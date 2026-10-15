import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

import {
  createWatermarkMask,
  findWatermarkByImage,
  generateFramePreview,
  dilateMask
} from '../src/core/template-matcher.js';
import { getFfmpegBinary, spawnPromise } from '../src/utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');

test('Template Matcher: Criação e dilatação de máscara alpha', async () => {
  // Cria imagem transparente 60x60 com um círculo opaco no centro
  const svg = `<svg width="60" height="60" xmlns="http://www.w3.org/2000/svg">
    <circle cx="30" cy="30" r="20" fill="red" />
  </svg>`;

  const pngBuf = await sharp(Buffer.from(svg)).png().toBuffer();
  const mask = await createWatermarkMask(pngBuf, 3);

  assert.equal(mask.width, 60);
  assert.equal(mask.height, 60);
  assert.equal(mask.hasAlpha, true);
  assert.ok(mask.maskPng.length > 100);

  // Testa função unitária dilateMask
  const raw = Buffer.alloc(100);
  raw[55] = 255; // Ponto no centro de 10x10
  const dilated = dilateMask(raw, 10, 10, 2);
  assert.equal(dilated[55], 255);
  // Vizinho imediato deve ter sido dilatado
  assert.equal(dilated[54], 255);
  assert.equal(dilated[56], 255);
});

test('Template Matcher: Localização por Imagem em Vídeo Sintético', async () => {
  const videoPath = path.join(testsDir, 'synthetic_watermark.mp4');
  assert.ok(fs.existsSync(videoPath), 'Vídeo sintético deve existir');

  // Cria template correspondente ao retângulo vermelho no canto do vídeo (450, 30, 160, 50)
  const templateImg = await sharp({
    create: {
      width: 160,
      height: 50,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 }
    }
  }).png().toBuffer();

  const result = await findWatermarkByImage({
    videoPath,
    templateBuffer: templateImg,
    sampleCount: 3
  });

  assert.ok(result.medianBox, 'Deve retornar medianBox');
  // Tolerância de posição: espera ~450, ~30
  assert.ok(Math.abs(result.medianBox.x - 450) < 30, `X detectado (${result.medianBox.x}) deve ser próximo de 450`);
  assert.ok(Math.abs(result.medianBox.y - 30) < 20, `Y detectado (${result.medianBox.y}) deve ser próximo de 30`);
  assert.ok(result.allMatches.length > 0, 'Deve ter amostras registradas');
});

test('Template Matcher: Geração de Prévia de 1 Frame', async () => {
  const videoPath = path.join(testsDir, 'synthetic_watermark.mp4');
  const preview = await generateFramePreview({
    videoPath,
    timestamp: 0.5,
    boxes: [{ x: 450, y: 30, w: 160, h: 50 }]
  });

  assert.ok(Buffer.isBuffer(preview), 'Prévia deve ser um buffer');
  assert.ok(preview.length > 1000, 'Prévia deve conter dados de imagem JPEG');

  const meta = await sharp(preview).metadata();
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 360);
  assert.equal(meta.format, 'jpeg');
});
