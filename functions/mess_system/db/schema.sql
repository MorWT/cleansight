CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS zones (
  zone_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT NOT NULL,
  floor    TEXT,
  building TEXT
);

CREATE TABLE IF NOT EXISTS cameras (
  camera_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  rtsp_url  TEXT,
  zone_id   UUID REFERENCES zones(zone_id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS detections (
  detection_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id        UUID REFERENCES cameras(camera_id) ON DELETE CASCADE,
  ts_utc           TIMESTAMPTZ NOT NULL,
  boxes            JSONB NOT NULL,
  meta             JSONB,
  hash_fingerprint TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS mess_events (
  event_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id  UUID REFERENCES cameras(camera_id),
  ts_start   TIMESTAMPTZ NOT NULL,
  ts_end     TIMESTAMPTZ,
  severity   INTEGER NOT NULL,
  summary    JSONB
);

CREATE TABLE IF NOT EXISTS rules (
  rule_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  enabled         BOOLEAN DEFAULT TRUE,
  min_boxes       INTEGER DEFAULT 1,
  min_coverage_pct NUMERIC DEFAULT 0,
  class_any       TEXT[],
  zone_any        UUID[],
  active_hours    INT4RANGE[],
  weekdays_any    INT[],
  task_title_tmpl TEXT NOT NULL,
  base_priority   INTEGER NOT NULL,
  sla_minutes     INTEGER NOT NULL,
  cooldown_s      INTEGER DEFAULT 300
);

CREATE TABLE IF NOT EXISTS cleaners (
  cleaner_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  skills     TEXT[],
  zone_pref  UUID[],
  is_on_shift BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES mess_events(event_id),
  camera_id  UUID REFERENCES cameras(camera_id),
  zone_id    UUID REFERENCES zones(zone_id),
  title      TEXT NOT NULL,
  description TEXT,
  priority   INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  sla_due    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  dedupe_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID REFERENCES tasks(task_id),
  cleaner_id    UUID REFERENCES cleaners(cleaner_id),
  assigned_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_det_cam_ts ON detections (camera_id, ts_utc);
CREATE INDEX IF NOT EXISTS idx_tasks_status_prio ON tasks (status, priority, sla_due);

-- Journal every task state transition for KPIs
CREATE TABLE IF NOT EXISTS task_journal (
  journal_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID REFERENCES tasks(task_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  reason      TEXT,                  -- e.g., 'CleanerDetector', 'VisionClear', 'Dispatcher'
  meta        JSONB,                 -- optional small blob
  ts_utc      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_task_ts ON task_journal (task_id, ts_utc);

-- Raw cleaner presence events (for traceability / analytics)
CREATE TABLE IF NOT EXISTS cleaner_events (
  cleaner_ev_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id     UUID REFERENCES cameras(camera_id) ON DELETE CASCADE,
  ts_utc        TIMESTAMPTZ NOT NULL,
  img_w         INTEGER,
  img_h         INTEGER,
  persons       JSONB NOT NULL,      -- [{"bbox":[x,y,w,h], "is_cleaner":true, "score":0.83}, ...]
  meta          JSONB                -- model name, frame_path, etc.
);
CREATE INDEX IF NOT EXISTS idx_cleaner_cam_ts ON cleaner_events (camera_id, ts_utc);

-- Simple presence window cache to smooth state changes (optional but useful)
CREATE TABLE IF NOT EXISTS presence_cache (
  camera_id  UUID PRIMARY KEY,
  last_cleaner_ts TIMESTAMPTZ,       -- last time we saw a cleaner on-site (vision)
  last_mess_clear_ts TIMESTAMPTZ     -- last time mess score was below threshold (vision)
);


-- KPI VIEWS AND METRICS
CREATE OR REPLACE VIEW kpi_task_deltas AS
SELECT
  t.task_id,
  MIN(CASE WHEN j.to_status='MissionCreated'     THEN j.ts_utc END) AS t_created,
  MIN(CASE WHEN j.to_status='Assigned'           THEN j.ts_utc END) AS t_assigned,
  MIN(CASE WHEN j.to_status='CleanerOnSite'      THEN j.ts_utc END) AS t_onsite,
  MIN(CASE WHEN j.to_status='CleaningInProgress' THEN j.ts_utc END) AS t_cleaning,
  MIN(CASE WHEN j.to_status='Verification'       THEN j.ts_utc END) AS t_verify,
  MIN(CASE WHEN j.to_status='Resolved'           THEN j.ts_utc END) AS t_resolved
FROM tasks t
LEFT JOIN task_journal j ON j.task_id=t.task_id
GROUP BY t.task_id;
