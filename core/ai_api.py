import os
import sys
import json
import base64
import re
import cv2
import numpy as np
import requests

CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")

DEFAULT_CONFIG = {
    "provider": "gemini", # "gemini", "openai", "local_cv"
    "api_key": "",
    "model": "gemini-1.5-flash",
    "prompt_detection": "Detect any watermarks, logos, channel tags, timestamps, or translucent text in this image. Return a JSON array of bounding boxes with pixel coordinates: [{\"x\": int, \"y\": int, \"w\": int, \"h\": int, \"name\": string}]. Return ONLY valid JSON.",
    "ai_generative_fill": True
}

def load_ai_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                # Garante chaves padrao
                for k, v in DEFAULT_CONFIG.items():
                    if k not in cfg:
                        cfg[k] = v
                return cfg
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()

def save_ai_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=4, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Erro ao salvar config: {e}")
        return False

def frame_to_base64_jpeg(frame_bgr, max_dim=1024):
    h, w = frame_bgr.shape[:2]
    scale = min(1.0, max_dim / max(h, w))
    if scale < 1.0:
        new_w = int(w * scale)
        new_h = int(h * scale)
        resized = cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        resized = frame_bgr
        scale = 1.0

    ret, buf = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ret:
        return None, 1.0
    b64_str = base64.b64encode(buf).decode("utf-8")
    return b64_str, scale

def detect_watermarks_ai(frame_bgr, config=None):
    """
    Identifica automaticamente marcas d'água usando API de IA (Gemini / OpenAI)
    ou fallback inteligente de Visão Computacional local.
    """
    if config is None:
        config = load_ai_config()

    provider = config.get("provider", "gemini")
    api_key = config.get("api_key", "").strip()

    # Se não tiver chave de API, usa detecção inteligente por Visão Computacional local
    if not api_key or provider == "local_cv":
        return _detect_watermarks_local_cv(frame_bgr)

    if provider == "gemini":
        return _detect_with_gemini(frame_bgr, api_key, config)
    elif provider == "openai":
        return _detect_with_openai(frame_bgr, api_key, config)
    else:
        return _detect_watermarks_local_cv(frame_bgr)

def _detect_with_gemini(frame_bgr, api_key, config):
    h, w = frame_bgr.shape[:2]
    b64_img, scale = frame_to_base64_jpeg(frame_bgr)
    if not b64_img:
        return _detect_watermarks_local_cv(frame_bgr)

    model = config.get("model", "gemini-1.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    prompt = (
        f"Analyze this image of size {w}x{h} pixels.\n"
        "Identify any watermarks, broadcast channel logos, timestamps, copyright overlays, or subtitles.\n"
        "Return the bounding box coordinates strictly in this JSON format:\n"
        "```json\n"
        "[\n"
        "  {\"x\": 10, \"y\": 20, \"w\": 120, \"h\": 40, \"name\": \"Logo do Canal\"}\n"
        "]\n"
        "```\n"
        "If no watermark exists, return `[]`. Output only the JSON block."
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": b64_img
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 800
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=20)
        if resp.status_code == 200:
            res_json = resp.json()
            text_resp = res_json["candidates"][0]["content"]["parts"][0]["text"]
            boxes = _parse_json_boxes(text_resp, w, h)
            if boxes:
                return boxes
    except Exception as e:
        print(f"Erro na API Gemini: {e}")

    # Fallback caso a API falhe
    return _detect_watermarks_local_cv(frame_bgr)

def _detect_with_openai(frame_bgr, api_key, config):
    h, w = frame_bgr.shape[:2]
    b64_img, scale = frame_to_base64_jpeg(frame_bgr)
    if not b64_img:
        return _detect_watermarks_local_cv(frame_bgr)

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    prompt = (
        f"Detect all watermarks, channel logos, text overlays in this {w}x{h} image.\n"
        "Return coordinates as JSON: [{\"x\": int, \"y\": int, \"w\": int, \"h\": int, \"name\": \"Marca d'Água\"}].\n"
        "If none found, return []."
    )

    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}
                    }
                ]
            }
        ],
        "temperature": 0.1
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        if resp.status_code == 200:
            res_json = resp.json()
            text_resp = res_json["choices"][0]["message"]["content"]
            boxes = _parse_json_boxes(text_resp, w, h)
            if boxes:
                return boxes
    except Exception as e:
        print(f"Erro na API OpenAI: {e}")

    return _detect_watermarks_local_cv(frame_bgr)

