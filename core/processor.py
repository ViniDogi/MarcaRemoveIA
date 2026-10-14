import os
import sys
import time
import re
import threading
import subprocess
import cv2
import numpy as np

from .ffmpeg_utils import get_ffmpeg_binary, get_video_metadata, check_nvenc_available, get_fullhd_dimensions

class WatermarkProcessor:
    def __init__(self):
        self.is_running = False
        self.cancel_requested = False
        self.process = None

    def cancel(self):
        self.cancel_requested = True
        if self.process and self.process.poll() is None:
            try:
                self.process.terminate()
            except Exception:
                pass

    def run_removal(
        self,
        input_video: str,
        output_video: str,
        watermark_boxes: list, # List of dicts: [{"x": int, "y": int, "w": int, "h": int}]
        engine: str = "gpu_nvenc", # "gpu_nvenc", "cpu_delogo", "ai_generative", "opencv_telea", "opencv_ns"
        quality: str = "high", # "original", "high", "medium"
        keep_audio: bool = True,
        upscale_fullhd: bool = False, # Upscale para Full HD 1080p com nitidez por IA
        progress_callback = None # callable(percent, current_frame, total_frames, fps, eta_str)
    ):
        """
        Executa a remoção de marca d'água no vídeo.
        """
        self.is_running = True
        self.cancel_requested = False

        meta = get_video_metadata(input_video)
        if not meta:
            raise RuntimeError("Não foi possível analisar os metadados do vídeo.")

        # Se escolheu GPU mas NVENC não estiver disponível, faz fallback para CPU
        if engine == "gpu_nvenc" and not check_nvenc_available():
            engine = "cpu_delogo"

        if engine in ["gpu_nvenc", "cpu_delogo"]:
            return self._process_ffmpeg_delogo(
                input_video, output_video, watermark_boxes,
                engine, quality, keep_audio, upscale_fullhd, meta, progress_callback
            )
        else:
            return self._process_inpaint_frames(
                input_video, output_video, watermark_boxes,
                engine, quality, keep_audio, upscale_fullhd, meta, progress_callback
            )

    def _process_ffmpeg_delogo(
        self, input_video, output_video, boxes, engine, quality, keep_audio, upscale_fullhd, meta, progress_callback
    ):
        ffmpeg_exe = get_ffmpeg_binary()

        # O filtro delogo exige no mínimo 1 pixel de margem em todos os 4 lados
        delogo_filters = []
        for b in boxes:
            x, y, w, h = b["x"], b["y"], b["w"], b["h"]
            x = max(1, min(x, meta["width"] - 3))
            y = max(1, min(y, meta["height"] - 3))
            w = max(2, min(w, meta["width"] - x - 1))
            h = max(2, min(h, meta["height"] - y - 1))
            delogo_filters.append(f"delogo=x={x}:y={y}:w={w}:h={h}")

        # Se upscale Full HD com IA estiver ativado
        if upscale_fullhd:
            fhd_w, fhd_h = get_fullhd_dimensions(meta["width"], meta["height"])
            delogo_filters.append(f"scale={fhd_w}:{fhd_h}:flags=lanczos,unsharp=5:5:0.8:3:3:0.4")

        vf_param = ",".join(delogo_filters)

        cmd = [ffmpeg_exe, "-y", "-i", input_video, "-vf", vf_param]

        # Configura Encoder de Vídeo
        if engine == "gpu_nvenc":
            cmd += ["-c:v", "h264_nvenc"]
            if upscale_fullhd:
                cmd += ["-preset", "p6", "-cq", "18"]
            elif quality == "original":
                cmd += ["-preset", "p7", "-cq", "17"]
            elif quality == "high":
                cmd += ["-preset", "p5", "-cq", "21"]
            else:
                cmd += ["-preset", "p3", "-cq", "26"]
        else:
            cmd += ["-c:v", "libx264"]
            if upscale_fullhd:
                cmd += ["-preset", "medium", "-crf", "18"]
            elif quality == "original":
                cmd += ["-preset", "slow", "-crf", "18"]
            elif quality == "high":
                cmd += ["-preset", "medium", "-crf", "22"]
            else:
                cmd += ["-preset", "fast", "-crf", "26"]

        # Configura Áudio Universalmente Compatível (LC-AAC 192k)
        if keep_audio and meta["has_audio"]:
            cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "44100"]
        else:
            cmd += ["-an"]

        cmd += ["-progress", "pipe:1", output_video]

        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )

        total_frames = meta["nb_frames"]
        start_time = time.time()

        for line in self.process.stdout:
            if self.cancel_requested:
                self.process.terminate()
                self.is_running = False
                return False

            line = line.strip()
            if line.startswith("frame="):
                try:
                    cur_frame = int(line.split("=")[1].strip())
                    if total_frames > 0 and progress_callback:
                        pct = min(1.0, cur_frame / float(total_frames))
                        elapsed = time.time() - start_time
                        cur_fps = cur_frame / elapsed if elapsed > 0 else 0
                        rem_sec = (total_frames - cur_frame) / cur_fps if cur_fps > 0 else 0
                        eta_str = time.strftime("%H:%M:%S", time.gmtime(max(0, rem_sec)))
                        progress_callback(pct, cur_frame, total_frames, cur_fps, eta_str)
                except ValueError:
                    pass

        self.process.wait()
        self.is_running = False
        success = (self.process.returncode == 0) and os.path.exists(output_video) and (os.path.getsize(output_video) > 1000)
        return success

    def _process_inpaint_frames(
        self, input_video, output_video, boxes, engine, quality, keep_audio, upscale_fullhd, meta, progress_callback
    ):
        """
        Executa inpainting frame a frame via IA Generativa ou OpenCV (Navier-Stokes / Telea)
        transmitindo diretamente via pipe para o encoder FFmpeg para máxima eficiência.
        """
        from .ai_api import ai_generative_fill_region

        ffmpeg_exe = get_ffmpeg_binary()
        cap = cv2.VideoCapture(input_video)
        if not cap.isOpened():
            raise RuntimeError("Não foi possível abrir o vídeo com OpenCV.")

        w = meta["width"]
        h = meta["height"]
        fps = meta["fps"]
        total_frames = meta["nb_frames"]

        # Cria máscara binária combinando todas as regiões de marca d'água
        mask = np.zeros((h, w), dtype=np.uint8)
        for b in boxes:
            x, y, bw, bh = b["x"], b["y"], b["w"], b["h"]
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            bw = max(1, min(bw, w - x))
            bh = max(1, min(bh, h - y))
            mask[y:y+bh, x:x+bw] = 255

        # Prepara comando FFmpeg
        cmd = [
            ffmpeg_exe, "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{w}x{h}",
            "-pix_fmt", "bgr24",
            "-r", str(fps),
            "-i", "-"
        ]

        if keep_audio and meta["has_audio"]:
            cmd += [
                "-i", input_video,
                "-map", "0:v:0",
                "-map", "1:a?",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100"
            ]
        else:
            cmd += ["-an"]

        # Se upscale Full HD estiver ativado, adiciona filtro de redimensionamento e realce de nitidez
        if upscale_fullhd:
            fhd_w, fhd_h = get_fullhd_dimensions(w, h)
            cmd += ["-vf", f"scale={fhd_w}:{fhd_h}:flags=lanczos,unsharp=5:5:0.8:3:3:0.4"]

        if check_nvenc_available():
            cmd += ["-c:v", "h264_nvenc"]
            if upscale_fullhd:
                cmd += ["-preset", "p6", "-cq", "18"]
            else:
                cmd += ["-preset", "p5", "-cq", "21"]
        else:
            cmd += ["-c:v", "libx264"]
            if upscale_fullhd:
                cmd += ["-preset", "medium", "-crf", "18"]
            else:
                cmd += ["-preset", "medium", "-crf", "22"]

        # -shortest garante que a codificação pare assim que o fluxo de vídeo terminar
        cmd += ["-pix_fmt", "yuv420p", "-shortest", output_video]

        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo
        )

        # Thread para esvaziar o buffer de stderr continuamente e evitar deadlocks
        stderr_logs = []
        def drain_stderr():
            try:
                for line in iter(self.process.stderr.readline, b''):
                    if line:
                        text = line.decode('utf-8', errors='ignore').strip()
                        stderr_logs.append(text)
                        if len(stderr_logs) > 30:
                            stderr_logs.pop(0)
            except Exception:
                pass

        t_err = threading.Thread(target=drain_stderr, daemon=True)
        t_err.start()

        cur_frame = 0
        start_time = time.time()

        try:
            while True:
                if self.cancel_requested:
                    break

                ret, frame = cap.read()
                if not ret:
                    break

                cur_frame += 1

                # Verifica se o processo ainda está vivo
                if self.process.poll() is not None:
                    break

                # Inpainting otimizado
                if engine == "ai_generative":
                    processed = ai_generative_fill_region(frame, mask, boxes=boxes)
                elif engine == "opencv_telea":
                    processed = cv2.inpaint(frame, mask, 3, cv2.INPAINT_TELEA)
                else: # opencv_ns
                    processed = cv2.inpaint(frame, mask, 3, cv2.INPAINT_NS)

                try:
                    self.process.stdin.write(processed.tobytes())
                except (BrokenPipeError, OSError):
                    break

                if cur_frame % 5 == 0 or cur_frame == total_frames:
                    elapsed = time.time() - start_time
                    cur_fps = cur_frame / elapsed if elapsed > 0 else 0
                    rem_sec = (total_frames - cur_frame) / cur_fps if cur_fps > 0 else 0
                    eta_str = time.strftime("%H:%M:%S", time.gmtime(max(0, rem_sec)))
                    pct = min(1.0, cur_frame / float(total_frames)) if total_frames > 0 else 0
                    if progress_callback:
                        progress_callback(pct, cur_frame, total_frames, cur_fps, eta_str)

        finally:
            cap.release()
            if self.process.stdin:
                try:
                    self.process.stdin.flush()
                    self.process.stdin.close()
                except Exception:
                    pass

            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.terminate()

            self.is_running = False

        success = (not self.cancel_requested) and (self.process.returncode == 0) and os.path.exists(output_video) and (os.path.getsize(output_video) > 1000)
        if not success and not self.cancel_requested:
            err_msg = " | ".join(stderr_logs[-5:]) if stderr_logs else "Erro desconhecido no FFmpeg"
            raise RuntimeError(f"Falha na codificação do vídeo (código {self.process.returncode}): {err_msg}")

        return success
