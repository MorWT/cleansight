import torch
from torchvision import models
from torch import nn
from pathlib import Path

Path("weights").mkdir(exist_ok=True, parents=True)

DEVICE = "cpu"
model = models.efficientnet_b0(weights=None)
model.classifier[1] = nn.Linear(model.classifier[1].in_features, 2)
model.load_state_dict(torch.load("cleaner_detector/weights/cleaner_cls_best.pth", map_location=DEVICE))
model.eval()

dummy = torch.randn(1,3,224,224)
torch.onnx.export(
    model, dummy, "weights/cleaner_cls_best.onnx",
    input_names=["images"], output_names=["logits"],
    opset_version=13,
    dynamic_axes={"images":{0:"batch"}, "logits":{0:"batch"}}
)
print("Saved ONNX: weights/cleaner_cls_best.onnx")
