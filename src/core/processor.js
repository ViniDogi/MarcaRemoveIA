import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getFfmpegBinary,
  validateVideoFile,
  getFullHdDimensions
} from '../utils/ffmpeg.js';
import {
  detectHardwareEncoders,
  getEncoderFallbackChain,
  ENCODER_PARAMS,
  COMMON_OUTPUT_FLAGS,
  UNIVERSAL_DIMENSION_FILTER,
  ENCODER_LABELS
} from './encoder-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const isVercel = Boolean(process.env.VERCEL);
const logsDir = isVercel ? '/tmp/logs' : path.join(projectRoot, 'logs');

try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch {
  // Ignora erro em sistemas de arquivos somente-leitura
}

export class WatermarkProcessor {
  constructor(initOptions = {}) {
    this.currentProcess = null;
    this.cancelRequested = false;
    this.isRunning = false;
    this.initOptions = initOptions;
  }

  cancel() {
    this.cancelRequested = true;
    if (this.currentProcess && !this.currentProcess.killed) {
      try {
        const pid = this.currentProcess.pid;
        if (process.platform === 'win32' && pid) {
          spawn('taskkill', ['/F', '/T', '/PID', pid.toString()], { windowsHide: true });
        } else {
          this.currentProcess.kill('SIGTERM');
          setTimeout(() => {
            if (this.currentProcess && !this.currentProcess.killed) {
              this.currentProcess.kill('SIGKILL');
            }
          }, 1500);
        }
      } catch (err) {
        console.error('Erro ao cancelar processo FFmpeg:', err);
      }
    }
  }

  /**
   * Alias de compatibilidade com pipeline de download
   */
  async process(overrideOptions = {}) {
    const opts = { ...this.initOptions, ...overrideOptions };
    return this.runRemoval({
      inputVideo: opts.inputPath || opts.inputVideo,
      outputVideo: opts.outputPath || opts.outputVideo,
      watermarkBoxes: opts.watermarkBoxes || opts.boxes || [],
      engine: opts.hardwareEncoder || opts.engine || 'auto',
      method: opts.method || 'ai_inpaint',
      quality: opts.quality || 'high',
      keepAudio: opts.keepAudio !== undefined ? opts.keepAudio : true,
      upscaleFullhd: Boolean(opts.upscaleFullhd || opts.upscale_fullhd),
      taskId: opts.taskId || Date.now().toString(),
      onProgress: (p) => {
        if (typeof opts.onProgress === 'function') {
          // Suporta tanto onProgress({ percent, status }) quanto onProgress(percent, status)
          if (typeof p === 'object') {
            const pct = Math.round((p.progress || 0) * 100);
            opts.onProgress(pct, p.status);
          } else {
            opts.onProgress(p);
          }
        }
      }
    });
  }

