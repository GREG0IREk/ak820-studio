// Préparation des images pour l'écran 128 × 128 (navigateur uniquement).
import { TFT_SIZE, rgbaToRgb565 } from './protocol.js';

/**
 * Décode un fichier en images brutes : [{ bitmap: ImageBitmap|VideoFrame, delayMs }].
 * GIF / WebP / PNG animés via ImageDecoder (WebCodecs, images déjà composées), sinon une seule image.
 */
export async function decodeFile(file, maxFrames) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Fichier trop lourd (20 Mo au plus)');
  const type = file.type || 'image/gif';
  if ('ImageDecoder' in window && /gif|webp|png|apng/.test(type)) {
    try {
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
      await dec.tracks.ready;
      const count = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
      const step = count > maxFrames ? count / maxFrames : 1;
      const frames = [];
      let total = 0;
      const durations = [];
      for (let i = 0; i < count; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const d = image.duration ? image.duration / 1000 : 100;
        durations.push(d);
        image.close();
      }
      // Sous-échantillonnage régulier quand l'animation dépasse la limite du clavier.
      for (let k = 0; k < Math.min(count, maxFrames); k++) {
        const from = Math.floor(k * step);
        const to = Math.floor((k + 1) * step);
        let delay = 0;
        for (let j = from; j < Math.max(to, from + 1); j++) delay += durations[j];
        const { image } = await dec.decode({ frameIndex: from });
        const bitmap = await createImageBitmap(image);
        image.close();
        frames.push({ bitmap, delayMs: delay || 100 });
        total += delay;
      }
      dec.close();
      return { frames, sourceCount: count, totalMs: total };
    } catch (e) {
      if (!/png/.test(type)) throw e;
    }
  }
  const bitmap = await createImageBitmap(file);
  return { frames: [{ bitmap, delayMs: 0 }], sourceCount: 1, totalMs: 0 };
}

/**
 * Rend une image dans un carré 128 × 128.
 * opts = { fit: 'cover'|'contain', zoom 1-3, offsetX/offsetY -1..1, background '#rrggbb' }
 */
export function renderFrame(bitmap, opts, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = TFT_SIZE;
  c.height = TFT_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = opts.background || '#000000';
  ctx.fillRect(0, 0, TFT_SIZE, TFT_SIZE);
  const bw = bitmap.width || bitmap.displayWidth;
  const bh = bitmap.height || bitmap.displayHeight;
  const base = opts.fit === 'contain' ? Math.min(TFT_SIZE / bw, TFT_SIZE / bh) : Math.max(TFT_SIZE / bw, TFT_SIZE / bh);
  const s = base * (opts.zoom || 1);
  const w = bw * s, h = bh * s;
  const slackX = Math.max(0, w - TFT_SIZE) / 2, slackY = Math.max(0, h - TFT_SIZE) / 2;
  const x = (TFT_SIZE - w) / 2 - (opts.offsetX || 0) * slackX;
  const y = (TFT_SIZE - h) / 2 - (opts.offsetY || 0) * slackY;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, x, y, w, h);
  return c;
}

/** Image rendue vers RGB565, et aperçu fidèle (couleurs quantifiées comme sur l'écran). */
export function toPixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, TFT_SIZE, TFT_SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] &= 0xf8;
    img.data[i + 1] &= 0xfc;
    img.data[i + 2] &= 0xf8;
    img.data[i + 3] = 255;
  }
  return { pixels: rgbaToRgb565(img.data), preview: img };
}
