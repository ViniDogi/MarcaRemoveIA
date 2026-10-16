import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

import {
  getVideoMetadata,
  validateVideoFile
} from './utils/ffmpeg.js';
import {
  detectHardwareEncoders
} from './core/encoder-detector.js';
import {
  WatermarkProcessor
} from './core/processor.js';
import {
  loadAiConfig,
  saveAiConfig,
  detectWatermarksAi,
  extractFrameBuffer
} from './core/ai-detector.js';
import {
  findWatermarkByImage,
  generateFramePreview
} from './core/template-matcher.js';
import {
  detectHybridWatermarks,
  inpaintImageBuffer
} from './core/onnx-engine.js';
import {
  getVideoInfo,
  downloadVideo,
  updateYtDlpBinary,
  validateUrlAndCheckSSRF
} from './core/downloader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const isVercel = Boolean(process.env.VERCEL);
const UPLOAD_DIR = isVercel ? '/tmp/web_uploads' : path.join(projectRoot, 'web_uploads');
const OUTPUT_DIR = isVercel ? '/tmp/web_outputs' : path.join(projectRoot, 'web_outputs');
const LOGS_DIR = isVercel ? '/tmp/logs' : path.join(projectRoot, 'logs');

try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch {
  // Ignora erro em sistemas somente-leitura (Vercel Lambda)
}

const app = express();
const PORT = process.env.PORT || 8000;
const HOST = '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuração do Multer para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const videoId = crypto.randomUUID();
    cb(null, `${videoId}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // limite de 2GB
});

// Armazenamento em memória das tarefas
const tasks = new Map();
const sseClients = new Map(); // taskId -> Array of res objects

function broadcastProgress(taskId, data) {
  const task = tasks.get(taskId);
  if (task) {
    Object.assign(task, data);
  }

  const clients = sseClients.get(taskId);
  if (clients && clients.length > 0) {
    const payload = `data: ${JSON.stringify(task || data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        // Ignora erro se cliente desconectou
      }
    }
  }
}

// 0. Healthcheck para Vercel e monitoramento
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    app: 'MarcaRemoveIA',
    version: '2.0.0',
    platform: process.platform,
    isVercel
  });
});

// 1. Página Principal
app.get('/', (req, res) => {
  const candidates = [
    path.join(projectRoot, 'index.html'),
    path.join(process.cwd(), 'index.html')
  ];
  for (const htmlPath of candidates) {
    if (fs.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
  }
  return res.status(404).send('<h1>MarcaRemoveIA Web - Arquivo index.html não encontrado</h1>');
});

// 2. Hardware Encoders
app.get('/api/hardware', async (req, res) => {
  try {
    const hw = await detectHardwareEncoders();
    return res.json(hw);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Upload de Vídeo
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
  }

  const filePath = req.file.path;
  const validation = await validateVideoFile(filePath);
  if (!validation.valid) {
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(400).json({ success: false, error: validation.error });
  }

  const videoId = path.basename(req.file.filename, path.extname(req.file.filename));
  const ext = path.extname(req.file.filename);

  return res.json({
    success: true,
    video_id: videoId,
    filename: req.file.originalname,
    video_url: `/api/video/${videoId}${ext}`,
    metadata: validation.metadata
  });
});

// 4. Servir Vídeo Estático com suporte a Range (streaming para preview)
app.get('/api/video/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Vídeo não encontrado.');
  }

  return res.sendFile(filePath);
});

