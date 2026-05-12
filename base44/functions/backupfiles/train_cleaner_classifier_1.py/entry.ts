#!/usr/bin/env python3
# train_cleaner_classifier.py — EfficientNet/MobileNet cleaner-vs-regular classifier
#
# Features:
# - Strong but sane augs: RandomResizedCrop(224), HFlip, ColorJitter, RandomErasing (+ optional RandAugment)
# - Mixup + Label Smoothing (improves calibration & robustness)
# - AdamW + cosine LR with warmup; gradient clipping
# - EMA of weights; Freeze-then-unfreeze transfer learning
# - Optional imbalance handling: class-weighted loss and/or weighted sampler
# - TTA on validation (hflip) + confusion matrices + per-class F1 + macro-F1
# - Saves: best checkpoint (by macro-F1), metrics.jsonl, confusion matrices PNG
#
# Usage (examples):
#   python3 train_cleaner_classifier.py --data_root crops_cleaner_cls --balance_strategy weights
#   python3 train_cleaner_classifier.py --data_root crops_cleaner_cls --model mobilenet_v3_large --balance_strategy both
#
import argparse, os, random, json, math, time
from pathlib import Path
from typing import Tuple, List
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms, models
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
import matplotlib.pyplot as plt

try:
    from torch.optim.swa_utils import AveragedModel
except Exception:
    AveragedModel = None

PIN_MEM = torch.cuda.is_available() and not getattr(torch.backends, "mps", None)

class LabelSmoothingCE(nn.Module):
    def __init__(self, smoothing=0.0, weight=None):
        super().__init__()
        self.smoothing = smoothing
        self.weight = weight
        self.ce = nn.CrossEntropyLoss(label_smoothing=smoothing, weight=weight)

    def forward(self, logits, target):
        # Rebuild loss if weights changed at runtime
        if self.ce.weight is not self.weight:
            self.ce = nn.CrossEntropyLoss(label_smoothing=self.smoothing, weight=self.weight)
        return self.ce(logits, target)


def get_model(name: str, num_classes: int, pretrained=True):
    name = name.lower()
    if name in ["efficientnet_b0", "efficientnet-b0", "effb0"]:
        m = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.DEFAULT if pretrained else None
        )
        in_feat = m.classifier[1].in_features
        m.classifier[1] = nn.Linear(in_feat, num_classes)
    elif name in ["mobilenet_v3_large", "mobilenetv3", "mbv3l"]:
        m = models.mobilenet_v3_large(
            weights=models.MobileNet_V3_Large_Weights.DEFAULT if pretrained else None
        )
        in_feat = m.classifier[3].in_features
        m.classifier[3] = nn.Linear(in_feat, num_classes)
    else:
        raise ValueError("Unsupported model name")
    return m


def build_transforms(img_size=224):
    train_tfms = [
        transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0), ratio=(0.8, 1.25)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.ColorJitter(0.2, 0.2, 0.2, 0.05),
    ]
    # Try RandAugment if available
    try:
        from torchvision.transforms import RandAugment
        train_tfms.append(RandAugment(num_ops=2, magnitude=7))
    except Exception:
        pass

    train_tfms += [
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
        transforms.RandomErasing(p=0.25, scale=(0.02, 0.08),
                                 ratio=(0.3, 3.3), value="random"),
    ]

    val_tfms = transforms.Compose([
        transforms.Resize(int(img_size * 1.14)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406],
                             std=[0.229, 0.224, 0.225]),
    ])
    return transforms.Compose(train_tfms), val_tfms


def mixup_data(x, y, alpha=0.2):
    if alpha <= 0:
        return x, y, None
    lam = np.random.beta(alpha, alpha)
    batch_size = x.size()[0]
    index = torch.randperm(batch_size, device=x.device)
    mixed_x = lam * x + (1 - lam) * x[index, :]
    y_a, y_b = y, y[index]
    return mixed_x, (y_a, y_b), lam


def mixup_criterion(criterion, pred, y_mix):
    y_a, y_b, lam = y_mix
    return lam * criterion(pred, y_a) + (1 - lam) * criterion(pred, y_b)


