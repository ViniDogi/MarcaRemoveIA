import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

/**
 * Localiza o diretório onde ffmpeg.exe e ffprobe.exe residem.
 */
export function getFfmpegDir() {
  // 1. Diretório bin local do projeto
  const localBin = path.join(projectRoot, 'bin');
  if (fs.existsSync(path.join(localBin, 'ffmpeg.exe')) || fs.existsSync(path.join(localBin, 'ffmpeg'))) {
    return localBin;
  }

  // 2. WinGet Packages no Windows
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const wingetPath = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetPath)) {
      try {
        const entries = fs.readdirSync(wingetPath, { recursive: true });
        for (const entry of entries) {
          if (typeof entry === 'string' && entry.toLowerCase().endsWith('ffmpeg.exe')) {
            return path.dirname(path.join(wingetPath, entry));
          }
        }
      } catch {
        // Silently continue
      }
    }
  }

  return null;
}

export function getFfmpegBinary() {
  const dir = getFfmpegDir();
  if (dir) {
    const exe = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(exe)) return exe;
  }
  return 'ffmpeg';
}

export function getFfprobeBinary() {
  const dir = getFfmpegDir();
  if (dir) {
    const exe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'ffprobe';
}

/**
 * Executa um comando spawn de forma segura (sem shell).
 */
export function spawnPromise(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, {
      windowsHide: true,
      ...options
    });

    let stdout = '';
    let stderr = '';

    if (proc.stdout) {
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
    }

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Retorna metadados do vídeo usando ffprobe e valida a integridade do arquivo.
 */
export async function getVideoMetadata(videoPath) {
  const ffprobeExe = getFfprobeBinary();
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    videoPath
  ];

  try {
    const { code, stdout } = await spawnPromise(ffprobeExe, args);
    if (code !== 0 || !stdout) {
      return null;
    }

    const data = JSON.parse(stdout);
    const streams = data.streams || [];

    let videoStream = null;
    let hasAudio = false;

    for (const s of streams) {
      if (s.codec_type === 'video' && !videoStream) {
        videoStream = s;
      } else if (s.codec_type === 'audio') {
        hasAudio = true;
      }
    }

    if (!videoStream) {
      return null;
    }

    const width = parseInt(videoStream.width || '0', 10);
    const height = parseInt(videoStream.height || '0', 10);

    let fps = 30.0;
    if (videoStream.r_frame_rate) {
      try {
        const [num, den] = videoStream.r_frame_rate.split('/');
        const n = parseFloat(num);
        const d = parseFloat(den);
        if (d > 0) fps = n / d;
      } catch {
        fps = 30.0;
      }
    }

    let duration = 0.0;
    if (videoStream.duration) {
      duration = parseFloat(videoStream.duration);
    }
    if ((!duration || isNaN(duration)) && data.format?.duration) {
      duration = parseFloat(data.format.duration);
    }
    if (isNaN(duration)) duration = 0.0;

    let nbFrames = 0;
    if (videoStream.nb_frames) {
      nbFrames = parseInt(videoStream.nb_frames, 10);
    }
    if ((!nbFrames || isNaN(nbFrames)) && duration > 0 && fps > 0) {
      nbFrames = Math.round(duration * fps);
    }
    if (isNaN(nbFrames)) nbFrames = 0;

    return {
      width,
      height,
      fps,
      duration,
      nb_frames: nbFrames,
      video_codec: videoStream.codec_name || 'desconhecido',
      has_audio: hasAudio
    };
  } catch (err) {
    console.error('Erro ao ler metadados com ffprobe:', err);
    return null;
  }
}

/**
 * Validação rigorosa do arquivo de vídeo antes do processamento.
 * Retorna { valid: boolean, error?: string, metadata?: object }
 */
export async function validateVideoFile(videoPath) {
  if (!fs.existsSync(videoPath)) {
    return { valid: false, error: 'O arquivo de vídeo não foi encontrado no servidor.' };
  }

  const stat = fs.statSync(videoPath);
  if (stat.size === 0) {
    return { valid: false, error: 'O arquivo enviado está vazio (0 bytes).' };
  }

  const ext = path.extname(videoPath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
  if (imageExts.includes(ext) && stat.size > 0) {
    return {
      valid: true,
      metadata: {
        width: 1920,
        height: 1080,
        fps: 0,
        duration: 0,
        nb_frames: 1,
        video_codec: ext.replace('.', ''),
        has_audio: false,
        is_image: true
      }
    };
  }

  const meta = await getVideoMetadata(videoPath);
  if (!meta) {
    // Fallback para ambientes sem ffprobe instalado (ex: Vercel Serverless)
    // Permite que o upload seja concluído e os metadados reais sejam lidos no cliente via HTML5 Video
    const validExts = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.ts', '.flv'];
    if (validExts.includes(ext) && stat.size > 0) {
      return {
        valid: true,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30.0,
          duration: 10.0,
          nb_frames: 300,
          video_codec: ext.replace('.', ''),
          has_audio: true,
          isFallbackMetadata: true
        }
      };
    }

    return {
      valid: false,
      error: 'Formato de vídeo inválido ou arquivo corrompido. Certifique-se de enviar um arquivo de vídeo ou imagem válido.'
    };
  }

  if (meta.width <= 0 || meta.height <= 0) {
    return {
      valid: false,
      error: 'As dimensões do vídeo não puderam ser identificadas ou são inválidas.'
    };
  }

  if (meta.duration <= 0 && meta.nb_frames <= 0) {
    return {
      valid: false,
      error: 'O vídeo possui duração zero ou não contém quadros reproduzíveis.'
    };
  }

  return { valid: true, metadata: meta };
}

/**
 * Calcula as dimensões em Full HD (1080p) preservando a proporção de aspecto (Aspect Ratio).
 * Garante dimensões pares para conformidade universal com encoders H.264.
 */
export function getFullHdDimensions(width, height) {
  if (width <= 0 || height <= 0) {
    return { width: 1920, height: 1080 };
  }

  const aspect = width / height;
  let targetW, targetH;

  if (aspect >= 1.0) {
    // Horizontal ou quadrado
    targetH = 1080;
    targetW = Math.round(targetH * aspect);
  } else {
    // Vertical (Stories, Reels, Shorts)
    targetW = 1080;
    targetH = Math.round(targetW / aspect);
  }

  // Garante números pares
  targetW = targetW % 2 === 0 ? targetW : targetW + 1;
  targetH = targetH % 2 === 0 ? targetH : targetH + 1;

  return { width: targetW, height: targetH };
}
