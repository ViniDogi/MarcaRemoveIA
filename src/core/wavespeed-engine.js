import fs from 'node:fs';
import path from 'node:path';

/**
 * Cliente para integração com a API da WaveSpeed AI
 * Suporta remoção de marca d'água em Imagens e Vídeos via IA.
 * Modelos:
 *  - wavespeed-ai/image-watermark-remover
 *  - wavespeed-ai/video-watermark-remover
 */
export class WaveSpeedEngine {
  constructor(apiKey = '') {
    this.apiKey = (apiKey || process.env.WAVESPEED_API_KEY || '').trim();
    this.baseUrl = 'https://api.wavespeed.ai/v1/predictions';
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * Envia mídia (imagem ou vídeo) para a WaveSpeed AI
   */
  async submitWatermarkRemoval({
    filePath,
    mediaType = 'image', // 'image' ou 'video'
    boxes = [],
    outputFormat = null
  }) {
    if (!this.apiKey) {
      throw new Error('Chave de API da WaveSpeed AI não configurada.');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo não encontrado para envio: ${filePath}`);
    }

    const modelId = mediaType === 'video'
      ? 'wavespeed-ai/video-watermark-remover'
      : 'wavespeed-ai/image-watermark-remover';

    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
    const base64Data = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

    const payload = {
      model: modelId,
      input: {
        file: base64Data,
        boxes: boxes && boxes.length > 0 ? boxes : undefined
      }
    };
    if (outputFormat) {
      payload.output_format = outputFormat;
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`WaveSpeed AI retornou erro HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const taskId = data.id || data.prediction_id;
    if (!taskId) {
      throw new Error('WaveSpeed AI não retornou um ID de tarefa válido.');
    }

    return {
      taskId,
      status: data.status || 'starting'
    };
  }

  /**
   * Consulta o status da predição na WaveSpeed AI até concluir
   */
  async pollTaskResult({
    taskId,
    onProgress = null,
    pollIntervalMs = 2500,
    maxWaitMs = 600000 // 10 minutos para vídeos
  }) {
    const statusUrl = `${this.baseUrl}/${taskId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const res = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Erro ao verificar status na WaveSpeed AI (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const status = data.status;

      if (onProgress) {
        onProgress({
          status: `WaveSpeed AI: ${status}...`,
          percent: status === 'completed' ? 100 : (status === 'processing' ? 50 : 20),
          data
        });
      }

      if (status === 'completed' || status === 'succeeded') {
        const outputUrl = data.output || (Array.isArray(data.outputs) ? data.outputs[0] : null);
        if (!outputUrl) {
          throw new Error('Tarefa concluída pela WaveSpeed AI mas nenhuma URL de saída foi retornada.');
        }
        return { success: true, outputUrl };
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`Processamento falhou na WaveSpeed AI: ${data.error || 'Erro desconhecido'}`);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error('Tempo limite excedido aguardando processamento na WaveSpeed AI.');
  }

  /**
   * Baixa a mídia processada pela WaveSpeed AI e salva no disco
   */
  async downloadResult(outputUrl, destinationPath) {
    const res = await fetch(outputUrl);
    if (!res.ok) {
      throw new Error(`Falha ao baixar resultado da WaveSpeed AI: HTTP ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(destinationPath, Buffer.from(arrayBuffer));
    return destinationPath;
  }

  /**
   * Executa pipeline completo: Envio -> Espera -> Download
   */
  async processMedia({
    filePath,
    outputPath,
    mediaType = 'image',
    boxes = [],
    onProgress = null
  }) {
    if (onProgress) onProgress({ status: 'Enviando arquivo para WaveSpeed AI...', percent: 10 });
    const { taskId } = await this.submitWatermarkRemoval({ filePath, mediaType, boxes });

    if (onProgress) onProgress({ status: 'WaveSpeed AI processando remoção com IA...', percent: 30 });
    const { outputUrl } = await this.pollTaskResult({ taskId, onProgress });

    if (onProgress) onProgress({ status: 'Baixando arquivo final da WaveSpeed AI...', percent: 90 });
    await this.downloadResult(outputUrl, outputPath);

    if (onProgress) onProgress({ status: 'Concluído com WaveSpeed AI!', percent: 100 });
    return { success: true, outputPath, taskId };
  }
}