def train_one_epoch(model, dl, optimizer, scheduler, criterion, device,
                    mixup_alpha=0.2, grad_clip=1.0, ema=None):
    model.train()
    total_loss, n = 0.0, 0
    for x, y in dl:
        x, y = x.to(device), y.to(device)
        # Mixup
        if mixup_alpha > 0:
            x, y_mix, lam = mixup_data(x, y, alpha=mixup_alpha)
        else:
            y_mix, lam = None, None

        optimizer.zero_grad(set_to_none=True)
        out = model(x)
        if y_mix is not None:
            loss = mixup_criterion(criterion, out, (*y_mix, lam))
        else:
            loss = criterion(out, y)
        loss.backward()
        if grad_clip is not None:
            nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
        optimizer.step()
        if scheduler is not None:
            scheduler.step()
        if ema is not None:
            for p_ema, p in zip(ema.parameters(), model.parameters()):
                p_ema.data.mul_(0.999).add_(p.data, alpha=0.001)

        total_loss += loss.item() * x.size(0)
        n += x.size(0)
    return total_loss / max(1, n)


@torch.no_grad()
def eval_model(model, dl, device, tta=False):
    model.eval()
    all_logits, all_tgts = [], []
    for x, y in dl:
        x, y = x.to(device), y.to(device)
        if tta:
            logits = model(x)
            logits_flip = model(torch.flip(x, dims=[3]))
            logits = (logits + logits_flip) / 2.0
        else:
            logits = model(x)
        all_logits.append(logits.cpu()); all_tgts.append(y.cpu())
    logits = torch.cat(all_logits); tgts = torch.cat(all_tgts)
    probs = torch.softmax(logits, dim=1).numpy()
    preds = probs.argmax(axis=1)
    acc = (preds == tgts.numpy()).mean()
    prec, rec, f1, _ = precision_recall_fscore_support(
        tgts.numpy(), preds, average=None, zero_division=0
    )
    macro_f1 = f1.mean()
    cm = confusion_matrix(tgts.numpy(), preds)
    return acc, macro_f1, f1.tolist(), cm, probs, tgts.numpy()


