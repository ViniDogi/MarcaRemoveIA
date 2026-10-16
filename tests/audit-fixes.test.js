import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WatermarkProcessor } from '../src/core/processor.js';
import { inpaintImageBuffer } from '../src/core/onnx-engine.js';
import { parseJsonBoxes } from '../src/core/ai-detector.js';
import { ensureSyntheticVideo } from './ensure-test-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = __dirname;

test('Auditoria: Suporte a múltiplos métodos de remoção (ai_inpaint, delogo, blur)', async () => {
  await ensureSyntheticVideo();
  const inputVideo = path.join(testsDir, 'synthetic_watermark.mp4');
  const outputVideo = path.join(testsDir, 'test_output_ai_inpaint.mp4');

  if (fs.existsSync(outputVideo)) {
    try { fs.unlinkSync(outputVideo); } catch {}
  }

  const processor = new WatermarkProcessor();
  const res = await processor.runRemoval({
    inputVideo,
    outputVideo,
    watermarkBoxes: [{ x: 450, y: 30, w: 160, h: 50 }],
    method: 'ai_inpaint',
    engine: 'libx264',
    keepAudio: false
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(outputVideo));
  assert.ok(fs.statSync(outputVideo).size > 1000);

  try { fs.unlinkSync(outputVideo); } catch {}
});

test('Auditoria: Compatibilidade do alias processor.process()', async () => {
  await ensureSyntheticVideo();
  const inputVideo = path.join(testsDir, 'synthetic_watermark.mp4');
  const outputVideo = path.join(testsDir, 'test_output_alias.mp4');

  if (fs.existsSync(outputVideo)) {
    try { fs.unlinkSync(outputVideo); } catch {}
  }

  const processor = new WatermarkProcessor({
    inputPath: inputVideo,
    outputPath: outputVideo,
    watermarkBoxes: [{ x: 450, y: 30, w: 160, h: 50 }],
    method: 'ai_inpaint',
    hardwareEncoder: 'libx264',
    keepAudio: false
  });

  const res = await processor.process();
  assert.equal(res.success, true);
  assert.ok(fs.existsSync(outputVideo));

  try { fs.unlinkSync(outputVideo); } catch {}
});

test('Auditoria: Parse resiliente de caixas de IA (pixels, normalizado e box_2d)', () => {
  // 1. Formato padrão com markdown
  const text1 = '```json\n[{"x": 100, "y": 50, "w": 200, "h": 80, "name": "Logo"}]\n```';
  const boxes1 = parseJsonBoxes(text1, 1920, 1080);
  assert.equal(boxes1.length, 1);
  assert.equal(boxes1[0].x, 100);
  assert.equal(boxes1[0].w, 200);

  // 2. Formato normalizado 0 a 1
  const text2 = '[{"x": 0.5, "y": 0.1, "w": 0.2, "h": 0.1}]';
  const boxes2 = parseJsonBoxes(text2, 1000, 1000);
  assert.equal(boxes2.length, 1);
  assert.equal(boxes2[0].x, 500);
  assert.equal(boxes2[0].w, 200);

  // 3. Formato box_2d do Gemini [ymin, xmin, ymax, xmax] normalizado 0-1000
  const text3 = '[{"box_2d": [100, 200, 300, 600], "label": "watermark"}]';
  const boxes3 = parseJsonBoxes(text3, 1000, 1000);
  assert.equal(boxes3.length, 1);
  assert.equal(boxes3[0].x, 200);
  assert.equal(boxes3[0].y, 100);
  assert.equal(boxes3[0].w, 400);
  assert.equal(boxes3[0].h, 200);
});

test('Auditoria: Inpainting de buffer de imagem com Sharp', async () => {
  const sharp = (await import('sharp')).default;
  // Cria uma imagem sintética 200x200
  const blank = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 100, g: 150, b: 200 }
    }
  }).jpeg().toBuffer();

  const boxes = [{ x: 50, y: 50, w: 60, h: 40 }];
  const healed = await inpaintImageBuffer({
    imageBuffer: blank,
    boxes,
    width: 200,
    height: 200
  });

  assert.ok(Buffer.isBuffer(healed));
  assert.ok(healed.length > 500);
});
