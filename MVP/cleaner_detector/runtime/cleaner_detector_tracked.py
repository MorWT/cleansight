# runtime/cleaner_detector_tracked.py
import os, argparse, json, glob
from pathlib import Path
import cv2, numpy as np
from ultralytics import YOLO
from ultralytics.trackers.byte_tracker import BYTETracker, STrack
import onnxruntime as ort
from types import SimpleNamespace


TOOLS = {"broom", "bucket", "clean_sponge", "cleaning_cart", "cleaning_sign", "disinfectant", "dustpan", "floor_cleaning_machine", 
 "glove", "mop", "rag", "spray_bottle", "trash_bag", "trash_bin", "uniforms", "vacuum"}

def softmax_np(v): v=v-np.max(v); e=np.exp(v); return e/np.sum(e)

def preprocess_onnx(bgr, size_wh=(224, 224), pad_pct=0.2):
    # optional context padding
    h, w = bgr.shape[:2]
    pad = int(pad_pct * max(h, w))
    y0, x0 = max(0, -pad), max(0, -pad)
    y1, x1 = min(h + pad, h), min(w + pad, w)
    crop = bgr[y0:y1, x0:x1]

    # resize to model’s expected size
    Wexp, Hexp = size_wh
    x = cv2.resize(crop, (Wexp, Hexp))
    x = x[:, :, ::-1] / 255.0
    x = np.transpose(x, (2, 0, 1))[None].astype(np.float32)
    return x


def iou(a,b):
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    x1,y1=max(ax,bx),max(ay,by); x2,y2=min(ax+aw,bx+bw),min(ay+ah,by+bh)
    if x2<=x1 or y2<=y1: return 0.0
    inter=(x2-x1)*(y2-y1); return inter/float(aw*ah + bw*bh - inter + 1e-6)

def center_dist(a,b):
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    cx1,cy1=ax+aw/2, ay+ah/2; cx2,cy2=bx+bw/2, by+bh/2
    return ((cx1-cx2)**2 + (cy1-cy2)**2)**0.5

