import os
import sys
import shutil
import subprocess
import json
import re

def get_ffmpeg_dir():
    """
    Localiza o diretório onde ffmpeg.exe e ffprobe.exe residem.
    Verifica no diretório interno do PyInstaller, no PATH do sistema,
    e no diretório de pacotes padrão do WinGet.
    """
    # 1. Se estiver empacotado pelo PyInstaller (_MEIPASS)
    if hasattr(sys, '_MEIPASS'):
        bundled = os.path.join(sys._MEIPASS, "bin")
        if os.path.exists(os.path.join(bundled, "ffmpeg.exe")):
            return bundled
        if os.path.exists(os.path.join(sys._MEIPASS, "ffmpeg.exe")):
            return sys._MEIPASS

    # 2. Se ffmpeg estiver no PATH do sistema
    which_ffmpeg = shutil.which("ffmpeg")
    if which_ffmpeg:
        return os.path.dirname(os.path.abspath(which_ffmpeg))

    # 3. Caminho local do WinGet no Windows
    local_appdata = os.environ.get("LOCALAPPDATA", "")
    if local_appdata:
        winget_path = os.path.join(local_appdata, "Microsoft", "WinGet", "Packages")
        if os.path.exists(winget_path):
            for root, dirs, files in os.walk(winget_path):
                if "ffmpeg.exe" in files:
                    return root

    # 4. Diretório relativo "bin" no projeto
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_bin = os.path.join(base_dir, "bin")
    if os.path.exists(os.path.join(local_bin, "ffmpeg.exe")):
        return local_bin

    return None

def get_ffmpeg_binary():
    f_dir = get_ffmpeg_dir()
    if f_dir:
        exe = os.path.join(f_dir, "ffmpeg.exe")
        if os.path.exists(exe):
            return exe
    return "ffmpeg"

def get_ffprobe_binary():
    f_dir = get_ffmpeg_dir()
    if f_dir:
        exe = os.path.join(f_dir, "ffprobe.exe")
        if os.path.exists(exe):
            return exe
    return "ffprobe"

def check_nvenc_available():
    """Verifica se os encoders NVENC da NVIDIA estão habilitados no FFmpeg."""
    ffmpeg_exe = get_ffmpeg_binary()
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

        result = subprocess.run(
            [ffmpeg_exe, "-encoders"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        return "h264_nvenc" in result.stdout
    except Exception:
        return False

def get_video_metadata(video_path):
    """
    Retorna metadados detalhados do vídeo usando ffprobe:
    largura, altura, fps, duração em segundos, contagem total de frames, codecs.
    """
    ffprobe_exe = get_ffprobe_binary()
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE

    cmd = [
        ffprobe_exe,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        video_path
    ]

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, startupinfo=startupinfo, text=True, encoding='utf-8', errors='ignore')
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout)
    except Exception as e:
        print(f"Erro ao obter metadados do ffprobe: {e}")
        return None

    video_stream = None
    has_audio = False
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and not video_stream:
            video_stream = stream
        elif stream.get("codec_type") == "audio":
            has_audio = True

    if not video_stream:
        return None

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))

    # FPS
    r_frame_rate = video_stream.get("r_frame_rate", "30/1")
    try:
        num, den = r_frame_rate.split("/")
        fps = float(num) / float(den) if float(den) > 0 else 30.0
    except Exception:
        fps = 30.0

    # Duração
    duration = 0.0
    if "duration" in video_stream:
        try:
            duration = float(video_stream["duration"])
        except ValueError:
            pass
    if duration <= 0 and "format" in data and "duration" in data["format"]:
        try:
            duration = float(data["format"]["duration"])
        except ValueError:
            duration = 0.0

    # Total frames
    nb_frames = 0
    if "nb_frames" in video_stream:
        try:
            nb_frames = int(video_stream["nb_frames"])
        except ValueError:
            nb_frames = 0
    if nb_frames <= 0 and duration > 0 and fps > 0:
        nb_frames = int(duration * fps)

    return {
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "nb_frames": nb_frames,
        "video_codec": video_stream.get("codec_name", "desconhecido"),
        "has_audio": has_audio
    }

def get_fullhd_dimensions(width, height):
    """
    Calcula as dimensões em Full HD (1080p) preservando a proporção de aspecto (Aspect Ratio).
    - Vídeos horizontais (16:9): 1920x1080
    - Vídeos verticais (9:16 - Reels, TikTok, Shorts): 1080x1920
    - Vídeos quadrados (1:1): 1080x1080
    Garante dimensões pares para conformidade com H.264 / NVENC.
    """
    if width <= 0 or height <= 0:
        return 1920, 1080

    aspect = width / float(height)
    if aspect >= 1.0: # Horizontal ou quadrado
        target_h = 1080
        target_w = int(round(target_h * aspect))
    else: # Vertical (Stories, Reels, Shorts)
        target_w = 1080
        target_h = int(round(target_w / aspect))

    # Garante números pares
    target_w = target_w if target_w % 2 == 0 else target_w + 1
    target_h = target_h if target_h % 2 == 0 else target_h + 1

    return target_w, target_h

