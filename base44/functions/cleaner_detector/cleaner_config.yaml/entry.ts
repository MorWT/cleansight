model:
  path: "runs/train/cleaner_detector/weights/best.pt"
  confidence_threshold: 0.1
  image_size: 1280
  device: "cpu"
  sample_interval: 1.0
  output_dir: "samples"
  learning_rate: 0.01
  early_stopping_patience: 20

data:
  images_path: "dataset/cleaning/images"
  labels_path: "dataset/cleaning/labels"
  vizualization_path: "dataset/cleaning/vizualization"
  split_path: "dataset/cleaning/split"