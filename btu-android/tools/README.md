# BTU CPU inference foundation

The exporter `tools/build_cpu_pte.py` defines a 16×64×64 to 3×64×64 convolutional graph and exports it through ExecuTorch with XNNPACK partitioning.

## Host build

Use a Python environment with compatible PyTorch and ExecuTorch versions (see https://docs.pytorch.org/executorch/). Then:

```sh
cd btu-android
python tools/build_cpu_pte.py
```

If successful, the exporter writes `tools/btu_cinema_inference.pte`. It has **random untrained weights** and does not generate realistic imagery. No .pte is checked into this repository.

## Required Android steps (not implemented)

1. Build or obtain compatible ExecuTorch Android native runtime with XNNPACK.
2. Load the generated .pte through the supported ExecuTorch Android/JNI interface.
3. Supply a 65,536-element float tensor in NCHW order and check for 12,288 float outputs.
4. Render RGB output to a bitmap; measure execution on a real Galaxy A07.
5. Replace random weights with a trained checkpoint whose architecture exactly matches the export graph.

The current APK is an H.264 encoder demonstration. Adding this script does not add inference to the APK or establish NPU acceleration.
