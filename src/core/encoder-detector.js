import { spawn } from 'node:child_process';
import { getFfmpegBinary, spawnPromise } from '../utils/ffmpeg.js';

export const ENCODER_PRIORITY = [
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_vaapi',
  'h264_videotoolbox',
  'libx264'
];

export const ENCODER_LABELS = {
  h264_nvenc: '⚡ NVIDIA (NVENC)',
  h264_qsv: '⚡ Intel (QuickSync)',
  h264_amf: '⚡ AMD (AMF)',
  h264_vaapi: '⚡ Linux (VAAPI)',
  h264_videotoolbox: '⚡ Apple (VideoToolbox)',
  libx264: '🖥️ CPU Universal (libx264)'
};

/**
 * Parâmetros seguros e mínimos estritos para cada encoder.
 * Não mistura flags de um encoder em outro.
 */
export const ENCODER_PARAMS = {
  h264_nvenc: ['-preset', 'p4', '-rc', 'vbr', '-cq', '23'],
  h264_qsv: ['-global_quality', '23'],
  h264_amf: ['-quality', 'balanced'],
  h264_vaapi: ['-qp', '23'],
  h264_videotoolbox: ['-b:v', '4M'],
  libx264: ['-preset', 'veryfast', '-crf', '23']
};

export const COMMON_OUTPUT_FLAGS = [
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart'
];

export const UNIVERSAL_DIMENSION_FILTER = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p';

let cachedDetection = null;

/**
 * Testa se o FFmpeg está instalado e operante.
 */
export async function checkFfmpegInstalled() {
  const ffmpegExe = getFfmpegBinary();
  try {
    const { code, stdout } = await spawnPromise(ffmpegExe, ['-version']);
    return code === 0 && stdout.includes('ffmpeg version');
  } catch {
    return false;
  }
}

/**
 * Testa uma codificação real curta de 0.5s para validar se o encoder realmente funciona no hardware.
 */
export async function testEncoderCandidate(encoderName, ffmpegExe = null) {
  const exe = ffmpegExe || getFfmpegBinary();
  const testArgs = [
    '-hide_banner',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=256x256:d=0.5',
    '-c:v', encoderName,
    '-f', 'null',
    '-'
  ];

  try {
    const { code } = await spawnPromise(exe, testArgs);
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Detecta todos os encoders suportados executando testes reais de codificação.
 */
export async function detectHardwareEncoders(forceRefresh = false) {
  if (cachedDetection && !forceRefresh) {
    return cachedDetection;
  }

  const isInstalled = await checkFfmpegInstalled();
  if (!isInstalled) {
    cachedDetection = {
      ffmpegInstalled: false,
      availableEncoders: [],
      primaryEncoder: null,
      instruction: 'FFmpeg não encontrado no sistema. Por favor, instale o FFmpeg via WinGet: `winget install Gyan.FFmpeg` ou adicione-o ao PATH do Windows.'
    };
    return cachedDetection;
  }

  const ffmpegExe = getFfmpegBinary();
  let listedEncoders = '';
  try {
    const { stdout } = await spawnPromise(ffmpegExe, ['-hide_banner', '-encoders']);
    listedEncoders = stdout;
  } catch (err) {
    console.warn('Aviso: Não foi possível listar encoders do FFmpeg:', err);
  }

  const testedAvailable = [];

  for (const candidate of ENCODER_PRIORITY) {
    // Se o encoder sequer estiver na lista do ffmpeg, pula teste desnecessário
    if (candidate !== 'libx264' && !listedEncoders.includes(candidate)) {
      continue;
    }

    // Executa teste real de codificação
    const ok = await testEncoderCandidate(candidate, ffmpegExe);
    if (ok) {
      testedAvailable.push(candidate);
    }
  }

  // libx264 é a garantia absoluta de fallback
  if (!testedAvailable.includes('libx264')) {
    const libOk = await testEncoderCandidate('libx264', ffmpegExe);
    if (libOk) testedAvailable.push('libx264');
  }

  cachedDetection = {
    ffmpegInstalled: true,
    availableEncoders: testedAvailable,
    primaryEncoder: testedAvailable[0] || 'libx264',
    encoderLabels: testedAvailable.map((enc) => ({
      id: enc,
      label: ENCODER_LABELS[enc] || enc,
      params: ENCODER_PARAMS[enc] || []
    }))
  };

  return cachedDetection;
}

/**
 * Retorna a cadeia de encoders a tentar a partir da preferência do usuário.
 * Exemplo: se usuário escolheu 'h264_nvenc', a cadeia é [ 'h264_nvenc', ..., 'libx264' ].
 * Se escolheu 'auto', a cadeia são todos os disponíveis na ordem de prioridade.
 */
export function getEncoderFallbackChain(preferred = 'auto', availableEncoders = []) {
  if (!availableEncoders || availableEncoders.length === 0) {
    return ['libx264'];
  }

  if (preferred && preferred !== 'auto' && availableEncoders.includes(preferred)) {
    // Coloca o preferido em primeiro e depois os outros em ordem de fallback
    const remainder = availableEncoders.filter((e) => e !== preferred);
    // Garante que libx264 esteja no final se não for o preferido
    if (!remainder.includes('libx264') && preferred !== 'libx264') {
      remainder.push('libx264');
    }
    return [preferred, ...remainder];
  }

  // Ordem padrão: disponível com libx264 garantido no final
  const chain = [...availableEncoders];
  if (!chain.includes('libx264')) {
    chain.push('libx264');
  }
  return chain;
}
