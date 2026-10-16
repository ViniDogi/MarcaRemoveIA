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
  provider: 'local_cv', // 'local_cv', 'gemini', 'openai'
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
 * Detecta marcas d'água no quadro do vídeo usando API configurada ou algoritmo local de visão computacional.
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

  const provider = config.provider || 'local_cv';
  const apiKey = (config.api_key || '').trim();

  // 1. Tenta API de IA se houver chave configurada e não for local_cv
  if (apiKey && provider === 'gemini') {
    try {
      const detected = await detectWithGemini(base64Img, width, height, apiKey, config);
      if (detected && detected.length > 0) return detected;
    } catch (e) {
      console.warn('[AI Detector] Falha na detecção Gemini, tentando detector local:', e.message);
    }
  } else if (apiKey && provider === 'openai') {
    try {
      const detected = await detectWithOpenAi(base64Img, width, height, apiKey, config);
      if (detected && detected.length > 0) return detected;
    } catch (e) {
      console.warn('[AI Detector] Falha na detecção OpenAI, tentando detector local:', e.message);
    }
  }

  // 2. Fallback para Visão Computacional Híbrida Local
  try {
    const { detectHybridWatermarks } = await import('./onnx-engine.js');
    const localBoxes = await detectHybridWatermarks({
      videoPath,
      sampleCount: 5,
      downscaleWidth: 480
    });
    if (localBoxes && localBoxes.length > 0) {
      return localBoxes;
    }
  } catch (err) {
    console.warn('[AI Detector] Falha na detecção híbrida local:', err.message);
  }

  // 3. Fallback estático de segurança
  return detectLocalHeuristics(width, height);
}

async function detectWithGemini(base64Img, width, height, apiKey, config) {
  const model = config.model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Analyze this video frame image of dimensions ${width}x${height} pixels.\n` +
    'Identify all watermarks, logos, TV channel tags, social media handles (TikTok, Instagram, Kwai), timestamps, or subtitles.\n' +
    'Return a JSON array of bounding boxes with pixel coordinates strictly in this format:\n' +
    '[\n' +
    '  {"x": int, "y": int, "w": int, "h": int, "name": "Nome da Marca"}\n' +
    ']\n' +
    'If no watermark is found, return []. Return ONLY valid JSON, without surrounding markdown commentary.';

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
      maxOutputTokens: 1000
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
    } else {
      const errText = await res.text();
      console.warn(`[AI Detector] Gemini retornou HTTP ${res.status}:`, errText);
    }
  } catch (err) {
    console.warn('[AI Detector] Erro de rede com Gemini:', err.message);
  }

  return null;
}

async function detectWithOpenAi(base64Img, width, height, apiKey, config) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const prompt = `Detect all watermarks, channel logos, usernames, text overlays in this ${width}x${height} image.\n` +
    'Return coordinates strictly as JSON: [{"x": int, "y": int, "w": int, "h": int, "name": "Marca"}].\n' +
    'If none found, return [].';

  const payload = {
    model: config.model || 'gpt-4o-mini',
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
    console.warn('[AI Detector] Erro de rede com OpenAI:', err.message);
  }

  return null;
}

export function parseJsonBoxes(text, imgW, imgH) {
  if (!text || typeof text !== 'string') return [];

  // Remove marcações de código markdown se presentes
  let cleanText = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Localiza o bloco JSON de array [ ... ] ou objeto { "boxes": [...] }
  let data = null;
  const arrayMatch = cleanText.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      data = JSON.parse(arrayMatch[0]);
    } catch {
      // Ignora erro e tenta parse de objeto
    }
  }

  if (!data) {
    const objMatch = cleanText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]);
        data = obj.boxes || obj.watermarks || obj.detected || [];
      } catch {
        // Ignora
      }
    }
  }

  if (!Array.isArray(data)) return [];

  const valid = [];

  data.forEach((item, idx) => {
    let x = 0, y = 0, w = 0, h = 0;
    const name = item.name || item.label || `Marca #${idx + 1}`;

    // Suporta formato [ymin, xmin, ymax, xmax] padrão Gemini box_2d
    if (Array.isArray(item.box_2d) && item.box_2d.length === 4) {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const normY = ymin > 1 ? ymin / 1000 : ymin;
      const normX = xmin > 1 ? xmin / 1000 : xmin;
      const normH = (ymax - ymin) > 1 ? (ymax - ymin) / 1000 : (ymax - ymin);
      const normW = (xmax - xmin) > 1 ? (xmax - xmin) / 1000 : (xmax - xmin);
      x = Math.round(normX * imgW);
      y = Math.round(normY * imgH);
      w = Math.round(normW * imgW);
      h = Math.round(normH * imgH);
    } else {
      x = Number(item.x !== undefined ? item.x : (item.left || 0));
      y = Number(item.y !== undefined ? item.y : (item.top || 0));
      w = Number(item.w !== undefined ? item.w : (item.width || 0));
      h = Number(item.h !== undefined ? item.h : (item.height || 0));

      // Normalizado entre 0 e 1 (se valores fracionários)
      if (x > 0 && x <= 1 && w > 0 && w <= 1) {
        x = Math.round(x * imgW);
        w = Math.round(w * imgW);
      }
      if (y > 0 && y <= 1 && h > 0 && h <= 1) {
        y = Math.round(y * imgH);
        h = Math.round(h * imgH);
      }
    }

    if (w >= 10 && h >= 10) {
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
}

/**
 * Detector heurístico local nos 4 cantos mais prováveis para vídeos.
 */
export function detectLocalHeuristics(width, height) {
  const marginX = Math.round(width * 0.04);
  const marginY = Math.round(height * 0.05);
  const boxW = Math.round(width * 0.22);
  const boxH = Math.round(height * 0.10);

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
