import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const uploadsDir = path.join(projectRoot, 'web_uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

let cachedYtDlpBinary = null;

/**
 * Localiza o executável do yt-dlp no sistema.
 */
export function getYtDlpBinary() {
  if (cachedYtDlpBinary && fs.existsSync(cachedYtDlpBinary)) {
    return cachedYtDlpBinary;
  }

  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    cachedYtDlpBinary = process.env.YTDLP_PATH;
    return cachedYtDlpBinary;
  }

  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    'yt-dlp',
    'yt-dlp.exe',
    path.join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe'),
    path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    'C:\\Program Files\\yt-dlp\\yt-dlp.exe',
    'C:\\yt-dlp\\yt-dlp.exe'
  ];

  for (const cand of candidates) {
    if (cand.includes(path.sep) || cand.includes('/')) {
      if (fs.existsSync(cand)) {
        cachedYtDlpBinary = cand;
        return cand;
      }
    }
  }

  // Fallback padrão para comando no PATH
  cachedYtDlpBinary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return cachedYtDlpBinary;
}

/**
 * Validação rigorosa contra Server-Side Request Forgery (SSRF).
 * Bloqueia localhost, IPs privados, redes link-local, metadados de nuvem e esquemas não HTTP/HTTPS.
 */
export async function validateUrlAndCheckSSRF(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL inválida ou não fornecida.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch {
    throw new Error('Formato de URL inválido. Certifique-se de incluir http:// ou https://');
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`Protocolo "${parsedUrl.protocol}" não permitido por segurança. Use apenas links HTTP ou HTTPS.`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Bloqueio de domínios especiais e localhost
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.includes('metadata.google') ||
    hostname === 'instance-data'
  ) {
    throw new Error(`Acesso ao host "${hostname}" foi bloqueado por segurança (Rede interna/SSRF).`);
  }

  // Função auxiliar para testar se um IP é privado/restrito
  const isPrivateOrRestrictedIp = (ip) => {
    // IPv4
    if (ip.includes('.')) {
      const parts = ip.split('.').map((p) => parseInt(p, 10));
      if (parts.length !== 4 || parts.some(isNaN)) return true;

      // 0.0.0.0/8
      if (parts[0] === 0) return true;
      // 127.0.0.0/8 (Loopback)
      if (parts[0] === 127) return true;
      // 10.0.0.0/8 (Privada Classe A)
      if (parts[0] === 10) return true;
      // 172.16.0.0/12 (Privada Classe B: 172.16.x.x - 172.31.x.x)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16 (Privada Classe C)
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16 (Link-Local e Cloud Metadata AWS/GCP/Azure)
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 100.64.0.0/10 (Carrier NAT)
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
      // 224.0.0.0/4 (Multicast) e 240.0.0.0/4 (Reservado)
      if (parts[0] >= 224) return true;

      return false;
    }

    // IPv6
    const cleanIp = ip.toLowerCase();
    if (cleanIp === '::1' || cleanIp === '::' || cleanIp.startsWith('fe80:') || cleanIp.startsWith('fc00:') || cleanIp.startsWith('fd00:')) {
      return true;
    }

    return false;
  };

  // Se o hostname já for um IP literal
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')) {
    if (isPrivateOrRestrictedIp(hostname)) {
      throw new Error(`O endereço IP "${hostname}" é restrito e foi bloqueado por segurança (SSRF).`);
    }
  } else {
    // Resolve DNS para verificar se o domínio aponta para um IP interno (ex: localtest.me -> 127.0.0.1)
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      for (const record of records) {
        if (isPrivateOrRestrictedIp(record.address)) {
          throw new Error(`O domínio "${hostname}" resolve para um IP de rede interna (${record.address}), acesso bloqueado.`);
        }
      }
    } catch (err) {
      if (err.message.includes('bloqueado')) throw err;
      throw new Error(`Não foi possível resolver o endereço do servidor: ${err.message}`);
    }
  }

  return true;
}

/**
 * Formata segundos em formato legível mm:ss ou hh:mm:ss.
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Obtém metadados de vídeo da URL via yt-dlp.
 */
