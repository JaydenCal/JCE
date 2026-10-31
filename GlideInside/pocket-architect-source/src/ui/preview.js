// Small canvas previews of catalogue furniture, drawn by each item's own draw2d symbol.

export function drawItemPreview(canvas, def, cssSize = 64) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  const cs = getComputedStyle(canvas);
  const line = cs.getPropertyValue('--ps-line').trim() || '#2b3d54';
  const fill = cs.getPropertyValue('--ps-canvas').trim() || '#f4f7fa';
  const w = def?.w || 600;
  const d = def?.d || 600;
  const k = (cssSize - 12) / Math.max(w, d);
  ctx.save();
  ctx.translate(cssSize / 2, cssSize / 2);
  ctx.scale(k, k);
  ctx.strokeStyle = line;
  ctx.fillStyle = fill;
  ctx.lineWidth = 1.3 / k;
  ctx.lineJoin = 'round';
  try {
    if (typeof def?.draw2d !== 'function') throw new Error('no symbol');
    def.draw2d(ctx, w, d);
  } catch {
    ctx.beginPath();
    ctx.rect(-w / 2, -d / 2, w, d);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
