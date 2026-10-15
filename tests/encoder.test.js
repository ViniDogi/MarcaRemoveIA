import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectHardwareEncoders,
  getEncoderFallbackChain,
  testEncoderCandidate,
  checkFfmpegInstalled,
  ENCODER_PARAMS,
  ENCODER_PRIORITY
} from '../src/core/encoder-detector.js';
import { WatermarkProcessor } from '../src/core/processor.js';
import { ensureSyntheticVideo } from './ensure-test-assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const logsDir = path.join(projectRoot, 'logs');

test('Encoder Detector: Verifica instalação do FFmpeg', async () => {
  const installed = await checkFfmpegInstalled();
  assert.equal(installed, true, 'FFmpeg deve estar instalado e detectável');
});

test('Encoder Detector: Detecção com teste real de codificação', async () => {
  const hw = await detectHardwareEncoders(true);
  assert.equal(hw.ffmpegInstalled, true);
  assert.ok(Array.isArray(hw.availableEncoders));
  assert.ok(hw.availableEncoders.includes('libx264'), 'libx264 deve passar no teste de codificação');

  // Verifica que cada encoder possui conjunto mínimo e seguro de flags isoladas
  for (const enc of hw.availableEncoders) {
    assert.ok(Array.isArray(ENCODER_PARAMS[enc]), `Encoder ${enc} deve ter parâmetros definidos`);
    assert.ok(ENCODER_PARAMS[enc].length > 0, `Encoder ${enc} deve ter parâmetros não vazios`);
  }
});

test('Encoder Detector: Prioridade e Cadeia de Fallback', () => {
  const mockAvailable = ['h264_nvenc', 'libx264'];

  // Teste 1: 'auto' deve manter a prioridade natural
  const autoChain = getEncoderFallbackChain('auto', mockAvailable);
  assert.deepEqual(autoChain, ['h264_nvenc', 'libx264']);

  // Teste 2: Preferência específica 'libx264'
  const cpuChain = getEncoderFallbackChain('libx264', mockAvailable);
  assert.equal(cpuChain[0], 'libx264');

  // Teste 3: Escolha de encoder ausente cai de volta em libx264
  const unknownChain = getEncoderFallbackChain('h264_videotoolbox', mockAvailable);
  assert.ok(unknownChain.includes('libx264'));
});

test('Fallback em Tempo de Execução: Gera log em logs/ffmpeg-<id>.log', async () => {
  await ensureSyntheticVideo();
  const testIn = path.join(projectRoot, 'tests', 'synthetic_watermark.mp4');
  const testOut = path.join(projectRoot, 'tests', 'test_fallback_out.mp4');
  const testTaskId = 'test-log-fallback-' + Date.now();

  const processor = new WatermarkProcessor();
  const res = await processor.runRemoval({
    inputVideo: testIn,
    outputVideo: testOut,
    watermarkBoxes: [{ x: 450, y: 30, w: 160, h: 50 }],
    engine: 'auto',
    taskId: testTaskId
  });

  assert.equal(res.success, true);
  const logFile = path.join(logsDir, `ffmpeg-${testTaskId}.log`);
  assert.ok(fs.existsSync(logFile), 'Arquivo de log do FFmpeg deve ser criado');

  const logContent = fs.readFileSync(logFile, 'utf-8');
  assert.ok(logContent.includes(testTaskId), 'Log deve conter o ID da tarefa');
  assert.ok(logContent.includes('Tentando codificação com:'), 'Log deve registrar a tentativa do encoder');

  // Limpeza
  try { fs.unlinkSync(testOut); } catch {}
});