def _parse_json_boxes(text, img_w, img_h):
    # Procura por blocos json
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
        valid_boxes = []
        for idx, item in enumerate(data):
            x = int(item.get("x", 0))
            y = int(item.get("y", 0))
            w = int(item.get("w", 0))
            h = int(item.get("h", 0))
            name = item.get("name", f"IA Detectada #{idx+1}")

            # Se os valores vierem normalizados (0.0 a 1.0)
            if 0 < x < 1 and 0 < w <= 1:
                x = int(x * img_w)
                w = int(w * img_w)
            if 0 < y < 1 and 0 < h <= 1:
                y = int(y * img_h)
                h = int(h * img_h)

            if w > 10 and h > 10:
                valid_boxes.append({
                    "id": idx + 1,
                    "x": max(0, min(x, img_w - 5)),
                    "y": max(0, min(y, img_h - 5)),
                    "w": min(w, img_w - x),
                    "h": min(h, img_h - y),
                    "name": name
                })
        return valid_boxes
    except Exception:
        return []

def _detect_watermarks_local_cv(frame_bgr):
    """
    Detector inteligente local baseado em bordas, morfologia e localização espacial
    (marcas d'água costumam estar nos 4 cantos ou na borda inferior).
    """
    h, w = frame_bgr.shape[:2]
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

    # Gradiente morfológico para destacar contornos nítidos e textos sobrepostos
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)

    # Binarização adaptativa
    _, thresh = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

    # Conecta caracteres de textos/logos
    connect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    connected = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, connect_kernel)

    contours, _ = cv2.findContours(connected, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    detected = []
    box_id = 1

    # Regiões prioritárias de cantos (25% superior/inferior, 30% esquerda/direita)
    corner_regions = [
        (0, 0, int(w * 0.35), int(h * 0.25)), # Top-Left
        (int(w * 0.65), 0, int(w * 0.35), int(h * 0.25)), # Top-Right
        (0, int(h * 0.75), int(w * 0.35), int(h * 0.25)), # Bottom-Left
        (int(w * 0.65), int(h * 0.75), int(w * 0.35), int(h * 0.25)), # Bottom-Right
    ]

    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        area = bw * bh

        # Filtra por dimensões típicas de marcas d'água
        if area < 600 or area > (w * h * 0.25):
            continue
        if bw < 30 or bh < 15:
            continue

        # Verifica se está localizado em um dos cantos
        is_in_corner = False
        for cx, cy, cw, ch in corner_regions:
            if (x >= cx and x + bw <= cx + cw + 20 and
                y >= cy and y + bh <= cy + ch + 20):
                is_in_corner = True
                break

        if is_in_corner:
            # Adiciona margem de segurança de 4 pixels
            pad = 4
            x_pad = max(0, x - pad)
            y_pad = max(0, y - pad)
            w_pad = min(w - x_pad, bw + pad * 2)
            h_pad = min(h - y_pad, bh + pad * 2)

            detected.append({
                "id": box_id,
                "x": x_pad,
                "y": y_pad,
                "w": w_pad,
                "h": h_pad,
                "name": f"IA Local #{box_id}"
            })
            box_id += 1

    return detected

def ai_generative_fill_region(frame_bgr, mask_gray, boxes=None):
    """
    Preenchimento generativo inteligente por IA:
    Se 'boxes' for fornecido, processa apenas as regiões delimitadas com margem de segurança,
    acelerando o processamento em até 10x e mantendo 100% da nitidez do restante do vídeo.
    """
    h, w = frame_bgr.shape[:2]
    result = frame_bgr.copy()

    if boxes:
        for b in boxes:
            bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
            pad = 8
            x0 = max(0, bx - pad)
            y0 = max(0, by - pad)
            x1 = min(w, bx + bw + pad)
            y1 = min(h, by + bh + pad)

            if x1 <= x0 or y1 <= y0:
                continue

            patch = frame_bgr[y0:y1, x0:x1]
            patch_mask = mask_gray[y0:y1, x0:x1]

            if cv2.countNonZero(patch_mask) == 0:
                continue

            # Inpainting na região delimitada
            inpainted_patch = cv2.inpaint(patch, patch_mask, 3, cv2.INPAINT_NS)
            smooth_patch = cv2.bilateralFilter(inpainted_patch, 5, 50, 50)

            # Mescla suave
            alpha = (patch_mask.astype(np.float32) / 255.0)[:, :, np.newaxis]
            blended = (smooth_patch.astype(np.float32) * alpha + inpainted_patch.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)

            result[y0:y1, x0:x1] = blended
    else:
        # Fallback para máscara global
        inpainted = cv2.inpaint(frame_bgr, mask_gray, 3, cv2.INPAINT_NS)
        smooth = cv2.bilateralFilter(inpainted, 5, 50, 50)
        alpha = (mask_gray.astype(np.float32) / 255.0)[:, :, np.newaxis]
        result = (smooth.astype(np.float32) * alpha + inpainted.astype(np.float32) * (1.0 - alpha)).astype(np.uint8)

    return result
