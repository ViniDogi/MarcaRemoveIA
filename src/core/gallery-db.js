import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFfmpegBinary, spawnPromise, getVideoMetadata } from '../utils/ffmpeg.js';
import { getSharp } from './onnx-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const isVercel = Boolean(process.env.VERCEL);

const OUTPUT_DIR = isVercel ? '/tmp/web_outputs' : path.join(projectRoot, 'web_outputs');
const THUMB_DIR = isVercel ? '/tmp/web_outputs/thumbnails' : path.join(OUTPUT_DIR, 'thumbnails');
const DB_FILE = isVercel ? '/tmp/web_outputs/gallery.json' : path.join(OUTPUT_DIR, 'gallery.json');

try {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
} catch {
  // Ignora em sistemas de arquivos somente-leitura
}

class GalleryDB {
  constructor() {
    this.items = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.items = JSON.parse(raw);
        if (!Array.isArray(this.items)) {
          this.items = [];
        }
      } else {
        this.items = [];
      }
    } catch (err) {
      console.warn('[GalleryDB] Erro ao carregar galeria:', err.message);
      this.items = [];
    }
  }

  _save() {
    try {
      if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(this.items, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[GalleryDB] Erro ao salvar galeria:', err.message);
    }
  }

  getAll() {
    // Retorna ordenado do mais recente para o mais antigo
    return [...this.items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getById(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  async addMedia({
    id,
    title = null,
    mediaType = 'video', // 'video' | 'image'
    filePath,
    duration = 0,
    width = 0,
    height = 0,
    size = 0,
    source = 'inpainting' // 'inpainting' | 'editor'
  }) {
    if (!id || !filePath) {
      throw new Error('id e filePath são obrigatórios para registrar mídia na galeria.');
    }

    // Se o item já existir, atualiza
    const existingIdx = this.items.findIndex((it) => it.id === id);

    let finalSize = size;
    if ((!finalSize || finalSize <= 0) && fs.existsSync(filePath)) {
      try {
        finalSize = fs.statSync(filePath).size;
      } catch {}
    }

    const ext = path.extname(filePath).toLowerCase();
    const isImage = mediaType === 'image' || ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);
    const isAudio = mediaType === 'audio' || ['.mp3', '.m4a', '.wav', '.aac', '.ogg'].includes(ext);
    const actualMediaType = isAudio ? 'audio' : (isImage ? 'image' : 'video');

    // Gera miniatura (Thumbnail)
    const thumbFilename = `thumb_${id}.jpg`;
    const thumbPath = path.join(THUMB_DIR, thumbFilename);
    const thumbUrl = `/api/gallery/thumbnail/${id}`;

    if (!fs.existsSync(thumbPath) && fs.existsSync(filePath)) {
      try {
        if (isAudio) {
          const sharp = await getSharp();
          if (sharp) {
            const svg = `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#0b132b"/>
                  <stop offset="100%" stop-color="#1e3a8a"/>
                </linearGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#bg)"/>
              <text x="160" y="105" font-family="system-ui, sans-serif" font-size="52" text-anchor="middle" fill="#38bdf8">🎵</text>
              <text x="160" y="150" font-family="system-ui, sans-serif" font-weight="bold" font-size="16" text-anchor="middle" fill="#f8fafc">Áudio Separado MP3</text>
              <rect x="70" y="180" width="8" height="24" rx="4" fill="#38bdf8"/>
              <rect x="90" y="170" width="8" height="44" rx="4" fill="#60a5fa"/>
              <rect x="110" y="175" width="8" height="34" rx="4" fill="#38bdf8"/>
              <rect x="130" y="165" width="8" height="54" rx="4" fill="#60a5fa"/>
              <rect x="150" y="158" width="8" height="68" rx="4" fill="#93c5fd"/>
              <rect x="170" y="165" width="8" height="54" rx="4" fill="#60a5fa"/>
              <rect x="190" y="175" width="8" height="34" rx="4" fill="#38bdf8"/>
              <rect x="210" y="170" width="8" height="44" rx="4" fill="#60a5fa"/>
              <rect x="230" y="180" width="8" height="24" rx="4" fill="#38bdf8"/>
            </svg>`;
            await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(thumbPath);
          }
        } else if (isImage) {
          const sharp = await getSharp();
          if (sharp) {
            await sharp(filePath)
              .resize(320, 240, { fit: 'cover' })
              .jpeg({ quality: 80 })
              .toFile(thumbPath);
          }
        } else {
          // Extrai 1 quadro para thumbnail do vídeo
          const ffmpegExe = getFfmpegBinary();
          const seekTime = duration > 1 ? 1.0 : 0.0;
          await spawnPromise(ffmpegExe, [
            '-y',
            '-ss', seekTime.toString(),
            '-i', filePath,
            '-vframes', '1',
            '-vf', 'scale=320:-2',
            '-q:v', '3',
            thumbPath
          ]);
        }
      } catch (thumbErr) {
        console.warn(`[GalleryDB] Aviso ao gerar thumbnail para ${id}:`, thumbErr.message);
      }
    }

    const item = {
      id,
      title: title || (isAudio ? `Áudio Extraído (${id.slice(0, 8)})` : (isImage ? `Imagem Processada (${id.slice(0, 8)})` : `Vídeo Sem Marca (${id.slice(0, 8)})`)),
      mediaType: actualMediaType,
      filename: path.basename(filePath),
      filePath,
      url: `/api/result/${id}`,
      downloadUrl: `/api/download/${id}`,
      thumbnailUrl: fs.existsSync(thumbPath) ? thumbUrl : null,
      thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : null,
      duration: Number(duration) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
      size: Number(finalSize) || 0,
      source,
      createdAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      this.items[existingIdx] = { ...this.items[existingIdx], ...item };
    } else {
      this.items.unshift(item);
    }

    this._save();
    return item;
  }

  deleteMedia(id) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) return false;

    const item = this.items[idx];

    // Remove arquivos do disco se existirem e estiverem dentro de OUTPUT_DIR
    try {
      if (item.filePath && fs.existsSync(item.filePath) && item.filePath.startsWith(OUTPUT_DIR)) {
        fs.unlinkSync(item.filePath);
      }
    } catch (e) {
      console.warn(`[GalleryDB] Não foi possível apagar arquivo ${item.filePath}:`, e.message);
    }

    try {
      if (item.thumbnailPath && fs.existsSync(item.thumbnailPath)) {
        fs.unlinkSync(item.thumbnailPath);
      }
    } catch (e) {
      console.warn(`[GalleryDB] Não foi possível apagar thumbnail:`, e.message);
    }

    this.items.splice(idx, 1);
    this._save();
    return true;
  }

  /**
   * Varre o diretório web_outputs na inicialização para registrar mídias existentes
   */
  async scanExistingOutputs() {
    try {
      if (!fs.existsSync(OUTPUT_DIR)) return;
      const files = fs.readdirSync(OUTPUT_DIR);

      for (const f of files) {
        if (f.startsWith('thumbnail') || f === 'gallery.json') continue;
        const fullPath = path.join(OUTPUT_DIR, f);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size === 0) continue;

        // Se já está catalogado, continua
        const id = f.replace(/^(clean_|output_)/, '').replace(/\.[^.]+$/, '');
        if (this.items.some((it) => it.id === id || it.filename === f)) continue;

        const ext = path.extname(f).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(ext);
        const isAudio = ['.mp3', '.m4a', '.wav', '.aac', '.ogg'].includes(ext);

        let width = 0, height = 0, duration = 0;
        if (!isImage) {
          const meta = await getVideoMetadata(fullPath);
          if (meta) {
            width = meta.width || 0;
            height = meta.height || 0;
            duration = meta.duration || 0;
          }
        }

        await this.addMedia({
          id,
          title: isAudio ? `Áudio Salvo (${id.slice(0, 8)})` : (isImage ? `Imagem Processada (${id.slice(0, 8)})` : `Vídeo Sem Marca (${id.slice(0, 8)})`),
          mediaType: isAudio ? 'audio' : (isImage ? 'image' : 'video'),
          filePath: fullPath,
          duration,
          width,
          height,
          size: stat.size,
          source: 'inpainting'
        });
      }
    } catch (err) {
      console.warn('[GalleryDB] Aviso ao varrer web_outputs:', err.message);
    }
  }
}

export const galleryDb = new GalleryDB();
