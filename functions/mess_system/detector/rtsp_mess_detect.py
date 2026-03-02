#!/usr/bin/env python3
"""
RTSP/video fixed-interval mess detection sampler

- Connects to an RTSP camera or video file.
- Runs YOLO mess detection on one frame every <interval> seconds (wall-clock), regardless of stream FPS.
- Saves annotated frames.
- Minimizes latency (small buffer), auto-reconnects on errors, supports resizing, and handles signals.
"""

import argparse
import os
import yaml
import time
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
from ultralytics import YOLO

# Load configuration
def load_config(config_path="mess_config.yaml"):
    with open(config_path, "r") as f:
        return yaml.safe_load(f)

config = load_config()

MODEL_PATH      = config["model"]["path"]
CONF_THRESHOLD  = config["model"]["confidence_threshold"]
IMAGE_SIZE      = config["model"]["image_size"]
DEVICE          = config["model"]["device"]
INTERVAL        = config["model"]["sample_interval"]
DEFAULT_OUT_DIR = config["model"]["output_dir"]
LOGO_PATH       = config["ui"]["logo_path"]

STOP = False
def _signal_handler(sig, frame):
    global STOP
    STOP = True
signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


def open_capture(rtsp_url: str, width: int = 0, height: int = 0, rtsp_transport: str = "tcp") -> cv2.VideoCapture:
    """
    Open an RTSP stream or local video file with low-latency settings where possible.
    """
    if rtsp_url.startswith("rtsp://"):
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", f"rtsp_transport;{rtsp_transport}")
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    else:
        cap = cv2.VideoCapture(rtsp_url)

    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass

    if width > 0:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    return cap

def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)

def save_frame(frame, out_dir: Path, prefix: str = "detected"):
    ts = datetime.now(timezone.utc)
    name = f"{prefix}_{ts.strftime('%Y-%m-%dT%H-%M-%S')}.{int(ts.microsecond/1000):03d}Z.jpg"
    out_path = out_dir / name
    cv2.imwrite(str(out_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    return out_path

def run(rtsp_url: str,
        interval_s: float,
        output_dir: str,
        prefix: str = "detected",
        width: int = 0,
        height: int = 0,
        rtsp_transport: str = "tcp",
        max_reconnect_delay: float = 10.0,
        model_path: str = MODEL_PATH,
        conf_threshold: float = CONF_THRESHOLD,
        image_size: int = IMAGE_SIZE,
        device: str = DEVICE):
    """
    Main loop: read frames continuously; every 'interval_s' seconds (wall-clock), run mess detection and save annotated frame.
    """
    out_dir = Path(output_dir)
    ensure_dir(out_dir)

    last_save_t = 0.0
    consecutive_failures = 0

    model = YOLO(model_path)
    cap = None
    def _open():
        nonlocal cap, consecutive_failures
        if cap is not None:
            cap.release()
        cap = open_capture(rtsp_url, width, height, rtsp_transport)
        time.sleep(0.2)
        consecutive_failures = 0

    _open()

    print(f"[INFO] Sampling every {interval_s:.3f}s from {rtsp_url}")
    print(f"[INFO] Writing annotated frames to: {out_dir.resolve()}")
    print(f"[INFO] Transport: {rtsp_transport.upper()}  Size hint: {width}x{height if height else ''}".strip())
    print(f"[INFO] Using YOLO model: {model_path}")
    print(f"[INFO] Confidence threshold: {conf_threshold}, Image size: {image_size}, Device: {device}")

    while not STOP:
        if not cap.isOpened():
            consecutive_failures += 1
            delay = min(0.5 * (2 ** (consecutive_failures - 1)), max_reconnect_delay)
            print(f"[WARN] Capture not opened. Reconnecting in {delay:.1f}s ...")
            time.sleep(delay)
            _open()
            continue

        ok, frame = cap.read()
        if not ok or frame is None:
            # For local files, break at end of video
            if not rtsp_url.startswith("rtsp://"):
                print("[INFO] End of video file reached.")
                cap.release()
                cap = open_capture(rtsp_url, width, height, rtsp_transport)
                continue
            consecutive_failures += 1
            delay = min(0.5 * (2 ** (consecutive_failures - 1)), max_reconnect_delay)
            print(f"[WARN] Failed to read frame (#{consecutive_failures}). Reconnecting in {delay:.1f}s ...")
            time.sleep(delay)
            _open()
            continue

        consecutive_failures = 0

        now = time.monotonic()
        if last_save_t == 0.0 or (now - last_save_t) >= interval_s:
            # Run mess detection
            results = model.predict(
                frame,
                device=device,
                conf=conf_threshold,
                imgsz=image_size,
                augment=False
            )
            
            annotated = results[0].plot()
            out_path = save_frame(annotated, out_dir, prefix)
            print(f"[OK] Saved: {out_path.name}")
            last_save_t = now

        time.sleep(0.001)

    print("[INFO] Stopping...")
    if cap is not None:
        cap.release()
    print("[INFO] Done.")

def parse_args():
    p = argparse.ArgumentParser(description="RTSP/video fixed-interval mess detection sampler")
    p.add_argument("--rtsp", required=True, help="RTSP URL or path to video file (e.g., rtsp://... or /path/to/video.mp4)")
    p.add_argument("--interval", type=float, help="Sampling interval in seconds (default: from config.yaml)")
    p.add_argument("--out", default=DEFAULT_OUT_DIR, help="Output directory for annotated frames (default: samples)")
    p.add_argument("--prefix", default="detected", help="Filename prefix (default: detected)")
    p.add_argument("--width", type=int, default=0, help="Optional width hint (0 = keep native)")
    p.add_argument("--height", type=int, default=0, help="Optional height hint (0 = keep native)")
    p.add_argument("--transport", choices=["tcp", "udp"], default="tcp", help="RTSP transport (default: tcp)")
    p.add_argument("--max-reconnect-delay", type=float, default=10.0, help="Max backoff on reconnect (seconds)")
    p.add_argument("--model", default=MODEL_PATH, help="Path to YOLO model weights (default: from config.yaml)")
    p.add_argument("--conf", type=float, default=CONF_THRESHOLD, help="YOLO confidence threshold (default: from config.yaml)")
    p.add_argument("--imgsz", type=int, default=IMAGE_SIZE, help="YOLO image size (default: from config.yaml)")
    p.add_argument("--device", default=DEVICE, help="YOLO device (default: from config.yaml)")
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    try:
        run(
            rtsp_url=args.rtsp,
            interval_s=args.interval if args.interval is not None else INTERVAL,
            output_dir=args.out,
            prefix=args.prefix,
            width=args.width,
            height=args.height,
            rtsp_transport=args.transport,
            max_reconnect_delay=args.max_reconnect_delay,
            model_path=args.model,
            conf_threshold=args.conf,
            image_size=args.imgsz,
            device=args.device
        )
    except Exception as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        sys.exit(1)