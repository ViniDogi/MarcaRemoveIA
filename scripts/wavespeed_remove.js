#!/usr/bin/env node
/**
 * Script CLI de Remoção de Marca d'Água com WaveSpeed AI
 * Uso:
 *   node scripts/wavespeed_remove.js --input video.mp4 --output video_limpo.mp4 --api-key SUA_CHAVE
 */

import path from 'node:path';
import fs from 'node:fs';
import { WaveSpeedEngine } from '../src/core/wavespeed-engine.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      params[key] = val;
    }
  }
  return params;
}

async function main() {
  const args = parseArgs();
  const input = args.input || args.i;
  const output = args.output || args.o;
  const apiKey = args['api-key'] || args.key || process.env.WAVESPEED_API_KEY;

  if (!input) {
    console.error('Uso: node scripts/wavespeed_remove.js --input <arquivo> [--output <destino>] [--api-key <chave>]');
    process.exit(1);
  }

  if (!fs.existsSync(input)) {
    console.error(`Erro: Arquivo não encontrado: ${input}`);
    process.exit(1);
  }

  if (!apiKey) {
    console.error('Erro: Chave de API da WaveSpeed AI não fornecida (--api-key ou variável WAVESPEED_API_KEY).');
    process.exit(1);
  }

  const ext = path.extname(input).toLowerCase();
  const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.webm'].includes(ext);
  const mediaType = isVideo ? 'video' : 'image';
  const outPath = output || path.join(path.dirname(input), `wavespeed_clean_${path.basename(input)}`);

  console.log(`[WaveSpeed AI] Iniciando remoção de marca d'água (${mediaType})...`);
  console.log(`Entrada: ${input}`);
  console.log(`Saída: ${outPath}`);

  const engine = new WaveSpeedEngine(apiKey);

  try {
    const result = await engine.processMedia({
      filePath: path.resolve(input),
      outputPath: path.resolve(outPath),
      mediaType,
      onProgress: (p) => {
        console.log(`[WaveSpeed AI] ${p.status || ''} ${p.percent ? `(${p.percent}%)` : ''}`);
      }
    });

    console.log(`\n✅ Sucesso! Arquivo limpo salvo em: ${result.outputPath}`);
  } catch (err) {
    console.error(`\n❌ Falha no processamento:`, err.message);
    process.exit(1);
  }
}

main();
