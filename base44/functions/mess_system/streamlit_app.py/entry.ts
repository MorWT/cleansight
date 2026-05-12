"""
app.py

Streamlit application for TidyVerify “Mess Detector”:
1. Loads a YOLO-based model for detecting mess in images.
2. Provides a two-step interface to compare “before” and “after” cleaning images.
3. Draws bounding boxes and labels on detected mess regions.
4. Flags rooms as clean or still needing work, with visual feedback.

Usage:
    streamlit run app.py

Configuration:
    - Ensure `runs/train/mess_multi/weights/best.pt` exists or update path.
    - Place your logo at `../project_assets/logo.png` (or update that path).
"""


import os
import yaml
# Disable Streamlit’s file watcher to avoid excessive reloads on model files
os.environ["STREAMLIT_SERVER_ENABLE_FILE_WATCHER"] = "false"

import streamlit as st
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
# Hide internal C++ class registry (necessary for ultralytics + MPS backend)
torch.classes.__path__ = []

from ultralytics import YOLO

# Load configuration
with open("config.yaml", "r") as f:
    config = yaml.safe_load(f)

MODEL_PATH      = config["model"]["path"]
CONF_THRESHOLD  = config["model"]["confidence_thershold"]
IMAGE_SIZE      = config["model"]["image_size"]
DEVICE_CONFIG   = config["model"]["device"]
LOGO_PATH       = config["ui"]["logo_path"]
SUPPORTED_TYPES = config["ui"]["supported_formata"]


# Preload a default PIL font for drawing labels
font = ImageFont.load_default()

@st.cache_resource
def load_model():
    """
    Load the YOLO model once and cache it for the session.
    
    Chooses 'mps' backend if available (for Apple Silicon), otherwise 'cpu'.
    Returns:
        model:   Ultralytics YOLO model instance
        device:  String identifier for compute device
    """
    device = (
        "mps" if DEVICE_CONFIG == "auto" and torch.backends.mps.is_available()
        else DEVICE_CONFIG if DEVICE_CONFIG != "auto"
        else "cpu"
    )
    model = YOLO(MODEL_PATH)
    return model, device

# Initialize the model and device at startup

model, DEVICE = load_model()

# Display the TidyVerify logo and titles
logo = Image.open(LOGO_PATH)
col1, col2, col3 = st.columns([1, 2, 1])
with col2:
    st.image(logo, width=400)

st.title("TidyVerify")
st.subheader("🧹 Mess Detector : Before & After 🧹")

# 1) BEFORE detection input
uploaded_file = st.file_uploader(
    "Upload BEFORE image",
    type=SUPPORTED_TYPES,
    key="before_upload"
)

# before_path = st.text_input("1) Enter BEFORE image path", key="before_path")
if st.button("Detect Mess in BEFORE"):
    if uploaded_file is not None:
        img = Image.open(uploaded_file).convert("RGB")
    # if os.path.isfile(before_path):
        # Load and preprocess image
        # img = Image.open(before_path).convert("RGB")
        # Run YOLO prediction
        res = model.predict(
            source=np.array(img),
            device=DEVICE,
            conf=CONF_THRESHOLD,
            imgsz=IMAGE_SIZE,
            augment=True
        )

        # Extract boxes (x1, y1, x2, y2) and class indices
        boxes   = res[0].boxes.xyxy.cpu().numpy()
        classes = res[0].boxes.cls.cpu().numpy().astype(int)

        # Store results in session state
        st.session_state.before = {
            "img":     img,
            "boxes":   boxes,
            "classes": classes
        }
        # Reset my previous 'after' state
        st.session_state.pop("after_boxes", None)
        # Flag that we should prompt for an AFTER image if mess was detected
        st.session_state.awaiting_after = boxes.size > 0
    else:
        st.error("File not found. Please check the path.")

# 2) SHOW BEFORE results with drawn boxes and labels
if "before" in st.session_state:
    before   = st.session_state.before
    img      = before["img"]
    boxes    = before["boxes"]
    classes  = before["classes"]
    names    = model.names  # Mapping from class index → label string

    st.image(img, caption="🔵 BEFORE", use_container_width=True)

    if boxes.size == 0:
        # No detections -> room is clean
        st.success("✅ Your room is clean! No mess detected.")
    else:
        # Draw detection boxes and labels
        disp = img.copy()
        draw = ImageDraw.Draw(disp)
        for (x1, y1, x2, y2), cls in zip(boxes, classes):
            label = names[cls]
            # 1) Draw bounding box around the mess 
            draw.rectangle([x1, y1, x2, y2], outline="red", width=2)
            # 2) Calculate text bounding box for background
            text_bbox = draw.textbbox((x1, y1), label, font=font)
            w = text_bbox[2] - text_bbox[0]
            h = text_bbox[3] - text_bbox[1]
            # 3) Draw filled background for label
            draw.rectangle([x1, y1 - h - 4, x1 + w + 4, y1], fill="red")
            # 4) Draw label text
            draw.text((x1 + 2, y1 - h - 2), label, fill="white", font=font)

        st.image(
            disp,
            caption="🔴 BEFORE with Mess Boxes + Labels",
            use_container_width=True
        )

# 3) AFTER detection loop
if st.session_state.get("awaiting_after", False):
    uploaded_after_file = st.file_uploader(
        "Upload AFTER image",
        type=SUPPORTED_TYPES,
        key="after_upload"
    )
    # after_path = st.text_input("2) Enter AFTER image path", key="after_path")
    if st.button("Re-check Mess in AFTER"):
        if uploaded_after_file is not None:
            img2 = Image.open(uploaded_after_file).convert("RGB")
            res2 = model.predict(
                source=np.array(img2),
                device=DEVICE, conf=CONF_THRESHOLD, imgsz=IMAGE_SIZE, augment=True
            )
            boxes2   = res2[0].boxes.xyxy.cpu().numpy()
            classes2 = res2[0].boxes.cls.cpu().numpy().astype(int)
            # Store AFTER results
            st.session_state.after_boxes = {
                "img":     img2,
                "boxes":   boxes2,
                "classes": classes2
            }
        else:
            st.error("File not found. Please check the path.")

    # Display AFTER results if available
    if "after_boxes" in st.session_state:
        after    = st.session_state.after_boxes
        img2     = after["img"]
        boxes2   = after["boxes"]
        classes2 = after["classes"]
        names    = model.names

        st.image(img2, caption="🔵 AFTER", use_container_width=True)

        if boxes2.size == 0:
            # All mess cleared!
            st.balloons()
            st.success("🎉 Mess cleared! Room is clean.")
            st.session_state.awaiting_after = False
        else:
            # Draw remaining mess
            disp2 = img2.copy()
            draw2 = ImageDraw.Draw(disp2)
            for (x1, y1, x2, y2), cls in zip(boxes2, classes2):
                label = names[cls]
                draw2.rectangle([x1, y1, x2, y2], outline="orange", width=2)
                text_bbox = draw2.textbbox((x1, y1), label, font=font)
                w = text_bbox[2] - text_bbox[0]
                h = text_bbox[3] - text_bbox[1]
                draw2.rectangle([x1, y1 - h - 4, x1 + w + 4, y1], fill="orange")
                draw2.text((x1 + 2, y1 - h - 2), label, fill="white", font=font)

            st.error("🚫 Room is not clean; please continue cleaning.")
            st.image(
                disp2,
                caption="🟠 AFTER with Remaining Mess + Labels",
                use_container_width=True
            )
