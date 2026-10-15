import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFfmpegBinary, spawnPromise } from '../src/utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testsDir = __dirname;

export async function ensureSyntheticVideo() {
  const videoPath = path.join(testsDir, 'synthetic_watermark.mp4');
  if (!fs.existsSync(videoPath)) {
    const ffmpegExe = getFfmpegBinary();
    try {
      await spawnPromise(ffmpegExe, [
        '-y', '-f', 'lavfi',
        '-i', 'testsrc=duration=2:size=640x360:rate=25',
        '-vf', 'drawbox=x=450:y=30:w=160:h=50:color=red@1.0:t=fill',
        '-c:v', 'libx264',
        videoPath
      ]);
    } catch (e) {
      console.warn('Aviso: Não foi possível gerar synthetic_watermark.mp4:', e.message);
    }
  }
  return videoPath;
}
