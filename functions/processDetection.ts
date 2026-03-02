/**
 * processDetection - Bridge between the Python CV pipeline and Base44 entities.
 *
 * Accepts POST /events/detections (mess detection) and POST /events/cleaner_presence
 * mirroring the Python FastAPI schema, then creates/updates Mission and TeamMember
 * records in the Base44 database.
 *
 * The Python detectors (rtsp_mess_detect_1.py / cleaner_detector.py) should point
 * their API_BASE at this function's URL.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ACTIVE_STATUSES = ["pending", "assigned", "in_progress"];

// Priority mapping: 1 = critical, 2 = high, 3 = medium, 4-5 = low
function mapPriority(numericPriority) {
  if (numericPriority <= 1) return "critical";
  if (numericPriority === 2) return "high";
  if (numericPriority === 3) return "medium";
  return "low";
}

function detectionsToTitle(clsCounts, zoneName) {
  const types = Object.keys(clsCounts);
  if (types.length === 0) return `Cleaning task in ${zoneName}`;
  const top = types.sort((a, b) => clsCounts[b] - clsCounts[a])[0];
  const count = Object.values(clsCounts).reduce((s, v) => s + v, 0);
  const titles = {
    "misaligned chair": `Realign chair in ${zoneName} (${count} detected)`,
    "objects on the floor": `Pick up objects on the floor in ${zoneName} (${count} items)`,
    "scattered paper": `Collect scattered papers in ${zoneName} (${count} sheets)`,
    "messy desk": `Tidy desk area in ${zoneName} (${count} desks)`,
    "trash": `Remove trash in ${zoneName}`,
    "messy room": `Clean messy room in ${zoneName}`,
    "unmade bed": `Make bed in ${zoneName}`,
    "misplaced dishes": `Return misplaced dishes in ${zoneName}`,
    "dirty dishes": `Clean dirty dishes in ${zoneName}`,
    "rumpled sheets": `Smooth sheets in ${zoneName}`,
    "misaligned pillow": `Adjust pillow in ${zoneName}`,
    "open drawers": `Close drawers in ${zoneName}`,
    "misaligned blanket": `Straighten blanket in ${zoneName}`,
  };
  return titles[top] || `Clean-up: ${top} in ${zoneName} (${count} detected)`;
}

function calcCoverage(imgW, imgH, boxes) {
  const imgArea = Math.max(1, imgW * imgH);
  const covered = boxes.reduce((s, b) => {
    return s + Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  }, 0);
  return (100.0 * covered) / imgArea;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/[^/]+/, ""); // strip function prefix

  // ── POST /events/detections ──────────────────────────────────────────────
  if (req.method === "POST" && path === "/events/detections") {
    const body = await req.json();
    const { camera_id, ts_utc, img_w = 1920, img_h = 1080, model = "unknown", frame_path, boxes = [] } = body;

    if (!camera_id) {
      return Response.json({ error: "camera_id required" }, { status: 400 });
    }

    const hasBoxes = boxes.length > 0;

    // Find matching camera in Base44
    let cameras = [];
    try {
      cameras = await base44.asServiceRole.entities.Camera.filter({ id: camera_id });
    } catch (_) {}
    if (!cameras.length) {
      // Try by name fallback
      cameras = await base44.asServiceRole.entities.Camera.list();
    }
    const camera = cameras.find(c => c.id === camera_id || c.name === camera_id) || cameras[0];
    const location = camera ? (camera.location || camera.name) : camera_id;
    const zoneName = camera ? (camera.zone || camera.location || camera.name) : camera_id;

    const created = [];

    if (hasBoxes) {
      // Count classes
      const clsCounts = {};
      for (const b of boxes) {
        clsCounts[b.cls] = (clsCounts[b.cls] || 0) + 1;
      }
      const coverage = calcCoverage(img_w, img_h, boxes);

      // Dedupe: check if active mission already exists for this camera in last 5 min
      const existingMissions = await base44.asServiceRole.entities.Mission.filter({ camera_id });
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentActive = existingMissions.find(m =>
        ACTIVE_STATUSES.includes(m.status) &&
        new Date(m.created_date) > fiveMinsAgo
      );

      if (!recentActive) {
        // Priority heuristic
        const totalBoxes = Object.values(clsCounts).reduce((s, v) => s + v, 0);
        let numPriority = 3; // medium default
        if (coverage >= 15 || totalBoxes >= 6) numPriority = 1; // critical
        else if (coverage >= 8 || totalBoxes >= 3) numPriority = 2; // high

        const title = detectionsToTitle(clsCounts, zoneName);
        const detectionTypes = Object.keys(clsCounts).join(", ");
        const topConf = boxes.reduce((max, b) => Math.max(max, b.conf || 0), 0);

        const mission = await base44.asServiceRole.entities.Mission.create({
          title,
          camera_id,
          location,
          status: "pending",
          priority: mapPriority(numPriority),
          detection_type: detectionTypes,
          detection_confidence: Math.round(topConf * 100),
          snapshot_url: frame_path || null,
          estimated_duration: numPriority <= 2 ? 20 : 10,
        });

        created.push(mission.id);

        // Update camera status + detection count
        if (camera) {
          await base44.asServiceRole.entities.Camera.update(camera.id, {
            status: "detecting",
            detection_count_today: (camera.detection_count_today || 0) + 1,
          });
        }

        // Auto-assign: pick first available team member
        const team = await base44.asServiceRole.entities.TeamMember.filter({ status: "available" });
        if (team.length > 0) {
          // Pick member with fewest open missions
          const allMissions = await base44.asServiceRole.entities.Mission.list();
          const activeMissions = allMissions.filter(m => ACTIVE_STATUSES.includes(m.status));
          const counts = {};
          for (const t of team) counts[t.name] = 0;
          for (const m of activeMissions) if (m.assigned_to && counts[m.assigned_to] !== undefined) counts[m.assigned_to]++;
          const assignee = team.sort((a, b) => (counts[a.name] || 0) - (counts[b.name] || 0))[0];

          await base44.asServiceRole.entities.Mission.update(mission.id, {
            status: "assigned",
            assigned_to: assignee.name,
          });
          await base44.asServiceRole.entities.TeamMember.update(assignee.id, {
            status: "busy",
            current_mission_id: mission.id,
          });
          created[created.length - 1] = mission.id; // already added
        }
      }
    } else {
      // No boxes = clean frame → resolve CleanerOnSite/in_progress missions
      const existingMissions = await base44.asServiceRole.entities.Mission.filter({ camera_id });
      for (const m of existingMissions) {
        if (m.status === "in_progress" || m.status === "assigned") {
          await base44.asServiceRole.entities.Mission.update(m.id, {
            status: "completed",
            completed_at: new Date().toISOString(),
          });
          // Free up the assignee
          if (m.assigned_to) {
            const member = (await base44.asServiceRole.entities.TeamMember.list())
              .find(t => t.name === m.assigned_to);
            if (member) {
              await base44.asServiceRole.entities.TeamMember.update(member.id, {
                status: "available",
                current_mission_id: null,
                missions_completed_today: (member.missions_completed_today || 0) + 1,
              });
            }
          }
        }
      }
      // Reset camera to online
      if (camera) {
        await base44.asServiceRole.entities.Camera.update(camera.id, { status: "online" });
      }
    }

    return Response.json({ status: "ok", created_missions: created });
  }

  // ── POST /events/cleaner_presence ────────────────────────────────────────
  if (req.method === "POST" && path === "/events/cleaner_presence") {
    const body = await req.json();
    const { camera_id, persons = [] } = body;

    if (!camera_id) return Response.json({ error: "camera_id required" }, { status: 400 });

    const cleanerTracks = persons.filter(p =>
      (p.label === "cleaner" || p.is_cleaner) &&
      (p.score_ema >= 0.6 || p.score >= 0.6 || p.is_cleaner)
    );
    if (cleanerTracks.length === 0) {
      return Response.json({ status: "ignored_no_cleaner" });
    }

    // Find active mission on this camera and advance its status
    const allMissions = await base44.asServiceRole.entities.Mission.list();
    const activeMission = allMissions
      .filter(m => m.camera_id === camera_id && ["pending", "assigned"].includes(m.status))
      .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];

    let updatedTask = null;
    if (activeMission) {
      await base44.asServiceRole.entities.Mission.update(activeMission.id, {
        status: "in_progress",
      });
      updatedTask = activeMission.id;

      // Update camera status
      const cameras = await base44.asServiceRole.entities.Camera.list();
      const camera = cameras.find(c => c.id === camera_id);
      if (camera) {
        await base44.asServiceRole.entities.Camera.update(camera.id, { status: "detecting" });
      }
    }

    return Response.json({ status: "ok", updated_task: updatedTask });
  }

  // ── POST /events/simulate ─── Manual trigger for demo/testing ────────────
  if (req.method === "POST" && path === "/events/simulate") {
    const body = await req.json();
    const { camera_id, detection_type = "trash", confidence = 85 } = body;

    if (!camera_id) return Response.json({ error: "camera_id required" }, { status: 400 });

    const cameras = await base44.asServiceRole.entities.Camera.list();
    const camera = cameras.find(c => c.id === camera_id) || cameras[0];
    if (!camera) return Response.json({ error: "no cameras found" }, { status: 404 });

    const fakeBoxes = [
      { x1: 100, y1: 100, x2: 300, y2: 300, cls: detection_type, conf: confidence / 100 }
    ];

    // Reuse detection logic
    const internalReq = new Request(req.url.replace("/events/simulate", "/events/detections"), {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({
        camera_id: camera.id,
        ts_utc: new Date().toISOString(),
        img_w: 1920,
        img_h: 1080,
        model: "simulate",
        boxes: fakeBoxes,
      }),
    });
    // Direct call to internal logic
    const clsCounts = { [detection_type]: 1 };
    const location = camera.location || camera.name;
    const zoneName = camera.zone || camera.location || camera.name;
    const title = detectionsToTitle(clsCounts, zoneName);

    const existingMissions = await base44.asServiceRole.entities.Mission.filter({ camera_id: camera.id });
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentActive = existingMissions.find(m =>
      ACTIVE_STATUSES.includes(m.status) && new Date(m.created_date) > fiveMinsAgo
    );

    if (recentActive) {
      return Response.json({ status: "deduplicated", existing_mission: recentActive.id });
    }

    const mission = await base44.asServiceRole.entities.Mission.create({
      title,
      camera_id: camera.id,
      location,
      status: "pending",
      priority: "high",
      detection_type,
      detection_confidence: confidence,
      estimated_duration: 15,
    });

    await base44.asServiceRole.entities.Camera.update(camera.id, {
      status: "detecting",
      detection_count_today: (camera.detection_count_today || 0) + 1,
    });

    const team = await base44.asServiceRole.entities.TeamMember.filter({ status: "available" });
    let assignedTo = null;
    if (team.length > 0) {
      const assignee = team[0];
      await base44.asServiceRole.entities.Mission.update(mission.id, {
        status: "assigned",
        assigned_to: assignee.name,
      });
      await base44.asServiceRole.entities.TeamMember.update(assignee.id, {
        status: "busy",
        current_mission_id: mission.id,
      });
      assignedTo = assignee.name;
    }

    return Response.json({ status: "ok", mission_id: mission.id, assigned_to: assignedTo });
  }

  // ── GET /health ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    return Response.json({
      status: "ok",
      endpoints: [
        "POST /events/detections  — receive YOLO mess detections from Python detector",
        "POST /events/cleaner_presence — receive cleaner tracking events",
        "POST /events/simulate — manually trigger a detection (demo/test)",
      ],
    });
  }

  return Response.json({ error: "not found" }, { status: 404 });
});