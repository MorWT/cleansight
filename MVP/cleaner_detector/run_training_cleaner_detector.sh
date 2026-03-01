#!/usr/bin/env bash
set -euo pipefail

# ========= User-configurable =========
# Choose a base model: yolov8s.pt / yolov8n.pt / yolov11n.pt / yolov11s.pt, or your own checkpoint
MODEL_WEIGHTS="${MODEL_WEIGHTS:-models/yolo11n.pt}"

# Point to your YOLO-format dataset (images/ + labels/ for train & val)
DATA_YAML="${DATA_YAML:-cleaner_detector/cleaner_detector_dataset.yaml}"

# Where to write runs
PROJECT="${PROJECT:-runs/train}"
RUN_NAME="${RUN_NAME:-cleaner_detector_v4_13_11_2025}"

# Mixed precision, device, batch, image size, epochs
DEVICE="${DEVICE:-cpu}"            # "0" for first GPU, "cpu" for CPU
BATCH="${BATCH:-16}"
IMGSZ="${IMGSZ:-640}"
EPOCHS="${EPOCHS:-150}"

# Early stopping patience (epochs without improvement in mAP50-95)
PATIENCE="${PATIENCE:-30}"

# Cache images into RAM for speed (requires enough memory)
CACHE="${CACHE:-ram}"

# Workers (set lower on Windows)
WORKERS="${WORKERS:-8}"

# Seed for repeatability
SEED="${SEED:-42}"
# ====================================

echo "===> Training CleanerDetector"
echo "Model:        ${MODEL_WEIGHTS}"
echo "Data:         ${DATA_YAML}"
echo "Device:       ${DEVICE}"
echo "Batch:        ${BATCH}"
echo "Img size:     ${IMGSZ}"
echo "Epochs:       ${EPOCHS}"
echo "Patience:     ${PATIENCE}"
echo "Cache:        ${CACHE}"
echo "Workers:      ${WORKERS}"
echo "Project/Name: ${PROJECT}/${RUN_NAME}"
echo "Seed:         ${SEED}"

# Optional: Clear any previous CUDA context issues
export CUDA_VISIBLE_DEVICES="${DEVICE}"

# Train
yolo detect train \
  model="${MODEL_WEIGHTS}" \
  data="${DATA_YAML}" \
  imgsz="${IMGSZ}" \
  epochs="${EPOCHS}" \
  batch="${BATCH}" \
  device="${DEVICE}" \
  patience="${PATIENCE}" \
  cache="${CACHE}" \
  workers="${WORKERS}" \
  project="${PROJECT}" name="${RUN_NAME}" exist_ok=True \
  seed="${SEED}" \
  optimizer=AdamW \
  cos_lr=True \
  lr0=0.002 lrf=0.2 \
  warmup_epochs=3.0 warmup_momentum=0.7 warmup_bias_lr=0.05 \
  close_mosaic=10 \
  save_period=10 \
  plots=True \
  pretrained=True \
  hsv_h=0.015 hsv_s=0.7 hsv_v=0.4 \
  degrees=5.0 translate=0.08 scale=0.40 shear=2.0 flipud=0.0 fliplr=0.5 \
  mosaic=0.8 mixup=0.05 copy_paste=0.0 \
  momentum=0.9 weight_decay=0.0005

# Copy best weights to a stable path used by runtime
mkdir -p weights
BEST_PATH="${PROJECT}/${RUN_NAME}/weights/best.pt"
if [ -f "${BEST_PATH}" ]; then
  cp "${BEST_PATH}" weights/people_tools_yolo.pt
  echo "Saved best weights -> weights/people_tools_yolo.pt"
else
  echo "WARNING: best.pt not found; check training run folder."
fi

# Validate (optional explicit val run; Ultralytics already validates during training)
yolo detect val model="weights/people_tools_yolo.pt" data="${DATA_YAML}" imgsz="${IMGSZ}" device="${DEVICE}" split=val
