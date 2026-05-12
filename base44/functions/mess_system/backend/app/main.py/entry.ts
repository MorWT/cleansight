from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os, json, hashlib
from fastapi import HTTPException


load_dotenv()

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}"
)
engine = create_engine(DB_URL, pool_pre_ping=True)

app = FastAPI(title="Mess Events & Tasks API")

# lifecycle timing knobs
T_CLEAR_SECONDS = int(os.getenv("T_CLEAR_SECONDS", "10"))  # CleanerOnSite -> Verification/Resolved

ACTIVE_STATUSES = (
    "OPEN", "MissionCreated", "AssignmentPending",
    "Assigned", "CleanerOnSite", "CleaningInProgress",
    "Verification", "IN_PROGRESS", "ASSIGNED"
)

def _transition_task(conn, task_id: str, new_status: str,
                     reason: str, meta: Optional[dict] = None) -> None:
    """
    Update tasks.status and append to task_journal in a single transaction.
    If status is already equal to new_status - no op.
    """
    row = conn.execute(
        text("SELECT status FROM tasks WHERE task_id = :t FOR UPDATE"),
        {"t": task_id}
    ).first()
    if not row:
        return
    old_status = row[0]
    if old_status == new_status:
        return

    conn.execute(
        text("UPDATE tasks SET status = :s, updated_at = now() WHERE task_id = :t"),
        {"s": new_status, "t": task_id}
    )
    conn.execute(
        text("""
            INSERT INTO task_journal (task_id, from_status, to_status, reason, meta)
            VALUES (:t, :from_s, :to_s, :reason, CAST(:meta AS JSONB))
        """),
        {
            "t": task_id,
            "from_s": old_status,
            "to_s": new_status,
            "reason": reason,
            "meta": json.dumps(meta or {})
        }
    )

class Box(BaseModel):
    x1: int; y1: int; x2: int; y2: int
    cls: str
    conf: float

class DetectionIn(BaseModel):
    camera_id: str
    ts_utc: datetime
    img_w: int
    img_h: int
    model: str
    frame_path: Optional[str] = None
    boxes: List[Box] = Field(default_factory=list)

class CleanerTrack(BaseModel):
    track_id: int
    bbox: List[int]            # [x, y, w, h]
    p_cleaner_model: float
    tool_near: bool
    cart_near: bool
    score_ema: float
    label: str                 # "cleaner" or "regular"
    locked: bool

class CleanerEventIn(BaseModel):
    camera_id: str
    ts_utc: datetime
    img_w: int
    img_h: int
    model: str
    frame_path: Optional[str] = None
    persons: List[CleanerTrack] = Field(default_factory=list)


def _area(b): return max(0, b["x2"]-b["x1"]) * max(0, b["y2"]-b["y1"])
def _coverage(w,h,boxes): 
    img = max(1, w*h); return 100.0 * sum(_area(b) for b in boxes)/img

