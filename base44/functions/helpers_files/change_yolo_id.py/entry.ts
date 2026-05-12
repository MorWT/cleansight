#!/usr/bin/env python3
import argparse
from pathlib import Path

RULE_KEEP = {0, 1, 2}
RULE_DROP = {3, 13}

def transform_class_id(cid: int) -> tuple[bool, int | None]:
    """
    Returns (keep_line, new_class_id_or_None_if_dropped)
    """
    if cid in RULE_KEEP:
        return True, cid
    if cid in RULE_DROP:
        return False, None
    if 4 <= cid <= 12:
        return True, cid - 1
    if 14 <= cid <= 18:
        return True, cid - 2
    # Any other class IDs: leave unchanged
    return True, cid

def process_file(path: Path) -> bool:
    """
    Process a single label file.
    Returns True if any line was dropped due to class 3 or 13, else False.
    """
    dropped_due_to_3_or_13 = False
    out_lines = []

    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                # preserve blank lines? YOLO labels typically don't need them; we skip
                continue

            parts = line.split()
            # Expect at least 5 tokens: class_id x y w h
            # If malformed, keep line as-is to avoid accidental data loss.
            if not parts:
                continue

            try:
                cid = int(parts[0])
            except ValueError:
                # Not a valid class id; keep original line
                out_lines.append(line)
                continue

            keep, new_cid = transform_class_id(cid)
            if not keep:
                # Dropped because 3 or 13
                if cid in RULE_DROP:
                    dropped_due_to_3_or_13 = True
                continue

            # Reconstruct line with possibly updated class id
            parts[0] = str(new_cid)
            out_lines.append(" ".join(parts))

    # Rewrite the file (even if empty after drops)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for i, l in enumerate(out_lines):
            # write each on its own line
            f.write(l)
            f.write("\n")

    return dropped_due_to_3_or_13

def main():
    parser = argparse.ArgumentParser(
        description="Rewrite YOLO label files in place based on class-id remapping/deletions."
    )
    parser.add_argument(
        "labels_dir",
        type=Path,
        help="Path to the directory containing YOLO label files (e.g., *.txt).",
    )
    parser.add_argument(
        "--pattern",
        default="*.txt",
        help="Glob pattern to match label files (default: *.txt).",
    )
    args = parser.parse_args()

    labels_dir: Path = args.labels_dir
    if not labels_dir.is_dir():
        raise SystemExit(f"Not a directory: {labels_dir}")

    dropped_files = []

    for file_path in sorted(labels_dir.glob(args.pattern)):
        if not file_path.is_file():
            continue
        dropped = process_file(file_path)
        if dropped:
            dropped_files.append(file_path.name)

    # Write drop.txt in the same directory
    drop_path = labels_dir / "drop.txt"
    with drop_path.open("w", encoding="utf-8", newline="\n") as f:
        for name in dropped_files:
            f.write(f"{name}\n")

    print(f"Processed {len(list(labels_dir.glob(args.pattern)))} files.")
    print(f"Wrote {len(dropped_files)} file name(s) to {drop_path.name}.")

if __name__ == "__main__":
    main()
