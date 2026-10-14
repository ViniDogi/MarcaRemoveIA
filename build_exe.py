import os
import sys
import shutil
import subprocess

def build():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    print("=" * 60)
    print(" Compilando Video Watermark Remover para Windows (.exe)")
    print("=" * 60)

    # 1. Localiza ffmpeg.exe e ffprobe.exe e copia para pasta bin local
    bin_dir = os.path.join(base_dir, "bin")
    os.makedirs(bin_dir, exist_ok=True)

    from core.ffmpeg_utils import get_ffmpeg_binary, get_ffprobe_binary
    ffmpeg_exe = get_ffmpeg_binary()
    ffprobe_exe = get_ffprobe_binary()

    if os.path.exists(ffmpeg_exe):
        shutil.copy2(ffmpeg_exe, os.path.join(bin_dir, "ffmpeg.exe"))
        print(f"-> ffmpeg copiado de: {ffmpeg_exe}")
    else:
        print("AVISO: ffmpeg.exe não encontrado para empacotamento.")

    if os.path.exists(ffprobe_exe):
        shutil.copy2(ffprobe_exe, os.path.join(bin_dir, "ffprobe.exe"))
        print(f"-> ffprobe copiado de: {ffprobe_exe}")
    else:
        print("AVISO: ffprobe.exe não encontrado para empacotamento.")

    # 2. Localiza arquivos de temas do CustomTkinter
    import customtkinter
    ctk_path = os.path.dirname(customtkinter.__file__)
    print(f"-> CustomTkinter localizado em: {ctk_path}")

    # 3. Executa o PyInstaller
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "-y",
        "--noconsole",
        "--name", "MarcaRemoveIA",
        "--clean",
        "--onedir",
        f"--add-data={ctk_path};customtkinter",
        f"--add-data={bin_dir};bin",
        "main.py"
    ]

    print("\nExecutando PyInstaller...")
    print("Comando:", " ".join(cmd))
    proc = subprocess.run(cmd)

    if proc.returncode == 0:
        exe_path = os.path.join(base_dir, "dist", "MarcaRemoveIA", "MarcaRemoveIA.exe")
        print("\n" + "=" * 60)
        print(f"[OK] SUCESSO! Executavel gerado em:\n{exe_path}")
        print("=" * 60)
    else:
        print("\n[ERRO] Falha na compilacao do executavel.")

if __name__ == "__main__":
    build()
