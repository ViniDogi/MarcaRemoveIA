import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getVideoMetadata,
  validateVideoFile,
  getFfmpegBinary,
  spawnPromise
} from '../src/utils/ffmpeg.js';
import {
  detectHardwareEncoders,
  getEncoderFallbackChain
} from '../src/core/encoder-detector.js';
import {
  WatermarkProcessor
} from '../src/core/processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = path.join(projectRoot, 'tests');

test('1. Metadados e Validação de Vídeo', async () => {
  const videoPath = path.join(testsDir, 'synthetic_watermark.mp4');
  assert.ok(fs.existsSync(videoPath), 'Vídeo sintético deve existir');

  const val = await validateVideoFile(videoPath);
  assert.equal(val.valid, true, 'Vídeo sintético deve ser válido');
  assert.equal(val.metadata.width, 640);
  assert.equal(val.metadata.height, 360);
  assert.ok(val.metadata.duration >= 1.9, 'Duração deve ser aprox. 2s');
});

test('2. Detecção de Hardware e Encoders Disponíveis', async () => {
  const hw = await detectHardwareEncoders();
  assert.equal(hw.ffmpegInstalled, true, 'FFmpeg deve estar instalado');
  assert.ok(hw.availableEncoders.length > 0, 'Deve detectar pelo menos 1 encoder funcional');
  assert.ok(hw.availableEncoders.includes('libx264'), 'libx264 sempre deve estar disponível');

  const fallback = getEncoderFallbackChain('auto', hw.availableEncoders);
  assert.ok(fallback.includes('libx264'), 'Fallback deve conter libx264');
});

test('3. Paridade de Remoção de Marca d\'Água no Vídeo Sintético', async () => {
  const inputVideo = path.join(testsDir, 'synthetic_watermark.mp4');
  const outputVideo = path.join(testsDir, 'output_clean_js.mp4');

  if (fs.existsSync(outputVideo)) {
    fs.unlinkSync(outputVideo);
  }

  const processor = new WatermarkProcessor();
  const boxes = [{ x: 450, y: 30, w: 160, h: 50, name: 'Marca 1' }];

  let lastProgress = 0;
  const result = await processor.runRemoval({
    inputVideo,
    outputVideo,
    watermarkBoxes: boxes,
    engine: 'auto',
    taskId: 'test-parity-01',
    onProgress: (p) => {
      lastProgress = p.progress;
    }
  });

  assert.equal(result.success, true, 'Remoção deve retornar sucesso');
  assert.ok(fs.existsSync(outputVideo), 'Arquivo de saída deve existir');
  const stat = fs.statSync(outputVideo);
  assert.ok(stat.size > 2000, `Arquivo gerado deve ter tamanho substancial: ${stat.size} bytes`);

  const outMeta = await getVideoMetadata(outputVideo);
  assert.ok(outMeta, 'Deve ser possível ler metadados do vídeo processado');
  assert.equal(outMeta.width, 640);
  assert.equal(outMeta.height, 360);
  assert.ok(lastProgress > 0.8, 'Progresso deve ter atingido quase 100%');
});

test('4. Resiliência a Dimensões Ímpares (Garante correção do Erro -22)', async () => {
  const oddVideo = path.join(testsDir, 'odd_dimension.mp4');
  const cleanOddVideo = path.join(testsDir, 'odd_clean.mp4');
  const ffmpegExe = getFfmpegBinary();

  // Gera vídeo de 639x359 (dimensões ímpares que provocavam erro -22)
  await spawnPromise(ffmpegExe, [
    '-y', '-f', 'lavfi',
    '-i', 'testsrc=duration=1:size=640x360:rate=25',
    '-vf', 'crop=639:359:0:0,drawbox=x=100:y=50:w=80:h=40:color=yellow@1.0:t=fill',
    '-c:v', 'mpeg4',
    oddVideo
  ]);

  assert.ok(fs.existsSync(oddVideo), 'Vídeo com dimensões ímpares gerado');

  const processor = new WatermarkProcessor();
  const boxes = [{ x: 100, y: 50, w: 80, h: 40, name: 'Marca Ímpar' }];

  const result = await processor.runRemoval({
    inputVideo: oddVideo,
    outputVideo: cleanOddVideo,
    watermarkBoxes: boxes,
    engine: 'auto',
    taskId: 'test-odd-dim-02'
  });

  assert.equal(result.success, true, 'Processamento de dimensões ímpares deve passar');
  assert.ok(fs.existsSync(cleanOddVideo), 'Vídeo limpo deve existir');

  const cleanMeta = await getVideoMetadata(cleanOddVideo);
  // O filtro scale=trunc(iw/2)*2:trunc(ih/2)*2 deve garantir números pares
  assert.equal(cleanMeta.width % 2, 0, 'Largura final deve ser par');
  assert.equal(cleanMeta.height % 2, 0, 'Altura final deve ser par');

  // Limpeza
  try { fs.unlinkSync(oddVideo); fs.unlinkSync(cleanOddVideo); } catch {}
});

test('5. Rejeição com Mensagem Clara para Arquivos Inválidos', async () => {
  const fakeFile = path.join(testsDir, 'invalid_sample.txt');
  fs.writeFileSync(fakeFile, 'Este não é um arquivo de vídeo.');

  const val = await validateVideoFile(fakeFile);
  assert.equal(val.valid, false, 'Arquivo texto deve ser considerado inválido');
  assert.match(val.error, /Formato de vídeo inválido/i);

  try { fs.unlinkSync(fakeFile); } catch {}
});
