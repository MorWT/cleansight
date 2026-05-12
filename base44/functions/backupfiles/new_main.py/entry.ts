from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os, json, hashlib
from fastapi import HTTPException

#  --- NEW: tunables (with sane defaults) ---
T_MESS_PERSIST_S = int(os.getenv("T_MESS_PERSIST_S", "3"))     # require mess to persist >= N sec (debounce)
T_CLEAR_PERSIST_S = int(os.getenv("T_CLEAR_PERSIST_S", "4"))   # require clear to persist >= N sec
CLEANER_RADIUS_IOU = float(os.getenv("CLEANER_RADIUS_IOU", "0.05"))  # near = IoU >= 0.05 OR center distance < 1.2*max(w,h)
NEAR_CENTER_K = float(os.getenv("NEAR_CENTER_K", "1.2"))

# States (canonical)
S = {
  "open": "MissionCreated",
  "queue": "AssignmentPending",
  "assigned": "Assigned",
  "enroute": "WorkerEnRoute",
  "onsite": "CleanerOnSite",
  "cleaning": "CleaningInProgress",
  "verify": "Verification",
  "resolved": "Resolved",
  "reopen": "Reopen"
}

load_dotenv()

DB_URL = (
    f"postgresql+psycopg2://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
    f"@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}"
)
engine = create_engine(DB_URL, pool_pre_ping=True)

app = FastAPI(title="Mess Events & Tasks API")

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

class PersonDet(BaseModel):
    bbox: List[int]  # [x,y,w,h]
    is_cleaner: bool
    score: float

class CleanerPresenceIn(BaseModel):
    camera_id: str
    ts_utc: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    img_w: int
    img_h: int
    persons: List[PersonDet]
    model: Optional[str] = None
    frame_path: Optional[str] = None

class ClearanceIn(BaseModel):
    camera_id: str
    ts_utc: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    cleared: bool      # True if mess score < threshold


def _area(b): return max(0, b["x2"]-b["x1"]) * max(0, b["y2"]-b["y1"])
def _coverage(w,h,boxes): 
    img = max(1, w*h); return 100.0 * sum(_area(b) for b in boxes)/img

