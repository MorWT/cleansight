# train_cleaner_classifier.py
# Cleaner vs Regular person classifier (macOS/MPS-safe + early stopping + LR scheduler)
# Dataset layout expected:
# datasets/person_cls/
#   train/{cleaner,regular}/
#   val/{cleaner,regular}/

import argparse
import platform
from collections import Counter
from pathlib import Path
import matplotlib.pyplot as plt


import torch
from torch import nn, optim
from torch.utils.data import DataLoader, WeightedRandomSampler
from torchvision import datasets, transforms, models


def detect_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def build_transforms(img_size: int, jitter: float):
    train_tf = transforms.Compose([
        transforms.Resize((img_size, img_size)),
        transforms.ColorJitter(jitter, jitter, jitter, 0.10),
        transforms.RandomHorizontalFlip(),
        transforms.ToTensor(),
    ])
    val_tf = transforms.Compose([
        transforms.Resize((img_size, img_size)),
        transforms.ToTensor(),
    ])
    return train_tf, val_tf


def compute_class_weights(train_ds, device: str):
    counts = Counter([y for _, y in train_ds.samples])
    total = sum(counts.values())
    weights = [total / counts[y] for _, y in train_ds.samples]
    # tensor for CE loss (index order = class index)
    cls_w = torch.tensor([total / counts[c] for c in range(len(train_ds.classes))],
                         dtype=torch.float32, device="cpu" if device == "mps" else device)
    return weights, cls_w


def build_loaders(data_root: Path,
                  img_size: int,
                  batch_size: int,
                  device: str,
                  use_class_weights: bool,
                  use_sampler: bool,
                  num_workers_override: int | None = None,
                  jitter: float = 0.30):
    train_tf, val_tf = build_transforms(img_size, jitter)

    train_ds = datasets.ImageFolder(data_root / "train", transform=train_tf)
    val_ds = datasets.ImageFolder(data_root / "val", transform=val_tf)

    is_mac = platform.system() == "Darwin"
    num_workers = 0 if (device == "mps" or is_mac) else 4
    print(f"++++++++ num_workers: {num_workers}")
    if num_workers_override is not None:
        num_workers = num_workers_override

    pin_memory = (device == "cuda")
    sampler = None
    class_weights_tensor = None

    if use_class_weights or use_sampler:
        sample_weights, class_weights_tensor = compute_class_weights(train_ds, device)
        if use_sampler:
            sampler = WeightedRandomSampler(sample_weights,
                                            num_samples=len(sample_weights),
                                            replacement=True)

    train_ld = DataLoader(
        train_ds,
        batch_size=batch_size,
        shuffle=(sampler is None),
        sampler=sampler,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )
    val_ld = DataLoader(
        val_ds,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=pin_memory,
    )
    return train_ld, val_ld, train_ds.classes, class_weights_tensor


def build_model(backbone: str, num_classes=2):
    if backbone == "efficientnet_b0":
        model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.DEFAULT)
        model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    elif backbone == "mobilenet_v3_large":
        model = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.DEFAULT)
        model.classifier[3] = nn.Linear(model.classifier[3].in_features, num_classes)
    else:
        raise ValueError(f"Unsupported backbone: {backbone}")
    return model


def set_backbone_trainable(model: nn.Module, trainable: bool):
    for name, p in model.named_parameters():
        if "classifier" in name:
            p.requires_grad = True
        else:
            p.requires_grad = trainable

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


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    tot = 0
    correct = 0
    loss_sum = 0.0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        out = model(x)
        loss = criterion(out, y)
        preds = out.argmax(1)
        loss_sum += loss.item() * x.size(0)
        correct += (preds == y).sum().item()
        tot += x.size(0)
    val_loss = loss_sum / max(tot, 1)
    val_acc = correct / max(tot, 1)
    return val_loss, val_acc


