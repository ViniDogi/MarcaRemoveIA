import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { extractFrameBuffer } from './ai-detector.js';
import { getVideoMetadata, getFfmpegBinary, spawnPromise } from '../utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const uploadsDir = path.join(projectRoot, 'web_uploads');

/**
 * Dilata uma máscara binária (valores 0 e 255) por N pixels para cobrir halos da marca d'água.
 */
export function dilateMask(rawPixels, width, height, radius = 3) {
  const dilated = Buffer.alloc(rawPixels.length);
  dilated.fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (rawPixels[idx] > 50) {
        // Marca vizinhança dentro do raio
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            if (dx * dx + dy * dy <= radius * radius) {
              dilated[ny * width + nx] = 255;
            }
          }
        }
      }
    }
  }

  return dilated;
}

/**
 * Cria a máscara a partir do canal alpha da imagem de template ou de seus contornos.
 */
export async function createWatermarkMask(templateBuffer, radius = 3) {
  const metadata = await sharp(templateBuffer).metadata();
  const { width, height, channels, hasAlpha } = metadata;

  let maskRaw;
  if (hasAlpha) {
    // Extrai o canal alpha
    const alphaRaw = await sharp(templateBuffer)
      .extractChannel(channels - 1)
      .raw()
      .toBuffer();
    maskRaw = dilateMask(alphaRaw, width, height, radius);
  } else {
    // Para imagens sem transparência (JPG), binariza invertendo luminosidade ou detectando bordas
    const gray = await sharp(templateBuffer)
      .grayscale()
      .raw()
      .toBuffer();

    const thresh = Buffer.alloc(width * height);
    for (let i = 0; i < gray.length; i++) {
      // Considera pixels não-brancos ou com contraste significativo como marca
      thresh[i] = gray[i] < 240 ? 255 : 0;
    }
    maskRaw = dilateMask(thresh, width, height, radius);
  }

  // Gera PNG da máscara dilatada
  const maskPng = await sharp(maskRaw, {
    raw: { width, height, channels: 1 }
  })
    .png()
    .toBuffer();

  return {
    width,
    height,
    maskPng,
    hasAlpha: Boolean(hasAlpha)
  };
}

/**
 * Template matching 2D em escala de cinza normalizada com busca em grade rápida.
 */
