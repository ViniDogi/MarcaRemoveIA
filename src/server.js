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
  detectHybridWatermarks
} from './core/onnx-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const UPLOAD_DIR = path.join(projectRoot, 'web_uploads');
const OUTPUT_DIR = path.join(projectRoot, 'web_outputs');
const LOGS_DIR = path.join(projectRoot, 'logs');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

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

// 1. Página Principal
app.get('/', (req, res) => {
  const htmlPath = path.join(projectRoot, 'templates', 'index.html');
  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath);
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
  const { video_id, timestamp = 0, boxes = [] } = req.body;
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
    const previewBuffer = await generateFramePreview({
      videoPath,
      timestamp: parseFloat(timestamp) || 0,
      boxes
    });

    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(previewBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 7. Iniciar Processamento
app.post('/api/process', async (req, res) => {
  const {
    video_id,
    boxes = [],
    engine = 'auto',
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
    return res.status(404).json({ error: 'Vídeo não encontrado.' });
  }

  const inputPath = path.join(UPLOAD_DIR, matched);
  const taskId = crypto.randomUUID();
  const outputPath = path.join(OUTPUT_DIR, `clean_${taskId}.mp4`);

  const taskData = {
    taskId,
    status: 'Iniciando processamento...',
    progress: 0.0,
    fps: 0.0,
    eta: '--:--:--',
    done: false,
    cancelled: false,
    error: null,
    outputPath,
    encoderInUse: engine
  };

  const processor = new WatermarkProcessor();
  tasks.set(taskId, { ...taskData, processor });

  // Executa processamento em background assíncrono
  (async () => {
    try {
      const result = await processor.runRemoval({
        inputVideo: inputPath,
        outputVideo: outputPath,
        watermarkBoxes: boxes,
        engine,
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
          encoderInUse: result.encoderUsed
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

  return res.json({ task_id: taskId });
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

// 11. Baixar Vídeo Final
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

  return res.download(filePath, 'video_sem_marca_ia.mp4');
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

// 13. Configuração da IA
app.get('/api/config', (req, res) => {
  const cfg = loadAiConfig();
  // Não envia a chave inteira de volta em texto aberto para segurança
  const maskedKey = cfg.api_key ? `${cfg.api_key.slice(0, 4)}...${cfg.api_key.slice(-4)}` : '';
  return res.json({
    provider: cfg.provider,
    model: cfg.model,
    has_api_key: Boolean(cfg.api_key),
    masked_key: maskedKey
  });
});

app.post('/api/config', (req, res) => {
  const { provider, api_key } = req.body;
  const cfg = loadAiConfig();
  if (provider) cfg.provider = provider;
  if (typeof api_key === 'string' && api_key.trim()) {
    cfg.api_key = api_key.trim();
  }
  saveAiConfig(cfg);
  return res.json({ success: true });
});

// Inicialização do Servidor
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