def train(args):
    device = detect_device()
    print(f"++++++++ Device: {device}")
    Path(args.weights_dir).mkdir(parents=True, exist_ok=True)
    data_root = Path(args.data_root)

    train_ld, val_ld, classes, class_weights_tensor = build_loaders(
        data_root=data_root,
        img_size=args.img_size,
        batch_size=args.batch_size,
        device=device,
        use_class_weights=args.use_class_weights,
        use_sampler=args.use_sampler,
        num_workers_override=args.num_workers,
        jitter=args.jitter,
    )
    print(f"Device: {device} | Classes: {classes} | Train batches: {len(train_ld)} | Val batches: {len(val_ld)}")

    model = build_model(args.backbone).to(device)

    # freeze backbone for warmup if requested
    if args.freeze_head_epochs > 0:
        set_backbone_trainable(model, False)
    else:
        set_backbone_trainable(model, True)

    # Loss
    if args.use_class_weights and class_weights_tensor is not None:
        # if device == "mps":
            # Force everything CPU-side for stability
            # criterion = nn.CrossEntropyLoss(weight=class_weights_tensor.cpu())
        # else:
        criterion = nn.CrossEntropyLoss(weight=class_weights_tensor.to(device))
        print("Using class-weighted cross entropy.")
    else:
        criterion = nn.CrossEntropyLoss()

    # Optimizer
    opt = optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr)

    # Scheduler: reduce LR when val loss plateaus
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", factor=0.5, patience=2)

    best_val_acc = 0.0
    best_val_loss = float("inf")
    epochs_no_improve = 0

    for epoch in range(1, args.max_epochs + 1):

        # unfreeze backbone after warmup
        if epoch == (args.freeze_head_epochs + 1):
            set_backbone_trainable(model, True)
            opt = optim.AdamW(model.parameters(), lr=args.lr)
            print("Unfroze backbone and reset optimizer.")

        # ---- train ----
        model.train()
        tot = 0
        correct = 0
        loss_sum = 0.0
        for x, y in train_ld:
            x, y = x.to(device), y.to(device)
            opt.zero_grad(set_to_none=True)
            out = model(x)
            loss = criterion(out, y)
            loss.backward()
            opt.step()

            preds = out.argmax(1)
            loss_sum += loss.detach().cpu().item() * x.size(0)
            correct += (preds == y).sum().item()
            tot += x.size(0)

        tr_loss = loss_sum / max(tot, 1)
        tr_acc = correct / max(tot, 1)

        # ---- val ----
        va_loss, va_acc = evaluate(model, val_ld, criterion, device)
        scheduler.step(va_loss)

        print(f"Epoch {epoch:02d} | train_loss={tr_loss:.4f} acc={tr_acc:.3f} "
              f"| val_loss={va_loss:.4f} acc={va_acc:.3f} | lr={opt.param_groups[0]['lr']:.2e}")
        
        
        # Save confusion matrix
        # plot_confusion(cm, classes, args.weights_dir / f"cm_epoch{epoch:03d}.png")

        # ---- early stopping (monitor val_loss, also track best acc) ----
        improved = (va_loss < best_val_loss - 1e-4)
        if improved or va_acc > best_val_acc:
            best_val_loss = min(best_val_loss, va_loss)
            best_val_acc = max(best_val_acc, va_acc)
            epochs_no_improve = 0
            torch.save(model.state_dict(), str(Path(args.weights_dir) / args.out_name))
            print(f"Saved: {Path(args.weights_dir) / args.out_name} (val_acc={best_val_acc:.3f})")
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                print(f"Early stopping at epoch {epoch} (patience {args.patience}). "
                      f"Best val acc={best_val_acc:.3f}")
                break

    print(f"Best val acc: {best_val_acc:.3f}")


def parse_args():
    p = argparse.ArgumentParser("Cleaner vs Regular classifier training")
    p.add_argument("--data_root", type=str, default="datasets/person_cls",
                   help="Root folder containing train/ and val/ subfolders")
    p.add_argument("--weights_dir", type=str, default="weights",
                   help="Where to save checkpoints")
    p.add_argument("--out_name", type=str, default="cleaner_cls_best.pth",
                   help="Checkpoint filename")
    p.add_argument("--backbone", type=str, default="efficientnet_b0",
                   choices=["efficientnet_b0", "mobilenet_v3_large"])
    p.add_argument("--img_size", type=int, default=256, help="Input image size (short side)")
    p.add_argument("--batch_size", type=int, default=64)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--max_epochs", type=int, default=40)
    p.add_argument("--patience", type=int, default=6, help="Early stopping patience (epochs)")
    p.add_argument("--freeze_head_epochs", type=int, default=2,
                   help="Train classifier head only for N epochs, then unfreeze backbone")
    p.add_argument("--use_class_weights", action="store_true",
                   help="Use inverse-frequency class weights in CrossEntropyLoss")
    p.add_argument("--use_sampler", action="store_true",
                   help="Oversample minority class using WeightedRandomSampler")
    p.add_argument("--num_workers", type=int, default=None,
                   help="Override DataLoader workers (default: 0 on macOS/MPS else 4)")
    p.add_argument("--jitter", type=float, default=0.30,
                   help="ColorJitter strength for S, V, B (h kept modest)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    train(args)
