version: '3.9'
services:
  backend:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    environment:
      - DATABASE_URL=sqlite:///./app.db
    volumes:
      - ./backend:/app
    ports: ["8000:8000"]

  frontend:
    build: ./frontend
    command: npm run dev
    environment:
      - NEXT_PUBLIC_API_BASE=http://localhost:8000
      - NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
    volumes:
      - ./frontend:/usr/src/app
    ports: ["3000:3000"]
    depends_on: [backend]