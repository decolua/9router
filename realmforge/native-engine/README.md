# RealmForge native engine integration

The native EGL/GLES3 patch and MediaCodec encoder prototype are **not production-ready**. Preserve BTU JNI CMake targets. The current native renderer draws a 2D triangle, not 3D geometry. Android device encoder input color layouts vary, so planar I420 must not be assumed with COLOR_FormatYUV420Flexible. Prefer MediaCodec input Surface with EGL for hardware video encoding.

Integration requirements:
1. Add an isolated native CMake target to BTU Android Gradle (without overwriting existing ExecuTorch scaffold).
2. Implement actual 3D geometry with model/view/projection matrices, depth testing and vertex/index buffers.
3. Use MediaCodec input Surface and EGL window surface to encode AVC into MediaMuxer MP4.
4. Add Android activity/navigation entry and background job lifecycle.
5. Verify Android SDK/NDK compilation and on-device MP4 playback before merge.

This is a staging document, not a claim of working GPU rendering or an installed APK.
