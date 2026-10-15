import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getFfmpegBinary, getVideoMetadata } from '../utils/ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(projectRoot, 'config.json');

export const DEFAULT_CONFIG = {
  provider: 'gemini', // 'gemini', 'openai', 'local_cv'
  api_key: '',
  model: 'gemini-1.5-flash',
  prompt_detection: 'Detect any watermarks, logos, channel tags, timestamps, or translucent text in this image. Return a JSON array of bounding boxes with pixel coordinates: [{"x": int, "y": int, "w": int, "h": int, "name": string}]. Return ONLY valid JSON.',
  ai_generative_fill: true
};

export function loadAiConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const cfg = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...cfg };
    } catch {
      // fallback
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function saveAiConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar config.json:', err);
    return false;
  }
}

/**
 * Extrai um frame do vídeo em buffer de imagem (JPEG ou PNG) via spawn do ffmpeg.
 */
export function extractFrameBuffer(videoPath, timestampSec = 0, format = 'mjpeg') {
  return new Promise((resolve, reject) => {
    const ffmpegExe = getFfmpegBinary();
    const args = [
      '-ss', timestampSec.toString(),
      '-i', videoPath,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', format,
      '-'
    ];

    const proc = spawn(ffmpegExe, args, { windowsHide: true });
    const chunks = [];

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', () => {}); // descartar stderr de amostragem

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`Falha ao extrair frame no tempo ${timestampSec}s (código ${code})`));
      }
    });
  });
}

/**
 * Detecta marcas d'água no quadro do vídeo usando API configurada ou heurística local.
 */
export async function detectWatermarksAi(videoPath, timestampSec = 0) {
  const config = loadAiConfig();
  const meta = await getVideoMetadata(videoPath);
  if (!meta) {
    throw new Error('Não foi possível obter metadados do vídeo para detecção.');
  }

  const { width, height } = meta;
  const frameBuffer = await extractFrameBuffer(videoPath, timestampSec, 'mjpeg');
  const base64Img = frameBuffer.toString('base64');

  const provider = config.provider || 'gemini';
  const apiKey = (config.api_key || '').trim();

  if (apiKey && provider === 'gemini') {
    const detected = await detectWithGemini(base64Img, width, height, apiKey, config);
    if (detected && detected.length > 0) return detected;
  } else if (apiKey && provider === 'openai') {
    const detected = await detectWithOpenAi(base64Img, width, height, apiKey, config);
    if (detected && detected.length > 0) return detected;
  }

  // Fallback para detector heurístico local (cantos e dimensões comuns)
  return detectLocalHeuristics(width, height);
}

async function detectWithGemini(base64Img, width, height, apiKey, config) {
  const model = config.model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Analyze this image of size ${width}x${height} pixels.\n` +
    'Identify any watermarks, broadcast channel logos, timestamps, copyright overlays, or subtitles.\n' +
    'Return the bounding box coordinates strictly in this JSON format:\n' +
    '```json\n' +
    '[\n' +
    '  {"x": 10, "y": 20, "w": 120, "h": 40, "name": "Logo do Canal"}\n' +
    ']\n' +
    '```\n' +
    'If no watermark exists, return `[]`. Output only the JSON block.';

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64Img
          }
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return parseJsonBoxes(text, width, height);
    }
  } catch (err) {
    console.warn('Aviso: Falha na API Gemini:', err.message);
  }

  return null;
}

async function detectWithOpenAi(base64Img, width, height, apiKey, config) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const prompt = `Detect all watermarks, channel logos, text overlays in this ${width}x${height} image.\n` +
    'Return coordinates as JSON: [{"x": int, "y": int, "w": int, "h": int, "name": "Marca"}].\n' +
    'If none found, return [].';

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Img}` }
          }
        ]
      }
    ],
    temperature: 0.1
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      return parseJsonBoxes(text, width, height);
    }
  } catch (err) {
    console.warn('Aviso: Falha na API OpenAI:', err.message);
  }

  return null;
}

function parseJsonBoxes(text, imgW, imgH) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const data = JSON.parse(match[0]);
    const valid = [];

    data.forEach((item, idx) => {
      let x = Number(item.x) || 0;
      let y = Number(item.y) || 0;
      let w = Number(item.w) || 0;
      let h = Number(item.h) || 0;
      const name = item.name || `IA Detectada #${idx + 1}`;

      // Valores normalizados (0 a 1)
      if (x > 0 && x < 1 && w > 0 && w <= 1) {
        x = Math.round(x * imgW);
        w = Math.round(w * imgW);
      }
      if (y > 0 && y < 1 && h > 0 && h <= 1) {
        y = Math.round(y * imgH);
        h = Math.round(h * imgH);
      }

      if (w > 10 && h > 10) {
        valid.push({
          id: idx + 1,
          x: Math.max(0, Math.min(x, imgW - 5)),
          y: Math.max(0, Math.min(y, imgH - 5)),
          w: Math.min(w, imgW - x),
          h: Math.min(h, imgH - y),
          name
        });
      }
    });

    return valid;
  } catch {
    return [];
  }
}

/**
 * Detector heurístico local nos 4 cantos mais prováveis para vídeos.
 */
function detectLocalHeuristics(width, height) {
  const marginX = Math.round(width * 0.04);
  const marginY = Math.round(height * 0.05);
  const boxW = Math.round(width * 0.22);
  const boxH = Math.round(height * 0.10);

  // Sugere canto superior direito ou inferior direito típicos
  return [
    {
      id: 1,
      x: width - boxW - marginX,
      y: marginY,
      w: boxW,
      h: boxH,
      name: 'Sugestão Canto Sup. Dir.'
    }
  ];
}
