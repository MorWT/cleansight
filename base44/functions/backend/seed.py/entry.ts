from sqlmodel import Session
from models import Camera, TeamMember

SAMPLE_CAMERAS = [
    {"name": "Lobby Cam", "hls_url": "http://localhost:8000/hls/lobby.m3u8", "location": "Lobby"},
    {"name": "Kitchen Cam", "hls_url": "http://localhost:8000/hls/kitchen.m3u8", "location": "Kitchen"},
]

TEAM = [
    {"name": "Alice", "is_available": True},
    {"name": "Bob", "is_available": True},
]

def seed(session: Session):
    if not session.exec(Camera.select()).all():
        for c in SAMPLE_CAMERAS:
            session.add(Camera(**c))
    if not session.exec(TeamMember.select()).all():
        for t in TEAM:
            session.add(TeamMember(**t))
    session.commit()