def _fingerprint(payload: dict) -> str:
    sig = json.dumps({
        "camera_id": payload["camera_id"],
        "ts": payload["ts_utc"][:19],
        "boxes": sorted([[b["cls"], round(b["conf"],2), b["x1"]//16, b["y1"]//16, b["x2"]//16, b["y2"]//16] for b in payload["boxes"]])
    }, sort_keys=True)
    return hashlib.sha1(sig.encode()).hexdigest()

def _active_hour(now_h, active_hours):
    if not active_hours: return True
    for rng in active_hours:
        # rng like "[8,20)"
        s = str(rng).strip("[]()").split(",")
        start, end = int(s[0]), int(s[1])
        if start <= now_h < end: return True
    return False

def _norm_prio(p): return max(1, min(5, p))

def _journal(conn, task_id: str, from_status: Optional[str], to_status: str, reason: str, meta: dict = None):
    conn.execute(text("""
        INSERT INTO task_journal (task_id, from_status, to_status, reason, meta)
        VALUES (:t,:f,:to,:r, CAST(:m AS JSONB))
    """), {"t": task_id, "f": from_status, "to": to_status, "r": reason, "m": json.dumps(meta or {})})

def _transition(conn, task_id: str, to_status: str, reason: str, meta: dict = None):
    # read current status
    row = conn.execute(text("SELECT status FROM tasks WHERE task_id=:t"), {"t": task_id}).first()
    cur = row[0] if row else None
    if cur == to_status:  # idempotent
        return
    _journal(conn, task_id, cur, to_status, reason, meta)
    conn.execute(text("UPDATE tasks SET status=:s, updated_at=now() WHERE task_id=:t"),
                 {"s": to_status, "t": task_id})
    

def _as_json_list(val):
    if val is None:
        return []
    if isinstance(val, (list, tuple)):
        return list(val)               # JSONB already decoded
    if isinstance(val, (bytes, bytearray)):
        try:
            return json.loads(val.decode("utf-8", errors="ignore"))
        except Exception:
            return []
    if isinstance(val, str):
        try:
            parsed = json.loads(val)   # TEXT containing JSON
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []

# --- Simple auto-dispatcher: pick least-loaded active cleaner (optionally by zone) ---
def choose_cleaner(conn, zone_id=None):
    # Count open assignments per cleaner to balance load
    # You may also add proximity logic by joining cleaners to cameras/zone
    rows = conn.execute(text("""
        WITH load AS (
            SELECT a.cleaner_id, COUNT(*) AS open_cnt
            FROM assignments a
            JOIN tasks t ON t.task_id = a.task_id
            WHERE t.status IN ('AssignmentPending','Assigned','WorkerEnRoute','CleanerOnSite','CleaningInProgress','Verification')
            GROUP BY a.cleaner_id
        )
        SELECT c.cleaner_id
        FROM cleaners c
        LEFT JOIN load l ON l.cleaner_id = c.cleaner_id
        WHERE c.is_active = TRUE
          AND ( :zid IS NULL OR c.zone_id = :zid OR c.zone_id IS NULL )
        ORDER BY COALESCE(l.open_cnt, 0) ASC, c.created_at ASC
        LIMIT 1
    """), {"zid": zone_id}).first()
    return rows[0] if rows else None


# --- Rules loader (optionally filter by zone) ---
def load_rules(conn, zone_id=None):
    # If you have per-zone rules, filter by zone_id; otherwise load all enabled rules
    if zone_id:
        rows = conn.execute(text("""
            SELECT *
            FROM rules
            WHERE enabled = TRUE
              AND (zone_id = :zid OR zone_id IS NULL)
            ORDER BY priority DESC, created_at ASC
        """), {"zid": zone_id}).mappings().all()
    else:
        rows = conn.execute(text("""
            SELECT *
            FROM rules
            WHERE enabled = TRUE
            ORDER BY priority DESC, created_at ASC
        """)).mappings().all()
    return rows



@app.post("/events/detections")
def ingest(d: DetectionIn):
    if not d.boxes:
        return {"status": "ignored_empty"}

    # ---- idempotency fingerprint (keep whatever you already had) ----
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

        # --- Debounce by persistence window (avoid one-off false alarms) ---
        persist_ok = False
        lookback = conn.execute(text("""
            SELECT ts_utc, boxes
            FROM detections
            WHERE camera_id = :cid
            AND ts_utc >= (:ts - make_interval(secs := :win))
            ORDER BY ts_utc DESC
            LIMIT 3
        """), {
            "cid": d.camera_id,
            "ts": d.ts_utc,
            "win": T_MESS_PERSIST_S
        }).mappings().all()

        if lookback:
            prev_classes = set()
            for row in lookback:
                for bb in _as_json_list(row["boxes"]):
                    cls_name = bb.get("cls") or bb.get("class") or bb.get("label")
                    if cls_name:
                        prev_classes.add(cls_name)
            persist_ok = any(c in prev_classes for c in cls_counts.keys())
        else:
            persist_ok = False

            if not persist_ok:
                return {"status": "stored_no_persist"}

        # ---- PRE-FETCH ZONE/CAMERA NAMES *ONCE* (so zone_id exists in outer scope) ----
        loc = conn.execute(text("""
            SELECT c.zone_id, z.name AS zone_name, c.name AS camera_name
            FROM cameras c
            LEFT JOIN zones z ON c.zone_id = z.zone_id
            WHERE c.camera_id = :cid
        """), {"cid": d.camera_id}).mappings().first()

        zone_id   = loc["zone_id"] if loc else None         # <-- now defined for all code below
        zone_name = (loc["zone_name"] or loc["camera_name"] or "area") if loc else "area"

        # ---- classify counts ----
        cls_counts = {}
        for b in boxes_aug:
            cls_counts[b["cls"]] = cls_counts.get(b["cls"], 0) + 1

        now = d.ts_utc.astimezone(timezone.utc)
        created = []

        # ---- loop rules ----
        rules = load_rules(conn, zone_id)
        for r in rules:
            if len(boxes_aug) < int(r["min_boxes"] or 1): 
                continue
            if cov < float(r["min_coverage_pct"] or 0.0): 
                continue
            if r["class_any"] and not any(k in r["class_any"] for k in cls_counts.keys()):
                continue

            # priority heuristic (keep your own if you have one)
            pr = max(1, min(5,
                int(r["base_priority"]) +
                (1 if cov >= 10 else 0) +
                (1 if sum(cls_counts.values()) >= 5 else 0)
            ))

            # dedupe within cooldown
            dedupe = f"{d.camera_id}:{r['rule_id']}:{now.date()}"
            hit = conn.execute(text("""
              SELECT 1 FROM tasks
              WHERE dedupe_key=:k
                AND status IN ('OPEN','ASSIGNED','IN_PROGRESS')
                AND (now() - created_at) < make_interval(secs => :cool)
            """), {"k": dedupe, "cool": int(r["cooldown_s"] or 300)}).first()
            if hit:
                continue

            # ---- insert mess_event ----
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

            # ---- build *readable* title using zone_name; store zone_id (UUID) ----
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
              "zone": zone_id,          # <-- uses the pre-fetched UUID
              "title": title,
              "pr": pr,
              "due": due,
              "dedupe": dedupe
            }).first()
            created.append(str(task[0]))

        # optional: simple auto-assign (unchanged)
        for tid in created:
            cleaner = conn.execute(text("""
              SELECT c.cleaner_id
              FROM cleaners c
              LEFT JOIN (
                SELECT a.cleaner_id, count(*) open_cnt
                FROM assignments a JOIN tasks t ON t.task_id=a.task_id
                WHERE t.status in ('OPEN','ASSIGNED','IN_PROGRESS')
                GROUP BY a.cleaner_id
              ) w ON w.cleaner_id=c.cleaner_id
              WHERE c.is_on_shift = TRUE
              ORDER BY COALESCE(w.open_cnt,0) ASC
              LIMIT 1
            """)).first()
            if cleaner:
                conn.execute(text("INSERT INTO assignments (task_id, cleaner_id) VALUES (:t,:c)"),
                             {"t": tid, "c": cleaner[0]})
                # new logic with journaling
                _transition(conn, tid, S["assigned"], "AutoAssign", {"cleaner_id": cleaner})


    return {"status": "ok", "created_tasks": created}



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


@app.post("/events/cleaner_presence")
def cleaner_presence(ev: CleanerPresenceIn):
    # 1) Record raw event
    with engine.begin() as conn:
        conn.execute(text("""
          INSERT INTO cleaner_events (camera_id, ts_utc, img_w, img_h, persons, meta)
          VALUES (:cid, :ts, :w, :h, CAST(:p AS JSONB), CAST(:m AS JSONB))
        """), {
            "cid": ev.camera_id,
            "ts": ev.ts_utc,
            "w": ev.img_w,
            "h": ev.img_h,
            "p": json.dumps([p.model_dump() for p in ev.persons]),
            "m": json.dumps({"model": ev.model, "frame_path": ev.frame_path})
        })

        # 2) Update presence cache if any cleaner found
        saw_cleaner = any(p.is_cleaner for p in ev.persons)
        if saw_cleaner:
            conn.execute(text("""
              INSERT INTO presence_cache (camera_id, last_cleaner_ts)
              VALUES (:cid, :ts)
              ON CONFLICT (camera_id) DO UPDATE SET last_cleaner_ts=EXCLUDED.last_cleaner_ts
            """), {"cid": ev.camera_id, "ts": ev.ts_utc})

        # 3) Find ACTIVE tasks for this camera that are in queue→assigned→enroute
        rows = conn.execute(text("""
          SELECT t.task_id, t.status
          FROM tasks t
          WHERE t.camera_id=:cid
            AND t.status IN (:s_assigned, :s_enroute, :s_onsite, :s_cleaning, :s_verify)
          ORDER BY t.created_at DESC
          LIMIT 3
        """), {
            "cid": ev.camera_id,
            "s_assigned": S["assigned"],
            "s_enroute":  S["enroute"],
            "s_onsite":   S["onsite"],
            "s_cleaning": S["cleaning"],
            "s_verify":   S["verify"]
        }).mappings().all()

        if not rows:
            return {"status": "ok", "updated": 0}

        # 4) If we saw a cleaner, move ASSIGNED/ENROUTE -> ONSITE
        updated = 0
        if saw_cleaner:
            for r in rows:
                if r["status"] in (S["assigned"], S["enroute"]):
                    _transition(conn, r["task_id"], S["onsite"], "CleanerDetector",
                                {"camera_id": ev.camera_id})
                    updated += 1
                elif r["status"] == S["onsite"]:
                    # optional: escalate to cleaning when cleaner persists ~2+ readings
                    _transition(conn, r["task_id"], S["cleaning"], "CleanerDetector",
                                {"camera_id": ev.camera_id})
                    updated += 1

        return {"status": "ok", "updated": updated}

@app.post("/events/clearance")
def clearance(ev: ClearanceIn):
    with engine.begin() as conn:
        if ev.cleared:
            # update cache
            conn.execute(text("""
              INSERT INTO presence_cache (camera_id, last_mess_clear_ts)
              VALUES (:cid, :ts)
              ON CONFLICT (camera_id) DO UPDATE SET last_mess_clear_ts=EXCLUDED.last_mess_clear_ts
            """), {"cid": ev.camera_id, "ts": ev.ts_utc})

            # pick relevant tasks
            rows = conn.execute(text("""
              SELECT t.task_id, t.status
              FROM tasks t
              WHERE t.camera_id=:cid
                AND t.status IN (:s_onsite,:s_cleaning,:s_verify)
              ORDER BY t.created_at DESC
              LIMIT 3
            """), {
                "cid": ev.camera_id,
                "s_onsite": S["onsite"], "s_cleaning": S["cleaning"], "s_verify": S["verify"]
            }).mappings().all()

            for r in rows:
                if r["status"] in (S["onsite"], S["cleaning"]):
                    _transition(conn, r["task_id"], S["verify"], "VisionClear", {"camera_id": ev.camera_id})

            # finalize if clear persisted for >= T_CLEAR_PERSIST_S
            row = conn.execute(text("""
              SELECT last_mess_clear_ts FROM presence_cache WHERE camera_id=:cid
            """), {"cid": ev.camera_id}).first()
            if row:
                last = row[0]
                if last and ev.ts_utc - last >= timedelta(seconds=T_CLEAR_PERSIST_S):
                    for r in rows:
                        _transition(conn, r["task_id"], S["resolved"], "VisionClearPersist", {"camera_id": ev.camera_id})
        else:
            # regression: if Verification in progress, bounce to Reopen
            rows = conn.execute(text("""
              SELECT t.task_id, t.status FROM tasks t
              WHERE t.camera_id=:cid AND t.status=:s_verify
            """), {"cid": ev.camera_id, "s_verify": S["verify"]}).mappings().all()
            for r in rows:
                _transition(conn, r["task_id"], S["reopen"], "VisionMessReturn", {"camera_id": ev.camera_id})

    return {"status": "ok"}
