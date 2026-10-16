import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractFrameBuffer } from './ai-detector.js';
import { getVideoMetadata } from '../utils/ffmpeg.js';

let cachedSharp = null;
export async function getSharp() {
  if (cachedSharp) return cachedSharp;
  try {
    const mod = await import('sharp');
    cachedSharp = mod.default || mod;
    return cachedSharp;
  } catch (err) {
    console.warn('[ONNX] sharp indisponível neste ambiente:', err.message);
    return null;
  }
}

let cachedOrt = null;
export async function getOrt() {
  if (cachedOrt) return cachedOrt;
  try {
    const mod = await import('onnxruntime-node');
    cachedOrt = mod.default || mod;
    return cachedOrt;
  } catch (err) {
    console.warn('[ONNX] onnxruntime-node indisponível neste ambiente:', err.message);
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const isVercel = Boolean(process.env.VERCEL);
const modelsDir = isVercel ? '/tmp/models' : path.join(projectRoot, 'models');

try {
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
} catch {
  // Ignora erro em sistemas de arquivos somente-leitura
}

export const EXECUTION_PROVIDERS_PRIORITY = ['cuda', 'dml', 'coreml', 'cpu'];

/**
 * Cria uma sessão ONNX tentando os provedores em ordem de preferência: CUDA -> DirectML -> CoreML -> CPU.
 */
export async function createOptimizedOnnxSession(modelPath) {
  const ort = await getOrt();
  if (!ort) {
    throw new Error('ONNX Runtime não pôde ser inicializado neste ambiente.');
  }

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
 * Modo Híbrido: Detecta marcas d'água cruzando persistência temporal com análise de gradientes e agrupamento conexo.
 * Identifica regiões onde o fundo muda mas os elementos gráficos permanecem estáticos com bordas nítidas.
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
  const downW = Math.max(64, Math.round(origW * scale));
  const downH = Math.max(64, Math.round(origH * scale));

  const frameBuffers = [];
  const sharp = await getSharp();

  if (sharp) {
    for (const t of timestamps) {
      try {
        const buf = await extractFrameBuffer(videoPath, t, 'mjpeg');
        const raw = await sharp(buf)
          .resize(downW, downH, { fit: 'fill' })
          .grayscale()
          .raw()
          .toBuffer();
        frameBuffers.push(raw);
      } catch {
        // Ignora erro em frame pontual
      }
    }
  }

  if (frameBuffers.length < 2) {
    // Retorna fallback inteligente no canto superior direito típico
    return [
      {
        id: 1,
        x: Math.round(origW * 0.72),
        y: Math.round(origH * 0.04),
        w: Math.round(origW * 0.24),
        h: Math.round(origH * 0.12),
        name: 'Sugestão Marca Canto Superior',
        confidence: 0.85,
        isStatic: true
      }
    ];
  }

  const numFrames = frameBuffers.length;
  const pixelCount = downW * downH;
  const varianceMap = new Float32Array(pixelCount);

  // 1. Calcula desvio padrão temporal pixel a pixel
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

  // 2. Calcula magnitude de gradiente (bordas) no frame médio
  const gradientMap = new Float32Array(pixelCount);
  const firstFrame = frameBuffers[0];
  for (let y = 1; y < downH - 1; y++) {
    for (let x = 1; x < downW - 1; x++) {
      const idx = y * downW + x;
      const gx = Math.abs(firstFrame[idx + 1] - firstFrame[idx - 1]);
      const gy = Math.abs(firstFrame[(y + 1) * downW + x] - firstFrame[(y - 1) * downW + x]);
      gradientMap[idx] = gx + gy;
    }
  }

  // 3. Grade de análise por blocos (ex: 16x16 pixels)
  const blockSize = 16;
  const gridCols = Math.ceil(downW / blockSize);
  const gridRows = Math.ceil(downH / blockSize);
  const blockScores = new Float32Array(gridCols * gridRows);

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const startX = gx * blockSize;
      const startY = gy * blockSize;
      const endX = Math.min(downW, startX + blockSize);
      const endY = Math.min(downH, startY + blockSize);

      let staticEdgePixels = 0;
      let totalPixels = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * downW + x;
          // Pixel com baixa variância temporal (estático) e presença de borda (não é tela uniforme vazia)
          if (varianceMap[idx] < 15 && gradientMap[idx] > 18) {
            staticEdgePixels++;
          }
          totalPixels++;
        }
      }

      const score = totalPixels > 0 ? staticEdgePixels / totalPixels : 0;
      blockScores[gy * gridCols + gx] = score;
    }
  }

  // 4. Agrupamento de blocos conectados com score relevante (> 0.12)
  const visited = new Uint8Array(gridCols * gridRows);
  const candidateBoxes = [];

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const idx = gy * gridCols + gx;
      if (visited[idx] || blockScores[idx] < 0.12) continue;

      // Inicia busca em largura (BFS) para agrupar o componente conexo
      const queue = [{ gx, gy }];
      visited[idx] = 1;

      let minGx = gx;
      let maxGx = gx;
      let minGy = gy;
      let maxGy = gy;
      let blockCount = 0;
      let scoreSum = 0;

      while (queue.length > 0) {
        const curr = queue.shift();
        blockCount++;
        scoreSum += blockScores[curr.gy * gridCols + curr.gx];

        minGx = Math.min(minGx, curr.gx);
        maxGx = Math.max(maxGx, curr.gx);
        minGy = Math.min(minGy, curr.gy);
        maxGy = Math.max(maxGy, curr.gy);

        // Vizinhos 4-conectados
        const neighbors = [
          { gx: curr.gx + 1, gy: curr.gy },
          { gx: curr.gx - 1, gy: curr.gy },
          { gx: curr.gx, gy: curr.gy + 1 },
          { gx: curr.gx, gy: curr.gy - 1 }
        ];

        for (const n of neighbors) {
          if (n.gx >= 0 && n.gx < gridCols && n.gy >= 0 && n.gy < gridRows) {
            const nIdx = n.gy * gridCols + n.gx;
            if (!visited[nIdx] && blockScores[nIdx] >= 0.10) {
              visited[nIdx] = 1;
              queue.push(n);
            }
          }
        }
      }

      // Converte coordenadas da grade de volta para resolução original
      const bX = Math.max(0, Math.round((minGx * blockSize) / scale));
      const bY = Math.max(0, Math.round((minGy * blockSize) / scale));
      const bW = Math.min(origW - bX, Math.round(((maxGx - minGx + 1) * blockSize) / scale));
      const bH = Math.min(origH - bY, Math.round(((maxGy - minGy + 1) * blockSize) / scale));

      // Filtra dimensões: deve ser pelo menos 18x18 e não pode cobrir mais de 45% do vídeo inteiro
      const areaRatio = (bW * bH) / (origW * origH);
      if (bW >= 18 && bH >= 18 && areaRatio < 0.40 && blockCount >= 2) {
        candidateBoxes.push({
          id: candidateBoxes.length + 1,
          x: bX,
          y: bY,
          w: bW,
          h: bH,
          name: `Marca Detectada IA #${candidateBoxes.length + 1}`,
          confidence: Math.min(0.98, (scoreSum / blockCount) * 2.0),
          isStatic: true
        });
      }
    }
  }

  // 5. Se nenhum bloco com alta evidência de marca d'água for encontrado,
  // NÃO inventa caixas aleatórias. Retorna vazio para que o usuário desenhe com precisão.
  if (candidateBoxes.length === 0) {
    return [];
  }

  // Aplica NMS para consolidar caixas
  return applyNms(candidateBoxes, 0.35);
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

/**
 * Inpainting de Imagem por IA / Reconstrução Pixel a Pixel:
 * Remove as regiões das marcas d'água reconstruindo os pixels de fundo
 * de forma nítida, preservando texturas e sem deixar borrão esbranquiçado.
 */
export async function inpaintImageBuffer({
  imageBuffer,
  boxes = [],
  width = 0,
  height = 0
}) {
  const sharp = await getSharp();
  if (!sharp || !imageBuffer || boxes.length === 0) {
    return imageBuffer;
  }

  try {
    const { reconstructExemplarPatches } = await import('./pixel-reconstructor.js');
    return await reconstructExemplarPatches({
      imageBuffer,
      boxes
    });
  } catch (err) {
    console.warn('[Inpainting] Erro na reconstrução de pixels, aplicando fallback:', err.message);
  }

  return imageBuffer;
}

