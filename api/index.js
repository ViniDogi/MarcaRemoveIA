import app from '../src/server.js';

export default function handler(req, res) {
  try {
    const isVercel = Boolean(process.env.VERCEL);
    const forwardedUri = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || req.url;
    if (forwardedUri && forwardedUri !== '/api') {
      req.url = forwardedUri;
    }

    const targetUrl = req.url || '';

    // No ambiente Vercel Serverless, fornece status de hardware informativo
    if (isVercel) {
      if (targetUrl.includes('/api/hardware')) {
        return res.status(200).json({
          ffmpegInstalled: false,
          isVercel: true,
          instruction: "Ambiente Web/Vercel ativo. Uploads diretos até 4.5MB e processamento no navegador suportados.",
          availableEncoders: ["client_canvas", "libx264"],
          primaryEncoder: "client_canvas",
          encoderLabels: [
            { id: "client_canvas", label: "Navegador Web (Canvas Client-side)" },
            { id: "libx264", label: "CPU Universal (libx264)" }
          ]
        });
      }

      if (targetUrl.includes('/api/health')) {
        return res.status(200).json({
          status: 'ok',
          app: 'MarcaRemoveIA',
          version: '4.0.0',
          platform: 'vercel-serverless',
          isVercel: true
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
