"""SceneForge premium image-generation worker.
A successful response requires a real CUDA GPU and a loaded Qwen-Image-2512 pipeline.
"""
from __future__ import annotations
import base64
import logging
import os
import threading
from io import BytesIO
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from contract import validate_request

app=FastAPI(title="SceneForge B200 Quality GPU",docs_url=None,redoc_url=None)
MODEL_ID="Qwen/Qwen-Image-2512"
_logger=logging.getLogger(__name__)
_model_lock=threading.Lock()
_inference_lock=threading.Lock()
_pipeline=None

class RenderRequest(BaseModel):
    prompt:str=Field(min_length=4,max_length=400)
    width:int=1024
    height:int=576

def _gpu_info():
    try:
        import torch
        if not torch.cuda.is_available():
            return {"gpu":"unavailable","gpu_name":None}
        return {"gpu":"cuda","gpu_name":torch.cuda.get_device_name(0)}
    except Exception:
        return {"gpu":"unavailable","gpu_name":None}

def _get_pipeline():
    global _pipeline
    if _gpu_info()["gpu"]!="cuda":
        raise RuntimeError("No CUDA GPU available")
    with _model_lock:
        if _pipeline is None:
            import torch
            from diffusers import QwenImagePipeline
            pipe=QwenImagePipeline.from_pretrained(
                MODEL_ID,torch_dtype=torch.bfloat16,
                cache_dir=os.environ.get("HF_HOME") or None)
            _pipeline=pipe.to("cuda")
        return _pipeline

@app.get("/health")
def health():
    info=_gpu_info()
    return {
        "service":"sceneforge-gpu","gpu":info["gpu"],
        "gpu_name":info["gpu_name"],"model":MODEL_ID,
        "model_loaded":_pipeline is not None,
        "model_ready":bool(info["gpu"]=="cuda" and _pipeline is not None),
        "quality_profile":"qwen-image-2512-b200",
    }

@app.post("/predict")
def predict(request:RenderRequest):
    try:
        prompt,width,height=validate_request(request.prompt,request.width,request.height)
    except ValueError as exc:
        raise HTTPException(status_code=400,detail=str(exc)) from exc
    if _gpu_info()["gpu"]!="cuda":
        raise HTTPException(status_code=503,detail="CUDA GPU unavailable")
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=429,detail="GPU currently serving another image")
    try:
        import torch
        pipe=_get_pipeline()
        with torch.inference_mode():
            image=pipe(prompt=prompt,
                       negative_prompt="watermark, heavily distorted text, visible artifacts, low resolution",
                       width=width,height=height,
                       num_inference_steps=50,true_cfg_scale=4.0).images[0]
        output=BytesIO()
        image.save(output,format="PNG",optimize=True)
        encoded=base64.b64encode(output.getvalue()).decode("ascii")
        return {"image_base64":encoded,"mime_type":"image/png",
                "gpu":"cuda","model":MODEL_ID,"width":width,"height":height}
    except HTTPException:
        raise
    except Exception:
        _logger.exception("GPU image generation error")
        raise HTTPException(status_code=502,detail="GPU inference failed")
    finally:
        _inference_lock.release()
