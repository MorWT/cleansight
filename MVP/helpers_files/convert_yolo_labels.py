# This scripts convert the labels file to YOLO correct format.
# From 9 fields label files to 5 fields

import os
from pathlib import Path
from PIL import Image, ImageDraw
import yaml

# Load configuration
with open("helpers_files/mess_config.yaml", "r") as f:
    config = yaml.safe_load(f)

labels_dir = Path(config["data"]["labels_path"])
images_dir = Path(config["data"]["images_path"])
viz_dir = Path(config["data"]["vizualization_path"])
viz_dir.mkdir(exist_ok=True)

for lbl_path in labels_dir.glob("*.txt"):
    # 1) Open image to get W,H
    img_path = images_dir / (lbl_path.stem + ".jpg")
    if not img_path.exists():
        img_path = images_dir / (lbl_path.stem + ".png")
    img = Image.open(img_path).convert("RGB")
    W, H = img.size

    draw = ImageDraw.Draw(img)
    new_yolo = []

    for line in lbl_path.read_text().splitlines():
        parts = line.split()
        if len(parts) != 9:
            continue
        cls = parts[0]
        coords_rel = list(map(float, parts[1:]))

        # 2) Denormalize to pixel coords
        xs = [coords_rel[i]*W for i in range(0,8,2)]
        ys = [coords_rel[i]*H for i in range(1,8,2)]

        # 3) Draw original polygon in green
        poly = list(zip(xs, ys))
        draw.line(poly + [poly[0]], fill="green", width=2)

        # 4) Compute tight bbox
        xmin, xmax = min(xs), max(xs)
        ymin, ymax = min(ys), max(ys)

        # 5) Draw YOLO-style rect in red
        draw.rectangle([xmin, ymin, xmax, ymax], outline="red", width=2)

        # 6) Convert to normalized YOLO5 fields
        x_center = (xmin + xmax) / 2 / W
        y_center = (ymin + ymax) / 2 / H
        bw = (xmax - xmin) / W
        bh = (ymax - ymin) / H
        new_yolo.append(f"{cls} {x_center:.6f} {y_center:.6f} {bw:.6f} {bh:.6f}")

    # 7) Overwrite label with YOLO5 lines
    lbl_path.write_text("\n".join(new_yolo))

    # 8) Save visualization
    out_path = viz_dir / f"{lbl_path.stem}_viz.png"
    img.save(out_path)
    print(f"{lbl_path.stem}: drew {len(new_yolo)} boxes → {out_path}")