// 5. Extração de Quadro para Preview
app.get('/api/frame-preview', async (req, res) => {
  const videoId = req.query.video_id;
  const timestamp = parseFloat(req.query.timestamp || '0') || 0;

  if (!videoId) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(videoId));
  if (!matched) {
    return res.status(404).json({ error: 'Vídeo não encontrado.' });
  }

  const videoPath = path.join(UPLOAD_DIR, matched);
  try {
    const buf = await extractFrameBuffer(videoPath, timestamp, 'mjpeg');
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. Detecção com IA e Estabilidade Temporal (Modo Híbrido)
app.post('/api/detect-ai', async (req, res) => {
  const { video_id, timestamp = 0, mode = 'hybrid' } = req.body;
  if (!video_id) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(video_id));
  if (!matched) {
    return res.status(404).json({ error: 'Vídeo não encontrado.' });
  }

  const videoPath = path.join(UPLOAD_DIR, matched);
  try {
    const config = loadAiConfig();
    let boxes = [];

    if (config.api_key && config.provider !== 'local_cv' && mode !== 'temporal_only') {
      boxes = await detectWatermarksAi(videoPath, timestamp);
    } else {
      // Modo Híbrido com Estabilidade Temporal
      boxes = await detectHybridWatermarks({ videoPath, sampleCount: 5 });
    }

    return res.json({ boxes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6.1 Detecção de Marca d'Água por Imagem (Template Matching)
app.post('/api/match-template', upload.single('template_image'), async (req, res) => {
  const { video_id, is_mobile } = req.body;
  if (!video_id) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Imagem da marca d\'água é obrigatória.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(video_id));
  if (!matched) {
    return res.status(404).json({ error: 'Vídeo não encontrado.' });
  }

  const videoPath = path.join(UPLOAD_DIR, matched);
  const templateBuffer = fs.readFileSync(req.file.path);

  try {
    const result = await findWatermarkByImage({
      videoPath,
      templateBuffer,
      sampleCount: 5,
      isMobile: is_mobile === 'true' || is_mobile === true
    });

    return res.json({
      success: true,
      box: result.medianBox,
      all_matches: result.allMatches,
      mask_info: {
        width: result.maskInfo.width,
        height: result.maskInfo.height,
        has_alpha: result.maskInfo.hasAlpha
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

// 6.2 Prévia do Resultado em 1 Frame
app.post('/api/preview-frame', async (req, res) => {
  const { video_id, timestamp = 0, boxes = [], method = 'ai_inpaint' } = req.body;
  if (!video_id) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(video_id));
  if (!matched) {
    return res.status(404).json({ error: 'Vídeo não encontrado.' });
  }

  const videoPath = path.join(UPLOAD_DIR, matched);
  try {
    let previewBuffer;
    if (method === 'ai_inpaint' && boxes.length > 0) {
      const origFrame = await extractFrameBuffer(videoPath, parseFloat(timestamp) || 0, 'mjpeg');
      previewBuffer = await inpaintImageBuffer({
        imageBuffer: origFrame,
        boxes
      });
    } else {
      previewBuffer = await generateFramePreview({
        videoPath,
        timestamp: parseFloat(timestamp) || 0,
        boxes
      });
    }

    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(previewBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Iniciar Processamento (Vídeo ou Imagem)
app.post('/api/process', async (req, res) => {
  const {
    video_id,
    boxes = [],
    engine = 'auto',
    method = 'ai_inpaint',
    quality = 'high',
    keep_audio = true,
    upscale_fullhd = false
  } = req.body;

  if (!video_id) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(video_id));
  if (!matched) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  const inputPath = path.join(UPLOAD_DIR, matched);
  const ext = path.extname(matched).toLowerCase();
  const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);

  const taskId = crypto.randomUUID();
  const outExt = isImage ? ext : '.mp4';
  const outputPath = path.join(OUTPUT_DIR, `clean_${taskId}${outExt}`);

  const taskData = {
    taskId,
    status: 'Iniciando processamento com IA...',
    progress: 0.0,
    fps: 0.0,
    eta: '--:--:--',
    done: false,
    cancelled: false,
    error: null,
    outputPath,
    encoderInUse: engine,
    method,
    media_type: isImage ? 'image' : 'video',
    download_url: `/api/download/${taskId}`,
    result_url: `/api/result/${taskId}`
  };

  // Se for IMAGEM: processamento ultra-rápido com Gemini / WaveSpeed / Reconstrução Pixel a Pixel
  if (isImage) {
    tasks.set(taskId, { ...taskData });

    (async () => {
      try {
        broadcastProgress(taskId, { status: 'Analisando pixels e regenerando imagem com IA...', progress: 0.3 });
        const imgBuffer = fs.readFileSync(inputPath);
        const cfg = loadAiConfig();
        let cleanBuffer;

        if (method === 'wavespeed' && (cfg.wavespeed_api_key || process.env.WAVESPEED_API_KEY)) {
          const { WaveSpeedEngine } = await import('./core/wavespeed-engine.js');
          const ws = new WaveSpeedEngine(cfg.wavespeed_api_key || process.env.WAVESPEED_API_KEY);
          await ws.processMedia({
            filePath: inputPath,
            outputPath,
            mediaType: 'image',
            boxes
          });
        } else if (method === 'gemini' || (cfg.api_key && method === 'ai_inpaint')) {
          const { regenerateWithGemini } = await import('./core/pixel-reconstructor.js');
          cleanBuffer = await regenerateWithGemini({
            imageBuffer: imgBuffer,
            boxes,
            apiKey: cfg.api_key
          });
          fs.writeFileSync(outputPath, cleanBuffer);
        } else {
          const { reconstructExemplarPatches } = await import('./core/pixel-reconstructor.js');
          cleanBuffer = await reconstructExemplarPatches({
            imageBuffer: imgBuffer,
            boxes
          });
          fs.writeFileSync(outputPath, cleanBuffer);
        }

        broadcastProgress(taskId, {
          status: 'Imagem regenerada com sucesso!',
          progress: 1.0,
          done: true,
          taskId,
          media_type: 'image',
          download_url: `/api/download/${taskId}`,
          result_url: `/api/result/${taskId}`
        });
      } catch (err) {
        console.error(`Erro ao processar imagem ${taskId}:`, err);
        broadcastProgress(taskId, {
          status: 'Erro na regeneração da imagem',
          error: err.message,
          done: false
        });
      }
    })();

    return res.json({ task_id: taskId, is_image: true });
  }

  // Se for VÍDEO: executa através do WatermarkProcessor
  const processor = new WatermarkProcessor();
  tasks.set(taskId, { ...taskData, processor });

  (async () => {
    try {
      const result = await processor.runRemoval({
        inputVideo: inputPath,
        outputVideo: outputPath,
        watermarkBoxes: boxes,
        engine,
        method,
        quality,
        keepAudio: Boolean(keep_audio),
        upscaleFullhd: Boolean(upscale_fullhd),
        taskId,
        onProgress: (prog) => {
          broadcastProgress(taskId, {
            status: prog.status,
            progress: prog.progress,
            fps: prog.fps,
            eta: prog.eta,
            encoderInUse: prog.encoderInUse
          });
        }
      });

      if (result.cancelled) {
        broadcastProgress(taskId, {
          status: 'Processamento cancelado pelo usuário.',
          done: false,
          cancelled: true
        });
      } else if (result.success) {
        broadcastProgress(taskId, {
          status: 'Concluído com sucesso!',
          progress: 1.0,
          done: true,
          taskId,
          media_type: 'video',
          download_url: `/api/download/${taskId}`,
          result_url: `/api/result/${taskId}`,
          encoderInUse: result.encoderUsed || engine
        });
      }
    } catch (err) {
      console.error(`Erro na tarefa ${taskId}:`, err);
      broadcastProgress(taskId, {
        status: 'Erro no processamento',
        error: err.message,
        done: false
      });
    }
  })();

  return res.json({ task_id: taskId, is_image: false });
});

// 7.1 Endpoint direto para processamento de imagem
app.post('/api/process-image', async (req, res) => {
  const { video_id, boxes = [], method = 'gemini' } = req.body;
  if (!video_id) {
    return res.status(400).json({ error: 'video_id é obrigatório.' });
  }

  const files = fs.readdirSync(UPLOAD_DIR);
  const matched = files.find((f) => f.startsWith(video_id));
  if (!matched) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  const inputPath = path.join(UPLOAD_DIR, matched);
  const ext = path.extname(matched).toLowerCase() || '.jpg';
  const taskId = crypto.randomUUID();
  const outputPath = path.join(OUTPUT_DIR, `clean_${taskId}${ext}`);

  try {
    const imgBuffer = fs.readFileSync(inputPath);
    const cfg = loadAiConfig();
    let cleanBuffer;

    if (method === 'gemini') {
      const { regenerateWithGemini } = await import('./core/pixel-reconstructor.js');
      cleanBuffer = await regenerateWithGemini({
        imageBuffer: imgBuffer,
        boxes,
        apiKey: cfg.api_key
      });
    } else if (method === 'wavespeed' && (cfg.wavespeed_api_key || process.env.WAVESPEED_API_KEY)) {
      const { WaveSpeedEngine } = await import('./core/wavespeed-engine.js');
      const ws = new WaveSpeedEngine(cfg.wavespeed_api_key || process.env.WAVESPEED_API_KEY);
      await ws.processMedia({
        filePath: inputPath,
        outputPath,
        mediaType: 'image',
        boxes
      });
      cleanBuffer = fs.readFileSync(outputPath);
    } else {
      const { reconstructExemplarPatches } = await import('./core/pixel-reconstructor.js');
      cleanBuffer = await reconstructExemplarPatches({
        imageBuffer: imgBuffer,
        boxes
      });
    }

    if (!fs.existsSync(outputPath) && cleanBuffer) {
      fs.writeFileSync(outputPath, cleanBuffer);
    }

    const taskData = {
      taskId,
      status: 'Concluído com sucesso!',
      progress: 1.0,
      done: true,
      outputPath,
      media_type: 'image',
      download_url: `/api/download/${taskId}`,
      result_url: `/api/result/${taskId}`
    };
    tasks.set(taskId, taskData);

    return res.json({
      success: true,
      task_id: taskId,
      result_url: `/api/result/${taskId}`,
      download_url: `/api/download/${taskId}`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 8. Stream de Progresso em Tempo Real (SSE - Server-Sent Events)
app.get('/api/progress/:taskId/stream', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).send('Tarefa não encontrada.');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(taskId)) {
    sseClients.set(taskId, []);
  }
  sseClients.get(taskId).push(res);

  // Envia estado inicial imediatamente
  res.write(`data: ${JSON.stringify(task)}\n\n`);

  req.on('close', () => {
    const list = sseClients.get(taskId) || [];
    sseClients.set(taskId, list.filter((client) => client !== res));
  });
});

// 9. Progresso JSON (Fallback para polling)
app.get('/api/progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Tarefa não encontrada.' });
  }

  // Remove o processor da resposta JSON para evitar referências circulares
  const { processor, ...safeData } = task;
  return res.json(safeData);
});

// 10. Cancelar Tarefa
app.post('/api/cancel/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Tarefa não encontrada.' });
  }

  if (task.processor) {
    task.processor.cancel();
  }
  task.cancelled = true;
  task.status = 'Cancelamento solicitado...';
  broadcastProgress(taskId, task);

  return res.json({ success: true, message: 'Cancelamento enviado com sucesso.' });
});

// 11. Visualização e Streaming do Resultado Limpo Final (Preview Direto)
app.get('/api/result/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task || !task.done) {
    return res.status(404).send('Resultado ainda não disponível.');
  }

  const filePath = task.outputPath;
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Arquivo final não encontrado.');
  }

  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) {
    res.setHeader('Content-Type', 'image/jpeg');
  } else if (ext === '.png') {
    res.setHeader('Content-Type', 'image/png');
  } else if (ext === '.webp') {
    res.setHeader('Content-Type', 'image/webp');
  } else {
    res.setHeader('Content-Type', 'video/mp4');
  }

  return res.sendFile(filePath);
});

// 11.1 Baixar Vídeo ou Imagem Final
app.get('/api/download/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task || !task.done) {
    return res.status(400).send('Arquivo ainda não finalizado.');
  }

  const filePath = task.outputPath;
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Arquivo final não encontrado no disco.');
  }

  const ext = path.extname(filePath).toLowerCase() || '.mp4';
  const isImg = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);
  const defaultName = isImg ? `imagem_sem_marca_ia${ext}` : 'video_sem_marca_ia.mp4';

  return res.download(filePath, defaultName);
});

