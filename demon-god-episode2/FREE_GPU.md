# Free GPU setup

1. Open https://www.kaggle.com/code and sign in.
2. Create a notebook. Under **Settings → Accelerator**, choose an available GPU. Availability, quotas, verification and terms are controlled by Kaggle.
3. Paste and execute `kaggle_gpu_preflight.py` from this folder.
4. Review the reported GPU model and VRAM. Choose a compatible small/quantized video model, based on its actual published requirements.
5. Render a **short 2–4 second proof clip first**, using shot 01 from `shots.json`. Save and inspect the resulting MP4.
6. Only then attempt the remaining scenes, with checkpoints and backups. The complete 90-second photorealistic project is not guaranteed to fit free GPU quotas.

Never paste passwords or API tokens into a notebook. Do not claim a completed render until its MP4 is verified. GitHub Actions standard runners do not provide a free NVIDIA GPU.
