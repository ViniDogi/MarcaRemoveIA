import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyNms,
  smoothBoxesTrajectory,
  detectHybridWatermarks,
  EXECUTION_PROVIDERS_PRIORITY
} from '../src/core/onnx-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');

test('ONNX Engine: Provedores e Manifesto', async () => {
  // Verifica prioridade de provedores
  assert.deepEqual(EXECUTION_PROVIDERS_PRIORITY, ['cuda', 'dml', 'coreml', 'cpu']);

  // Verifica existência e schema do manifesto
  const manifestPath = path.join(projectRoot, 'src', 'core', 'models-manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'models-manifest.json deve existir');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.ok(manifest['detector'], 'Manifesto deve conter detector YOLO');
  assert.ok(manifest['inpaint'], 'Manifesto deve conter modelo LaMa');
  assert.ok(manifest['detector'].sha256, 'Detector deve ter SHA-256');
  assert.ok(manifest['inpaint'].sha256, 'LaMa deve ter SHA-256');
});

test('ONNX Engine: Algoritmo Non-Maximum Suppression (NMS)', () => {
  const overlappingBoxes = [
    { id: 1, x: 100, y: 100, w: 100, h: 100, confidence: 0.9 },
    { id: 2, x: 105, y: 105, w: 95, h: 95, confidence: 0.7 }, // Quase idêntica à 1
    { id: 3, x: 500, y: 500, w: 120, h: 80, confidence: 0.85 }  // Em outro canto
  ];

  const filtered = applyNms(overlappingBoxes, 0.4);
  assert.equal(filtered.length, 2, 'Deve suprimir a caixa redundante (id 2)');
  assert.equal(filtered[0].id, 1, 'Deve manter a de maior confiança primeiro');
  assert.equal(filtered[1].id, 3, 'Deve manter a caixa não sobreposta');
});

test('ONNX Engine: Suavização de Trajetória Temporal', () => {
  const history = [
    { x: 100, y: 100, w: 50, h: 50 }
  ];
  const newBox = { x: 120, y: 120, w: 50, h: 50 };

  // Com alpha = 0.5, deve resultar em média exata: 110, 110
  const smoothed = smoothBoxesTrajectory(history, newBox, 0.5);
  assert.equal(smoothed.x, 110);
  assert.equal(smoothed.y, 110);
  assert.equal(smoothed.w, 50);
  assert.equal(smoothed.h, 50);
});

test('ONNX Engine: Detecção Híbrida em Vídeo Sintético', async () => {
  const videoPath = path.join(testsDir, 'synthetic_watermark.mp4');
  assert.ok(fs.existsSync(videoPath), 'Vídeo de teste deve existir');

  const detectedBoxes = await detectHybridWatermarks({
    videoPath,
    sampleCount: 3,
    downscaleWidth: 320
  });

  assert.ok(Array.isArray(detectedBoxes), 'Resultado deve ser um array');
  assert.ok(detectedBoxes.length > 0, 'Deve detectar pelo menos 1 região');

  for (const box of detectedBoxes) {
    assert.ok(box.w > 0, 'Largura deve ser positiva');
    assert.ok(box.h > 0, 'Altura deve ser positiva');
    assert.ok(typeof box.x === 'number' && box.x >= 0, 'X deve ser válido');
    assert.ok(typeof box.y === 'number' && box.y >= 0, 'Y deve ser válido');
    assert.ok(box.confidence > 0, 'Confiança deve ser maior que 0');
  }
});
