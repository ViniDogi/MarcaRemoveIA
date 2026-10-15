import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateUrlAndCheckSSRF,
  getYtDlpBinary,
  updateYtDlpBinary
} from '../src/core/downloader.js';

test('Downloader: Bloqueio Rigoroso de SSRF e Protocolos Proibidos', async () => {
  const ssrfUrls = [
    'http://127.0.0.1',
    'http://127.0.0.1:8000/api/config',
    'http://localhost',
    'http://localhost:8080/secret',
    'http://169.254.169.254/latest/meta-data/', // AWS/GCP Metadata
    'http://10.0.0.5/video.mp4',
    'http://192.168.1.1/stream.m3u8',
    'http://172.16.0.1/test.mp4',
    'file:///C:/Windows/win.ini',
    'file:///etc/passwd',
    'ftp://192.168.0.1/video.mp4',
    'gopher://127.0.0.1:70',
    'javascript:alert(1)'
  ];

  for (const url of ssrfUrls) {
    await assert.rejects(
      async () => {
        await validateUrlAndCheckSSRF(url);
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('bloqueado') ||
          err.message.includes('não permitido') ||
          err.message.includes('inválido'),
          `Mensagem de bloqueio esperada para "${url}", obteve: "${err.message}"`
        );
        return true;
      },
      `A URL "${url}" deveria ter sido sumariamente bloqueada pelo SSRF guard!`
    );
  }
});

test('Downloader: Validação Positiva de URLs Públicas', async () => {
  const publicUrls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/76979871',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  ];

  for (const url of publicUrls) {
    const valid = await validateUrlAndCheckSSRF(url);
    assert.equal(valid, true, `URL pública legítima "${url}" deve ser autorizada`);
  }
});

test('Downloader: Detecção do Binário do yt-dlp', () => {
  const bin = getYtDlpBinary();
  assert.ok(typeof bin === 'string' && bin.length > 0, 'Caminho do binário deve ser retornado');
  assert.ok(bin.includes('yt-dlp'), 'Nome do binário deve conter yt-dlp');
});

test('Downloader: Rotina de Atualização / Verificação de Versão', async () => {
  const result = await updateYtDlpBinary();
  assert.ok(typeof result.success === 'boolean', 'Deve retornar flag booleana success');
  assert.ok(typeof result.message === 'string', 'Deve retornar mensagem do yt-dlp');
});
