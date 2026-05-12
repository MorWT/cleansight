from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from sqlmodel import Session
from typing import Optional
from database import init_db, get_session
import crud
from schemas import CameraCreate, CameraRead, MissionCreate, MissionUpdate, MissionRead, DetectionIn
from models import Camera
from websocket import manager
import cv2
import glob

app = FastAPI(title="CV Missions Backend")

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def gen_frames(video_path):
    cap = cv2.VideoCapture(video_path)
    while True:
        success, frame = cap.read()
        if not success:
            break
        # Encode frame as JPEG
        ret, buffer = cv2.imencode('.jpg', frame)
        frame = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
    cap.release()

@app.get("/video_feed")
def video_feed():
    return StreamingResponse(gen_frames("dataset/videos/27092-361827484_small.mp4"), media_type="multipart/x-mixed-replace; boundary=frame")

@app.on_event("startup")
def on_startup():
    init_db()
    # Optional: seed
    try:
        from database import engine
        from .seed import seed
        from sqlmodel import Session
        with Session(engine) as s:
            seed(s)
    except Exception:
        pass

# ---- Cameras ----
@app.get("/cameras", response_model=list[CameraRead])
def list_cameras(session: Session = Depends(get_session)):
    return crud.list_cameras(session)

@app.post("/cameras", response_model=CameraRead)
def add_camera(payload: CameraCreate, session: Session = Depends(get_session)):
    cam = Camera(**payload.dict())
    session.add(cam)
    session.commit()
    session.refresh(cam)
    return cam

# ---- Missions ----
@app.get("/missions", response_model=list[MissionRead])
def get_missions(status: Optional[str] = None, session: Session = Depends(get_session)):
    return crud.list_missions(session, status)

@app.post("/missions", response_model=MissionRead)
async def create_mission(payload: MissionCreate, session: Session = Depends(get_session)):
    mission = crud.create_mission(session,
                                  title=payload.title,
                                  description=payload.description or "",
                                  camera_id=payload.camera_id,
                                  priority=payload.priority)
    await manager.broadcast({"type": "mission_created", "data": mission.model_dump()})
    return mission

@app.patch("/missions/{mission_id}", response_model=MissionRead)
async def patch_mission(mission_id: int, payload: MissionUpdate, session: Session = Depends(get_session)):
    mission = crud.update_mission(session, mission_id, **payload.dict(exclude_unset=True))
    await manager.broadcast({"type": "mission_updated", "data": mission.model_dump()})
    return mission


@app.get("/latest_detection")
def latest_detection():
    files = sorted(glob.glob("samples/*.jpg"))
    if not files:
        return Response(status_code=404)
    return FileResponse(files[-1], media_type="image/jpeg")

# ---- CV pipeline hook ----
@app.post("/detections")
async def post_detection(payload: DetectionIn, session: Session = Depends(get_session)):
    event = crud.record_detection(session,
                                  camera_id=payload.camera_id,
                                  label=payload.label,
                                  severity=payload.severity,
                                  confidence=payload.confidence,
                                  image_url=payload.image_url)
    # Example policy: create a mission on certain labels
    title = f"Clean-up: {payload.label} (sev {payload.severity})"
    mission = crud.create_mission(session, title=title, description=f"Auto from camera {payload.camera_id}", camera_id=payload.camera_id)
    mission = crud.auto_assign(session, mission)
    await manager.broadcast({"type": "detection", "data": {"event_id": event.id, "mission": mission.model_dump()}})
    return {"ok": True, "event_id": event.id, "mission_id": mission.id}

# ---- WebSocket for realtime pushes ----
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We don't expect messages from client now, but keep alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)