function matchTemplateSingleScale(frameData, frameW, frameH, templData, templW, templH, step = 2) {
  if (templW >= frameW || templH >= frameH) {
    return { x: 0, y: 0, score: Infinity };
  }

  let minDiff = Infinity;
  let bestX = 0;
  let bestY = 0;

  // Amostragem de pontos do template (máx 600 pontos para velocidade ultra rápida)
  const samplePoints = [];
  const ptStepX = Math.max(1, Math.floor(templW / 24));
  const ptStepY = Math.max(1, Math.floor(templH / 24));

  for (let ty = 0; ty < templH; ty += ptStepY) {
    for (let tx = 0; tx < templW; tx += ptStepX) {
      const val = templData[ty * templW + tx];
      samplePoints.push({ tx, ty, val });
    }
  }

  const numPoints = samplePoints.length;
  if (numPoints === 0) return { x: 0, y: 0, score: Infinity };

  // Busca na imagem do frame
  const maxX = frameW - templW;
  const maxY = frameH - templH;

  for (let y = 0; y <= maxY; y += step) {
    for (let x = 0; x <= maxX; x += step) {
      let diffSum = 0;
      for (let i = 0; i < numPoints; i++) {
        const pt = samplePoints[i];
        const fVal = frameData[(y + pt.ty) * frameW + (x + pt.tx)];
        diffSum += Math.abs(fVal - pt.val);
      }

      const avgDiff = diffSum / numPoints;
      if (avgDiff < minDiff) {
        minDiff = avgDiff;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY, score: minDiff };
}

/**
 * Localiza a marca d'água no vídeo via Template Matching Multi-escala em múltiplos frames.
 */
export async function findWatermarkByImage({
  videoPath,
  templateBuffer,
  sampleCount = 5,
  isMobile = false
}) {
  const meta = await getVideoMetadata(videoPath);
  if (!meta) {
    throw new Error('Não foi possível ler os metadados do vídeo.');
  }

  const templMeta = await sharp(templateBuffer).metadata();
  const origTemplW = templMeta.width;
  const origTemplH = templMeta.height;

  // Escalas a testar: 0.7x, 0.85x, 1.0x, 1.15x, 1.3x
  const scales = [1.0, 0.85, 1.15, 0.7, 1.3];
  const scaledTemplates = [];

  for (const s of scales) {
    const sw = Math.round(origTemplW * s);
    const sh = Math.round(origTemplH * s);
    if (sw > 15 && sh > 15 && sw < meta.width && sh < meta.height) {
      const buf = await sharp(templateBuffer)
        .resize(sw, sh)
        .grayscale()
        .raw()
        .toBuffer();
      scaledTemplates.push({ scale: s, width: sw, height: sh, data: buf });
    }
  }

  if (scaledTemplates.length === 0) {
    scaledTemplates.push({
      scale: 1.0,
      width: origTemplW,
      height: origTemplH,
      data: await sharp(templateBuffer).grayscale().raw().toBuffer()
    });
  }

  // Amostra tempos ao longo do vídeo
  const duration = meta.duration || 5;
  const sampleTimes = [];
  for (let i = 1; i <= sampleCount; i++) {
    sampleTimes.push((duration * i) / (sampleCount + 1));
  }

  const matches = [];

  for (const t of sampleTimes) {
    try {
      const frameJpg = await extractFrameBuffer(videoPath, t, 'mjpeg');
      const frameRaw = await sharp(frameJpg)
        .resize(meta.width, meta.height)
        .grayscale()
        .raw()
        .toBuffer();

      let bestMatchForFrame = null;
      let lowestScore = Infinity;

      for (const tpl of scaledTemplates) {
        const res = matchTemplateSingleScale(
          frameRaw,
          meta.width,
          meta.height,
          tpl.data,
          tpl.width,
          tpl.height,
          3 // passo de busca de 3px para agilidade
        );

        if (res.score < lowestScore) {
          lowestScore = res.score;
          bestMatchForFrame = {
            time: t,
            x: res.x,
            y: res.y,
            w: tpl.width,
            h: tpl.height,
            scale: tpl.scale,
            score: res.score
          };
        }
      }

      if (bestMatchForFrame) {
        matches.push(bestMatchForFrame);
      }
    } catch {
      // Ignora falha de amostragem em frame isolado
    }
  }

  if (matches.length === 0) {
    throw new Error('Não foi possível localizar correspondência da marca d\'água no vídeo.');
  }

  // Posição mediana (mais robusta contra variações de fundo e cortes de cena)
  const sortedX = [...matches.map((m) => m.x)].sort((a, b) => a - b);
  const sortedY = [...matches.map((m) => m.y)].sort((a, b) => a - b);
  const sortedW = [...matches.map((m) => m.w)].sort((a, b) => a - b);
  const sortedH = [...matches.map((m) => m.h)].sort((a, b) => a - b);

  const mid = Math.floor(sortedX.length / 2);
  const medianBox = {
    x: sortedX[mid],
    y: sortedY[mid],
    w: sortedW[mid],
    h: sortedH[mid],
    name: 'Marca por Imagem',
    isMobile
  };

  // Gera máscara correspondente ao tamanho da caixa detectada
  const maskInfo = await createWatermarkMask(templateBuffer, 4);

  return {
    medianBox,
    allMatches: matches,
    maskInfo
  };
}

/**
 * Gera prévia de 1 frame do vídeo com o filtro de remoção aplicado.
 */
export async function generateFramePreview({
  videoPath,
  timestamp = 0,
  boxes = []
}) {
  const meta = await getVideoMetadata(videoPath);
  if (!meta) {
    throw new Error('Vídeo não encontrado para gerar prévia.');
  }

  const ffmpegExe = getFfmpegBinary();
  const filters = [];

  for (const b of boxes) {
    let x = Math.round(Number(b.x) || 0);
    let y = Math.round(Number(b.y) || 0);
    let w = Math.round(Number(b.w) || 10);
    let h = Math.round(Number(b.h) || 10);

    x = Math.max(1, Math.min(x, meta.width - 3));
    y = Math.max(1, Math.min(y, meta.height - 3));
    w = Math.max(2, Math.min(w, meta.width - x - 1));
    h = Math.max(2, Math.min(h, meta.height - y - 1));

    filters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
  }

  const vf = filters.length > 0 ? filters.join(',') : 'null';

  const previewId = `preview_${Date.now()}.jpg`;
  const outPath = path.join(uploadsDir, previewId);

  const args = [
    '-y',
    '-ss', timestamp.toString(),
    '-i', videoPath,
    '-vf', vf,
    '-vframes', '1',
    '-f', 'image2',
    outPath
  ];

  const { code } = await spawnPromise(ffmpegExe, args);
  if (code !== 0 || !fs.existsSync(outPath)) {
    throw new Error('Falha ao gerar o frame de prévia.');
  }

  const buffer = fs.readFileSync(outPath);
  try { fs.unlinkSync(outPath); } catch {}

  return buffer;
}
