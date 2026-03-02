from typing import Optional
from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime

class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    hls_url: Optional[str] = None # URL to HLS stream (produced by your RTSP→HLS gateway)
    location: Optional[str] = None
    is_active: bool = True

class TeamMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    is_available: bool = True

class Mission(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    camera_id: Optional[int] = Field(default=None, foreign_key="camera.id")
    status: str = Field(default="todo") # todo | in_progress | done
    priority: int = 2 # 1=high,2=med,3=low
    assignee_id: Optional[int] = Field(default=None, foreign_key="teammember.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class DetectionEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id")
    label: str # e.g., "mess" / "spill" / "trash"
    severity: int = 1 # 1..5
    confidence: float = 0.0
    image_url: Optional[str] = None # snapshot link if you store frames
    created_at: datetime = Field(default_factory=datetime.utcnow)