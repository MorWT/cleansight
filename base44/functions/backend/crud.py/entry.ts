from typing import List, Optional
from sqlmodel import Session, select
from datetime import datetime
from models import Camera, Mission, DetectionEvent, TeamMember

# Cameras

def list_cameras(session: Session) -> List[Camera]:
    return session.exec(select(Camera).where(Camera.is_active == True)).all()

# Missions

def create_mission(session: Session, *, title: str, description: str = "", camera_id: Optional[int] = None, priority: int = 2) -> Mission:
    mission = Mission(title=title, description=description, camera_id=camera_id, priority=priority)
    session.add(mission)
    session.commit()
    session.refresh(mission)
    return mission


def update_mission(session: Session, mission_id: int, **fields) -> Mission:
    mission = session.get(Mission, mission_id)
    if not mission:
        raise ValueError("Mission not found")
    for k, v in fields.items():
        if v is not None:
            setattr(mission, k, v)
    mission.updated_at = datetime.utcnow()
    session.add(mission)
    session.commit()
    session.refresh(mission)
    return mission


def list_missions(session: Session, status: Optional[str] = None) -> List[Mission]:
    stmt = select(Mission)
    if status:
        stmt = stmt.where(Mission.status == status)
    return session.exec(stmt.order_by(Mission.created_at.desc())).all()

# Detections

def record_detection(session: Session, *, camera_id: int, label: str, severity: int, confidence: float, image_url: Optional[str]) -> DetectionEvent:
    event = DetectionEvent(camera_id=camera_id, label=label, severity=severity, confidence=confidence, image_url=image_url)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event

# Simple auto-assigner example (replace with your availability logic)

def auto_assign(session: Session, mission: Mission) -> Mission:
    # Find first available member
    member = session.exec(select(TeamMember).where(TeamMember.is_available == True)).first()
    if member:
        mission.assignee_id = member.id
        session.add(mission)
        session.commit()
        session.refresh(mission)
    return mission