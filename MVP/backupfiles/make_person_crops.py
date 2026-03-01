"""
Create a person-crop classification dataset from Label Studio JSON.

Inputs:
- LS JSON export (full JSON, not minimal)
- Base images directory where the original image files exist
- Split ratio for train/val

Output:
- datasets/person_cls/train/{cleaner,regular}/
- datasets/person_cls/val/{cleaner,regular}/

Notes:
- Label Studio stores boxes as percentages (0..100). We convert to pixels.
- We match the attribute record to the bbox by the shared region 'id'.
- If a person has no 'is_cleaner' choice, we default to 'regular' (configurable).
"""

import json, os, random, shutil
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import cv2
import argparse

def expand_box(x, y, w, h, W, H, pad_pct=0.15):
    pad = int(pad_pct * max(w, h))
    x2 = max(0, x - pad); y2 = max(0, y - pad)
    w2 = min(W, x + w + pad) - x2
    h2 = min(H, y + h + pad) - y2
    return x2, y2, w2, h2


def extract_filename_from_data(item):
    # Prefer data.image if present
    data = item.get("data") or {}
    img_field = data.get("image") or data.get("img") or ""
    if img_field:
        u = urlparse(img_field)
        q = parse_qs(u.query)
        if "d" in q and q["d"]:
            return Path(q["d"][0]).name
        return Path(u.path).name or Path(img_field).name
    # Fallback to file_upload (Label Studio stores server-side name)
    fu = item.get("file_upload")
    if fu:
        return Path(fu).name
    return None

def ensure_dirs(root):
    for split in ["train","val"]:
        for cls in ["cleaner","regular"]:
            (root/split/cls).mkdir(parents=True, exist_ok=True)

def clamp(x, lo, hi): return max(lo, min(hi, x))

def main(ls_json, images_dir, out_root, train_ratio=0.85, min_size=12):
    ls = json.load(open(ls_json, "r", encoding="utf-8"))
    images_dir = Path(images_dir)
    out_root   = Path(out_root)
    ensure_dirs(out_root)

    # Optional shuffle for split
    random.shuffle(ls)

    for item in ls:
        fname = extract_filename_from_data(item)
        if not fname:
            print(f"[WARN] no image name for task id={item.get('id')}")
            continue

        # Try to locate the actual image on disk by basename
        # (assumes your images_dir contains the original files)
        candidates = list(images_dir.rglob(fname))
        if not candidates:
            print(f"[WARN] image file not found on disk: {fname}")
            continue
        img_path = candidates[0]
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"[WARN] failed to read: {img_path}")
            continue
        H, W = img.shape[:2]

        results = (item.get("annotations") or [{}])[0].get("result") or []
        # Index attributes by region id for quick lookup
        choices_by_id = {}
        for r in results:
            if r.get("type") == "choices":
                rid = r.get("id")
                val = (r.get("value") or {}).get("choices") or []
                if rid and val:
                    # We'll keep the first choice; expected ["cleaner"] or ["regular"]
                    choices_by_id[rid] = val[0].lower()

        # Iterate regions and crop persons
        for r in results:
            if r.get("type") != "rectanglelabels": 
                continue
            labels = (r.get("value") or {}).get("rectanglelabels") or []
            if not labels: 
                continue
            if labels[0] != "person":
                continue

            # LS rectangle values are in percentages of the image
            v = r["value"]
            x = int((v["x"]      / 100.0) * W)
            y = int((v["y"]      / 100.0) * H)
            w = int((v["width"]  / 100.0) * W)
            h = int((v["height"] / 100.0) * H)

            # Clamp and ignore tiny crops
            x = clamp(x, 0, W-1); y = clamp(y, 0, H-1)
            w = clamp(w, 1, W-x); h = clamp(h, 1, H-y)
            if w < min_size or h < min_size:
                continue

            x2, y2, w2, h2 = expand_box(x, y, w, h, W, H, pad_pct=args.pad_pct)
            crop = img[y2:y2+h2, x2:x2+w2]
            # Attribute join by region id
            rid = r.get("id")
            tag = choices_by_id.get(rid, "regular")
            tag = "cleaner" if tag == "cleaner" else "regular"

            # Split
            split = "train" if random.random() < train_ratio else "val"
            out_name = f"{img_path.stem}_x{x}_y{y}_w{w}_h{h}.jpg"
            out_file = out_root/split/tag/out_name
            cv2.imwrite(str(out_file), crop)

    print("[OK] Person crops created at:", out_root)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ls_json", required=True, help="Label Studio JSON export path")
    ap.add_argument("--images_dir", required=True, help="Root folder containing the original images")
    ap.add_argument("--out_root", default="dataset/person_cls", help="Output root for person crops")
    ap.add_argument("--train_ratio", type=float, default=0.85)
    ap.add_argument("--pad_pct", type=float, default=0.15, help="Context padding around person bbox")

    args = ap.parse_args()
    main(args.ls_json, args.images_dir, args.out_root, args.train_ratio, args.pad_pct)
