#!/usr/bin/env python3
"""
split_dataset.py

Splits a collection of images (JPEG/PNG) and their YOLO-style labels (TXT) into
train / validation / test subsets. Copies the files into separate folders
under a given output directory, preserving image/label pairing.

Usage:
    python split_dataset.py

Configuration:
    - IMG_ROOT:   Path to source images directory
    - LBL_ROOT:   Path to source labels directory
    - SPLIT_ROOT: Path to output base directory
    - RATIOS:     Tuple of (train_frac, val_frac, test_frac)

At the end, prints counts of files in each split.
"""
import yaml
import os
import random
import shutil
from typing import List, Tuple, Dict, Set, DefaultDict
from collections import defaultdict


# ----------------------------
# Load paths from config.yaml
# ----------------------------
# with open("mess_config.yaml", "r") as f:
#     config = yaml.safe_load(f)
with open("cleaner_detector/cleaner_config.yaml", "r") as f:
    config = yaml.safe_load(f)
# ----------------------------
# Configuration
# ----------------------------
IMG_ROOT: str    = config["data"]["images_path"]
LBL_ROOT: str    = config["data"]["labels_path"]
SPLIT_ROOT: str  = config["data"]["split_path"]
RATIOS: Tuple[float, float, float] = (0.7, 0.2, 0.1)  # train / val / test fractions

# ----------------------------
# Helper Functions
# ----------------------------
def gather_image_basenames(img_dir: str) -> List[str]:
    basenames = [
        os.path.splitext(f)[0]
        for f in os.listdir(img_dir)
        if f.lower().endswith(('.jpg', '.png'))
    ]
    unique_sorted = sorted(set(basenames))
    return unique_sorted

def get_image_classes(lbl_dir: str, basenames: List[str]) -> Dict[str, Set[str]]:
    """
    For each image, read its label file and collect all classes present.
    Returns: {basename: set of class_ids}
    """
    img_classes = {}
    for name in basenames:
        label_path = os.path.join(lbl_dir, name + ".txt")
        classes = set()
        if os.path.exists(label_path):
            with open(label_path, "r") as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        classes.add(parts[0])  # class id is first field
        img_classes[name] = classes
    return img_classes

def stratified_split_indices(
    img_classes: Dict[str, Set[str]],
    ratios: Tuple[float, float, float]
) -> Dict[str, List[str]]:
    """
    Stratified split: for each class, split images containing that class,
    then merge splits so each split has proportional class representation.
    """
    # Map class_id -> set of image basenames
    class_to_images = defaultdict(set)
    for name, classes in img_classes.items():
        for cls in classes:
            class_to_images[cls].add(name)

    # For each class, split its images
    split_sets = {'train': set(), 'val': set(), 'test': set()}
    for cls, images in class_to_images.items():
        images = list(images)
        random.shuffle(images)
        total = len(images)
        n_train = int(ratios[0] * total)
        n_val   = int(ratios[1] * total)
        train_imgs = set(images[:n_train])
        val_imgs   = set(images[n_train:n_train + n_val])
        test_imgs  = set(images[n_train + n_val:])
        split_sets['train'].update(train_imgs)
        split_sets['val'].update(val_imgs)
        split_sets['test'].update(test_imgs)

    # Ensure no image is in more than one split
    all_imgs = set(img_classes.keys())
    assigned = set()
    splits = {'train': [], 'val': [], 'test': []}
    for split in ['train', 'val', 'test']:
        for name in split_sets[split]:
            if name not in assigned:
                splits[split].append(name)
                assigned.add(name)
    # Assign any unassigned images randomly
    unassigned = list(all_imgs - assigned)
    random.shuffle(unassigned)
    for i, name in enumerate(unassigned):
        split = ['train', 'val', 'test'][i % 3]
        splits[split].append(name)
    return splits

def copy_split_files(
    split_name: str,
    basenames: List[str],
    img_src: str,
    lbl_src: str,
    out_base: str
) -> None:
    img_out = os.path.join(out_base, split_name, "images")
    lbl_out = os.path.join(out_base, split_name, "labels")
    os.makedirs(img_out, exist_ok=True)
    os.makedirs(lbl_out, exist_ok=True)

    for name in basenames:
        jpg_path = os.path.join(img_src, name + ".jpg")
        png_path = os.path.join(img_src, name + ".png")
        img_path = jpg_path if os.path.exists(jpg_path) else png_path

        if not os.path.exists(img_path):
            print(f"[ERROR] Image not found for: {name}")
            continue

        shutil.copy(img_path, img_out)

        label_path = os.path.join(lbl_src, name + ".txt")
        if os.path.exists(label_path):
            shutil.copy(label_path, lbl_out)
        else:
            print(f"[WARNING] Label not found for: {name}")

# ----------------------------
# Main Routine
# ----------------------------
def main() -> None:
    random.seed(42)  # For reproducibility

    basenames = gather_image_basenames(IMG_ROOT)
    img_classes = get_image_classes(LBL_ROOT, basenames)
    splits = stratified_split_indices(img_classes, RATIOS)

    for split, names in splits.items():
        copy_split_files(split, names, IMG_ROOT, LBL_ROOT, SPLIT_ROOT)

    print("✅ Stratified dataset split complete:")
    for split, names in splits.items():
        print(f"  • {split}: {len(names)} files")

if __name__ == "__main__":
    main()