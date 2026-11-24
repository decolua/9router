package com.btu.cinema

import org.json.JSONObject
import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.VideoView
import android.widget.MediaController
import android.widget.EditText
import android.widget.ScrollView
import android.widget.Toast
import androidx.core.content.FileProvider
import android.content.Intent
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.view.ViewGroup
import android.util.Log
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLExt
import android.opengl.GLES20
import android.view.Surface
import java.io.File

class MainActivity : Activity() {
    private val tag = "BTU_Engine_Audit"
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 48, 28, 28)
        }
        val status = TextView(this).apply {
            textSize = 18f
            text = "BTU Cinema Encoder v0.2\\nHardware AVC test, 640×360, 30 FPS"
        }
        val runButton = Button(this).apply { text = "Render 3-second test video" }
        val prompt = EditText(this).apply {
            hint = "Scene prompt (saved locally, not AI inference)"
            setSingleLine(false)
            minLines = 2
        }
        val referenceButton = Button(this).apply { text = "Choose character reference image" }
        val shareButton = Button(this).apply { text = "Share last rendered MP4" }
        val importButton = Button(this).apply { text = "Import BTU Studio project JSON" }
        val projectDir = File(filesDir, "projects").apply { mkdirs() }
        val referenceFile = File(projectDir, "character_reference.png")
        val promptFile = File(projectDir, "scene_prompt.txt")
        prompt.setText(if (promptFile.exists()) promptFile.readText() else "Ancient youthful Demon God, exactly eight wings, cinematic lighting")
        referenceButton.setOnClickListener {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
            }, 101)
        }
        shareButton.setOnClickListener {
            val video = File(getExternalFilesDir(null), "btu_hardware_test.mp4")
            if (!video.exists()) {
                Toast.makeText(this, "Render a video first", Toast.LENGTH_SHORT).show()
            } else {
                try {
                    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", video)
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "video/mp4"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(intent, "Share BTU MP4"))
                } catch (e: Exception) {
                    Log.e(tag, "MP4 sharing failed", e)
                    Toast.makeText(this, "Unable to share video: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
        val player = VideoView(this)
        player.setMediaController(MediaController(this).apply { setAnchorView(player) })
        player.setOnErrorListener { _, what, extra ->
            Log.e(tag, "Playback failed what=$what extra=$extra")
            status.text = "MP4 playback failed ($what/$extra)"
            true
        }
        layout.addView(status)
        layout.addView(prompt)
        layout.addView(referenceButton)
        layout.addView(importButton)
        importButton.setOnClickListener { openBridgePicker() }
        if (intent?.action == Intent.ACTION_VIEW || intent?.action == Intent.ACTION_SEND) {
            importBridgeIntent(intent)
        }
        layout.addView(runButton)
        layout.addView(shareButton)
        layout.addView(player, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 420
        ))
        setContentView(layout)
        runButton.setOnClickListener {
            runButton.isEnabled = false
            player.stopPlayback()
            promptFile.writeText(prompt.text.toString())
            status.text = "Encoding 90 frames..."
            Thread {
                try {
                    val dest = File(getExternalFilesDir(null), "btu_hardware_test.mp4")
                    val began = System.nanoTime()
                    encode(dest) { frame ->
                        if (frame % 15 == 0 || frame == 90) runOnUiThread {
                            status.text = "BTU encoding: $frame / 90 frames"
                        }
                    }
                    val seconds = (System.nanoTime() - began) / 1_000_000_000.0
                    val retriever = MediaMetadataRetriever()
                    val details = try {
                        retriever.setDataSource(dest.absolutePath)
                        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                        val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                        val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                        check(duration >= 2500L && width == 640 && height == 360) { "Invalid video metadata: ${duration}ms ${width}x${height}" }
                        "duration=${duration}ms, ${width}x${height}"
                    } finally { retriever.release() }
                    Log.i("BTU_DIAGNOSTICS", "MP4 validated: $details bytes=${dest.length()}")
                    runOnUiThread {
                        status.text = "BTU video ready: ${dest.length()} bytes in %.1fs\\n$details\\n${dest.absolutePath}".format(seconds)
                        player.setVideoPath(dest.absolutePath)
                        player.setOnPreparedListener { it.isLooping = true; player.start() }
                        runButton.isEnabled = true
                    }
                } catch (e: Throwable) {
                    Log.e(tag, "Encoding failed", e)
                    runOnUiThread {
                        status.text = "BTU encode failed: ${e.message}"
                        runButton.isEnabled = true
                    }
                }
            }.start()
        }
    }
    @Deprecated("Uses Android legacy activity result for minimum SDK compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 202 && resultCode == Activity.RESULT_OK) {
            importBridgeUri(data?.data)
            return
        }
        if (requestCode == 101 && resultCode == Activity.RESULT_OK) {
            val uri = data?.data ?: return
            try {
                contentResolver.openInputStream(uri)?.use { input ->
                    val bitmap = BitmapFactory.decodeStream(input) ?: error("Unable to decode image")
                    val scaled = Bitmap.createScaledBitmap(bitmap, 512, 512, true)
                    File(filesDir, "projects/character_reference.png").outputStream().use {
                        scaled.compress(Bitmap.CompressFormat.PNG, 95, it)
                    }
                    if (scaled !== bitmap) scaled.recycle()
                    bitmap.recycle()
                }
                Toast.makeText(this, "Character reference saved locally", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(tag, "Reference import failed", e)
                Toast.makeText(this, "Image import failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }
    private fun openBridgePicker() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "application/json"
            addCategory(Intent.CATEGORY_OPENABLE)
        }, 202)
    }

    private fun importBridgeIntent(incoming: Intent?) {
        val uri = when (incoming?.action) {
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                incoming.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            }
            Intent.ACTION_VIEW -> incoming.data
            else -> null
        }
        importBridgeUri(uri)
    }

    private fun importBridgeUri(uri: Uri?) {
        if (uri == null) return
        try {
            val bytes = contentResolver.openInputStream(uri)?.use { input ->
                input.readBytes()
            } ?: error("Cannot read project file")
            require(bytes.size <= 1024 * 1024) { "Project exceeds 1 MB" }
            val root = JSONObject(String(bytes, Charsets.UTF_8))
            require(root.optString("format") == "BTU-Cinema-Bridge-v1") { "Unsupported bridge format" }
            require(root.optInt("version") == 1) { "Unsupported bridge version" }
            val project = root.getJSONObject("project")
            val scenes = project.getJSONArray("scenes")
            require(scenes.length() in 1..100) { "Project must contain 1–100 scenes" }
            val dir = File(filesDir, "projects").apply { mkdirs() }
            File(dir, "imported_bridge.json").writeBytes(bytes)
            val first = scenes.getJSONObject(0)
            val scenePrompt = first.optString("prompt", first.optString("title", ""))
            File(dir, "scene_prompt.txt").writeText(scenePrompt)
            Toast.makeText(this, "Imported ${scenes.length()} BTU scenes. Restart to load first prompt.", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Log.e(tag, "Bridge import failed", e)
            Toast.makeText(this, "BTU import failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun encode(dest: File, progress: (Int) -> Unit) {
        val width = 640
        val height = 360
        val fps = 30
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 1_500_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
        }
        val codecInfo = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.firstOrNull {
            it.isEncoder && it.isHardwareAccelerated &&
                it.supportedTypes.any { type -> type.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) }
        } ?: error("No hardware AVC encoder reported")
        Log.i(tag, "Selected codec: ${codecInfo.name} hardware=${codecInfo.isHardwareAccelerated}")
        val codec = MediaCodec.createByCodecName(codecInfo.name)
        var muxer: MediaMuxer? = null
        var eglDisplay = EGL14.EGL_NO_DISPLAY
        var eglContext = EGL14.EGL_NO_CONTEXT
        var eglSurface = EGL14.EGL_NO_SURFACE
        var inputSurface: Surface? = null
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            inputSurface = codec.createInputSurface()
            codec.start()
            muxer = MediaMuxer(dest.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            check(eglDisplay != EGL14.EGL_NO_DISPLAY)
            check(EGL14.eglInitialize(eglDisplay, IntArray(2), 0, IntArray(2), 0))
            val attribs = intArrayOf(
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
            val count = IntArray(1)
            check(EGL14.eglChooseConfig(eglDisplay, attribs, 0, configs, 0, 1, count, 0) && count[0] > 0)
            eglContext = EGL14.eglCreateContext(
                eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0
            )
            check(eglContext != EGL14.EGL_NO_CONTEXT)
            eglSurface = EGL14.eglCreateWindowSurface(
                eglDisplay, configs[0], inputSurface, intArrayOf(EGL14.EGL_NONE), 0
            )
            check(eglSurface != EGL14.EGL_NO_SURFACE)
            check(EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext))
            GLES20.glViewport(0, 0, width, height)
            var track = -1
            var started = false
            var eos = false
            val info = MediaCodec.BufferInfo()
            fun drain(waitForEos: Boolean) {
                var idle = 0
                while (!eos) {
                    val index = codec.dequeueOutputBuffer(info, if (waitForEos) 10_000L else 0L)
                    when (index) {
                        MediaCodec.INFO_TRY_AGAIN_LATER -> {
                            if (!waitForEos || ++idle > 2000) {
                                if (waitForEos) error("Timed out draining encoder EOS")
                                break
                            }
                        }
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            check(!started)
                            track = muxer!!.addTrack(codec.outputFormat)
                            muxer!!.start()
                            started = true
                        }
                        else -> if (index >= 0) {
                            idle = 0
                            val buffer = codec.getOutputBuffer(index) ?: error("Missing codec buffer")
                            if (info.size > 0) {
                                check(started)
                                buffer.position(info.offset)
                                buffer.limit(info.offset + info.size)
                                muxer!!.writeSampleData(track, buffer, info)
                            }
                            eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                            codec.releaseOutputBuffer(index, false)
                        }
                    }
                }
            }
            for (i in 0 until 90) {
                val t = i / 89f
                GLES20.glClearColor(t, 0.15f, 1f - t, 1f)
                GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
                val pts = i.toLong() * 1_000_000_000L / fps
                EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, pts)
                check(EGL14.eglSwapBuffers(eglDisplay, eglSurface)) { "EGL swap failed: ${EGL14.eglGetError()}" }
                drain(false)
                progress(i + 1)
            }
            codec.signalEndOfInputStream()
            drain(true)
            check(started && track >= 0 && dest.length() > 0L) { "No encoded MP4 samples produced" }
            Log.i(tag, "MP4 complete bytes=${dest.length()} frames=90 codec=${codecInfo.name}")
        } finally {
            if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                if (eglSurface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface)
                if (eglContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext)
                EGL14.eglTerminate(eglDisplay)
            }
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            inputSurface?.release()
            try { muxer?.stop() } catch (_: Exception) {}
            muxer?.release()
        }
    }
}
