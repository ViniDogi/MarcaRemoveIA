import app from '../src/server.js';

export default function handler(req, res) {
  try {
    return app(req, res);
  } catch (err) {
    console.error('Erro na invocação da função Vercel:', err);
    return res.status(500).json({
      error: 'Erro interno na função serverless',
      message: err.message
    });
  }
}
