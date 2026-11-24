# Free GPU smoke test for Demon God Episode 2
# Run in Kaggle Notebook with Accelerator: GPU.
# Does not download model weights or spend credits.
import os, subprocess, json, shutil
try:
    import torch
    cuda=torch.cuda.is_available()
    details=[{"name":torch.cuda.get_device_name(i),"vram_gb":round(torch.cuda.get_device_properties(i).total_memory/2**30,1)} for i in range(torch.cuda.device_count())] if cuda else []
except ImportError:
    cuda=False
    details=[]
print(json.dumps({"cuda_available":cuda,"gpus":details,"ffmpeg":bool(shutil.which("ffmpeg"))},indent=2))
if not cuda:
    raise RuntimeError("GPU unavailable. In Kaggle Notebook select Settings > Accelerator > GPU, then rerun.")
print("GPU preflight passed. This does NOT mean a full 90-second render is feasible.")
