model:
  path: "runs/train/mess_detector/weights/best.pt"
  tag: "yolov8n-mess:v1"
  confidence_threshold: 0.1
  image_size: 1280
  device: "cpu"
  sample_interval: 1.0
  output_dir: "samples"
  learning_rate: 0.01
  early_stopping_patience: 20

ui:
  logo_path: "assets/logo.png"
  max_file_size: "10MB"
  supported_formata: ["png", "jpg", "jpeg"]


data:
  images_path: "dataset/raw"
  labels_path: "dataset/yolov8_annotations/labels"
  vizualization_path: "dataset/yolov8_annotations/vizualization"
  split_path: "dataset/split"