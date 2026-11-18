// Canvas-generated textures: no external assets, no network. Every factory returns a
// THREE.CanvasTexture. Facade day/night variants share one deterministic window layout
// per (variant, seed), so the lit windows line up when night falls.
import * as THREE from '../vendor/three.module.js';
import { hashSeed, mulberry32 } from './random.js';

/** Create a 2D canvas of the given size. */
export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function finish(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/** Speckle noise over the whole canvas: `n` dots of random grey around `base`. */
function speckle(ctx, w, h, rng, n, alpha) {
  for (let i = 0; i < n; i += 1) {
    const v = Math.floor(90 + rng() * 110);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(Math.floor(rng() * w), Math.floor(rng() * h), 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
}

/** Asphalt with a dashed centre line running along the canvas height (the road length). */
export function asphaltTexture() {
  const w = 256;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(11);
  ctx.fillStyle = '#34353a';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, rng, 900, 0.16);
  // Faint tyre-wear bands.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(52, 0, 44, h);
  ctx.fillRect(160, 0, 44, h);
  // Edge lines.
  ctx.fillStyle = 'rgba(220,220,210,0.55)';
  ctx.fillRect(6, 0, 3, h);
  ctx.fillRect(w - 9, 0, 3, h);
  // Dashed centre line.
  ctx.fillStyle = 'rgba(240,220,120,0.9)';
  for (let y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 3, y + 8, 6, 32);
  return finish(canvas);
}

/** Pale pavement slabs. */
export function sidewalkTexture() {
  const w = 128;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(23);
  ctx.fillStyle = '#9a978f';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, rng, 350, 0.14);
  ctx.strokeStyle = 'rgba(60,60,58,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(w, i * 32); ctx.stroke();
  }
  return finish(canvas);
}

/** Deterministic window layout for one facade variant/seed. */
function facadeLayout(variant, seed) {
  const rng = mulberry32(hashSeed(`facade:${variant}:${seed}`));
  const bases = ['#9a8874', '#7d8b9c', '#a87f68', '#8b9a7d', '#94849e', '#6d7d90'];
  const base = bases[((variant % bases.length) + bases.length) % bases.length];
  const cols = 5 + Math.floor(rng() * 3);
  const rows = 8 + Math.floor(rng() * 5);
  const windows = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      windows.push({ c, r, lit: rng() < 0.38 });
    }
  }
  return { base, cols, rows, windows };
}

function drawFacade(ctx, w, h, layout, night) {
  ctx.fillStyle = night ? '#20242c' : layout.base;
  ctx.fillRect(0, 0, w, h);
  // Subtle vertical grime / panel seams.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 2, h);
  const padX = 14;
  const padTop = 16;
  const padBottom = 14;
  const cellW = (w - padX * 2) / layout.cols;
  const cellH = (h - padTop - padBottom) / layout.rows;
  for (const win of layout.windows) {
    const x = padX + win.c * cellW + cellW * 0.2;
    const y = padTop + win.r * cellH + cellH * 0.22;
    const ww = cellW * 0.6;
    const wh = cellH * 0.56;
    if (night) {
      ctx.fillStyle = win.lit ? '#ffd27a' : '#0d1520';
    } else {
      ctx.fillStyle = win.lit ? '#5a6d80' : '#46586c';
    }
    ctx.fillRect(x, y, ww, wh);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, ww, 2);
  }
  // Ground-floor shopfront band.
  ctx.fillStyle = night ? '#101318' : 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, h - 26, w, 26);
}

/**
 * Building facade. `variant` picks the base colour family; `lit` draws the night
 * version (dark walls, warm lit windows). Same (variant, seed) → same window layout.
 */
export function facadeTexture(variant, lit, seed = 0) {
  const layout = facadeLayout(variant, seed);
  const canvas = makeCanvas(256, 512);
  drawFacade(canvas.getContext('2d'), 256, 512, layout, !!lit);
  return finish(canvas);
}

/**
 * Glow-only facade: black everywhere except the lit windows. Use as emissiveMap
 * with emissive white so windows glow at night without re-texturing the walls.
 */
export function facadeGlowTexture(variant, seed = 0) {
  const layout = facadeLayout(variant, seed);
  const canvas = makeCanvas(256, 512);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 512);
  const padX = 14;
  const padTop = 16;
  const padBottom = 14;
  const cellW = (256 - padX * 2) / layout.cols;
  const cellH = (512 - padTop - padBottom) / layout.rows;
  for (const win of layout.windows) {
    if (!win.lit) continue;
    const x = padX + win.c * cellW + cellW * 0.2;
    const y = padTop + win.r * cellH + cellH * 0.22;
    ctx.fillStyle = '#ffca6a';
    ctx.fillRect(x, y, cellW * 0.6, cellH * 0.56);
  }
  return finish(canvas);
}

/** Day + night facade pair sharing one layout (convenience for city.js). */
export function facadeTexturePair(variant, seed = 0) {
  return { day: facadeTexture(variant, false, seed), night: facadeTexture(variant, true, seed), glow: facadeGlowTexture(variant, seed) };
}

/** Flat roof: dark membrane with a pale parapet edge. */
export function roofTexture() {
  const w = 128;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(41);
  ctx.fillStyle = '#3a3d44';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, rng, 260, 0.15);
  ctx.strokeStyle = 'rgba(200,200,195,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(20, 20, 26, 18);
  ctx.fillRect(84, 78, 22, 22);
  return finish(canvas);
}

/** Lawns and park strips. */
export function grassTexture() {
  const w = 128;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(53);
  ctx.fillStyle = '#4d7a3a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i += 1) {
    const g = 90 + Math.floor(rng() * 70);
    ctx.fillStyle = `rgba(30,${g},40,0.5)`;
    ctx.fillRect(Math.floor(rng() * w), Math.floor(rng() * h), 2, 3 + Math.floor(rng() * 3));
  }
  return finish(canvas);
}

/** Beach sand. */
export function sandTexture() {
  const w = 128;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(67);
  ctx.fillStyle = '#d9c28a';
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, rng, 500, 0.18);
  ctx.strokeStyle = 'rgba(160,130,80,0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    const y = rng() * h;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 3);
    ctx.stroke();
  }
  return finish(canvas);
}

/** Sea surface: deep blue with pale wave streaks (offset is animated by city.js). */
export function waterTexture() {
  const w = 256;
  const h = 256;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(71);
  ctx.fillStyle = '#1d6f8e';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(180,225,245,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i += 1) {
    const y = rng() * h;
    const x = rng() * w;
    const len = 20 + rng() * 60;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y + (rng() - 0.5) * 10, x + len, y);
    ctx.stroke();
  }
  speckle(ctx, w, h, rng, 200, 0.08);
  return finish(canvas);
}

/**
 * Glowing sign text on a transparent background. Use on a plane with a
 * MeshBasicMaterial ({map, transparent: true}) — bright at night, dim by day.
 */
export function neonTexture(text, color = '#ff4fa3') {
  const w = 512;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 2);
  ctx.fillText(text, w / 2, h / 2 + 2);
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
