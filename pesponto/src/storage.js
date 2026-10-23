'use strict';
// Armazenamento de mídia: arquivos em disco/volume; o banco guarda só o caminho.
// Para S3/Supabase Storage/R2, troque put/remove mantendo a mesma interface.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('sharp indisponível: imagens serão salvas sem redimensionar.'); }
fs.mkdirSync(config.uploadDir, { recursive: true });

const rid = () => crypto.randomBytes(12).toString('hex');
const urlFor = (rel) => (rel ? (/^(https?:)?\/\//.test(rel) || rel.startsWith('/') ? rel : `/uploads/${rel}`) : null);

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'gif';
  if (buf.slice(4, 8).toString() === 'ftyp') return 'mp4';
  if (buf.slice(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}
async function put(rel, buf) {
  const full = path.join(config.uploadDir, rel);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buf);
  return rel;
}
// Valida pelo conteúdo, remove metadados (EXIF/GPS), redimensiona e gera miniatura.
async function saveImage(buf, { max = 1600, thumb = 480 } = {}) {
  const kind = sniff(buf);
  if (!['jpg', 'png', 'webp', 'gif'].includes(kind)) throw new Error('Formato de imagem não aceito. Envie JPG, PNG ou WebP.');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '/');
  const id = rid();
  if (!sharp) { const rel = await put(`${ym}/${id}.${kind}`, buf); return { path: rel, thumb: rel }; }
  const base = sharp(buf, { failOn: 'error', limitInputPixels: 60e6 }).rotate();
  const full = await base.clone().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const small = await base.clone().resize({ width: thumb, height: thumb, fit: 'cover', position: 'attention' }).webp({ quality: 74 }).toBuffer();
  return { path: await put(`${ym}/${id}.webp`, full), thumb: await put(`${ym}/${id}-t.webp`, small) };
}
async function saveVideo(buf) {
  const kind = sniff(buf);
  if (!['mp4', 'webm'].includes(kind)) throw new Error('Vídeo não aceito. Envie MP4 ou WebM (ou cole um link do YouTube/Vimeo).');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '/');
  return { path: await put(`${ym}/${rid()}.${kind}`, buf) };
}
async function remove(...rels) {
  for (const rel of rels.filter(Boolean)) {
    if (/^(https?:)?\/\//.test(rel) || rel.startsWith('/')) continue; // arquivos estáticos do demo não são apagados
    const full = path.resolve(config.uploadDir, rel);
    if (!full.startsWith(config.uploadDir + path.sep)) continue;
    await fs.promises.unlink(full).catch(() => {});
  }
}
module.exports = { saveImage, saveVideo, remove, urlFor, sniff };