@app.post("/events/detections")
def ingest(d: DetectionIn):
    # Do not early return on empty boxes - we want to see "clean" frames as well
    has_boxes = bool(d.boxes)

    # idempotency fingerprint
    sig = json.dumps({
        "camera_id": str(d.camera_id),
        "ts": d.ts_utc.astimezone(timezone.utc).isoformat()[:19],
        "boxes": sorted([
            [b.cls, round(b.conf, 2), b.x1//16, b.y1//16, b.x2//16, b.y2//16]
            for b in d.boxes
        ])
    }, sort_keys=True)
    fp = hashlib.sha1(sig.encode()).hexdigest()

    with engine.begin() as conn:
        # ---- augment boxes + coverage (keep your implementations of _area/_coverage) ----
        boxes_aug = []
        for b in d.boxes:
            bb = {"x1": b.x1, "y1": b.y1, "x2": b.x2, "y2": b.y2, "cls": b.cls, "conf": b.conf}
            bb["area"] = _area(bb)
            boxes_aug.append(bb)
        cov = _coverage(d.img_w, d.img_h, boxes_aug)

        # ---- store detection (note CAST + bound params) ----
        conn.execute(text("""
          INSERT INTO detections (camera_id, ts_utc, boxes, meta, hash_fingerprint)
          VALUES (:cam, :ts, CAST(:boxes AS JSONB), CAST(:meta AS JSONB), :fp)
          ON CONFLICT (hash_fingerprint) DO NOTHING
        """), {
          "cam": d.camera_id,
          "ts": d.ts_utc,
          "boxes": json.dumps(boxes_aug),
          "meta": json.dumps({
              "img_w": d.img_w, "img_h": d.img_h, "model": d.model, "frame_path": getattr(d, "frame_path", None),
              "coverage_pct": cov
          }),
          "fp": fp
        })

        created = []

        if has_boxes:
            # ---- get rules ----
            rules = conn.execute(text("SELECT * FROM rules WHERE enabled=TRUE")).mappings().all()
            if not rules:
                # Stored detection but nothing to trigger
                return {"status": "stored_no_rules"}

            # zone / camera info
            loc = conn.execute(text("""
                SELECT c.zone_id, z.name AS zone_name, c.name AS camera_name
                FROM cameras c
                LEFT JOIN zones z ON c.zone_id = z.zone_id
                WHERE c.camera_id = :cid
            """), {"cid": d.camera_id}).mappings().first()

            zone_id   = loc["zone_id"] if loc else None
            zone_name = (loc["zone_name"] or loc["camera_name"] or "area") if loc else "area"

            # classify counts
            cls_counts = {}
            for b in boxes_aug:
                cls_counts[b["cls"]] = cls_counts.get(b["cls"], 0) + 1

            now = d.ts_utc.astimezone(timezone.utc)

            # loop rules
            for r in rules:
                if len(boxes_aug) < int(r["min_boxes"] or 1):
                    continue
                if cov < float(r["min_coverage_pct"] or 0.0):
                    continue
                if r["class_any"] and not any(k in r["class_any"] for k in cls_counts.keys()):
                    continue

                # priority heuristic
                pr = max(1, min(5,
                    int(r["base_priority"]) +
                    (1 if cov >= 10 else 0) +
                    (1 if sum(cls_counts.values()) >= 5 else 0)
                ))

                # dedupe within cooldown - support old and new statuses
                dedupe = f"{d.camera_id}:{r['rule_id']}:{now.date()}"
                hit = conn.execute(text(f"""
                  SELECT 1 FROM tasks
                  WHERE dedupe_key = :k
                    AND status IN :active_statuses
                    AND (now() - created_at) < make_interval(secs => :cool)
                """).bindparams(active_statuses=tuple(ACTIVE_STATUSES))),
                {"k": dedupe, "cool": int(r["cooldown_s"] or 300)}).first()
                if hit:
                    continue

                # insert mess_event
                ev = conn.execute(text("""
                  INSERT INTO mess_events (camera_id, ts_start, severity, summary)
                  VALUES (:cam, :ts, :sev, CAST(:sum AS JSONB))
                  RETURNING event_id
                """), {
                  "cam": d.camera_id,
                  "ts": d.ts_utc,
                  "sev": pr,
                  "sum": json.dumps({"counts_by_class": cls_counts, "coverage_pct": cov})
                }).first()
                event_id = ev[0]

                # build title
                title = (r["task_title_tmpl"] or "Cleaning task").format(
                    zone=zone_name,
                    count=sum(cls_counts.values())
                )
                due = now + timedelta(minutes=int(r["sla_minutes"]))

                task = conn.execute(text("""
                  INSERT INTO tasks (event_id, camera_id, zone_id, title, priority, sla_due, dedupe_key)
                  VALUES (:ev, :cam, :zone, :title, :pr, :due, :dedupe)
                  RETURNING task_id
                """), {
                  "ev": event_id,
                  "cam": d.camera_id,
                  "zone": zone_id,
                  "title": title,
                  "pr": pr,
                  "due": due,
                  "dedupe": dedupe
                }).first()
                tid = str(task[0])
                created.append(tid)

                # transition NEW tasks from OPEN (default) -> MissionCreated
                _transition_task(conn, tid, "MissionCreated", reason="MessDetected", meta={
                    "rule_id": str(r["rule_id"]),
                    "zone_name": zone_name
                })

        # optional: simple auto-assign with journaling
        for tid in created:
            cleaner = conn.execute(text("""
              SELECT c.cleaner_id
              FROM cleaners c
              LEFT JOIN (
                SELECT a.cleaner_id, count(*) open_cnt
                FROM assignments a JOIN tasks t ON t.task_id = a.task_id
                WHERE t.status IN :active_statuses
                GROUP BY a.cleaner_id
              ) w ON w.cleaner_id = c.cleaner_id
              WHERE c.is_on_shift = TRUE
              ORDER BY COALESCE(w.open_cnt, 0) ASC
              LIMIT 1
            """).bindparams(active_statuses=tuple(ACTIVE_STATUSES))).first()

            if cleaner:
                conn.execute(
                    text("INSERT INTO assignments (task_id, cleaner_id) VALUES (:t, :c)"),
                    {"t": tid, "c": cleaner[0]}
                )
                _transition_task(conn, tid, "Assigned", reason="AutoDispatcher", meta={
                    "cleaner_id": str(cleaner[0])
                })
        
                # --- cleaning verification based on clear frames ---
        now_utc = d.ts_utc.astimezone(timezone.utc)

        if not has_boxes:
            # update presence_cache.last_mess_clear_ts
            pc = conn.execute(
                text("SELECT last_mess_clear_ts FROM presence_cache WHERE camera_id = :cam"),
                {"cam": d.camera_id}
            ).first()
            last_clear = pc[0] if pc else None

            if pc is None:
                conn.execute(
                    text("INSERT INTO presence_cache (camera_id, last_cleaner_ts, last_mess_clear_ts) VALUES (:cam, NULL, :ts)"),
                    {"cam": d.camera_id, "ts": now_utc}
                )
            else:
                conn.execute(
                    text("UPDATE presence_cache SET last_mess_clear_ts = :ts WHERE camera_id = :cam"),
                    {"cam": d.camera_id, "ts": now_utc}
                )

            if last_clear is not None and (now_utc - last_clear).total_seconds() >= T_CLEAR_SECONDS:
                # find active tasks on this camera that look like they are being cleaned
                rows = conn.execute(text("""
                  SELECT task_id, status
                  FROM tasks
                  WHERE camera_id = :cam
                    AND status IN ('CleanerOnSite', 'CleaningInProgress', 'Verification')
                """), {"cam": d.camera_id}).mappings().all()

                for row in rows:
                    tid = row["task_id"]
                    cur = row["status"]
                    if cur != "Verification":
                        _transition_task(conn, tid, "Verification", reason="VisionClear")
                    _transition_task(conn, tid, "Resolved", reason="VisionClear")



    return {"status": "ok", "created_tasks": created}


