#!/usr/bin/env python3
"""
make_person_crops.py — Create cleaner/regular person crops from a Label Studio JSON export.

This script is tailored to the provided Label Studio schema:
- Top-level is a list of tasks.
- Each task has `data.image` (Label Studio internal path like "/data/upload/5/<fname>.jpg").
- Each task has `annotations[0].result`, which includes:
  * `type: "rectanglelabels"` items for boxes (with `value.rectanglelabels` e.g., ["person"], ["mop"], ["vacuum"] ...)
    - Coordinates are *percent* values: x, y, width, height
    - Also includes original_width/height for conversion (but we will measure from the image actually loaded)
  * `type: "choices"` items from_name == "is_cleaner" with `value.choices` == ["cleaner"] or ["regular"]
    - The "id" field matches the id of the corresponding box record.

Output structure:
  out_root/
    train/{cleaner,regular}/<img_stem>_<idx>.jpg
    val/{cleaner,regular}/...

Notes:
- We add context padding around person boxes (--pad_pct) so uniform/tools are visible.
- We can infer "cleaner" if tools are near the person when no explicit choice exists (--assume_cleaner_if_tool_near).
- We split by image basename to reduce leakage.
"""

import argparse, json, os, math, random, csv
from pathlib import Path
from typing import Dict, Any, List, Tuple
import cv2
import numpy as np

TOOL_LABELS_DEFAULT = {"broom", "bucket", "clean_sponge", "cleaning_cart", "cleaning_sign", "disinfectant", "dustpan", "floor_cleaning_machine", 
 "glove", "mop", "rag", "spray_bottle", "trash_bag", "trash_bin", "uniforms", "vacuum"}

# ----------------- geometry helpers -----------------
def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def clamp_box(x1, y1, x2, y2, W, H):
    return max(0, int(x1)), max(0, int(y1)), min(W - 1, int(x2)), min(H - 1, int(y2))

def expand_with_pad(box_xyxy, pad, W, H):
    x1, y1, x2, y2 = box_xyxy
    cx, cy = (x1 + x2) * 0.5, (y1 + y2) * 0.5
    bw, bh = (x2 - x1), (y2 - y1)
    nx1 = cx - bw * (0.5 + pad)
    ny1 = cy - bh * (0.5 + pad)
    nx2 = cx + bw * (0.5 + pad)
    ny2 = cy + bh * (0.5 + pad)
    return clamp_box(nx1, ny1, nx2, ny2, W, H)

def iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1 = max(ax1, bx1); iy1 = max(ay1, by1); ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    iw = max(0, ix2 - ix1); ih = max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0: return 0.0
    ua = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / ua if ua > 0 else 0.0

