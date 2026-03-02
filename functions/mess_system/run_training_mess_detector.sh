#!/usr/bin/env bash
set -e
# ─── LOAD CONFIG FROM config.yaml ─────────────────────────────────────────────
CONFIG_FILE="mess_config.yaml"

DATA_CFG="mess_detector_dataset.yaml"        # data config pointing at train/val/test

MODEL_PRETRAIN="models/yolov8n.pt"           # base model
PROJECT_DIR="runs/train"                     # where to save training outputs
RUN_NAME="mess_detector"
DEVICE=$(yq '.model.device' "$CONFIG_FILE")
EPOCHS=100
IMGSZ=$(yq '.model.image_size' "$CONFIG_FILE")
BATCH=8
CONF=$(yq '.model.confidence_thershold' "$CONFIG_FILE")
LR=$(yq '.model.learning_rate // 0.01' "$CONFIG_FILE")
PATIENCE=$(yq '.model.early_stopping_patience // 20' "$CONFIG_FILE")

# ─── 1) TRAIN (uses train+val internally, selects best.pt) ─────────────────────
echo "🔄 Starting training on train→val splits..."
yolo train \
  data=$DATA_CFG \
  model=$MODEL_PRETRAIN \
  epochs=$EPOCHS \
  imgsz=$IMGSZ \
  batch=$BATCH \
  device=$DEVICE \
  project=$PROJECT_DIR \
  name=$RUN_NAME \
  exist_ok=True \
  conf=$CONF \
  max_det=100 \
  lr0=$LR \
  patience=$PATIENCE \
  fliplr=0.5 \
  degrees=10 \
  scale=0.5 \
  hsv_h=0.015 \
  hsv_s=0.7 \
  hsv_v=0.4

BEST_MODEL="$PROJECT_DIR/$RUN_NAME/weights/best.pt"
echo "✔ Training complete. Best model saved to $BEST_MODEL"

# ─── 2) VALIDATE on the VAL split ───────────────────────────────────────────────
echo "🔍 Evaluating on the validation split..."
yolo val \
  data=$DATA_CFG \
  model=$BEST_MODEL \
  split=val \
  device=$DEVICE

# ─── 3) EVALUATE on the TEST split ─────────────────────────────────────────────
echo "🔍 Evaluating on the test split..."
yolo val \
  data=$DATA_CFG \
  model=$BEST_MODEL \
  split=test \
  device=$DEVICE

# ─── 4) PREDICT on TEST (generate .txt + visuals) ─────────────────────────────
echo "📦 Generating test predictions (boxes + confidences)..."
yolo predict \
  data=$DATA_CFG \
  model=$BEST_MODEL \
  split=test \
  save_txt=True \
  save_conf=True \
  device=$DEVICE \
  project=runs/predict_test \
  name=mess_test

echo ""
echo "✅ All done!"
echo ""
echo " • Trained model: $BEST_MODEL"
echo " • Val results:    runs/train/$RUN_NAME/val"
echo " • Test results:   runs/train/$RUN_NAME/test"
echo " • Predictions:    runs/predict_test/mess_test/"
echo ""
echo "You can now launch your Streamlit app to browse test-set predictions."
