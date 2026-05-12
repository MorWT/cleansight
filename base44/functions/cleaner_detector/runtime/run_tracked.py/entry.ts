# runtime/run_tracked.py
import cv2, argparse, json
from pathlib import Path
from cleaner_detector_tracked import CleanerTracker

def is_video(src):
    s=str(src).lower()
    return s.isdigit() or s.startswith("rtsp://") or s.endswith((".mp4",".avi",".mov",".mkv"))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    # ap.add_argument("--yolo", default="cleaner_detector/weights/people_tools_yolo.pt")
    ap.add_argument("--yolo", default="cleaner_detector/weights/best.pt")
    ap.add_argument("--cls", default="cleaner_detector/weights/cleaner_cls_best.onnx")
    ap.add_argument("--out", default="runs/cleaner_tracked")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--save_video", action="store_true")
    args=ap.parse_args()

    Path(args.out).mkdir(parents=True, exist_ok=True)
    ct=CleanerTracker(yolo_w=args.yolo, cls_onnx=args.cls)

    src=args.source
    if is_video(src):
        if src.isdigit(): src=int(src)
        cap=cv2.VideoCapture(src)
        assert cap.isOpened()
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        ct.fps = fps
        w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        writer=None
        if args.save_video:
            fourcc=cv2.VideoWriter_fourcc(*"mp4v")
            writer=cv2.VideoWriter(str(Path(args.out)/"annotated.mp4"), fourcc, fps, (w,h))
        f=0
        log=open(Path(args.out)/"results.jsonl","w")
        while True:
            ok,frame=cap.read()
            if not ok: break
            outs,dets=ct.infer(frame, now_frame_idx=f)
            # draw
            for d in dets:
                if d["cls"]!="person":
                    x,y,w,h=d["bbox"]
                    cv2.rectangle(frame,(x,y),(x+w,y+h),(60,180,255),1)
                    cv2.putText(frame,f"{d['cls']} {d['conf']:.2f}",(x,y-4),
                                cv2.FONT_HERSHEY_SIMPLEX,0.45,(60,180,255),1)
            for p in outs:
                x,y,w,h=p["bbox"]
                color=(0,200,0) if p["label"]=="cleaner" else (0,0,200)
                cv2.rectangle(frame,(x,y),(x+w,y+h),color,2)
                lab=f"ID{p['track_id']} {p['label'].upper()} s={p['score_ema']:.2f}"
                cv2.putText(frame,lab,(x,max(15,y-6)),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),2)
            log.write(json.dumps({"frame":f,"tracks":outs})+"\n")
            if args.show:
                cv2.imshow("CleanerTracker",frame)
                if cv2.waitKey(1)&0xFF==27: break
            if writer is not None: writer.write(frame)
            f+=1
        log.close()
        cap.release()
        if writer is not None: writer.release()
    else:
        # ordered image sequence folder
        import glob, os
        files=sorted([*glob.glob(f"{src}/*.jpg"),*glob.glob(f"{src}/*.png")])
        fps=10.0; ct.fps=fps
        log=open(Path(args.out)/"results.jsonl","w")
        for i,fp in enumerate(files):
            frame=cv2.imread(fp)
            outs,dets=ct.infer(frame, now_frame_idx=i)
            for d in dets:
                if d["cls"]!="person":
                    x,y,w,h=d["bbox"]
                    cv2.rectangle(frame,(x,y),(x+w,y+h),(60,180,255),1)
                    cv2.putText(frame,f"{d['cls']} {d['conf']:.2f}",(x,y-4),
                                cv2.FONT_HERSHEY_SIMPLEX,0.45,(60,180,255),1)
            for p in outs:
                x,y,w,h=p["bbox"]
                color=(0,200,0) if p["label"]=="cleaner" else (0,0,200)
                cv2.rectangle(frame,(x,y),(x+w,y+h),color,2)
                cv2.putText(frame,f"ID{p['track_id']} {p['label'].upper()} s={p['score_ema']:.2f}",
                            (x,max(15,y-6)),cv2.FONT_HERSHEY_SIMPLEX,0.55,(255,255,255),2)
            cv2.imwrite(str(Path(args.out)/Path(fp).name),frame)
            log.write(json.dumps({"image":os.path.basename(fp),"tracks":outs})+"\n")
        log.close()

if __name__=="__main__":
    main()
