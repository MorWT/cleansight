<!-- Logo -->
<p align="center">
  <a href="#">
    <img src="assets/logo.png" alt="Project Logo" width="400"/>
  </a>
</p>

# 🧹 TidyVertify - Spot the Mess, Send the Crew, Know it’s Done 🧹

> _A vision pipeline that watches live camera feeds in offices or guest apartments, flags visible mess (full bins, unmade beds, misaligned chair, messy desk, etc.), and turns each detection into a to-do item for the cleaning crew. The service dispatches those tasks, checks that a cleaner has arrived, then re-scans the room to mark anything still missing and pushes status updates to a dashboard for site managers.<br>Under the hood it mixes YOLO object detection, simple activity recognition, and a GPT-4o prompt that translates detections into task lists._

* **Note**: The project is currently at the POC level, which implements before/after mess comparison logic on images.

---

## Table of Contents
 
- [Features & Tech Stack](#features-and-tech-stack)  
- [Getting Started](#getting-started)  
  - [Prerequisites](#prerequisites)  
  - [Installation & Run](#installation-and-run)
- [Usage](#usage)
  - [Streamlit UI](#streamlit-ui)

---

## 🛠️ Features & Tech Stack (POC-level)

- **Language:** Python 3.11
- **Dependency Management:** Python virtual environment
- **Object Detection & Inference:** 
    * PyTorch
    * Ultralytics YOLOv8
- **Web UI:** Streamlit

---

## 🚀 Getting Started

### Prerequisites

```bash
- Python 3.11
- yq
```

### Installation & Run
1. Clone the repo
```bash
cd TidyVerify
```
2. Setup and download model
```bash
chmod +x setup.sh
./setup.sh
```

3. Run Streamlit UI
```bash
streamlit run streamlit_app.py
```

## Usage

### Streamlit UI
At the POC level the Streamlit UI include the following steps:
  1. Upload image (meesy or clean) by its image' path (from your PC).
  2. If the system detect any mess it will display the image with bounding boxes that mark the mess and ask the user to upload an image of the room after it has been cleaned.<br>
    - This loop will continue until the user uploads an image that is not identified as a mess.
  3. If the system does not detect a mess, it will display a message to the user that the displayed room is clean.

