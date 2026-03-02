#!/usr/bin/env python3
"""
RTSP fixed-interval frame sampler

- Connects to an RTSP camera (H.264/H.265).
- Saves one frame every <interval> seconds (wall-clock), regardless of stream FPS.
- Tries to minimize latency (small buffer), and auto-reconnects on errors.
"""

import argparse
import os
import time
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2


STOP = False
def _signal_handler(sig, frame):
    global STOP
    STOP = True
signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)


def open_capture(rtsp_url: str, width: int = 0, height: int = 0, rtsp_transport: str = "tcp") -> cv2.VideoCapture:
    """
    Open an RTSP stream with low-latency settings where possible.
    rtsp_transport: 'tcp' (reliable, default) or 'udp' (lower latency, less reliable).
    """
    # Hint OpenCV/FFmpeg about transport
    if rtsp_url.startswith("rtsp://"):
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", f"rtsp_transport;{rtsp_transport}")
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    else:
        cap = cv2.VideoCapture(rtsp_url)

    

    # Try to reduce internal buffering/latency (supported on some builds)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # smallest buffer
    except Exception:
        pass

    # Optional resizing at the decoder level (best effort)
    if width > 0:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

    return cap


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def save_frame(frame, out_dir: Path, prefix: str = "frame"):
    # Use UTC for consistent ordering across machines
    ts = datetime.now(timezone.utc)
    # Example filename: frame_2025-09-16T17-32-10.123Z.jpg
    name = f"{prefix}_{ts.strftime('%Y-%m-%dT%H-%M-%S')}.{int(ts.microsecond/1000):03d}Z.jpg"
    out_path = out_dir / name
    # Use reasonable JPEG quality; tune if needed
    cv2.imwrite(str(out_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    return out_path


def run(rtsp_url: str,
        interval_s: float = 1.0,
        output_dir: str = "samples",
        prefix: str = "frame",
        width: int = 0,
        height: int = 0,
        rtsp_transport: str = "tcp",
        max_reconnect_delay: float = 10.0):
    """
    Main loop: read frames continuously; every 'interval_s' seconds (wall-clock), save the latest frame.
    """
    out_dir = Path(output_dir)
    ensure_dir(out_dir)

    last_save_t = 0.0
    consecutive_failures = 0

    cap = None
    def _open():
        nonlocal cap, consecutive_failures
        if cap is not None:
            cap.release()
        cap = open_capture(rtsp_url, width, height, rtsp_transport)
        time.sleep(0.2)  # brief settle to reduce initial junk frames
        consecutive_failures = 0

    _open()

    print(f"[INFO] Sampling every {interval_s:.3f}s from {rtsp_url}")
    print(f"[INFO] Writing to: {out_dir.resolve()}")
    print(f"[INFO] Transport: {rtsp_transport.upper()}  Size hint: {width}x{height if height else ''}".strip())

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
            consecutive_failures += 1
            delay = min(0.5 * (2 ** (consecutive_failures - 1)), max_reconnect_delay)
            print(f"[WARN] Failed to read frame (#{consecutive_failures}). Reconnecting in {delay:.1f}s ...")
            time.sleep(delay)
            _open()
            continue

        # Successful read resets failure counter
        consecutive_failures = 0

        now = time.monotonic()
        if last_save_t == 0.0 or (now - last_save_t) >= interval_s:
            out_path = save_frame(frame, out_dir, prefix)
            print(f"[OK] Saved: {out_path.name}")
            last_save_t = now

        # Tiny sleep to avoid maxing a CPU core on very high FPS streams
        time.sleep(0.001)

    print("[INFO] Stopping...")
    if cap is not None:
        cap.release()
    print("[INFO] Done.")


def parse_args():
    p = argparse.ArgumentParser(description="RTSP fixed-interval frame sampler")
    p.add_argument("--rtsp", required=True, help="RTSP URL (e.g., rtsp://user:pass@ip:554/Streaming/Channels/101)")
    p.add_argument("--interval", type=float, default=1.0, help="Sampling interval in seconds (default: 1.0)")
    p.add_argument("--out", default="samples", help="Output directory for saved frames (default: samples)")
    p.add_argument("--prefix", default="frame", help="Filename prefix (default: frame)")
    p.add_argument("--width", type=int, default=0, help="Optional width hint (0 = keep native)")
    p.add_argument("--height", type=int, default=0, help="Optional height hint (0 = keep native)")
    p.add_argument("--transport", choices=["tcp", "udp"], default="tcp", help="RTSP transport (default: tcp)")
    p.add_argument("--max-reconnect-delay", type=float, default=10.0, help="Max backoff on reconnect (seconds)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        run(rtsp_url=args.rtsp,
            interval_s=args.interval,
            output_dir=args.out,
            prefix=args.prefix,
            width=args.width,
            height=args.height,
            rtsp_transport=args.transport,
            max_reconnect_delay=args.max_reconnect_delay)
    except Exception as e:
        print(f"[FATAL] {e}", file=sys.stderr)
        sys.exit(1)
