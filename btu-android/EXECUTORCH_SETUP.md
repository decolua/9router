# BTU ExecuTorch native integration gates

This branch contains a **smoke-test export script** for a random-weight FP32 convolution, not an image/video generator.

## Export on a Python development machine
Install compatible PyTorch and ExecuTorch releases in an isolated environment, then run:

```bash
python btu-android/tools/export_btu_smoke_test.py --output btu-android/app/src/main/assets/btu_cinema_core.pte
```

Do not package the output until it has been generated and checked with the matching ExecuTorch runtime.

## Native CMake prerequisites
The provided CMakeLists.txt is deliberately **not enabled** by Gradle. To build a JNI runtime, first obtain the correct ExecuTorch C++ headers, compiled Android libraries, operator registration, data loader, and matching ABI. Then implement real method inputs/outputs using the version-matched runtime API, and add externalNativeBuild to Gradle.

## Verification
1. Confirm the export produces a nonempty .pte and loads using the same ExecuTorch version.
2. Run a known tensor input, compare with the PyTorch result within tolerance.
3. Verify Android CPU execution on the Galaxy A07 before attempting GPU/NPU delegation.
4. Do not claim INT4, NPU acceleration, or image/video generation until those paths are independently implemented and tested.

The user's earlier C++ snippet returned the input unchanged and is not a valid inference implementation.
