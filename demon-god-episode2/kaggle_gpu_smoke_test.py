# Kaggle free NVIDIA GPU: first-run verification
# Paste these cells into https://www.kaggle.com/code after enabling Settings > Accelerator > GPU.
# This is a hardware test, NOT a claim that Episode 2 is rendered.

import torch, subprocess, json, os
print("CUDA available:",torch.cuda.is_available())
if not torch.cuda.is_available():
    raise RuntimeError("No NVIDIA GPU assigned. Enable the GPU accelerator in Kaggle Settings.")
print("GPU:",torch.cuda.get_device_name(0))
print("VRAM GiB:",round(torch.cuda.get_device_properties(0).total_memory/1024**3,2))
subprocess.run(["nvidia-smi"],check=True)

# Check whether basic GPU inference actually works without downloading model weights.
device="cuda"
x=torch.randn((1024,1024),device=device)
y=x@x
torch.cuda.synchronize()
print("GPU smoke test:",bool(torch.isfinite(y).all()),"mean",float(y.mean()))

# Next: select a video model that fits the *measured* VRAM. Do not start a 90s
# batch until a single 2-3 second scene has been rendered and inspected.
# Retrieve prompts from the repository's demon-god-episode2/shots.json.
