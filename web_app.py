import os
import sys
import uuid
import threading
import time
import cv2
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# Garante importações locais
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from core.ffmpeg_utils import get_video_metadata, get_ffmpeg_binary
from core.processor import WatermarkProcessor
from core.ai_api import load_ai_config, save_ai_config, detect_watermarks_ai

UPLOAD_DIR = os.path.join(BASE_DIR, "web_uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "web_outputs")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = FastAPI(title="MarcaRemoveIA Web API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Estado das tarefas de processamento em memória
tasks = {}

class WatermarkBox(BaseModel):
    id: int
    x: int
    y: int
    w: int
    h: int
    name: Optional[str] = "Marca"

class ProcessRequest(BaseModel):
    video_id: str
    boxes: List[WatermarkBox]
    engine: str = "ai_generative"
    quality: str = "high"
    keep_audio: bool = True
    upscale_fullhd: bool = False

class DetectRequest(BaseModel):
    video_id: str
    timestamp: float = 0.0

class ConfigRequest(BaseModel):
    provider: str
    api_key: str

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    html_path = os.path.join(BASE_DIR, "templates", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>MarcaRemoveIA Web - Arquivo index.html não encontrado</h1>")

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename)[1].lower() or ".mp4"
    video_id = str(uuid.uuid4())
    save_path = os.path.join(UPLOAD_DIR, f"{video_id}{ext}")

    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)

    meta = get_video_metadata(save_path)
    if not meta:
        raise HTTPException(status_code=400, detail="Formato de vídeo inválido.")

    return {
        "success": True,
        "video_id": video_id,
        "filename": file.filename,
        "video_url": f"/api/video/{video_id}{ext}",
        "metadata": meta
    }

@app.get("/api/video/{filename}")
async def get_video(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    return FileResponse(file_path, media_type="video/mp4")

@app.post("/api/detect-ai")
async def detect_ai(req: DetectRequest):
    # Encontra o vídeo no diretório
    matched = None
    for f in os.listdir(UPLOAD_DIR):
        if f.startswith(req.video_id):
            matched = os.path.join(UPLOAD_DIR, f)
            break

    if not matched or not os.path.exists(matched):
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    cap = cv2.VideoCapture(matched)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_idx = int(req.timestamp * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        raise HTTPException(status_code=400, detail="Não foi possível capturar o quadro.")

    config = load_ai_config()
    detected = detect_watermarks_ai(frame, config)
    return {"boxes": detected}

@app.post("/api/process")
async def process_video(req: ProcessRequest):
    matched = None
    ext = ".mp4"
    for f in os.listdir(UPLOAD_DIR):
        if f.startswith(req.video_id):
            matched = os.path.join(UPLOAD_DIR, f)
            ext = os.path.splitext(f)[1]
            break

    if not matched:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    task_id = str(uuid.uuid4())
    out_file = os.path.join(OUTPUT_DIR, f"clean_{task_id}.mp4")

    tasks[task_id] = {
        "status": "Iniciando processamento...",
        "progress": 0.0,
        "fps": 0.0,
        "eta": "--:--:--",
        "done": False,
        "error": None,
        "output_path": out_file
    }

    raw_boxes = [b.dict() for b in req.boxes]

    def worker():
        proc = WatermarkProcessor()
        def cb(pct, cur_f, tot_f, cur_fps, eta_str):
            tasks[task_id]["progress"] = pct
            tasks[task_id]["fps"] = cur_fps
            tasks[task_id]["eta"] = eta_str
            tasks[task_id]["status"] = f"Processando: {pct*100:.1f}% ({cur_f}/{tot_f})"

        try:
            ok = proc.run_removal(
                input_video=matched,
                output_video=out_file,
                watermark_boxes=raw_boxes,
                engine=req.engine,
                quality=req.quality,
                keep_audio=req.keep_audio,
                upscale_fullhd=req.upscale_fullhd,
                progress_callback=cb
            )
            if ok and os.path.exists(out_file):
                tasks[task_id]["done"] = True
                tasks[task_id]["progress"] = 1.0
                tasks[task_id]["status"] = "Concluído com sucesso!"
            else:
                tasks[task_id]["error"] = "Falha ao gerar o vídeo."
        except Exception as e:
            tasks[task_id]["error"] = str(e)

    threading.Thread(target=worker, daemon=True).start()
    return {"task_id": task_id}

@app.get("/api/progress/{task_id}")
async def get_progress(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada.")
    return tasks[task_id]

@app.get("/api/download/{task_id}")
async def download_result(task_id: str):
    if task_id not in tasks or not tasks[task_id].get("done"):
        raise HTTPException(status_code=400, detail="Arquivo ainda não finalizado.")
    path = tasks[task_id]["output_path"]
    return FileResponse(path, filename="video_sem_marca_ia.mp4", media_type="video/mp4")

@app.post("/api/config")
async def update_config(req: ConfigRequest):
    cfg = load_ai_config()
    cfg["provider"] = req.provider
    cfg["api_key"] = req.api_key
    save_ai_config(cfg)
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print(" 🌐 Iniciando Servidor Web MarcaRemoveIA em http://127.0.0.1:8000")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8000)
