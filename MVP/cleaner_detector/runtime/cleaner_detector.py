import os, sys, argparse, time, json, math, glob
from pathlib import Path
import cv2
import numpy as np
import onnxruntime as ort
from ultralytics import YOLO

TOOLS = {"broom", "bucket", "clean_sponge", "cleaning_cart", "cleaning_sign", "disinfectant", "dustpan", "floor_cleaning_machine", 
 "glove", "mop", "rag", "spray_bottle", "trash_bag", "trash_bin", "uniforms", "vacuum"}

def softmax_np(v):
    v = v - np.max(v); e = np.exp(v); return e/np.sum(e)

def iou(a,b):
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    x1,y1=max(ax,bx),max(ay,by)
    x2,y2=min(ax+aw,bx+bw),min(ay+ah,by+bh)
    if x2<=x1 or y2<=y1: return 0.0
    inter=(x2-x1)*(y2-y1)
    return inter/float(aw*ah + bw*bh - inter + 1e-6)

def center_dist(a,b):
    ax,ay,aw,ah=a; bx,by,bw,bh=b
    cx1,cy1=ax+aw/2, ay+ah/2
    cx2,cy2=bx+bw/2, by+bh/2
    return ((cx1-cx2)**2 + (cy1-cy2)**2)**0.5

def preprocess_onnx(bgr, size=224):
    x = cv2.resize(bgr, (size,size))
    x = x[:, :, ::-1] / 255.0              # BGR->RGB, [0,1]
    x = np.transpose(x, (2,0,1))[None]     # NCHW (1,3,H,W)
    return x.astype(np.float32)

