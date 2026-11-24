package com.btu.cinema.inference

import android.util.Log
import kotlin.math.abs

/**
 * Backend-independent tensor verification.
 *
 * The caller supplies a real, initialized inference backend. This verifier does
 * not instantiate or claim to implement the native ExecuTorch runtime.
 */
object TensorVerifier {
    const val EXPECTED_ELEMENTS = 16 * 64 * 64
    private const val TAG = "BTU_INFERENCE"

    data class Result(
        val passed: Boolean,
        val elapsedMs: Double,
        val maxAbsoluteError: Float,
        val message: String
    )

    fun verify(
        inference: (FloatArray) -> FloatArray?,
        reference: (FloatArray) -> FloatArray,
        tolerance: Float = 1e-4f
    ): Result {
        require(tolerance >= 0f && tolerance.isFinite())
        val input = FloatArray(EXPECTED_ELEMENTS) { (it % 50) / 50.0f }
        val expected = reference(input.copyOf())
        if (expected.size != EXPECTED_ELEMENTS || expected.any { !it.isFinite() }) {
            return Result(false, 0.0, Float.NaN, "Invalid reference output")
        }
        val start = System.nanoTime()
        val actual = try {
            inference(input.copyOf())
        } catch (e: Exception) {
            Log.e(TAG, "Inference threw", e)
            return Result(false, (System.nanoTime() - start) / 1e6, Float.NaN, "Inference exception: ${e.message}")
        }
        val elapsed = (System.nanoTime() - start) / 1e6
        if (actual == null || actual.size != EXPECTED_ELEMENTS) {
            return Result(false, elapsed, Float.NaN, "Null or incorrect output shape")
        }
        if (actual.any { !it.isFinite() }) {
            return Result(false, elapsed, Float.NaN, "Non-finite output values")
        }
        var maxError = 0f
        for (i in actual.indices) {
            val error = abs(actual[i] - expected[i])
            if (error > maxError) maxError = error
        }
        val passed = maxError <= tolerance
        val message = if (passed) "Matched reference" else "Output differs from reference"
        Log.i(TAG, "$message; elapsed=${"%.2f".format(elapsed)} ms; max_error=$maxError")
        return Result(passed, elapsed, maxError, message)
    }
}
