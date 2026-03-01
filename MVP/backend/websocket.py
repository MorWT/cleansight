from typing import Dict, List
from fastapi import WebSocket
import json

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

    async def broadcast(self, message: Dict):
        data = json.dumps(message)
        stale = []
        for ws in self.active:
            try:
                await ws.send_text(data)
            except Exception:
                stale.append(ws)
        for s in stale:
            self.disconnect(s)

manager = ConnectionManager()