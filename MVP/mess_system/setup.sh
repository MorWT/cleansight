#!/usr/bin/env bash
set -e

# 1) Create & activate a clean venv
python3 -m venv venv
echo "Created virtualenv in ./venv"
source venv/bin/activate
echo "Activated virtualenv. Installing packages..."

# 2) Upgrade pip & install core deps
pip install --upgrade pip
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
fi

# 3) Download YOLOv8n pretrained weights
cd models
if [ ! -f yolov8n.pt ]; then
    echo "Downloading YOLOv8n weights"
    curl -L \
        -o models/yolov8n.pt \
        https://huggingface.co/ultralytics/yolov8/resolve/main/yolov8n.pt
fi
cd ..

# 3) Split the dataset to train, val and test sets -> images + labels
python3 split_dataset.py

#4) Run training process
chmod +x run_training_mess_detector.sh
./run_training.sh

# 5) Check the cleanliness of your room via the Streamlit UI
streamlit run streamlit_app.py