class CleanerTracker:
    def __init__(self, yolo_w="weights/people_tools_yolo.pt",
                 cls_onnx="weights/cleaner_cls_best.onnx",
                 conf=0.3, imgsz=640, device=None,
                 prox_iou=0.05, prox_dist=1.2,
                 w_cls=0.7, b_tool=0.2, b_cart=0.2,
                 th_on=0.5, th_off=0.35,
                 ema_alpha=0.5,    # smoother over ~2 frames @ 10 fps → ~0.2 s
                 lock_after_s=2.0, # seconds before freezing label if high
                 fps_fallback=10.0):
        self.det = YOLO(yolo_w)
        self.conf, self.imgsz, self.device = conf, imgsz, device
        self.sess = ort.InferenceSession(cls_onnx, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.tracker = None
        self.fps = fps_fallback
        self.sess = ort.InferenceSession(cls_onnx, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name

        # Read model's expected spatial size (N, C, H, W)
        in_shape = self.sess.get_inputs()[0].shape  # e.g., [1, 3, 224, 224] or [None, 3, 224, 224]
        try:
            Hexp = int(in_shape[2]) if in_shape[2] is not None else 224
            Wexp = int(in_shape[3]) if in_shape[3] is not None else 224
        except Exception:
            Hexp, Wexp = 224, 224
        self._onnx_size = (Wexp, Hexp)  # (width, height)


        # Prepare default ByteTrack args; actual tracker created later
        self.bt_args = SimpleNamespace(
            track_thresh=0.5,          # detection confidence threshold
            track_high_thresh=0.6,     # secondary threshold for confirmed tracks
            track_low_thresh=0.1,      # lower threshold for initiating tracks
            new_track_thresh=0.4,      # threshold for starting a new track
            match_thresh=0.8,          # IoU threshold for association
            track_buffer=30,           # how long to keep lost tracks (frames)
            min_box_area=10,           # ignore tiny boxes
            mot20=False,               # for MOT20 dataset compatibility
            frame_rate=int(max(1, round(self.fps)))  # required by ByteTrack
        )
        self.prox_iou, self.prox_dist = prox_iou, prox_dist
        self.w_cls, self.b_tool, self.b_cart = w_cls, b_tool, b_cart
        self.th_on, self.th_off = th_on, th_off
        self.ema_alpha = ema_alpha
        self.lock_after_s = lock_after_s
        self.fps = fps_fallback  # we’ll update from the stream if available
        # per-track state: {id: {ema, first_ts, locked_label}}
        self.state = {}

    def _near(self, pb, tb):
        return (iou(pb,tb) > self.prox_iou) or (center_dist(pb,tb) < max(pb[2],pb[3])*self.prox_dist)

    def _upd_track_state(self, tid, score, now_s):
        st = self.state.get(tid, {"ema":0.0, "first_ts":now_s, "locked":None})
        st["ema"] = self.ema_alpha*score + (1-self.ema_alpha)*st["ema"]
        # hysteresis + optional lock after a short dwell time
        age = now_s - st["first_ts"]
        if st["locked"] is None and age >= self.lock_after_s:
            if st["ema"] >= self.th_on: st["locked"]="cleaner"
            elif st["ema"] <= self.th_off: st["locked"]="regular"
        self.state[tid] = st
        # current label with hysteresis even if not locked yet
        if st["locked"] is not None:
            return st["locked"], st
        return ("cleaner" if st["ema"] >= self.th_on else "regular"), st
    
    def _ensure_tracker(self):
        if self.tracker is None:
            # Some Ultralytics builds want frame_rate passed in ctor as well
            self.bt_args.frame_rate = int(max(1, round(self.fps)))
            self.tracker = BYTETracker(self.bt_args, frame_rate=self.bt_args.frame_rate)


    def infer(self, frame_bgr, now_frame_idx=0):
        # 0) frame dims
        H, W = frame_bgr.shape[:2]

        # 1) YOLO track (Ultralytics holds the tracker state when persist=True)
        r = self.det.track(
            frame_bgr,
            conf=self.conf,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
            persist=True,                 # keep tracker state across calls
            tracker="bytetrack.yaml"      # use default ByteTrack params
        )[0]
        names = r.names
        boxes = r.boxes  # ultralytics Boxes: has .xyxy, .conf, .cls, .id

        # 2) Build a flat list of detections for drawing/logging
        dets = []
        persons_idx = []
        tools_idx = []

        if boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy()
            conf = boxes.conf.cpu().numpy()
            cls  = boxes.cls.cpu().numpy().astype(int)
            ids  = boxes.id
            ids  = ids.cpu().numpy().astype(int) if ids is not None else None

            for i in range(len(xyxy)):
                x1, y1, x2, y2 = map(int, xyxy[i])
                cidx = int(cls[i])
                cname = names[cidx]
                det = {
                    "cls": cname,
                    "bbox": [x1, y1, max(1, x2 - x1), max(1, y2 - y1)],
                    "conf": float(conf[i]),
                }
                # keep indices for person/tools for later proximity
                if cname == "person":
                    persons_idx.append(i)
                elif cname in TOOLS:
                    tools_idx.append(i)
                dets.append(det)
        else:
            # no detections
            return [], []

        # convenience accessors on the same order
        def bbox_of(idx):
            x1, y1, x2, y2 = map(int, boxes.xyxy[idx].tolist())
            return [x1, y1, max(1, x2 - x1), max(1, y2 - y1)]

        # Collect tool bboxes once
        tool_bboxes = [bbox_of(i) for i in tools_idx]
        tool_names  = [names[int(boxes.cls[i])] for i in tools_idx]

        # 3) Per-person classification + proximity + temporal smoothing
        outputs = []
        now_s = now_frame_idx / max(self.fps, 1e-6)  # runner should set self.fps

        for i in persons_idx:
            pb = bbox_of(i)
            x, y, w, h = pb
            x0, y0, x3, y3 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
            if x3 <= x0 or y3 <= y0:
                continue

            # Person track_id from tracker (may be None on very first frames)
            tid = None
            if boxes.id is not None:
                tid = int(boxes.id[i].item())
            else:
                # fallback: negative pseudo-id by index if tracker didn't attach IDs yet
                tid = -100000 - i

            # Classify person crop with padding/resize (preprocess_onnx does both)
            crop = frame_bgr[y0:y3, x0:x3]
            logits = self.sess.run(None, {self.inp: preprocess_onnx(crop, self._onnx_size)})[0][0]
            # p_cleaner = float(softmax_np(logits)[1])
            p_cleaner = float(softmax_np(logits)[0])

            # Proximity to tools and specifically cart
            tool_near = any(self._near(pb, tb) for tb in tool_bboxes)
            cart_near = any(self._near(pb, tb) for tb, tn in zip(tool_bboxes, tool_names) if tn == "cleaning_cart")

            # Fusion
            score = min(1.0, self.w_cls * p_cleaner + self.b_tool * float(tool_near) + self.b_cart * float(cart_near))

            # Temporal smoothing + hysteresis + optional lock
            label, st = self._upd_track_state(tid, score, now_s)

            outputs.append({
                "track_id": tid,
                "bbox": pb,
                "p_cleaner_model": p_cleaner,
                "tool_near": tool_near,
                "cart_near": cart_near,
                "score_ema": st["ema"],
                "label": label,              # "cleaner" or "regular"
                "locked": st["locked"] is not None
            })

        return outputs, dets