class CleanerDetector:
    def __init__(self, yolo_w, cls_onnx,
                 conf=0.3, imgsz=640, decision_th=0.60,
                 prox_iou=0.05, prox_dist=1.2,
                 cls_w=0.55, tool_bonus=0.25, cart_bonus=0.20,
                 device=None):
        self.detector = YOLO(yolo_w)
        self.conf, self.imgsz, self.device = conf, imgsz, device
        self.sess = ort.InferenceSession(cls_onnx, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.th = decision_th
        self.prox_iou = prox_iou
        self.prox_dist = prox_dist
        self.cls_w, self.tool_b, self.cart_b = cls_w, tool_bonus, cart_bonus

    def _near(self, pb, tb):
        return (iou(pb,tb) > self.prox_iou) or (center_dist(pb,tb) < max(pb[2],pb[3]) * self.prox_dist)

    def infer_frame(self, frame_bgr):
        H,W = frame_bgr.shape[:2]
        res = self.detector.predict(frame_bgr, conf=self.conf, imgsz=self.imgsz,
                                    device=self.device, verbose=False)[0]
        dets=[]
        for b in res.boxes:
            x1,y1,x2,y2 = map(int, b.xyxy[0].tolist())
            dets.append({
                "cls": res.names[int(b.cls)],
                "bbox": [x1, y1, x2-x1, y2-y1],
                "conf": float(b.conf)
            })
        persons = [d for d in dets if d["cls"]=="person"]
        tools   = [d for d in dets if d["cls"] in TOOLS]

        outputs=[]
        for p in persons:
            x,y,w,h = p["bbox"]
            x0,y0,x1,y1 = max(0,x),max(0,y), min(W,x+w),min(H,y+h)
            if x1<=x0 or y1<=y0: continue
            crop = frame_bgr[y0:y1, x0:x1]
            logits = self.sess.run(None, {self.inp: preprocess_onnx(crop)})[0][0]
            p_cleaner = float(softmax_np(logits)[1])

            tool_near = any(self._near(p["bbox"], t["bbox"]) for t in tools)
            cart_near = any(self._near(p["bbox"], t["bbox"]) for t in tools if t["cls"]=="cleaning_cart")
            score = min(1.0, self.cls_w*p_cleaner + self.tool_b*float(tool_near) + self.cart_b*float(cart_near))
            outputs.append({
                "bbox": p["bbox"], "p_cleaner": p_cleaner,
                "tool_near": tool_near, "cart_near": cart_near,
                "score": score, "is_cleaner": bool(score >= self.th)
            })

        return outputs, dets  # per-person outputs + all detections

def draw(frame, outputs, dets):
    for d in dets:
        if d["cls"] == "person": continue
        x,y,w,h = d["bbox"]
        cv2.rectangle(frame, (x,y), (x+w,y+h), (60,180,255), 1)
        cv2.putText(frame, f"{d['cls']} {d['conf']:.2f}", (x, y-4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60,180,255), 1, cv2.LINE_AA)
    for p in outputs:
        x,y,w,h = p["bbox"]
        color = (0,200,0) if p["is_cleaner"] else (0,0,200)
        cv2.rectangle(frame, (x,y), (x+w,y+h), color, 2)
        lab = f"{'CLEANER' if p['is_cleaner'] else 'REG'} s={p['score']:.2f} pc={p['p_cleaner']:.2f}"
        cv2.putText(frame, lab, (x, max(15,y-6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255,255,255), 2, cv2.LINE_AA)
    return frame

def is_video_source(src):
    if isinstance(src, int): return True
    s = str(src).lower()
    return s.startswith("rtsp://") or s.endswith(".mp4") or s.endswith(".avi") or s.endswith(".mov") or s.endswith(".mkv")

def iter_images(folder_or_image):
    p = Path(folder_or_image)
    if p.is_file():
        yield str(p)
    else:
        exts = ("*.jpg","*.jpeg","*.png","*.bmp")
        files = []
        for e in exts: files += glob.glob(str(p / e))
        files.sort()
        for f in files: yield f

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yolo", default="cleaner_detector/weights/people_tools_yolo.pt", help="YOLO detector weights")
    ap.add_argument("--cls",  default="cleaner_detector/weights/cleaner_cls_best.onnx", help="Cleaner classifier ONNX")
    ap.add_argument("--source", required=True, help="image|folder|video|rtsp|webcam_index")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.30)
    ap.add_argument("--out", default="runs/cleaner_out", help="output folder (video/frames + jsonl)")
    ap.add_argument("--save_video", action="store_true")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--api_url", type=str, default=None, help="FastAPI base URL, e.g. http://localhost:8000")
    ap.add_argument("--camera_id", type=str, default=None, help="Camera UUID (matches DB cameras.camera_id)")
    ap.add_argument("--post_presence", action="store_true", help="POST /events/cleaner_presence on each frame")

    args = ap.parse_args()

    Path(args.out).mkdir(parents=True, exist_ok=True)
    cd = CleanerDetector(args.yolo, args.cls, conf=args.conf, imgsz=args.imgsz)

    log_path = Path(args.out)/"results.jsonl"
    log_f = open(log_path, "w", encoding="utf-8")

    src = args.source
    # webcam index?
    if src.isdigit() and len(src)<4: src = int(src)

    if is_video_source(src):
        cap = cv2.VideoCapture(src)
        assert cap.isOpened(), f"cannot open source: {src}"
        writer=None
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        w  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h  = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if args.save_video:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(str(Path(args.out)/"annotated.mp4"), fourcc, fps, (w,h))
        fidx=0
        while True:
            ok, frame = cap.read()
            if not ok: break
            outputs, dets = cd.infer_frame(frame)
            ann = draw(frame.copy(), outputs, dets)

            if args.post_presence and args.api_url and args.camera_id:
                try:
                    import requests
                    H, W = frame.shape[:2]
                    payload = {
                        "camera_id": args.camera_id,
                        "img_w": int(W), "img_h": int(H),
                        "persons": [{"bbox": o["bbox"], "is_cleaner": bool(o["is_cleaner"]), "score": float(o["score"])} for o in outputs],
                        "model": "cleaner-detector-v1",
                        "frame_path": None  # or your saved frame path if you keep it
                    }
                    r = requests.post(f"{args.api_url}/events/cleaner_presence", json=payload, timeout=2.0)
                    # optional log:
                    # print("[POST] /events/cleaner_presence", r.status_code)
                except Exception as e:
                    print(f"[WARN] presence POST failed: {e}")

            # log one JSON per frame
            rec = {"frame": fidx, "outputs": outputs, "detections": dets}
            log_f.write(json.dumps(rec)+"\n")
            if args.show:
                cv2.imshow("CleanerDetector", ann)
                if cv2.waitKey(1)&0xFF==27: break
            if writer is not None: writer.write(ann)
            fidx+=1
        cap.release()
        if writer is not None: writer.release()
    else:
        # image or folder
        out_frames = Path(args.out)/"frames"
        out_frames.mkdir(parents=True, exist_ok=True)
        for fp in iter_images(src):
            frame = cv2.imread(fp); assert frame is not None, f"bad image: {fp}"
            outputs, dets = cd.infer_frame(frame)
            ann = draw(frame.copy(), outputs, dets)
            rec = {"image": os.path.basename(fp), "outputs": outputs, "detections": dets}
            log_f.write(json.dumps(rec)+"\n")
            cv2.imwrite(str(out_frames/Path(fp).name), ann)
            if args.show:
                cv2.imshow("CleanerDetector", ann)
                if cv2.waitKey(0)&0xFF==27: break

    log_f.close()
    if args.show: cv2.destroyAllWindows()
    print(f"[OK] Logs: {log_path}")
    if args.save_video and is_video_source(src):
        print(f"[OK] Video: {Path(args.out)/'annotated.mp4'}")

if __name__ == "__main__":
    main()
