-- ===========================
-- 1. ZONES (Rooms / Areas)
-- ===========================
INSERT INTO zones (name, floor, building)
VALUES 
  ('Lobby', 'G', 'HQ'),
  ('Kitchen', '1', 'HQ'),
  ('Conference Room', '2', 'HQ');

-- ===========================
-- 2. CAMERAS (RTSP or MP4)
-- Each camera belongs to one zone
-- ===========================
INSERT INTO cameras (name, rtsp_url, zone_id, is_active)
VALUES
  ('Lobby-Cam-1', 'dataset/videos/27092-361827484_small.mp4', 
       (SELECT zone_id FROM zones WHERE name='Lobby'), TRUE),
  ('Kitchen-Cam-1', 'dataset/videos/27092-361827484_small.mp4', 
       (SELECT zone_id FROM zones WHERE name='Kitchen'), TRUE),
  ('ConfRoom-Cam-1', 'dataset/videos/27092-361827484_small.mp4', 
       (SELECT zone_id FROM zones WHERE name='Conference Room'), TRUE);

       
-- ===========================
-- 3. RULES (Mess detection → Task logic)
-- ===========================
-- ------------------------------------------------------------
--  Mess-detection rules seeded for YOLOv8n-mess model
-- ------------------------------------------------------------

INSERT INTO rules
  (name, enabled, min_boxes, min_coverage_pct, class_any,
   task_title_tmpl, base_priority, sla_minutes, cooldown_s)
VALUES
  ('Rule: Misaligned Chair',
   TRUE, 1, 0, ARRAY['misaligned chair'],
   'Realign chair in {zone} ({count} detected)', 2, 15, 300),

  ('Rule: Objects on the Floor',
   TRUE, 1, 0, ARRAY['objects on the floor'],
   'Pick up objects on the floor in {zone} ({count} items)', 1, 15, 300),

  ('Rule: Scattered Paper',
   TRUE, 1, 0, ARRAY['scattered paper'],
   'Collect scattered papers in {zone} ({count} sheets)', 2, 15, 300),

  ('Rule: Messy Desk',
   TRUE, 1, 0, ARRAY['messy desk'],
   'Tidy desk area in {zone} ({count} desks)', 2, 15, 300),

  ('Rule: Trash',
   TRUE, 1, 0, ARRAY['trash'],
   'Remove trash in {zone}', 1, 10, 300),

  ('Rule: Messy Room',
   TRUE, 1, 0, ARRAY['messy room'],
   'Clean messy room in {zone}', 1, 20, 300),

  ('Rule: Unmade Bed',
   TRUE, 1, 0, ARRAY['unmade bed'],
   'Make bed in {zone}', 2, 15, 300),

  ('Rule: Misplaced Dishes',
   TRUE, 1, 0, ARRAY['misplaced dishes'],
   'Return misplaced dishes in {zone}', 2, 15, 300),

  ('Rule: Misaligned Blanket',
   TRUE, 1, 0, ARRAY['misaligned blanket'],
   'Straighten blanket in {zone}', 2, 15, 300),

  ('Rule: Open Drawers',
   TRUE, 1, 0, ARRAY['open drawers'],
   'Close drawers in {zone}', 2, 15, 300),

  ('Rule: Dirty Dishes',
   TRUE, 1, 0, ARRAY['dirty dishes'],
   'Clean dirty dishes in {zone}', 1, 15, 300),

  ('Rule: Rumpled Sheets',
   TRUE, 1, 0, ARRAY['rumpled sheets'],
   'Smooth sheets in {zone}', 2, 15, 300),

  ('Rule: Misaligned Pillow',
   TRUE, 1, 0, ARRAY['misaligned pillow'],
   'Adjust pillow in {zone}', 2, 15, 300);


-- ===========================
-- 4. CLEANERS (Optional for auto-assignment)
-- ===========================
INSERT INTO cleaners (name, skills, is_on_shift)
VALUES
  ('Dana', ARRAY['mess','spill','trash'], TRUE),
  ('Tom',  ARRAY['trash','mess'], FALSE);
