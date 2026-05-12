from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime

class CameraCreate(BaseModel):
    name: str
    hls_url: Optional[str] = None
    location: Optional[str] = None

class CameraRead(BaseModel):
    id: int
    name: str
    hls_url: Optional[str]
    location: Optional[str]
    is_active: bool

class Config:
    from_attributes = True

class MissionCreate(BaseModel):
    title: str
    description: Optional[str] = None
    camera_id: Optional[int] = None
    priority: int = 2

class MissionUpdate(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None

class MissionRead(BaseModel):
    id: int
    title: str
    description: Optional[str]
    camera_id: Optional[int]
    status: str
    priority: int
    assignee_id: Optional[int]
    created_at: datetime
    updated_at: datetime

class Config:
    from_attributes = True

class DetectionIn(BaseModel):
    camera_id: int
    label: str
    severity: int = 1
    confidence: float = 0.0
    image_url: Optional[str] = None