import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { galleryDb } from '../src/core/gallery-db.js';
import { VideoEditor } from '../src/core/video-editor.js';
import { ensureSyntheticVideo } from './ensure-test-assets.js';
import { getVideoMetadata } from '../src/utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const testsDir = __dirname;

test('Galeria: Adicionar mídia, buscar e excluir', async () => {
  const synthVideo = await ensureSyntheticVideo();
  const testCopy = path.join(testsDir, `test_copy_${Date.now()}.mp4`);
  fs.copyFileSync(synthVideo, testCopy);

  const testId = `test_gal_${Date.now()}`;

  const item = await galleryDb.addMedia({
    id: testId,
    title: 'Vídeo Teste Galeria',
    mediaType: 'video',
    filePath: testCopy,
    duration: 2.0,
    width: 640,
    height: 360,
    size: fs.statSync(testCopy).size,
    source: 'inpainting'
  });

  assert.equal(item.id, testId);
  assert.equal(item.mediaType, 'video');
  assert.equal(item.title, 'Vídeo Teste Galeria');

  // Buscar por ID
  const retrieved = galleryDb.getById(testId);
  assert.ok(retrieved);
  assert.equal(retrieved.id, testId);

  // Listar todas as mídias
  const all = galleryDb.getAll();
  assert.ok(Array.isArray(all));
  assert.ok(all.some((m) => m.id === testId));

  // Excluir mídia
  const deleted = galleryDb.deleteMedia(testId);
  assert.equal(deleted, true);
  assert.equal(galleryDb.getById(testId), null);
  try { fs.unlinkSync(testCopy); } catch {}
});

test('Editor de Vídeo: Renderização de Corte e Ajuste de Proporção', async () => {
  const synthVideo = await ensureSyntheticVideo();
  const editor = new VideoEditor();
  const taskId = `test_edit_${Date.now()}`;

  let progressCalled = false;
  const res = await editor.render({
    clips: [
      {
        filePath: synthVideo,
        trimStart: 0.2,
        trimEnd: 1.5,
        speed: 1.0
      }
    ],
    globalSettings: {
      title: 'Teste Corte e Aspecto',
      aspectRatio: '16:9',
      speed: 1.0,
      muteAudio: true
    },
    taskId,
    onProgress: (p) => {
      progressCalled = true;
      assert.ok(p.percent >= 0);
    }
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.outputPath));
  assert.ok(fs.statSync(res.outputPath).size > 1000);

  // Valida metadados do vídeo renderizado
  const meta = await getVideoMetadata(res.outputPath);
  assert.ok(meta);
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 1080);
  assert.ok(meta.duration >= 1.0 && meta.duration <= 1.8);

  // Limpa arquivo de teste da galeria e disco
  galleryDb.deleteMedia(taskId);
});

test('Editor de Vídeo: Junção de 2 Clipes e Mudança de Velocidade', async () => {
  const synthVideo = await ensureSyntheticVideo();
  const editor = new VideoEditor();
  const taskId = `test_concat_${Date.now()}`;

  const res = await editor.render({
    clips: [
      {
        filePath: synthVideo,
        trimStart: 0,
        trimEnd: 1.0,
        speed: 1.5
      },
      {
        filePath: synthVideo,
        trimStart: 0.5,
        trimEnd: 1.5,
        speed: 1.0
      }
    ],
    globalSettings: {
      title: 'Concat Clipes',
      aspectRatio: 'original',
      muteAudio: true
    },
    taskId
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.outputPath));
  assert.ok(fs.statSync(res.outputPath).size > 1000);

  // Limpa arquivo de teste da galeria e disco
  galleryDb.deleteMedia(taskId);
});

test('Editor de Vídeo: Extração de Áudio MP3', async () => {
  const synthVideo = await ensureSyntheticVideo();
  const editor = new VideoEditor();
  const taskId = `test_audio_${Date.now()}`;

  const res = await editor.extractAudio({
    filePath: synthVideo,
    taskId
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.outputPath));
  assert.ok(res.outputPath.endsWith('.mp3'));
  assert.ok(fs.statSync(res.outputPath).size > 100);

  // Confirma item salvo no banco de galeria
  const gItem = galleryDb.getById(taskId);
  assert.ok(gItem);
  assert.equal(gItem.mediaType, 'audio');

  galleryDb.deleteMedia(taskId);
});

test('Editor de Vídeo: Aplicação de Marca d Água, Figurinhas e Recorte (Crop)', async () => {
  const synthVideo = await ensureSyntheticVideo();
  const editor = new VideoEditor();
  const taskId = `test_stickers_crop_${Date.now()}`;

  const res = await editor.render({
    clips: [
      {
        filePath: synthVideo,
        trimStart: 0,
        trimEnd: 1.0,
        crop: {
          xPct: 10,
          yPct: 10,
          widthPct: 80,
          heightPct: 80
        }
      }
    ],
    globalSettings: {
      title: 'Teste Stickers e Crop',
      aspectRatio: '16:9',
      muteAudio: true,
      stickers: [
        {
          type: 'emoji',
          emoji: '🔥',
          xPct: 20,
          yPct: 30,
          size: 100,
          opacity: 0.9,
          startTime: 0,
          endTime: 1.0
        }
      ],
      watermark: {
        enabled: true,
        type: 'text',
        text: '@MeuCanal',
        position: 'bottom-right',
        fontSize: 32,
        color: '#38bdf8',
        opacity: 0.85
      }
    },
    taskId
  });

  assert.equal(res.success, true);
  assert.ok(fs.existsSync(res.outputPath));
  assert.ok(fs.statSync(res.outputPath).size > 1000);

  const meta = await getVideoMetadata(res.outputPath);
  assert.ok(meta);
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 1080);

  galleryDb.deleteMedia(taskId);
});