export async function getVideoInfo(url) {
  await validateUrlAndCheckSSRF(url);

  const bin = getYtDlpBinary();
  const args = [
    '-J',
    '--no-playlist',
    '--flat-playlist',
    url
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (d) => {
      stdoutData += d.toString();
    });

    proc.stderr.on('data', (d) => {
      stderrData += d.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Falha ao executar yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp retornou erro (código ${code}): ${stderrData || stdoutData}`));
      }

      try {
        const raw = JSON.parse(stdoutData);
        const durationSec = raw.duration || 0;

        // Categoriza resoluções disponíveis com estimativas de tamanho
        const standardHeights = [1080, 720, 480, 360];
        const qualities = [];

        // Adiciona "Melhor Qualidade"
        qualities.push({
          id: 'best',
          label: 'Melhor Qualidade (Recomendado)',
          formatSelector: 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
          height: raw.height || 0,
          approxSizeMb: raw.filesize ? Math.round(raw.filesize / (1024 * 1024)) : (durationSec > 0 ? Math.round(durationSec * 0.4) : null)
        });

        for (const h of standardHeights) {
          const approxMb = durationSec > 0 ? Math.round(durationSec * (h / 1080) * 0.35) : null;
          qualities.push({
            id: `${h}p`,
            label: `${h}p ${h >= 720 ? '(HD)' : '(SD)'}`,
            formatSelector: `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b[height<=${h}]`,
            height: h,
            approxSizeMb: approxMb
          });
        }

        // Opção de áudio apenas (caso usuário deseje)
        qualities.push({
          id: 'audio_only',
          label: 'Apenas Áudio (M4A/MP3)',
          formatSelector: 'ba[ext=m4a]/ba',
          height: 0,
          approxSizeMb: durationSec > 0 ? Math.round(durationSec * 0.02) : null
        });

        resolve({
          id: raw.id,
          title: raw.title || 'Vídeo sem título',
          thumbnail: raw.thumbnail || '',
          duration: durationSec,
          durationFormatted: formatDuration(durationSec),
          uploader: raw.uploader || raw.channel || 'Desconhecido',
          qualities
        });
      } catch (err) {
        reject(new Error(`Falha ao decodificar metadados do vídeo: ${err.message}`));
      }
    });
  });
}

/**
 * Faz download do vídeo via yt-dlp com stream de progresso.
 */
export async function downloadVideo({
  url,
  formatSelector = 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
  taskId = Date.now().toString(),
  outputDir = uploadsDir,
  onProgress = null
}) {
  await validateUrlAndCheckSSRF(url);

  const bin = getYtDlpBinary();
  const safeFilename = `download_${taskId}.mp4`;
  const outputPath = path.join(outputDir, safeFilename);

  const args = [
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--newline',
    '--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_estimate_str)s',
    '-o', outputPath,
    url
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrData = '';

    proc.stdout.on('data', (d) => {
      const lines = d.toString().split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Formato customizado: " 45.2%| 2.50MiB/s| 00:03| 15.00MiB"
        if (trimmed.includes('|')) {
          const parts = trimmed.split('|');
          const percentStr = parts[0].replace('%', '').trim();
          const speedStr = (parts[1] || '').trim();
          const etaStr = (parts[2] || '').trim();
          const sizeStr = (parts[3] || '').trim();
          const percent = parseFloat(percentStr);

          if (!isNaN(percent) && onProgress) {
            onProgress({
              percent: Math.min(100, Math.max(0, percent)),
              speed: speedStr || 'Calculando...',
              eta: etaStr || '--:--',
              totalSize: sizeStr || '',
              status: 'downloading'
            });
          }
        } else if (trimmed.includes('[download]')) {
          // Fallback para linha padrão do yt-dlp
          const match = trimmed.match(/([0-9.]+)%/);
          if (match && onProgress) {
            const percent = parseFloat(match[1]);
            onProgress({
              percent: Math.min(100, Math.max(0, percent)),
              speed: '',
              eta: '',
              status: 'downloading'
            });
          }
        }
      }
    });

    proc.stderr.on('data', (d) => {
      stderrData += d.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Falha ao iniciar processo de download: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Download falhou (código ${code}): ${stderrData}`));
      }

      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Download concluído mas o arquivo de saída não foi encontrado.'));
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        return reject(new Error('O arquivo baixado está vazio (0 bytes).'));
      }

      if (onProgress) {
        onProgress({
          percent: 100,
          speed: '0 KiB/s',
          eta: '00:00',
          status: 'completed'
        });
      }

      resolve({
        filePath: outputPath,
        filename: safeFilename,
        sizeBytes: stats.size,
        taskId
      });
    });
  });
}

/**
 * Executa rotina de atualização do binário do yt-dlp (`yt-dlp -U`).
 */
export async function updateYtDlpBinary() {
  const bin = getYtDlpBinary();

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ['-U'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';

    proc.stdout.on('data', (d) => {
      output += d.toString();
    });

    proc.stderr.on('data', (d) => {
      output += d.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Erro ao invocar atualizador do yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        message: output.trim() || `Processo finalizado com código ${code}`
      });
    });
  });
}