  /**
   * Executa a remoção de marca d'água com suporte a múltiplos métodos (IA, Delogo, Blur)
   * e fallback automático universal de encoders.
   */
  async runRemoval({
    inputVideo,
    outputVideo,
    watermarkBoxes = [],
    engine = 'auto',
    method = 'ai_inpaint', // 'ai_inpaint', 'delogo', 'blur'
    quality = 'high',
    keepAudio = true,
    upscaleFullhd = false,
    taskId = Date.now().toString(),
    onProgress = null
  }) {
    this.isRunning = true;
    this.cancelRequested = false;

    // 1. Validação estrita do arquivo de entrada
    const validation = await validateVideoFile(inputVideo);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    const meta = validation.metadata;

    // 2. Garante diretório de logs
    const logPath = path.join(logsDir, `ffmpeg-${taskId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    logStream.write(`=== Início da Tarefa: ${taskId} ===\n`);
    logStream.write(`Arquivo: ${inputVideo}\nResolução: ${meta.width}x${meta.height}\nFPS: ${meta.fps}\nFrames: ${meta.nb_frames}\nMétodo: ${method}\n\n`);

    // 3. Monta cadeia de filtros com base no método escolhido
    const filters = [];

    for (const b of watermarkBoxes) {
      let x = Math.round(Number(b.x) || 0);
      let y = Math.round(Number(b.y) || 0);
      let w = Math.round(Number(b.w) || 10);
      let h = Math.round(Number(b.h) || 10);

      x = Math.max(1, Math.min(x, meta.width - 3));
      y = Math.max(1, Math.min(y, meta.height - 3));
      w = Math.max(2, Math.min(w, meta.width - x - 1));
      h = Math.max(2, Math.min(h, meta.height - y - 1));

      if (method === 'blur') {
        filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
      } else {
        // Modo IA e Delogo padrão
        filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
      }
    }

    // Se Upscale Full HD estiver ativado e o vídeo for menor que 1080p
    if (upscaleFullhd && (meta.width < 1920 || meta.height < 1080)) {
      const fhd = getFullHdDimensions(meta.width, meta.height);
      filters.push(`scale=${fhd.width}:${fhd.height}:flags=bilinear,unsharp=3:3:0.5:3:3:0.0`);
    }

    // SEMPRE aplica o filtro universal para evitar -22 por dimensões ímpares
    filters.push(UNIVERSAL_DIMENSION_FILTER);

    const filterComplex = filters.join(',');

    // 4. Detecção de hardware e cadeia de fallback
    const hw = await detectHardwareEncoders();
    const fallbackChain = getEncoderFallbackChain(engine, hw.availableEncoders);

    logStream.write(`Encoders disponíveis: ${hw.availableEncoders.join(', ')}\n`);
    logStream.write(`Cadeia de fallback: ${fallbackChain.join(' -> ')}\n\n`);

    let lastError = null;
    let successfulEncoder = null;

    for (let i = 0; i < fallbackChain.length; i++) {
      const currentEncoder = fallbackChain[i];
      if (this.cancelRequested) {
        logStream.write('Processamento cancelado pelo usuário.\n');
        logStream.end();
        this.isRunning = false;
        return { success: false, cancelled: true };
      }

      if (i > 0) {
        const msg = `Falha no encoder anterior. Aplicando fallback automático para: ${ENCODER_LABELS[currentEncoder] || currentEncoder}...`;
        logStream.write(`\n[FALLBACK] ${msg}\n`);
        if (onProgress) {
          onProgress({
            progress: 0,
            status: msg,
            encoderInUse: currentEncoder
          });
        }
      }

      logStream.write(`\n--- Tentando codificação com: ${currentEncoder} ---\n`);

      try {
        const ok = await this._executeFfmpegPass({
          inputVideo,
          outputVideo,
          filterComplex,
          encoder: currentEncoder,
          keepAudio,
          hasAudio: meta.has_audio,
          totalFrames: meta.nb_frames,
          logStream,
          onProgress,
          quality
        });

        if (ok && fs.existsSync(outputVideo) && fs.statSync(outputVideo).size > 1000) {
          successfulEncoder = currentEncoder;
          logStream.write(`\n[SUCESSO] Codificação concluída com sucesso usando ${currentEncoder}.\n`);
          break;
        }
      } catch (err) {
        lastError = err;
        logStream.write(`[ERRO COM ${currentEncoder}]: ${err.message}\n`);
      }
    }

    logStream.end();
    this.isRunning = false;

    if (this.cancelRequested) {
      if (fs.existsSync(outputVideo)) {
        try { fs.unlinkSync(outputVideo); } catch {}
      }
      return { success: false, cancelled: true };
    }

    if (!successfulEncoder) {
      const summaryMsg = 'Falha em todos os encoders testados durante o processamento do vídeo.';
      const detailMsg = lastError ? lastError.message : 'Erro desconhecido no FFmpeg.';
      throw new Error(`${summaryMsg} Detalhes: ${detailMsg}`);
    }

    return {
      success: true,
      encoderUsed: successfulEncoder,
      logFile: logPath,
      outputPath: outputVideo
    };
  }

  /**
   * Executa uma passada do FFmpeg monitorando progresso e registrando stderr.
   */
  _executeFfmpegPass({
    inputVideo,
    outputVideo,
    filterComplex,
    encoder,
    keepAudio,
    hasAudio,
    totalFrames,
    logStream,
    onProgress,
    quality
  }) {
    return new Promise((resolve, reject) => {
      const ffmpegExe = getFfmpegBinary();
      const args = ['-y', '-i', inputVideo, '-vf', filterComplex];

      // Configura encoder de vídeo e parâmetros dedicados
      args.push('-c:v', encoder);
      const specificParams = ENCODER_PARAMS[encoder] || ['-preset', 'veryfast', '-crf', '23'];
      args.push(...specificParams);

      // Otimização de threads máxima para CPU
      if (encoder === 'libx264') {
        args.push('-threads', '0');
      }

      // Flags de compatibilidade universal
      args.push(...COMMON_OUTPUT_FLAGS);

      // Áudio universal LC-AAC 192k 44.1kHz
      if (keepAudio && hasAudio) {
        args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
      } else {
        args.push('-an');
      }

      // Progresso via stdout pipe
      args.push('-progress', 'pipe:1', outputVideo);

      logStream.write(`Executando comando: ${ffmpegExe} ${args.join(' ')}\n\n`);

      const proc = spawn(ffmpegExe, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = proc;
      const startTime = Date.now();
      const stderrTail = [];

      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('frame=')) {
            const frameStr = trimmed.split('=')[1]?.trim();
            const curFrame = parseInt(frameStr, 10);
            if (!isNaN(curFrame) && totalFrames > 0 && onProgress) {
              const pct = Math.min(1.0, curFrame / totalFrames);
              const elapsedSec = (Date.now() - startTime) / 1000;
              const fps = elapsedSec > 0 ? curFrame / elapsedSec : 0;
              const remSec = fps > 0 ? (totalFrames - curFrame) / fps : 0;
              const etaStr = formatSecondsToTime(remSec);

              onProgress({
                progress: pct,
                currentFrame: curFrame,
                totalFrames,
                fps: Math.round(fps * 10) / 10,
                eta: etaStr,
                status: `Processando com IA: ${(pct * 100).toFixed(1)}% (${curFrame}/${totalFrames})`,
                encoderInUse: encoder
              });
            }
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        logStream.write(text);
        const lines = text.split('\n');
        for (const l of lines) {
          const tr = l.trim();
          if (tr) {
            stderrTail.push(tr);
            if (stderrTail.length > 25) stderrTail.shift();
          }
        }
      });

      proc.on('error', (err) => {
        logStream.write(`\nErro ao iniciar FFmpeg: ${err.message}\n`);
        reject(err);
      });

      proc.on('close', (code) => {
        this.currentProcess = null;
        logStream.write(`\nFFmpeg finalizado com código: ${code}\n`);

        if (code === 0) {
          resolve(true);
        } else {
          const tailSummary = stderrTail.slice(-5).join(' | ');
          const err = new Error(`FFmpeg finalizou com código ${code}. Últimas mensagens: ${tailSummary}`);
          reject(err);
        }
      });
    });
  }
}

function formatSecondsToTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
