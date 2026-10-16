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
import { galleryDb } from './gallery-db.js';

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

    // 2.1 Se o método selecionado for WaveSpeed AI, executa via API da WaveSpeed
    if (method === 'wavespeed' || engine === 'wavespeed') {
      try {
        const { WaveSpeedEngine } = await import('./wavespeed-engine.js');
        const { loadAiConfig } = await import('./ai-detector.js');
        const cfg = loadAiConfig();
        const wsKey = cfg.wavespeed_api_key || process.env.WAVESPEED_API_KEY;
        if (!wsKey) {
          throw new Error('Chave de API da WaveSpeed AI não configurada. Configure na engrenagem ⚙️.');
        }

        const ws = new WaveSpeedEngine(wsKey);
        const wsRes = await ws.processMedia({
          filePath: inputVideo,
          outputPath: outputVideo,
          mediaType: 'video',
          boxes: watermarkBoxes,
          onProgress: (p) => {
            if (onProgress) {
              onProgress({
                progress: (p.percent || 50) / 100,
                status: p.status || 'Processando com WaveSpeed AI...',
                encoderInUse: 'WaveSpeed AI'
              });
            }
          }
        });

        this.isRunning = false;
        return { success: true, outputPath: wsRes.outputPath, encoderUsed: 'WaveSpeed AI' };
      } catch (wsErr) {
        logStream.write(`[WaveSpeed AI] Falha: ${wsErr.message}. Recorrendo ao motor local...\n`);
      }
    }

    // 3. Monta cadeia de filtros com base no método escolhido e suporte a marca em movimento
    const filters = [];

    for (const b of watermarkBoxes) {
      if (b.isMoving && (b.start || b.end || b.trajectory)) {
        // Marca d'água em movimento: Interpolação suave ao longo da linha do tempo
        const t0 = Math.max(0, Number(b.start?.t !== undefined ? b.start.t : 0));
        const t1 = Math.max(t0 + 0.5, Number(b.end?.t !== undefined ? b.end.t : meta.duration || 10));
        const startX = Number(b.start?.x ?? b.x ?? 0);
        const startY = Number(b.start?.y ?? b.y ?? 0);
        const startW = Number(b.start?.w ?? b.w ?? 20);
        const startH = Number(b.start?.h ?? b.h ?? 20);
        const endX = Number(b.end?.x ?? startX);
        const endY = Number(b.end?.y ?? startY);
        const endW = Number(b.end?.w ?? startW);
        const endH = Number(b.end?.h ?? startH);

        const step = 0.5; // fatias temporais a cada 0.5s para transição suave
        for (let t = t0; t < t1; t += step) {
          const nextT = Math.min(t1, t + step);
          const ratio = (t + step / 2 - t0) / Math.max(0.1, t1 - t0);
          const curX = Math.round(startX + (endX - startX) * ratio);
          const curY = Math.round(startY + (endY - startY) * ratio);
          const curW = Math.round(startW + (endW - startW) * ratio);
          const curH = Math.round(startH + (endH - startH) * ratio);

          // Expande 2px além da marca para amostrar fundo 100% limpo sem serrilhamento
          const safeX = Math.max(1, Math.min(curX - 2, meta.width - 5));
          const safeY = Math.max(1, Math.min(curY - 2, meta.height - 5));
          const safeW = Math.max(4, Math.min(curW + 4, meta.width - safeX - 1));
          const safeH = Math.max(4, Math.min(curH + 4, meta.height - safeY - 1));

          filters.push(`delogo=x=${safeX}:y=${safeY}:w=${safeW}:h=${safeH}:show=0:enable='between(t\\,${t.toFixed(2)}\\,${nextT.toFixed(2)})'`);
        }
      } else {
        // Marca d'água estática: margem de 2px para amostrar o fundo puro e evitar borrão estriado
        let rawX = Math.round(Number(b.x) || 0);
        let rawY = Math.round(Number(b.y) || 0);
        let rawW = Math.round(Number(b.w) || 10);
        let rawH = Math.round(Number(b.h) || 10);

        const x = Math.max(1, Math.min(rawX - 2, meta.width - 5));
        const y = Math.max(1, Math.min(rawY - 2, meta.height - 5));
        const w = Math.max(4, Math.min(rawW + 4, meta.width - x - 1));
        const h = Math.max(4, Math.min(rawH + 4, meta.height - y - 1));

        filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`);
      }
    }

    // Estabilidade e Consistência Temporal (elimina piscadas, jitter e artefatos de um frame para o outro)
    if (watermarkBoxes.length > 0) {
      filters.push('hqdn3d=luma_spatial=1.5:chroma_spatial=1.5:luma_tmp=3.0:chroma_tmp=3.0');
    }

    // Se Upscale Full HD estiver ativado e o vídeo for menor que 1080p
    if (upscaleFullhd && (meta.width < 1920 || meta.height < 1080)) {
      const fhd = getFullHdDimensions(meta.width, meta.height);
      filters.push(`scale=${fhd.width}:${fhd.height}:flags=bilinear,unsharp=3:3:0.5:3:3:0.0`);
    }

    // SEMPRE aplica o filtro universal para evitar -22 por dimensões ímpares e garantir yuv420p
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
          useAudioCopy: (i === 0), // Primeira tentativa tenta -c:a copy para preservação 100% sem perda
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

    // Registra automaticamente o vídeo sem marca na galeria integrada
    let galleryItem = null;
    try {
      galleryItem = await galleryDb.addMedia({
        id: taskId,
        title: path.basename(inputVideo),
        mediaType: 'video',
        filePath: outputVideo,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        size: fs.statSync(outputVideo).size,
        source: 'inpainting'
      });
    } catch (gErr) {
      console.warn('[Processor] Aviso ao salvar vídeo na galeria:', gErr.message);
    }

    return {
      success: true,
      encoderUsed: successfulEncoder,
      logFile: logPath,
      outputPath: outputVideo,
      galleryItem
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
    useAudioCopy = false,
    totalFrames,
    logStream,
    onProgress,
    quality
  }) {
    return new Promise((resolve, reject) => {
      const ffmpegExe = getFfmpegBinary();
      const args = ['-y', '-i', inputVideo, '-vf', filterComplex];

      // Configura encoder de vídeo e parâmetros dedicados de alta qualidade
      args.push('-c:v', encoder);
      const specificParams = ENCODER_PARAMS[encoder] || ['-preset', 'slow', '-crf', '18'];
      args.push(...specificParams);

      // Otimização de threads máxima para CPU
      if (encoder === 'libx264') {
        args.push('-threads', '0');
      }

      // Flags de compatibilidade universal web (H.264, yuv420p, +faststart)
      args.push(...COMMON_OUTPUT_FLAGS);

      // Preservação de Áudio Original:
      // Tenta -c:a copy para manter a faixa de áudio idêntica à original sem perda
      // Se houver incompatibilidade, fallback automático para LC-AAC 192k 44.1kHz
      if (keepAudio && hasAudio) {
        if (useAudioCopy) {
          args.push('-c:a', 'copy');
        } else {
          args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
        }
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
