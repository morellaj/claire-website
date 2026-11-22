// Celebrations: confetti for a finished picture, a sparkle pop for a finished colour.

const SHAPES = ['♥', '✦', '★', '♡', '✧', '🐾'];
const PINKS = ['#FF4FA3', '#FFB6D9', '#D6B8FF', '#ff1f7a', '#FFD9EC', '#ffffff'];

let layer;
function canvasLayer() {
  if (layer) return layer;
  layer = document.createElement('canvas');
  layer.className = 'fun-layer';
  document.body.appendChild(layer);
  return layer;
}

function run(particles, ms) {
  const c = canvasLayer(), dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const ctx = c.getContext('2d');
  const t0 = performance.now();
  return new Promise(resolve => {
    const frame = now => {
      const t = now - t0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of particles) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        const fade = Math.max(0, 1 - t / ms);
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.colour; ctx.font = `${p.size}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.shape, 0, 0); ctx.restore();
      }
      if (t < ms) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, innerWidth, innerHeight); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

/** Big confetti rain for a finished picture, in pinks plus the picture's own colours. */
export function confetti(extraColours = []) {
  const colours = PINKS.concat(extraColours.slice(0, 8));
  const ps = [];
  for (let i = 0; i < 160; i++) {
    ps.push({
      x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
      vx: (Math.random() - 0.5) * 2.2, vy: 1.5 + Math.random() * 3, g: 0.035,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.12,
      size: 14 + Math.random() * 20, shape: SHAPES[i % SHAPES.length], colour: colours[i % colours.length],
    });
  }
  return run(ps, 4200);
}

/** A small burst at a point (a finished colour). */
export function sparkleAt(x, y, colour) {
  const ps = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, sp = 2 + Math.random() * 3;
    ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.06, r: 0, vr: 0.1,
      size: 12 + Math.random() * 10, shape: i % 2 ? '✦' : '♥', colour: i % 3 ? colour : '#FF4FA3' });
  }
  return run(ps, 900);
}
