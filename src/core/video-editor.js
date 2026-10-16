import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getFfmpegBinary, getVideoMetadata } from '../utils/ffmpeg.js';
import { galleryDb } from './gallery-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const isVercel = Boolean(process.env.VERCEL);
const OUTPUT_DIR = isVercel ? '/tmp/web_outputs' : path.join(projectRoot, 'web_outputs');
const logsDir = isVercel ? '/tmp/logs' : path.join(projectRoot, 'logs');

try {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch {}

/**
 * Cria ou formata uma imagem PNG transparente para sobreposição no vídeo (Marca d'água, Figurinhas/Stickers, Emojis)
 */
export async function createOverlayPng({
  type = 'text',
  text = '',
  emoji = '',
  color = '#ffffff',
  fontSize = 36,
  imagePath = null,
  dataUrl = null,
  width = 240,
  height = null,
  outputPath
}) {
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default;

  // Imagem enviada pelo usuário (PNG transparente, logotipo, adesivo)
  if (type === 'image' && (imagePath || dataUrl)) {
    let inputBuf = null;
    if (dataUrl && dataUrl.startsWith('data:')) {
      const base64Data = dataUrl.split(',')[1];
      inputBuf = Buffer.from(base64Data, 'base64');
    } else if (imagePath && fs.existsSync(imagePath)) {
      inputBuf = fs.readFileSync(imagePath);
    }

    if (inputBuf) {
      let inst = sharp(inputBuf);
      if (width) {
        inst = inst.resize(Math.round(width), height ? Math.round(height) : null, { fit: 'inside' });
      }
      await inst.png().toFile(outputPath);
      return true;
    }
  }

  // Adesivo Emoji Expressivo (🔥, ⭐, 🚀, 💯, etc.)
  if (type === 'emoji') {
    const em = emoji || text || '⭐';
    const sz = Math.round(width || 120);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 100 100">
      <text x="50" y="70" font-size="65" text-anchor="middle">${em}</text>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
    return true;
  }

  // Marca d'Água Textual Estilizada
  const txt = text || 'MarcaRemoveIA';
  const fSize = Math.max(16, Math.round(fontSize || 36));
  const estimatedWidth = Math.max(140, Math.round(txt.length * fSize * 0.65) + 40);
  const estimatedHeight = Math.round(fSize * 1.8) + 16;
  const hexColor = color || '#ffffff';

  const safeText = txt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${estimatedWidth}" height="${estimatedHeight}">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.85"/>
      </filter>
    </defs>
    <rect x="4" y="4" width="${estimatedWidth - 8}" height="${estimatedHeight - 8}" rx="12" fill="rgba(15, 23, 42, 0.65)" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5"/>
    <text x="50%" y="62%" font-family="system-ui, -apple-system, BlinkMacSystemFont, sans-serif" font-weight="bold" font-size="${fSize}" fill="${hexColor}" text-anchor="middle" filter="url(#shadow)">${safeText}</text>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return true;
}

export class VideoEditor {
  constructor() {
    this.currentProcess = null;
    this.cancelRequested = false;
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
        }
      } catch (err) {
        console.warn('[VideoEditor] Erro ao cancelar FFmpeg:', err.message);
      }
    }
  }

  /**
   * Extrai áudio de um vídeo e gera arquivo MP3 de alta fidelidade
   */
  async extractAudio({
    filePath,
    taskId = `audio_${Date.now()}`,
    onProgress = null
  }) {
    this.cancelRequested = false;
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Arquivo de vídeo não encontrado para extração de áudio: ${filePath}`);
    }

    const ffmpegExe = getFfmpegBinary();
    const outputPath = path.join(OUTPUT_DIR, `clean_${taskId}.mp3`);
    const meta = await getVideoMetadata(filePath);
    const duration = meta?.duration || 0;

    const args = meta?.has_audio
      ? ['-y', '-i', filePath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', outputPath]
      : ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', Math.max(0.5, duration).toFixed(2), '-c:a', 'libmp3lame', '-q:a', '2', '-ar', '44100', outputPath];

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegExe, args, { windowsHide: true });
      this.currentProcess = proc;
      proc.on('close', (code) => {
        this.currentProcess = null;
        if (code === 0) resolve(true);
        else reject(new Error(`Falha ao extrair áudio (código ${code})`));
      });
      proc.on('error', (err) => {
        this.currentProcess = null;
        reject(err);
      });
    });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
      throw new Error('Falha ao gerar o arquivo MP3 de áudio.');
    }

    const title = `Áudio Extraído - ${path.basename(filePath, path.extname(filePath))}`;
    const galleryItem = await galleryDb.addMedia({
      id: taskId,
      title,
      mediaType: 'audio',
      filePath: outputPath,
      duration,
      size: fs.statSync(outputPath).size,
      source: 'editor'
    });

    return {
      success: true,
      taskId,
      outputPath,
      galleryItem,
      downloadUrl: `/api/download/${taskId}`,
      resultUrl: `/api/result/${taskId}`
    };
  }

  /**
   * Renderiza vídeo editado (Corte, Recorte de Enquadramento, Junção, Ajuste de Velocidade, Proporção, Marca d'Água e Figurinhas)
   */
  async render({
    clips = [],
    globalSettings = {},
    taskId = Date.now().toString(),
    onProgress = null
  }) {
    this.cancelRequested = false;
    if (!clips || clips.length === 0) {
      throw new Error('Nenhum clipe fornecido para edição.');
    }

    const ffmpegExe = getFfmpegBinary();
    const outputPath = path.join(OUTPUT_DIR, `clean_${taskId}.mp4`);
    const logPath = path.join(logsDir, `editor-${taskId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });

    logStream.write(`=== Início da Tarefa de Edição de Vídeo: ${taskId} ===\n`);
    logStream.write(`Quantidade de clipes: ${clips.length}\n`);
    logStream.write(`Configurações Globais: ${JSON.stringify(globalSettings)}\n\n`);

    // Lê metadados de todos os clipes
    const clipMetas = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (!fs.existsSync(c.filePath)) {
        throw new Error(`Arquivo do clipe #${i + 1} não encontrado: ${c.filePath}`);
      }
      const meta = await getVideoMetadata(c.filePath);
      if (!meta) {
        throw new Error(`Não foi possível ler metadados do clipe #${i + 1}: ${c.filePath}`);
      }
      clipMetas.push({ ...c, meta });
    }

    // Determina dimensões de destino com base na proporção (aspectRatio)
    const aspect = globalSettings.aspectRatio || 'original';
    let targetW = 1920;
    let targetH = 1080;

    if (aspect === 'original') {
      const first = clipMetas[0].meta;
      targetW = first.width % 2 === 0 ? first.width : first.width + 1;
      targetH = first.height % 2 === 0 ? first.height : first.height + 1;
    } else if (aspect === '9:16') {
      targetW = 1080;
      targetH = 1920;
    } else if (aspect === '1:1') {
      targetW = 1080;
      targetH = 1080;
    } else {
      // 16:9
      targetW = 1920;
      targetH = 1080;
    }

    const muteAudio = Boolean(globalSettings.muteAudio);
    const globalSpeed = parseFloat(globalSettings.speed || '1.0') || 1.0;

    // Calcula duração total estimada para a barra de progresso
    let totalEstimatedDuration = 0;
    for (const c of clipMetas) {
      const start = Math.max(0, parseFloat(c.trimStart || 0) || 0);
      const end = c.trimEnd !== undefined && c.trimEnd !== null && parseFloat(c.trimEnd) > start
        ? parseFloat(c.trimEnd)
        : c.meta.duration;
      const dur = Math.max(0.1, end - start);
      const clipSpeed = (parseFloat(c.speed) || globalSpeed || 1.0);
      totalEstimatedDuration += dur / clipSpeed;
    }

    const args = ['-y'];

    // Adiciona inputs de vídeo
    for (const c of clipMetas) {
      args.push('-i', c.filePath);
    }

    // Processa Overlays (Figurinhas/Stickers e Marca d'Água)
    const overlayItems = [];
    if (Array.isArray(globalSettings.stickers)) {
      for (const s of globalSettings.stickers) {
        if (s && (s.text || s.emoji || s.imagePath || s.dataUrl)) {
          overlayItems.push({
            type: s.type || (s.emoji ? 'emoji' : (s.imagePath || s.dataUrl ? 'image' : 'text')),
            text: s.text,
            emoji: s.emoji,
            imagePath: s.imagePath,
            dataUrl: s.dataUrl,
            width: s.size || s.width || 120,
            height: s.height || null,
            opacity: typeof s.opacity === 'number' ? s.opacity : 1.0,
            position: s.position || 'custom',
            xPct: typeof s.xPct === 'number' ? s.xPct : (parseFloat(s.x) || 50),
            yPct: typeof s.yPct === 'number' ? s.yPct : (parseFloat(s.y) || 50),
            startTime: parseFloat(s.startTime || 0) || 0,
            endTime: parseFloat(s.endTime) > 0 ? parseFloat(s.endTime) : totalEstimatedDuration
          });
        }
      }
    }

    if (globalSettings.watermark && globalSettings.watermark.enabled) {
      const wm = globalSettings.watermark;
      overlayItems.push({
        type: wm.type || (wm.imagePath || wm.dataUrl ? 'image' : 'text'),
        text: wm.text || 'MarcaRemoveIA',
        color: wm.color || '#ffffff',
        fontSize: wm.fontSize || 36,
        imagePath: wm.imagePath,
        dataUrl: wm.dataUrl,
        width: wm.width || 240,
        height: wm.height || null,
        opacity: typeof wm.opacity === 'number' ? wm.opacity : 0.8,
        position: wm.position || 'bottom-right',
        xPct: parseFloat(wm.xPct || wm.customX || 85),
        yPct: parseFloat(wm.yPct || wm.customY || 88),
        startTime: 0,
        endTime: totalEstimatedDuration
      });
    }

    const tempOverlayFiles = [];
    for (let k = 0; k < overlayItems.length; k++) {
      const ov = overlayItems[k];
      const tempPng = path.join(OUTPUT_DIR, `temp_ov_${taskId}_${k}.png`);
      try {
        await createOverlayPng({ ...ov, outputPath: tempPng });
        if (fs.existsSync(tempPng)) {
          tempOverlayFiles.push({ ...ov, filePath: tempPng, inputIndex: clipMetas.length + tempOverlayFiles.length });
          args.push('-i', tempPng);
        }
      } catch (err) {
        console.warn(`[VideoEditor] Aviso ao gerar overlay #${k}:`, err.message);
      }
    }

    // Monta Filter Complex para suportar corte, recorte de enquadramento, velocidade, padronização e overlays
    const filterParts = [];
    const concatInputs = [];

    for (let i = 0; i < clipMetas.length; i++) {
      const c = clipMetas[i];
      const start = Math.max(0, parseFloat(c.trimStart || 0) || 0);
      const end = c.trimEnd !== undefined && c.trimEnd !== null && parseFloat(c.trimEnd) > start
        ? parseFloat(c.trimEnd)
        : c.meta.duration;
      const speed = parseFloat(c.speed) || globalSpeed || 1.0;

      // Filtro de vídeo para este clipe
      const vFilters = [];
      if (start > 0 || (end < c.meta.duration && end > 0)) {
        vFilters.push(`trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS`);
      }
      if (Math.abs(speed - 1.0) > 0.01) {
        const ptsFactor = (1 / speed).toFixed(4);
        vFilters.push(`setpts=${ptsFactor}*PTS`);
      }

      // Recorte de enquadramento (Crop) se configurado
      const cropCfg = c.crop || (globalSettings.cropEnabled ? globalSettings.crop : null);
      if (cropCfg && (cropCfg.width > 0 || cropCfg.widthPct > 0)) {
        let cw = 0, ch = 0, cx = 0, cy = 0;
        if (cropCfg.widthPct !== undefined) {
          cw = Math.round((parseFloat(cropCfg.widthPct) / 100) * c.meta.width);
          ch = Math.round((parseFloat(cropCfg.heightPct || 100) / 100) * c.meta.height);
          cx = Math.round((parseFloat(cropCfg.xPct || 0) / 100) * c.meta.width);
          cy = Math.round((parseFloat(cropCfg.yPct || 0) / 100) * c.meta.height);
        } else {
          cw = Math.round(cropCfg.width);
          ch = Math.round(cropCfg.height);
          cx = Math.round(cropCfg.x || 0);
          cy = Math.round(cropCfg.y || 0);
        }
        cw = Math.min(c.meta.width - cx, cw);
        ch = Math.min(c.meta.height - cy, ch);
        cw = Math.max(16, cw - (cw % 2));
        ch = Math.max(16, ch - (ch % 2));
        cx = Math.max(0, cx);
        cy = Math.max(0, cy);
        vFilters.push(`crop=${cw}:${ch}:${cx}:${cy}`);
      }

      // Escala e padding centralizado para resolução uniforme
      vFilters.push(
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
        `setsar=1`,
        `fps=30`
      );

      const vLabel = `v${i}`;
      filterParts.push(`[${i}:v]${vFilters.join(',')}[${vLabel}]`);
      concatInputs.push(`[${vLabel}]`);

      // Filtro de áudio para este clipe se áudio não estiver mutado
      if (!muteAudio) {
        const aFilters = [];
        if (start > 0 || (end < c.meta.duration && end > 0)) {
          aFilters.push(`atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS`);
        }
        if (Math.abs(speed - 1.0) > 0.01) {
          if (speed >= 0.5 && speed <= 2.0) {
            aFilters.push(`atempo=${speed.toFixed(2)}`);
          } else if (speed > 2.0) {
            aFilters.push(`atempo=2.0,atempo=${(speed / 2.0).toFixed(2)}`);
          } else {
            aFilters.push(`atempo=0.5,atempo=${(speed / 0.5).toFixed(2)}`);
          }
        }
        aFilters.push(`aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`);

        const aLabel = `a${i}`;
        if (c.meta.has_audio) {
          filterParts.push(`[${i}:a]${aFilters.join(',')}[${aLabel}]`);
        } else {
          const dur = Math.max(0.1, (end - start) / speed);
          filterParts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${dur.toFixed(3)}[${aLabel}]`);
        }
        concatInputs.push(`[${aLabel}]`);
      }
    }

    // Unifica os clipes em uma base
    const n = clipMetas.length;
    let vBaseLabel = 'vbase';
    if (n > 1) {
      if (!muteAudio) {
        filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[${vBaseLabel}][outa]`);
      } else {
        filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=0[${vBaseLabel}]`);
      }
    } else {
      if (!muteAudio) {
        filterParts.push(`[v0]copy[${vBaseLabel}];[a0]copy[outa]`);
      } else {
        filterParts.push(`[v0]copy[${vBaseLabel}]`);
      }
    }

    // Aplica cadeia de sobreposição de overlays (marca d'água / figurinhas)
    let currentV = vBaseLabel;
    if (tempOverlayFiles.length > 0) {
      for (let k = 0; k < tempOverlayFiles.length; k++) {
        const ov = tempOverlayFiles[k];
        const nextV = `v_ov_${k}`;
        const ovLayer = `ov_layer_${k}`;
        const opacity = Math.max(0.05, Math.min(1.0, ov.opacity || 1.0));

        // Formata PNG para RGBA e aplica canal de opacidade
        filterParts.push(`[${ov.inputIndex}:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${ovLayer}]`);

        // Calcula coordenadas X e Y
        let posX = 'W-w-30';
        let posY = 'H-h-30';
        if (ov.position === 'top-left') {
          posX = '30';
          posY = '30';
        } else if (ov.position === 'top-right') {
          posX = 'W-w-30';
          posY = '30';
        } else if (ov.position === 'bottom-left') {
          posX = '30';
          posY = 'H-h-30';
        } else if (ov.position === 'bottom-right') {
          posX = 'W-w-30';
          posY = 'H-h-30';
        } else if (ov.position === 'center') {
          posX = '(W-w)/2';
          posY = '(H-h)/2';
        } else {
          // Coordenadas livres em porcentagem
          const px = (Math.max(0, Math.min(100, ov.xPct)) / 100).toFixed(4);
          const py = (Math.max(0, Math.min(100, ov.yPct)) / 100).toFixed(4);
          posX = `(W*${px})-(w/2)`;
          posY = `(H*${py})-(h/2)`;
        }

        // Condição de tempo se especificada
        let enableStr = '';
        if (ov.startTime > 0 || (ov.endTime > 0 && ov.endTime < totalEstimatedDuration)) {
          enableStr = `:enable='between(t,${ov.startTime.toFixed(2)},${ov.endTime.toFixed(2)})'`;
        }

        filterParts.push(`[${currentV}][${ovLayer}]overlay=x=${posX}:y=${posY}${enableStr}[${nextV}]`);
        currentV = nextV;
      }
    }

    filterParts.push(`[${currentV}]copy[outv]`);
    args.push('-filter_complex', filterParts.join(';'));
    if (!muteAudio) {
      args.push('-map', '[outv]', '-map', '[outa]');
    } else {
      args.push('-map', '[outv]');
    }

    // Parâmetros de alta qualidade e compatibilidade web universal exigidos pelo usuário
    args.push(
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    );

    if (muteAudio) {
      args.push('-an');
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
    }

    args.push('-progress', 'pipe:1', outputPath);

    logStream.write(`Executando comando: ${ffmpegExe} ${args.join(' ')}\n\n`);

    try {
      await new Promise((resolve, reject) => {
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
            if (trimmed.startsWith('out_time_ms=')) {
              const timeMs = parseInt(trimmed.split('=')[1]?.trim(), 10);
              if (!isNaN(timeMs) && totalEstimatedDuration > 0 && onProgress) {
                const currentSec = Math.max(0, timeMs / 1000000);
                const pct = Math.max(0, Math.min(0.99, currentSec / totalEstimatedDuration));
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speedVal = currentSec / Math.max(0.1, elapsedSec);
                const remSec = speedVal > 0 ? (totalEstimatedDuration - currentSec) / speedVal : 0;

                onProgress({
                  progress: pct,
                  percent: Math.max(0, Math.round(pct * 100)),
                  status: `Renderizando vídeo editado: ${(pct * 100).toFixed(1)}%`,
                  eta: formatSecondsToTime(remSec),
                  fps: Math.round(speedVal * 30 * 10) / 10
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
            const tail = stderrTail.slice(-5).join(' | ');
            reject(new Error(`Falha no FFmpeg ao renderizar edição (código ${code}): ${tail}`));
          }
        });
      });
    } finally {
      // Remove arquivos temporários de overlay
      for (const ov of tempOverlayFiles) {
        try {
          if (fs.existsSync(ov.filePath)) fs.unlinkSync(ov.filePath);
        } catch {}
      }
    }

    logStream.end();

    if (this.cancelRequested) {
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch {}
      }
      return { success: false, cancelled: true };
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) {
      throw new Error('O arquivo de vídeo final não foi gerado corretamente pelo editor.');
    }

    // Registra automaticamente o vídeo editado na Galeria de Mídias
    const outMeta = await getVideoMetadata(outputPath);
    const galleryTitle = globalSettings.title || `Vídeo Editado #${taskId.slice(0, 8)}`;
    const galleryItem = await galleryDb.addMedia({
      id: taskId,
      title: galleryTitle,
      mediaType: 'video',
      filePath: outputPath,
      duration: outMeta?.duration || totalEstimatedDuration,
      width: outMeta?.width || targetW,
      height: outMeta?.height || targetH,
      size: fs.statSync(outputPath).size,
      source: 'editor'
    });

    return {
      success: true,
      taskId,
      outputPath,
      galleryItem,
      downloadUrl: `/api/download/${taskId}`,
      resultUrl: `/api/result/${taskId}`
    };
  }
}

function formatSecondsToTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
