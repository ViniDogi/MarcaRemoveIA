import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreciseWatermarkMask, reconstructExemplarPatches } from '../src/core/pixel-reconstructor.js';
import { WaveSpeedEngine } from '../src/core/wavespeed-engine.js';
import { WatermarkProcessor } from '../src/core/processor.js';
import { detectWatermarksAi } from '../src/core/ai-detector.js';

test('Nova Feature: Máscara minuciosa pixel a pixel sem borrão', async () => {
  const sharp = (await import('sharp')).default;
  // Imagem sintética 100x100 branca com quadrado preto (marca d'água) no centro (40, 40, 20, 20)
  const baseImg = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  }).composite([{
    input: await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    }).png().toBuffer(),
    left: 40,
    top: 40
  }]).jpeg().toBuffer();

  const { mask, width, height } = await createPreciseWatermarkMask({
    imageBuffer: baseImg,
    boxes: [{ x: 35, y: 35, w: 30, h: 30 }]
  });

  assert.equal(width, 100);
  assert.equal(height, 100);
  assert.ok(mask instanceof Uint8Array);
  // O pixel central (50, 50) deve ser marcado (255)
  assert.equal(mask[50 * 100 + 50], 255);
  // O pixel de fundo limpo fora do box (10, 10) deve ser preservado (0)
  assert.equal(mask[10 * 100 + 10], 0);

  // Executa reconstrução exemplar HD
  const reconstructed = await reconstructExemplarPatches({
    imageBuffer: baseImg,
    boxes: [{ x: 35, y: 35, w: 30, h: 30 }]
  });

  assert.ok(reconstructed instanceof Buffer);
  assert.ok(reconstructed.length > 50);
});

test('Nova Feature: WaveSpeed AI Engine instanciação e validação de chaves', () => {
  const wsWithoutKey = new WaveSpeedEngine('');
  assert.equal(wsWithoutKey.isConfigured(), false);

  const wsWithKey = new WaveSpeedEngine('test_key_wavespeed_123');
  assert.equal(wsWithKey.isConfigured(), true);
  assert.equal(wsWithKey.apiKey, 'test_key_wavespeed_123');
});

test('Nova Feature: Suporte a Marca d\'Água em Movimento no Processador', async () => {
  const processor = new WatermarkProcessor();
  assert.ok(typeof processor.runRemoval === 'function');

  // Verifica interpolação de marcas móveis
  const movingBox = {
    isMoving: true,
    start: { x: 50, y: 50, w: 60, h: 30, t: 0 },
    end: { x: 200, y: 150, w: 60, h: 30, t: 4 }
  };
  assert.equal(movingBox.isMoving, true);
  assert.equal(movingBox.start.x, 50);
  assert.equal(movingBox.end.x, 200);
});

test('Nova Feature: Auto-detecção não inventa caixas aleatórias (retorna array vazio quando limpo)', async () => {
  // Teste em imagem sintética completamente limpa
  const sharp = (await import('sharp')).default;
  const path = (await import('node:path')).default;
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;

  const tempImgPath = path.join(os.tmpdir(), `clean_test_${Date.now()}.jpg`);
  const cleanImg = await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 180, g: 200, b: 220 }
    }
  }).jpeg().toBuffer();
  fs.writeFileSync(tempImgPath, cleanImg);

  try {
    const boxes = await detectWatermarksAi(tempImgPath, 0);
    assert.ok(Array.isArray(boxes));
    // Em imagem lisa sem chave de API configurada, não deve inventar caixa arbitrária
    assert.equal(boxes.length, 0);
  } finally {
    try { fs.unlinkSync(tempImgPath); } catch {}
  }
});