def plot_confusion(cm, class_names, out_png):
    fig, ax = plt.subplots(figsize=(4, 4), dpi=150)
    im = ax.imshow(cm, interpolation='nearest')
    ax.set_title("Confusion Matrix")
    ax.set_xticks(range(len(class_names))); ax.set_xticklabels(class_names, rotation=45, ha='right')
    ax.set_yticks(range(len(class_names))); ax.set_yticklabels(class_names)
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center")
    fig.tight_layout()
    fig.savefig(out_png)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_root", required=True,
                    help="data_root/{train,val}/{cleaner,regular} expected")
    ap.add_argument("--model", default="efficientnet_b0",
                    choices=["efficientnet_b0", "mobilenet_v3_large"])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch_size", type=int, default=64)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--weight_decay", type=float, default=1e-4)
    ap.add_argument("--mixup_alpha", type=float, default=0.2)
    ap.add_argument("--label_smoothing", type=float, default=0.05)
    ap.add_argument("--warmup_steps", type=int, default=500)
    ap.add_argument("--img_size", type=int, default=224)
    ap.add_argument("--freeze_epochs", type=int, default=3,
                    help="Freeze backbone for first N epochs")
    ap.add_argument("--out", default="cls_runs/cleaner_classifier")
    ap.add_argument("--num_workers", type=int, default=6)
    ap.add_argument("--balance_strategy",
                    choices=["none", "weights", "sampler", "both"],
                    default="weights",
                    help="Handle class imbalance: add loss weights, sampler, or both.")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    train_tfms, val_tfms = build_transforms(args.img_size)

    # Datasets
    train_ds = datasets.ImageFolder(Path(args.data_root) / "train", transform=train_tfms)
    val_ds = datasets.ImageFolder(Path(args.data_root) / "val", transform=val_tfms)
    class_names = train_ds.classes
    num_classes = len(class_names)
    assert set(class_names) == {"cleaner", "regular"}, f"Expected classes cleaner/regular, got {class_names}"

    # Compute class counts/weights from train set
    # ImageFolder typically stores targets in .targets
    import numpy as _np  # avoids shadowing numpy import
    targets = _np.array(train_ds.targets, dtype=_np.int64)
    class_counts = _np.bincount(targets, minlength=num_classes)
    total = class_counts.sum()
    inv_freq = total / _np.maximum(1, class_counts)
    class_weights = (inv_freq / inv_freq.sum() * num_classes).astype("float32")

    print(f"[INFO] Class counts (train): {dict(zip(class_names, class_counts.tolist()))}")
    print(f"[INFO] Using balance_strategy={args.balance_strategy}")

    # DataLoaders (optionally with WeightedRandomSampler)
    g = torch.Generator()
    g.manual_seed(42)

    if args.balance_strategy in ("sampler", "both"):
        from torch.utils.data.sampler import WeightedRandomSampler
        sample_weights = class_weights[targets]
        sampler = WeightedRandomSampler(
            weights=torch.tensor(sample_weights, dtype=torch.double),
            num_samples=len(targets),
            replacement=True,
        )
        train_dl = DataLoader(train_ds, batch_size=args.batch_size, shuffle=False,
                              sampler=sampler, num_workers=args.num_workers,
                              pin_memory=PIN_MEM, generator=g)
    else:
        train_dl = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              num_workers=args.num_workers, pin_memory=PIN_MEM, generator=g)

    val_dl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                        num_workers=args.num_workers, pin_memory=PIN_MEM)

    # Model
    model = get_model(args.model, num_classes=num_classes, pretrained=True).to(device)

    # Freeze backbone initially
    def set_backbone_trainable(m, requires_grad: bool):
        for name, p in m.named_parameters():
            if "classifier" not in name:
                p.requires_grad = requires_grad

    set_backbone_trainable(model, False)

    # Opt & sched
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=args.lr, weight_decay=args.weight_decay
    )

    total_steps = args.epochs * len(train_dl)
    warmup_steps = min(args.warmup_steps, max(10, int(0.05 * total_steps)))
    cosine_steps = max(1, total_steps - warmup_steps)

    def lr_lambda(step):
        if step < warmup_steps:
            return step / float(max(1, warmup_steps))
        progress = (step - warmup_steps) / float(max(1, cosine_steps))
        return 0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * progress))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Criterion (with optional class weights)
    cw = torch.tensor(class_weights, dtype=torch.float32, device=device) \
        if args.balance_strategy in ("weights", "both") else None
    criterion = LabelSmoothingCE(smoothing=args.label_smoothing, weight=cw)

    # EMA
    ema = AveragedModel(model) if AveragedModel is not None else None

    best_f1, best_epoch = -1.0, -1
    out_dir = Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)
    metrics_hist = []

    global_step = 0
    for epoch in range(args.epochs):
        if epoch == args.freeze_epochs:
            # unfreeze backbone with slightly lower LR
            set_backbone_trainable(model, True)
            optimizer = torch.optim.AdamW(model.parameters(),
                                          lr=args.lr * 0.3,
                                          weight_decay=args.weight_decay)
            scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

        train_loss = train_one_epoch(model, train_dl, optimizer, scheduler, criterion, device,
                                     mixup_alpha=args.mixup_alpha, grad_clip=1.0, ema=ema)
        global_step += len(train_dl)

        # Eval with EMA if present
        eval_model_ref = ema if (ema is not None and epoch >= args.freeze_epochs) else model
        acc, macro_f1, per_class_f1, cm, probs, tgts = eval_model(eval_model_ref, val_dl, device, tta=True)

        # Log metrics
        metrics = {
            "epoch": epoch, "train_loss": train_loss, "val_acc": acc,
            "val_macro_f1": macro_f1, "per_class_f1": per_class_f1
        }
        metrics_hist.append(metrics)
        with open(out_dir / "metrics.jsonl", "a") as f:
            f.write(json.dumps(metrics) + "\n")

        # Save confusion matrix
        plot_confusion(cm, class_names, out_dir / f"cm_epoch{epoch:03d}.png")

        # Save best model (by macro-F1)
        if macro_f1 > best_f1:
            best_f1, best_epoch = macro_f1, epoch
            torch.save(
                {
                    "model": model.state_dict(),
                    "ema": (ema.state_dict() if ema else None),
                    "class_names": class_names,
                    "args": vars(args),
                },
                out_dir / "cleaner_cls_best.pth",
            )

        print(f"epoch {epoch}: train_loss={0 if train_loss is None else train_loss:.4f} "
              f"| acc={acc:.4f} | macroF1={macro_f1:.4f} | bestF1={best_f1:.4f}@{best_epoch}")

    print(f"[OK] Finished. Best macro-F1={best_f1:.4f} at epoch {best_epoch}. "
          f"Model saved to {out_dir/'cleaner_cls_best.pth'}.")


if __name__ == "__main__":
    main()
