import app from '../src/server.js';

export default function handler(req, res) {
  try {
    const isVercel = Boolean(process.env.VERCEL);
    const forwardedUri = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url;
    if (forwardedUri && forwardedUri !== '/api') {
      req.url = forwardedUri;
    }

    const targetUrl = req.url || '';

    // No ambiente Vercel Serverless, binários como FFmpeg e yt-dlp não estão disponíveis
    if (isVercel) {
      if (targetUrl.includes('/api/hardware')) {
        return res.status(200).json({
          ffmpegInstalled: false,
          isVercel: true,
          instruction: "Ambiente Vercel detectado. O processamento com IA e FFmpeg requer execução local. Execute 'run_web.bat' no seu computador e acesse http://127.0.0.1:8000.",
          availableEncoders: ["libx264"],
          primaryEncoder: "libx264",
          encoderLabels: [{ id: "libx264", label: "CPU Universal (libx264)" }]
        });
      }

      if (targetUrl.includes('/api/health')) {
        return res.status(200).json({
          status: 'ok',
          app: 'MarcaRemoveIA',
          version: '2.0.0',
          platform: 'vercel-serverless',
          isVercel: true
        });
      }

      if (
        targetUrl.includes('/api/upload') ||
        targetUrl.includes('/api/remote-download') ||
        targetUrl.includes('/api/process') ||
        targetUrl.includes('/api/detect-ai') ||
        targetUrl.includes('/api/match-template') ||
        targetUrl.includes('/api/preview-frame')
      ) {
        return res.status(200).json({
          success: false,
          error: "O ambiente serverless da Vercel não possui suporte a FFmpeg, yt-dlp ou uploads pesados (>4.5MB). Execute o MarcaRemoveIA no seu computador executando 'run_web.bat' (ou 'run.bat') e acesse http://127.0.0.1:8000."
        });
      }
    }

    return app(req, res);
  } catch (err) {
    console.error('Erro na invocação da função Vercel:', err);
    return res.status(500).json({
      success: false,
      error: 'Erro interno na função serverless: ' + err.message
    });
  }
}
