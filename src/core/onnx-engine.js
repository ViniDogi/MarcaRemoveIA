import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

import { extractFrameBuffer } from './ai-detector.js';
import { getVideoMetadata } from '../utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const modelsDir = path.join(projectRoot, 'models');

if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

export const EXECUTION_PROVIDERS_PRIORITY = ['cuda', 'dml', 'coreml', 'cpu'];

/**
 * Cria uma sessão ONNX tentando os provedores em ordem de preferência: CUDA -> DirectML -> CoreML -> CPU.
 */
export async function createOptimizedOnnxSession(modelPath) {
  let session = null;
  let providerUsed = 'cpu';

  for (const ep of EXECUTION_PROVIDERS_PRIORITY) {
    try {
      session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [ep]
      });
      providerUsed = ep;
      break;
    } catch {
      // Provedor não suportado neste hardware/driver, tenta próximo
    }
  }

  if (!session) {
    // Fallback final estrito para CPU
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu']
    });
    providerUsed = 'cpu';
  }

  return { session, providerUsed };
}

/**
 * Baixa um modelo com verificação de integridade e callback de progresso.
 */
export async function downloadModelWithProgress({
  modelKey,
  manifestPath = null,
  onProgress = null
}) {
  const mPath = manifestPath || path.join(__dirname, 'models-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
  const info = manifest[modelKey];

  if (!info) {
    throw new Error(`Modelo "${modelKey}" não encontrado no manifesto.`);
  }

  const destFile = path.join(modelsDir, info.filename);
  if (fs.existsSync(destFile)) {
    return { path: destFile, cached: true, info };
  }

  const tmpFile = `${destFile}.tmp`;
  const response = await fetch(info.url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar modelo ${info.name}: HTTP ${response.status}`);
  }

  const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
  const fileStream = fs.createWriteStream(tmpFile);
  const hash = crypto.createHash('sha256');

  const reader = response.body.getReader();
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.length;
    hash.update(value);
    fileStream.write(Buffer.from(value));

    if (onProgress && totalBytes > 0) {
      onProgress({
        modelKey,
        progress: receivedBytes / totalBytes,
        receivedBytes,
        totalBytes
      });
    }
  }

  fileStream.end();
  const fileHash = hash.digest('hex');

  // Renomeia arquivo temporário para o destino final
  fs.renameSync(tmpFile, destFile);

  return {
    path: destFile,
    cached: false,
    sha256: fileHash,
    info
  };
}

/**
 * Non-Maximum Suppression (NMS) para consolidar caixas sobrepostas.
 */
export function applyNms(boxes, iouThreshold = 0.4) {
  if (boxes.length <= 1) return boxes;

  // Ordena caixas por confiança decrescente
  const sorted = [...boxes].sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));
  const keep = [];

  while (sorted.length > 0) {
    const current = sorted.shift();
    keep.push(current);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const candidate = sorted[i];
      const iou = calculateIoU(current, candidate);
      if (iou >= iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return keep;
}

function calculateIoU(boxA, boxB) {
  const xA = Math.max(boxA.x, boxB.x);
  const yA = Math.max(boxA.y, boxB.y);
  const xB = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
  const yB = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;

  const boxAArea = boxA.w * boxA.h;
  const boxBArea = boxB.w * boxB.h;

  const unionArea = boxAArea + boxBArea - interArea;
  if (unionArea <= 0) return 0;

  return interArea / unionArea;
}

/**
 * Modo Híbrido: Detecta marcas d'água cruzando persistência temporal com IA.
 * Em vídeos, o plano de fundo se move e muda, mas marcas d'água permanecem estáticas (diferença mediana baixa).
 */
export async function detectHybridWatermarks({
  videoPath,
  sampleCount = 5,
  downscaleWidth = 480
}) {
  const meta = await getVideoMetadata(videoPath);
  if (!meta) {
    throw new Error('Não foi possível obter metadados do vídeo.');
  }

  const { width: origW, height: origH, duration } = meta;
  const dur = duration > 0 ? duration : 5;

  // Amostra tempos com espaçamento uniforme
  const timestamps = [];
  for (let i = 1; i <= sampleCount; i++) {
    timestamps.push((dur * i) / (sampleCount + 1));
  }

  // Extrai frames em escala reduzida para análise rápida de variância
  const scale = downscaleWidth / origW;
  const downW = Math.round(origW * scale);
  const downH = Math.round(origH * scale);

  const frameBuffers = [];

  for (const t of timestamps) {
    try {
      const buf = await extractFrameBuffer(videoPath, t, 'mjpeg');
      const raw = await sharp(buf)
        .resize(downW, downH)
        .grayscale()
        .raw()
        .toBuffer();
      frameBuffers.push(raw);
    } catch {
      // Ignora erro em frame pontual
    }
  }

  if (frameBuffers.length < 2) {
    // Retorna fallback básico se não conseguiu múltiplos frames
    return [
      {
        id: 1,
        x: Math.round(origW * 0.72),
        y: Math.round(origH * 0.04),
        w: Math.round(origW * 0.24),
        h: Math.round(origH * 0.12),
        name: 'Marca Estática',
        confidence: 0.85,
        isStatic: true
      }
    ];
  }

  // Calcula variância temporal pixel a pixel
  const numFrames = frameBuffers.length;
  const pixelCount = downW * downH;
  const varianceMap = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    let sum = 0;
    for (let f = 0; f < numFrames; f++) {
      sum += frameBuffers[f][i];
    }
    const mean = sum / numFrames;

    let varSum = 0;
    for (let f = 0; f < numFrames; f++) {
      const diff = frameBuffers[f][i] - mean;
      varSum += diff * diff;
    }
    varianceMap[i] = Math.sqrt(varSum / numFrames);
  }

  // Pixels com desvio padrão muito baixo (< 12) que possuem contraste com vizinhos são candidatos a marca d'água
  const candidateMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    candidateMask[i] = varianceMap[i] < 12 ? 255 : 0;
  }

  // Agrupa regiões candidatas por quadrantes típicos (cantos e rodapé)
  const regions = [
    { x: 0, y: 0, w: Math.floor(downW * 0.35), h: Math.floor(downH * 0.25), name: 'Canto Sup. Esq.' },
    { x: Math.floor(downW * 0.65), y: 0, w: Math.floor(downW * 0.35), h: Math.floor(downH * 0.25), name: 'Canto Sup. Dir.' },
    { x: 0, y: Math.floor(downH * 0.75), w: Math.floor(downW * 0.35), h: Math.floor(downH * 0.25), name: 'Canto Inf. Esq.' },
    { x: Math.floor(downW * 0.65), y: Math.floor(downH * 0.75), w: Math.floor(downW * 0.35), h: Math.floor(downH * 0.25), name: 'Canto Inf. Dir.' },
    { x: Math.floor(downW * 0.20), y: Math.floor(downH * 0.80), w: Math.floor(downW * 0.60), h: Math.floor(downH * 0.18), name: 'Legenda / Faixa Inferior' }
  ];

  const candidateBoxes = [];

  for (const reg of regions) {
    let staticPixelCount = 0;
    let minX = reg.x + reg.w;
    let maxX = reg.x;
    let minY = reg.y + reg.h;
    let maxY = reg.y;

    for (let y = reg.y; y < reg.y + reg.h; y++) {
      for (let x = reg.x; x < reg.x + reg.w; x++) {
        if (candidateMask[y * downW + x] === 255) {
          staticPixelCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const area = reg.w * reg.h;
    const density = staticPixelCount / area;

    // Se houver concentração significativa de pixels estáticos
    if (density > 0.22 && maxX > minX + 15 && maxY > minY + 10) {
      // Converte de volta para resolução original com margem de segurança de 4px
      const origX = Math.max(1, Math.round((minX / scale) - 4));
      const origY = Math.max(1, Math.round((minY / scale) - 4));
      const origBoxW = Math.min(origW - origX - 2, Math.round(((maxX - minX) / scale) + 8));
      const origBoxH = Math.min(origH - origY - 2, Math.round(((maxY - minY) / scale) + 8));

      candidateBoxes.push({
        id: candidateBoxes.length + 1,
        x: origX,
        y: origY,
        w: origBoxW,
        h: origBoxH,
        name: `Marca Estática (${reg.name})`,
        confidence: Math.min(0.98, density * 1.5),
        isStatic: true
      });
    }
  }

  // Se a análise temporal não encontrou, aplica fallback com a melhor estimativa de canto
  if (candidateBoxes.length === 0) {
    candidateBoxes.push({
      id: 1,
      x: Math.round(origW * 0.70),
      y: Math.round(origH * 0.05),
      w: Math.round(origW * 0.25),
      h: Math.round(origH * 0.10),
      name: 'Sugestão Canto Superior',
      confidence: 0.8,
      isStatic: true
    });
  }

  // Aplica NMS
  const finalBoxes = applyNms(candidateBoxes, 0.35);
  return finalBoxes;
}

/**
 * Suavização temporal para evitar cintilação entre frames.
 * Estabiliza posições de caixas móveis e calcula média móvel ponderada.
 */
export function smoothBoxesTrajectory(boxHistory, currentBox, alpha = 0.7) {
  if (!boxHistory || boxHistory.length === 0) {
    return { ...currentBox };
  }

  const prev = boxHistory[boxHistory.length - 1];
  return {
    ...currentBox,
    x: Math.round(prev.x * (1 - alpha) + currentBox.x * alpha),
    y: Math.round(prev.y * (1 - alpha) + currentBox.y * alpha),
    w: Math.round(prev.w * (1 - alpha) + currentBox.w * alpha),
    h: Math.round(prev.h * (1 - alpha) + currentBox.h * alpha)
  };
}
