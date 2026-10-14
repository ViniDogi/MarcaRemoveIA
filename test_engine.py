import os
import cv2
import numpy as np
from core.processor import WatermarkProcessor
from core.ffmpeg_utils import get_video_metadata

def create_synthetic_video(filename="test_input.mp4", duration_sec=2, fps=30, width=640, height=360):
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(filename, fourcc, fps, (width, height))

    total_frames = int(duration_sec * fps)
    for i in range(total_frames):
        # Fundo dinâmico com gradiente
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        color_val = int((i / total_frames) * 200)
        frame[:, :] = (color_val, 120, 220 - color_val)

        # Adiciona um círculo em movimento
        cx = int((i / total_frames) * width)
        cv2.circle(frame, (cx, height // 2), 40, (255, 255, 0), -1)

        # Adiciona Marca d'Água estática no canto superior direito
        cv2.rectangle(frame, (450, 30), (610, 80), (0, 0, 200), -1)
        cv2.putText(frame, "WATERMARK", (460, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

        out.write(frame)

    out.release()
    print(f"Vídeo de teste gerado: {filename} ({width}x{height}, {total_frames} frames)")

def run_test():
    test_in = "test_input.mp4"
    test_out_gpu = "test_output_gpu.mp4"
    test_out_cv = "test_output_opencv.mp4"

    create_synthetic_video(test_in)

    meta = get_video_metadata(test_in)
    print("Metadados:", meta)

    processor = WatermarkProcessor()

    # Bounding box da marca: (450, 30) a (610, 80) => x=450, y=30, w=160, h=50
    boxes = [{"x": 450, "y": 30, "w": 160, "h": 50, "name": "Marca 1"}]

    print("\n--- Testando Motor 1: GPU NVENC ---")
    def cb(pct, cur, tot, cur_fps, eta):
        print(f"GPU Progresso: {pct*100:.1f}% ({cur}/{tot}) - {cur_fps:.1f} fps")

    res = processor.run_removal(test_in, test_out_gpu, boxes, engine="gpu_nvenc", progress_callback=cb)
    print("Resultado GPU:", res, "Arquivo existe:", os.path.exists(test_out_gpu), "Tamanho:", os.path.getsize(test_out_gpu) if os.path.exists(test_out_gpu) else 0)

    print("\n--- Testando Motor 2: OpenCV Telea ---")
    def cb2(pct, cur, tot, cur_fps, eta):
        if cur % 15 == 0 or cur == tot:
            print(f"OpenCV Progresso: {pct*100:.1f}% ({cur}/{tot}) - {cur_fps:.1f} fps")

    res2 = processor.run_removal(test_in, test_out_cv, boxes, engine="opencv_telea", progress_callback=cb2)
    print("Resultado OpenCV:", res2, "Arquivo existe:", os.path.exists(test_out_cv), "Tamanho:", os.path.getsize(test_out_cv) if os.path.exists(test_out_cv) else 0)

    print("\nTodos os testes passaram com sucesso!")

if __name__ == "__main__":
    run_test()