// 12. Obter Detalhes do Log do FFmpeg (para modal técnico)
app.get('/api/logs/:taskId', (req, res) => {
  const { taskId } = req.params;
  const safeId = path.basename(taskId);
  const logFile = path.join(LOGS_DIR, `ffmpeg-${safeId}.log`);

  if (!fs.existsSync(logFile)) {
    return res.status(404).json({ error: 'Log não encontrado para esta tarefa.' });
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    return res.json({ log: content });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 13. Configuração da IA (Gemini, WaveSpeed e Local)
app.get('/api/config', (req, res) => {
  const cfg = loadAiConfig();
  const maskedKey = cfg.api_key ? `${cfg.api_key.slice(0, 4)}...${cfg.api_key.slice(-4)}` : '';
  const maskedWsKey = cfg.wavespeed_api_key ? `${cfg.wavespeed_api_key.slice(0, 4)}...${cfg.wavespeed_api_key.slice(-4)}` : '';
  return res.json({
    provider: cfg.provider || 'gemini',
    model: cfg.model || 'gemini-3.8-flash',
    has_api_key: Boolean(cfg.api_key),
    masked_key: maskedKey,
    has_wavespeed_key: Boolean(cfg.wavespeed_api_key),
    masked_wavespeed_key: maskedWsKey
  });
});

app.post('/api/config', (req, res) => {
  const { provider, api_key, wavespeed_api_key, model } = req.body;
  const cfg = loadAiConfig();
  if (provider) cfg.provider = provider;
  if (model) cfg.model = model;
  if (typeof api_key === 'string' && api_key.trim()) {
    cfg.api_key = api_key.trim();
  }
  if (typeof wavespeed_api_key === 'string' && wavespeed_api_key.trim()) {
    cfg.wavespeed_api_key = wavespeed_api_key.trim();
  }
  saveAiConfig(cfg);
  return res.json({ success: true });
});

// 14. Buscar Metadados de Vídeo por URL (yt-dlp com proteção SSRF)
app.post('/api/remote-download/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL do vídeo é obrigatória.' });
  }

  try {
    const info = await getVideoInfo(url);
    return res.json({ success: true, info });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// 15. Iniciar Download por Link (com suporte a pipeline de download + limpeza)
app.post('/api/remote-download/start', async (req, res) => {
  const { url, formatSelector, autoProcess, boxes, method, hardwareEncoder } = req.body;

  try {
    await validateUrlAndCheckSSRF(url);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  const taskId = `dl_${Date.now()}`;
  const initialTask = {
    id: taskId,
    type: 'download',
    status: 'Iniciando download...',
    percent: 0,
    speed: '',
    eta: '',
    done: false,
    error: null,
    autoProcess: Boolean(autoProcess)
  };
  tasks.set(taskId, initialTask);

  // Execução assíncrona em segundo plano
  (async () => {
    try {
      broadcastProgress(taskId, {
        status: 'Conectando ao servidor e iniciando download...',
        percent: 2
      });

      const dlResult = await downloadVideo({
        url,
        formatSelector,
        taskId,
        outputDir: UPLOAD_DIR,
        onProgress: (p) => {
          broadcastProgress(taskId, {
            percent: p.percent,
            speed: p.speed,
            eta: p.eta,
            status: `Baixando vídeo: ${p.percent.toFixed(1)}% (${p.speed || '...'} - ETA: ${p.eta || '--'})`
          });
        }
      });

      const validation = await validateVideoFile(dlResult.filePath);
      if (!validation.valid) {
        throw new Error(`Vídeo baixado é inválido: ${validation.error}`);
      }

      const videoId = path.basename(dlResult.filename, path.extname(dlResult.filename));
      const ext = path.extname(dlResult.filename);
      const videoUrl = `/api/video/${videoId}${ext}`;

      if (autoProcess && Array.isArray(boxes) && boxes.length > 0) {
        // Pipeline contínuo: Baixar e já processar
        broadcastProgress(taskId, {
          status: 'Download concluído! Iniciando remoção automática de marca d\'água...',
          percent: 0,
          stage: 'processing'
        });

        const outputPath = path.join(OUTPUT_DIR, `output_${taskId}.mp4`);
        const processor = new WatermarkProcessor({
          inputPath: dlResult.filePath,
          outputPath,
          watermarkBoxes: boxes,
          method: method || 'ai_inpaint',
          hardwareEncoder: hardwareEncoder || 'auto',
          taskId,
          onProgress: (percent, status) => {
            broadcastProgress(taskId, {
              percent,
              status: `Processando vídeo: ${percent}% - ${status || ''}`,
              stage: 'processing'
            });
          }
        });

        const currentTask = tasks.get(taskId);
        if (currentTask) currentTask.processor = processor;

        const result = await processor.process();
        if (result.success) {
          broadcastProgress(taskId, {
            status: 'Vídeo baixado e processado com sucesso!',
            percent: 100,
            done: true,
            stage: 'completed',
            outputPath: result.outputPath,
            download_url: `/api/download/${taskId}`,
            encoderUsed: result.encoderUsed
          });
        } else {
          throw new Error(result.error || 'Falha no processamento');
        }
      } else {
        // Modo normal: baixa e disponibiliza para visualização e edição imediata
        broadcastProgress(taskId, {
          status: 'Download concluído com sucesso!',
          percent: 100,
          done: true,
          readyForEditing: true,
          video_id: videoId,
          video_url: videoUrl,
          metadata: validation.metadata,
          filename: dlResult.filename
        });
      }
    } catch (err) {
      console.error(`Erro no download/pipeline da tarefa ${taskId}:`, err);
      broadcastProgress(taskId, {
        status: 'Erro no download',
        error: err.message,
        done: false
      });
    }
  })();

  return res.json({ success: true, task_id: taskId });
});

// 16. Atualizar Binário do yt-dlp
app.post('/api/remote-download/update-bin', async (req, res) => {
  try {
    const result = await updateYtDlpBinary();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 17. Fallback para rotas /api não mapeadas (garante retorno JSON e evita HTML 404)
app.use('/api', (req, res) => {
  return res.status(404).json({
    success: false,
    error: `Rota da API não encontrada: ${req.method} ${req.originalUrl || req.url}`
  });
});

// Inicialização do Servidor (executado apenas fora de ambientes serverless como Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, HOST, async () => {
    console.log('\n============================================================');
    console.log(` 🌐 Servidor Web MarcaRemoveIA Node.js (ESM) ativo:`);
    console.log(` 👉 http://${HOST}:${PORT}`);
    console.log('============================================================\n');

    // Detecta encoders em segundo plano logo no início
    try {
      const hw = await detectHardwareEncoders();
      console.log(`[Hardware] Encoders detectados: ${hw.availableEncoders.join(', ') || 'nenhum'}`);
      console.log(`[Hardware] Encoder primário: ${hw.primaryEncoder}`);
    } catch (e) {
      console.warn('[Hardware] Aviso ao detectar encoders:', e.message);
    }
  });
}

export default app;