@app.post("/events/cleaner_presence")
def cleaner_presence(ev: CleanerEventIn):
    """
    Event from CleanerDetector.

    - Inserts a row into cleaner_events.
    - Updates presence_cache.last_cleaner_ts.
    - If at least one strong "cleaner" is present, transition latest task
      on that camera to CleanerOnSite.
    """
    if not ev.persons:
        return {"status": "ignored_no_persons"}

    # Only treat as confirmation if any track is labeled cleaner and decently confident
    cleaner_tracks = [p for p in ev.persons if p.label == "cleaner" and p.score_ema >= 0.6]
    if not cleaner_tracks:
        return {"status": "ignored_no_cleaner"}

    now_utc = ev.ts_utc.astimezone(timezone.utc)

    with engine.begin() as conn:
        # store raw event
        conn.execute(text("""
          INSERT INTO cleaner_events (camera_id, ts_utc, img_w, img_h, persons, meta)
          VALUES (:cam, :ts, :w, :h, CAST(:persons AS JSONB), CAST(:meta AS JSONB))
        """), {
          "cam": ev.camera_id,
          "ts": now_utc,
          "w": ev.img_w,
          "h": ev.img_h,
          "persons": json.dumps([p.dict() for p in ev.persons]),
          "meta": json.dumps({"model": ev.model, "frame_path": ev.frame_path})
        })

        # update presence_cache.last_cleaner_ts
        pc = conn.execute(
            text("SELECT last_cleaner_ts FROM presence_cache WHERE camera_id = :cam"),
            {"cam": ev.camera_id}
        ).first()
        if pc is None:
            conn.execute(
                text("INSERT INTO presence_cache (camera_id, last_cleaner_ts, last_mess_clear_ts) VALUES (:cam, :ts, NULL)"),
                {"cam": ev.camera_id, "ts": now_utc}
            )
        else:
            conn.execute(
                text("UPDATE presence_cache SET last_cleaner_ts = :ts WHERE camera_id = :cam"),
                {"cam": ev.camera_id, "ts": now_utc}
            )

        # choose latest active task on this camera
        row = conn.execute(text("""
          SELECT task_id, status
          FROM tasks
          WHERE camera_id = :cam
            AND status IN ('MissionCreated', 'AssignmentPending', 'Assigned', 'CleanerOnSite', 'CleaningInProgress')
          ORDER BY created_at ASC
          LIMIT 1
        """), {"cam": ev.camera_id}).mappings().first()

        updated_task = None
        if row:
            tid = row["task_id"]
            cur = row["status"]
            if cur in ("MissionCreated", "AssignmentPending", "Assigned"):
                _transition_task(conn, tid, "CleanerOnSite", reason="CleanerDetector", meta={
                    "n_cleaners": len(cleaner_tracks)
                })
                updated_task = tid
            elif cur == "CleanerOnSite":
                # you can choose to move to CleaningInProgress if you want
                _transition_task(conn, tid, "CleaningInProgress", reason="CleanerDetector", meta={
                    "n_cleaners": len(cleaner_tracks)
                })
                updated_task = tid

    return {"status": "ok", "updated_task": updated_task}



@app.get("/tasks")
def list_tasks(status: Optional[str] = Query(None)):
    q = "SELECT task_id,title,priority,status,sla_due,created_at FROM tasks"
    if status:
        q += " WHERE status=:s ORDER BY priority ASC, sla_due ASC"
        params = {"s": status}
    else:
        q += " ORDER BY created_at DESC LIMIT 100"
        params = {}
    with engine.begin() as conn:
        rows = conn.execute(text(q), params).mappings().all()
        return [dict(r) for r in rows]

@app.get("/cameras/by-name")
def get_camera_by_name(name: str):
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT camera_id, name, rtsp_url, zone_id, is_active
            FROM cameras WHERE name=:n
        """), {"n": name}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="camera not found")
        return dict(row)

@app.get("/cameras/{camera_id}")
def get_camera(camera_id: str):
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT camera_id, name, rtsp_url, zone_id, is_active
            FROM cameras WHERE camera_id=:cid
        """), {"cid": camera_id}).mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="camera not found")
        return dict(row)

