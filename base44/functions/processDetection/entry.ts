/**
 * processDetection - Bridge between the Python CV pipeline and Base44 entities.
 *
 * All calls come in as POST to "/". The "action" field in the body selects the handler:
 *   action="detections"         — receive YOLO mess detections
 *   action="cleaner_presence"   — receive cleaner tracking events
 *   action="simulate"           — manually trigger a detection (demo/test)
 *
 * The Python detectors should POST to the function URL with the action field.
 * Alternatively, the path-based routing (/events/detections, /events/cleaner_presence)
 * is supported for direct integration.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ACTIVE_STATUSES = ["pending", "assigned", "in_progress"];

function mapPriority(n) {
  if (n <= 1) return "critical";
  if (n === 2) return "high";
  if (n === 3) return "medium";
  return "low";
}

function detectionsToTitle(clsCounts, zoneName) {
  const types = Object.keys(clsCounts);
  if (!types.length) return `Cleaning task in ${zoneName}`;
  const top = types.sort((a, b) => clsCounts[b] - clsCounts[a])[0];
  const count = Object.values(clsCounts).reduce((s, v) => s + v, 0);
  const map = {
    "misaligned chair": `Realign chair in ${zoneName} (${count} detected)`,
    "objects on the floor": `Pick up objects on the floor in ${zoneName}`,
    "scattered paper": `Collect scattered papers in ${zoneName}`,
    "messy desk": `Tidy desk area in ${zoneName}`,
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
  return map[top] || `Clean-up: ${top} in ${zoneName} (${count} detected)`;
}

function calcCoverage(w, h, boxes) {
  const area = Math.max(1, w * h);
  const covered = boxes.reduce((s, b) => s + Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1), 0);
  return (100 * covered) / area;
}

async function handleDetections(base44, body) {
  const { camera_id, img_w = 1920, img_h = 1080, frame_path, boxes = [] } = body;
  if (!camera_id) return Response.json({ error: "camera_id required" }, { status: 400 });

  const hasBoxes = boxes.length > 0;
  const allCameras = await base44.asServiceRole.entities.Camera.list();
  const camera = allCameras.find(c => c.id === camera_id || c.name === camera_id) || allCameras[0];
  const location = camera ? (camera.location || camera.name) : camera_id;
  const zoneName = camera ? (camera.zone || camera.location || camera.name) : camera_id;
  const realCameraId = camera ? camera.id : camera_id;

  const created = [];

  if (hasBoxes) {
    const clsCounts = {};
    for (const b of boxes) clsCounts[b.cls] = (clsCounts[b.cls] || 0) + 1;
    const coverage = calcCoverage(img_w, img_h, boxes);

    const existingMissions = await base44.asServiceRole.entities.Mission.list();
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentActive = existingMissions.find(m =>
      m.camera_id === realCameraId &&
      ACTIVE_STATUSES.includes(m.status) &&
      new Date(m.created_date) > fiveMinsAgo
    );

    if (!recentActive) {
      const totalBoxes = Object.values(clsCounts).reduce((s, v) => s + v, 0);
      let numPriority = 3;
      if (coverage >= 15 || totalBoxes >= 6) numPriority = 1;
      else if (coverage >= 8 || totalBoxes >= 3) numPriority = 2;

      const topConf = boxes.reduce((max, b) => Math.max(max, b.conf || 0), 0);

      const mission = await base44.asServiceRole.entities.Mission.create({
        title: detectionsToTitle(clsCounts, zoneName),
        camera_id: realCameraId,
        location,
        status: "pending",
        priority: mapPriority(numPriority),
        detection_type: Object.keys(clsCounts).join(", "),
        detection_confidence: Math.round(topConf * 100),
        snapshot_url: frame_path || null,
        estimated_duration: numPriority <= 2 ? 20 : 10,
      });
      created.push(mission.id);

      if (camera) {
        await base44.asServiceRole.entities.Camera.update(camera.id, {
          status: "detecting",
          detection_count_today: (camera.detection_count_today || 0) + 1,
        });
      }

      // Auto-assign to least-busy available member
      const team = await base44.asServiceRole.entities.TeamMember.filter({ status: "available" });
      if (team.length > 0) {
        const counts = {};
        for (const t of team) counts[t.name] = 0;
        const activeMissions = existingMissions.filter(m => ACTIVE_STATUSES.includes(m.status));
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
      }
    }
  } else {
    // Clean frame → resolve active missions on this camera
    const allMissions = await base44.asServiceRole.entities.Mission.list();
    for (const m of allMissions) {
      if (m.camera_id === realCameraId && ["in_progress", "assigned"].includes(m.status)) {
        await base44.asServiceRole.entities.Mission.update(m.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
        if (m.assigned_to) {
          const allTeam = await base44.asServiceRole.entities.TeamMember.list();
          const member = allTeam.find(t => t.name === m.assigned_to);
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
    if (camera) {
      await base44.asServiceRole.entities.Camera.update(camera.id, { status: "online" });
    }
  }

  return Response.json({ status: "ok", created_missions: created });
}

async function handleCleanerPresence(base44, body) {
  const { camera_id, persons = [] } = body;
  if (!camera_id) return Response.json({ error: "camera_id required" }, { status: 400 });

  const cleaners = persons.filter(p =>
    (p.label === "cleaner" || p.is_cleaner) &&
    ((p.score_ema || p.score || 0) >= 0.6 || p.is_cleaner)
  );
  if (!cleaners.length) return Response.json({ status: "ignored_no_cleaner" });

  const allCameras = await base44.asServiceRole.entities.Camera.list();
  const camera = allCameras.find(c => c.id === camera_id || c.name === camera_id);
  const realCameraId = camera ? camera.id : camera_id;

  const allMissions = await base44.asServiceRole.entities.Mission.list();
  const active = allMissions
    .filter(m => m.camera_id === realCameraId && ["pending", "assigned"].includes(m.status))
    .sort((a, b) => new Date(a.created_date) - new Date(b.created_date))[0];

  let updatedTask = null;
  if (active) {
    await base44.asServiceRole.entities.Mission.update(active.id, { status: "in_progress" });
    updatedTask = active.id;
    if (camera) {
      await base44.asServiceRole.entities.Camera.update(camera.id, { status: "detecting" });
    }
  }
  return Response.json({ status: "ok", updated_task: updatedTask });
}

async function handleSimulate(base44, body) {
  const { camera_id, detection_type = "trash", confidence = 85 } = body;
  if (!camera_id) return Response.json({ error: "camera_id required" }, { status: 400 });

  const allCameras = await base44.asServiceRole.entities.Camera.list();
  const camera = allCameras.find(c => c.id === camera_id || c.name === camera_id) || allCameras[0];
  if (!camera) return Response.json({ error: "no cameras found" }, { status: 404 });

  const zoneName = camera.zone || camera.location || camera.name;
  const clsCounts = { [detection_type]: 1 };

  const allMissions = await base44.asServiceRole.entities.Mission.list();
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentActive = allMissions.find(m =>
    m.camera_id === camera.id &&
    ACTIVE_STATUSES.includes(m.status) &&
    new Date(m.created_date) > fiveMinsAgo
  );
  if (recentActive) return Response.json({ status: "deduplicated", existing_mission: recentActive.id });

  const mission = await base44.asServiceRole.entities.Mission.create({
    title: detectionsToTitle(clsCounts, zoneName),
    camera_id: camera.id,
    location: camera.location || camera.name,
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const url = new URL(req.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);

  // Determine action from path or body
  let body = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  // Path-based routing (Python detectors): /processDetection/events/detections
  const eventIdx = pathSegments.indexOf("events");
  const pathAction = eventIdx >= 0 ? pathSegments[eventIdx + 1] : null;
  // Body-based routing (SDK from frontend): { action: "simulate", ... }
  const action = pathAction || body.action || "simulate";

  if (req.method === "POST") {
    if (action === "detections") return handleDetections(base44, body);
    if (action === "cleaner_presence") return handleCleanerPresence(base44, body);
    if (action === "simulate") return handleSimulate(base44, body);
  }

  return Response.json({
    status: "ok",
    endpoints: {
      "POST body:{action:'detections', camera_id, boxes:[]}": "Ingest YOLO mess detections",
      "POST body:{action:'cleaner_presence', camera_id, persons:[]}": "Ingest cleaner presence events",
      "POST body:{action:'simulate', camera_id, detection_type, confidence}": "Trigger demo detection",
    },
  });
});