def box_center_dist(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    acx, acy = (ax1 + ax2) * 0.5, (ay1 + ay2) * 0.5
    bcx, bcy = (bx1 + bx2) * 0.5, (by1 + by2) * 0.5
    return math.hypot(acx - bcx, acy - bcy)

def nearest_tool(person_box, tool_boxes):
    """Heuristic: consider a tool 'near' if IoU>0.05 or center distance < 1.5 * person height."""
    if not tool_boxes: return False
    px1, py1, px2, py2 = person_box
    ph = max(1, py2 - py1)
    thresh = 1.5 * ph
    for tb in tool_boxes:
        if iou(person_box, tb) > 0.05: return True
        if box_center_dist(person_box, tb) < thresh: return True
    return False

# ----------------- path helpers -----------------
def find_image(images_dir: Path, labelstudio_image_path: str) -> Path:
    """
    LS stores something like '/data/upload/5/<file>.jpg'. We map by basename under images_dir.
    """
    bn = os.path.basename(labelstudio_image_path)
    candidate = images_dir / bn
    if candidate.exists():
        return candidate
    # as a fallback, try lower/upper variants and small recursive search of one level
    for root, _, files in os.walk(images_dir):
        if bn in files:
            return Path(root) / bn
    return candidate  # return the straightforward join even if it doesn't exist (caller will check)

# ----------------- parser for LS export -----------------
def parse_labelstudio(ls_json_path: Path) -> List[Dict[str, Any]]:
    """
    Returns a list of tasks with:
      {
        "image_path": str (as in LS, not resolved to disk),
        "results": [ ... ]  # items from annotations[0].result
      }
    """
    raw = json.loads(ls_json_path.read_text(encoding="utf-8"))
    tasks = raw if isinstance(raw, list) else raw.get("tasks", [])
    out = []
    for task in tasks:
        img = task.get("data", {}).get("image") or task.get("data", {}).get("img") or ""
        ann = task.get("annotations") or task.get("completions") or []
        results = []
        if ann:
            results = ann[0].get("result", [])
        out.append({"image_path": img, "results": results})
    return out

def extract_boxes_and_labels(results: List[Dict[str, Any]], img_w: int, img_h: int,
                             tool_labels: List[str]) -> Tuple[List[Dict[str, Any]], List[Tuple[int,int,int,int]]]:
    """
    From a single task's results:
      - Build a mapping region_id -> choice ("cleaner"/"regular") using 'choices' items
      - Collect person boxes and tool boxes from 'rectanglelabels' items
      Returns:
        persons: list of dicts { "xyxy":(x1,y1,x2,y2), "id":region_id, "role": "cleaner"/"regular"/None }
        tool_boxes: list of xyxy boxes
    """
    # Map choice by region id
    role_by_id: Dict[str, str] = {}
    for r in results:
        if r.get("type") == "choices" and r.get("from_name") == "is_cleaner":
            rid = r.get("id")
            val = r.get("value", {})
            choices = val.get("choices", [])
            if rid and choices:
                role_by_id[rid] = choices[0].lower()

    persons = []
    tool_boxes = []

    for r in results:
        if r.get("type") != "rectanglelabels":
            continue
        v = r.get("value", {})
        labels = v.get("rectanglelabels", []) or []
        if not labels:
            continue
        label = labels[0].lower()

        # LS coordinates are percentages (x,y,width,height)
        x_pct, y_pct = float(v.get("x", 0.0)), float(v.get("y", 0.0))
        w_pct, h_pct = float(v.get("width", 0.0)), float(v.get("height", 0.0))
        x1 = (x_pct / 100.0) * img_w
        y1 = (y_pct / 100.0) * img_h
        x2 = x1 + (w_pct / 100.0) * img_w
        y2 = y1 + (h_pct / 100.0) * img_h
        x1, y1, x2, y2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
        xyxy = (x1, y1, x2, y2)

        if label == "person":
            rid = r.get("id")
            role = role_by_id.get(rid)  # "cleaner" or "regular" or None
            persons.append({"xyxy": xyxy, "id": rid, "role": role})
        elif label in [t.lower() for t in tool_labels]:
            tool_boxes.append(xyxy)

    return persons, tool_boxes

# ----------------- writing crops -----------------
def save_crop(img, xyxy, out_path: Path, out_size=224) -> bool:
    x1, y1, x2, y2 = xyxy
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(img.shape[1] - 1, x2), min(img.shape[0] - 1, y2)
    if x2 <= x1 or y2 <= y1:
        return False
    crop = img[y1:y2, x1:x2]
    if crop is None or crop.size == 0:
        return False
    crop = cv2.resize(crop, (out_size, out_size), interpolation=cv2.INTER_LINEAR)
    ensure_dir(out_path.parent)
    return cv2.imwrite(str(out_path), crop)

# ----------------- main build -----------------
def build_from_labelstudio(ls_json: Path, images_dir: Path, out_root: Path,
                           train_ratio: float, pad_pct: float, min_size: int,
                           min_box_pct: float, assume_cleaner_if_tool_near: bool,
                           tool_labels: List[str]) -> int:
    random.seed(42)
    tasks = parse_labelstudio(ls_json)
    meta = []
    tmp_paths = []

    for ti, task in enumerate(tasks):
        ls_img_path = task["image_path"]
        img_path = find_image(images_dir, ls_img_path)
        img = cv2.imread(str(img_path))
        if img is None:
            # Try again by stripping query/fragments if present
            img_path2 = images_dir / os.path.basename(str(ls_img_path).split("?")[0])
            img = cv2.imread(str(img_path2))
            if img is None:
                # Skip this task
                continue
            else:
                img_path = img_path2

        H, W = img.shape[:2]
        persons, tool_boxes = extract_boxes_and_labels(task["results"], W, H, tool_labels)

        for pi, p in enumerate(persons):
            x1, y1, x2, y2 = p["xyxy"]
            # filter very small boxes by percent of image size
            if (x2 - x1) < max(min_size, int(min_box_pct * W)) or (y2 - y1) < max(min_size, int(min_box_pct * H)):
                continue
            # pad and clamp
            px1, py1, px2, py2 = expand_with_pad((x1, y1, x2, y2), pad_pct, W, H)
            # infer role if missing
            role = (p.get("role") or "").lower() if p.get("role") else None
            if role not in ("cleaner", "regular"):
                if assume_cleaner_if_tool_near and nearest_tool((px1, py1, px2, py2), tool_boxes):
                    role = "cleaner"
                else:
                    continue
                #     role = "regular"  # default fallback if not specified

            out_split = "train"  # temporary; will split later
            out_label = role
            out_name = f"{Path(img_path).stem}_p{pi}_{out_label}.jpg"
            rel_path = Path(out_split) / out_label / out_name
            out_path = out_root / rel_path
            ok = save_crop(img, (px1, py1, px2, py2), out_path, out_size=224)
            if ok:
                meta.append({
                    "path": str(rel_path),
                    "label": out_label,
                    "src": str(img_path),
                    "w": int(px2 - px1),
                    "h": int(py2 - py1)
                })
                tmp_paths.append((out_path, out_label, Path(img_path).name))

    if not meta:
        print("[ERROR] No crops produced. Verify your LS export and --images_dir mapping.")
        return 1

    # Grouped split by image basename
    groups = [src for (_, _, src) in tmp_paths]
    uniq = list(sorted(set(groups)))
    random.shuffle(uniq)
    cutoff = int(len(uniq) * train_ratio)
    train_groups = set(uniq[:cutoff])

    # move files into final split dirs
    for (out_path, label, src_name) in tmp_paths:
        split = "train" if src_name in train_groups else "val"
        final_rel = Path(split) / label / out_path.name
        final_abs = out_root / final_rel
        ensure_dir(final_abs.parent)
        try:
            os.replace(out_path, final_abs)
        except FileNotFoundError:
            # already moved or missing
            pass

    # rewrite meta with correct split
    final_rows = []
    for m in meta:
        # compute new path
        old = Path(m["path"])
        split = "train" if any(str(old.name) in str(p[0]) for p in tmp_paths if p[2] in train_groups) else "val"
        new_rel = Path(split) / old.parts[-2] / old.name  # split/label/filename
        m["path"] = str(new_rel)
        final_rows.append(m)

    ensure_dir(out_root)
    with open(out_root / "metadata.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(final_rows[0].keys()))
        w.writeheader()
        w.writerows(final_rows)

    print(f"[OK] Wrote {len(final_rows)} crops into {out_root}/(train|val)/{{cleaner,regular}}")
    return 0

# ----------------- CLI -----------------
def main():
    ap = argparse.ArgumentParser(description="Create person crops from a Label Studio JSON export.")
    ap.add_argument("--ls_json", required=True, help="Path to Label Studio export JSON (the provided file).")
    ap.add_argument("--images_dir", required=True, help="Root directory containing the source images.")
    ap.add_argument("--out_root", default="dataset/person_cls", help="Output root for crops.")
    ap.add_argument("--train_ratio", type=float, default=0.85, help="Train split ratio.")
    ap.add_argument("--pad_pct", type=float, default=0.20, help="Context padding around person bbox.")
    ap.add_argument("--min_size", type=int, default=48, help="Min crop side in pixels.")
    ap.add_argument("--min_box_pct", type=float, default=0.05, help="Min box size as fraction of image (width/height).")
    ap.add_argument("--assume_cleaner_if_tool_near", action="store_true", help="Infer cleaner when a tool is near and no choice exists.")
    ap.add_argument("--tool_labels", nargs="*", default=TOOL_LABELS_DEFAULT, help="Tool labels in Label Studio rectanglelabels.")
    args = ap.parse_args()

    out_root = Path(args.out_root)
    out_root.mkdir(parents=True, exist_ok=True)

    rc = build_from_labelstudio(
        ls_json=Path(args.ls_json),
        images_dir=Path(args.images_dir),
        out_root=out_root,
        train_ratio=args.train_ratio,
        pad_pct=args.pad_pct,
        min_size=args.min_size,
        min_box_pct=args.min_box_pct,
        assume_cleaner_if_tool_near=args.assume_cleaner_if_tool_near,
        tool_labels=args.tool_labels
    )
    raise SystemExit(rc)

if __name__ == "__main__":
    main()
