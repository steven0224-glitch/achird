/* Thinking Orbs — dotted monochrome canvas thinking indicators.
   Vanilla port of https://github.com/Jakubantalik/thinking-orbs (MIT, Jakub Antalik).
   9 states × 2 tuned size presets, plain 2D canvas, no filters/WebGL.
   Exposes window.ThinkingOrbs.create(state, px) → <canvas>. One shared rAF clock;
   disconnected canvases are pruned automatically; reduced-motion gets a static frame. */
(() => {
  "use strict";

  /* ------------ core ------------ */
  const lerp = (a, b, f) => a + (b - a) * f;
  const frac = (x) => x - Math.floor(x);
  const hashD = (a, b) => { const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hashD(xi, yi), b = hashD(xi + 1, yi), c = hashD(xi, yi + 1), d = hashD(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fibDir(i, n) {
    const g = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), a = i * g;
    return [rad * Math.cos(a), y, rad * Math.sin(a)];
  }
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function makeProj(yaw, tilt, cx, cy, scale) {
    const st = Math.sin(tilt), ct = Math.cos(tilt), sy = Math.sin(yaw), cyw = Math.cos(yaw);
    return (x, y, z) => {
      const x1 = x * cyw + z * sy, z1 = -x * sy + z * cyw;
      return [cx + x1 * scale, cy - (y * ct - z1 * st) * scale, y * st + z1 * ct];
    };
  }
  // achird 대표 색상(--accent, 라이트 골드 / 다크 골드) 을 읽어 hue/sat 을 얻고,
  // 기존 grayscale 로직의 명도(g)만 그대로 재사용해 톤을 입힌다.
  const accentHSLCache = new Map();
  function accentHSL(dark) {
    const key = dark ? 1 : 0;
    const hit = accentHSLCache.get(key);
    if (hit) return hit;
    const hex = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    let h = 42, s = 84; // fallback: achird gold
    if (m) {
      const n = parseInt(m[1], 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
      if (d !== 0) {
        s = (l > 0.5 ? d / (2 - max - min) : d / (max + min)) * 100;
        h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
      }
    }
    const hsl = { h, s };
    accentHSLCache.set(key, hsl);
    return hsl;
  }
  function paint(ctx, dots, dark, rMin = 0.3) {
    const { h, s } = accentHSL(dark);
    dots.sort((a, b) => a.z - b.z);
    for (const d of dots) {
      const alpha = d.a ?? 1;
      if (alpha < 0.02) continue;
      const w = Math.min(1, Math.max(0, d.white));
      const l = Math.round((dark ? 1 - w : w) * 100);
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,${alpha})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(rMin, d.r), 0, Math.PI * 2); ctx.fill();
    }
  }
  function paintLines(ctx, lines, dark) {
    const { h, s } = accentHSL(dark);
    for (const l of lines) {
      const alpha = l.a ?? 1;
      if (alpha < 0.02) continue;
      const w = Math.min(1, Math.max(0, l.white));
      const li = Math.round((dark ? 1 - w : w) * 100);
      ctx.strokeStyle = `hsla(${h},${s}%,${li}%,${alpha})`;
      ctx.lineWidth = l.w;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    }
  }
  const radiusScale = (size, pow) => (size / 300) ** pow;

  /* ------------ modes ------------ */
  function drawOrbits(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.82;
    const pt = makeProj(t * 0.12, 0.3, cx, cy, 1);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const dots = [];
    const orbitN = o.orbitN ?? 12, ghostN = o.ghostN ?? 40, particles = o.particles ?? 3;
    for (let orb = 0; orb < orbitN; orb++) {
      const h1 = hashD(orb, 1.7), h2 = hashD(orb, 5.2), h3 = hashD(orb, 8.9);
      const ro = R * (0.45 + 0.52 * h1), th = h1 * 2 * Math.PI, phi = Math.acos(2 * h2 - 1);
      const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      let ux = -ny, uy = nx; const uz = 0;
      const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy)); ux /= ul; uy /= ul;
      const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
      const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
      for (let k = 0; k < ghostN; k++) {
        const a = (k / ghostN) * 2 * Math.PI;
        const [px, py, z] = pt((ux * Math.cos(a) + vx * Math.sin(a)) * ro,
                               (uy * Math.cos(a) + vy * Math.sin(a)) * ro,
                               (uz * Math.cos(a) + vz * Math.sin(a)) * ro);
        const depth = (z / ro + 1) / 2;
        dots.push({ x: px, y: py, z, r: (o.ghostR ?? 0.9) * rs, white: 0.72, a: (o.ghostA ?? 0.5) * (0.4 + 0.6 * depth) });
      }
      for (let m = 0; m < particles; m++) {
        const a = t * speed + (m / particles) * 2 * Math.PI + h2 * 6;
        const [px, py, z] = pt((ux * Math.cos(a) + vx * Math.sin(a)) * ro,
                               (uy * Math.cos(a) + vy * Math.sin(a)) * ro,
                               (uz * Math.cos(a) + vz * Math.sin(a)) * ro);
        const depth = (z / ro + 1) / 2;
        dots.push({ x: px, y: py, z, r: ((o.partR ?? 1.2) + (o.partRDepth ?? 1.6) * depth) * rs, white: 0.3 - 0.22 * depth });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  function solveCycle(time, count, slotDur, rest) {
    const cyc = 2 * count * slotDur + rest, tc = time % cyc;
    const amount = new Array(count).fill(0);
    let active = -1;
    if (tc < 2 * count * slotDur) {
      const slot = Math.floor(tc / slotDur), p = (tc - slot * slotDur) / slotDur;
      const cl = Math.min(1, p / 0.7), ep = 1 - (1 - cl) ** 3;
      if (slot < count) { for (let i = 0; i < slot; i++) amount[i] = 1; amount[slot] = ep; active = slot; }
      else { const u = 2 * count - 1 - slot; for (let i = 0; i < u; i++) amount[i] = 1; amount[u] = 1 - ep; active = u; }
    }
    return { amount, active };
  }
  function applyMoves(pt3, moves, sc) {
    let [x, y, z] = pt3; let inActive = false;
    for (let i = 0; i < moves.length; i++) {
      if (sc.amount[i] <= 0) continue;
      const mv = moves[i];
      const coord = mv.axis === 0 ? x : mv.axis === 1 ? y : z;
      if (coord < mv.lo || coord >= mv.hi) continue;
      if (i === sc.active) inActive = true;
      const a = mv.ang * sc.amount[i], ca = Math.cos(a), sa = Math.sin(a);
      if (mv.axis === 0) { const y2 = y * ca - z * sa; z = y * sa + z * ca; y = y2; }
      else if (mv.axis === 1) { const x2 = x * ca + z * sa; z = -x * sa + z * ca; x = x2; }
      else { const x2 = x * ca - y * sa; y = x * sa + y * ca; x = x2; }
    }
    return [x, y, z, inActive];
  }
  function makeMoves(count) {
    const moves = [];
    for (let i = 0; i < count; i++) {
      const axis = Math.min(2, Math.floor(hashD(i, 2.3) * 3));
      const lo = -1.0 + 0.5 * Math.min(3, Math.floor(hashD(i, 5.9) * 4));
      const dir = hashD(i, 7.7) < 0.5 ? 1 : -1;
      moves.push({ axis, lo, hi: lo + 0.5, ang: (dir * Math.PI) / 2 });
    }
    return moves;
  }

  function drawGlobe(ctx, size, t, dark, o) {
    const spin = 0.5, cx = size / 2, cy = size / 2, radius = (size / 2) * 0.82;
    const tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
    const pt = makeProj(t * spin, tilt, cx, cy, radius);
    const scan = t * (spin + (1.7 - spin) * (o.scanMul ?? 1));
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const dimBase = o.dimBase ?? 1;
    const dots = [];
    const latRings = o.latRings ?? 17, lonDensity = o.lonDensity ?? 44;
    for (let li = 0; li <= latRings; li++) {
      const lat = -Math.PI / 2 + (li / latRings) * Math.PI;
      const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (let lj = 0; lj < lonCount; lj++) {
        const lon = (lj / lonCount) * 2 * Math.PI;
        const [px, py, z] = pt(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
        const depth = (z + 1) / 2;
        const d = angleDelta(lon + t * spin, scan);
        const boost = Math.exp(-(d * d) / 0.18) * Math.max(0, z);
        dots.push({ x: px, y: py, z,
          r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth + (o.rBoost ?? 1) * boost) * rs,
          white: (o.inkFar ?? 0.62) - (o.inkSpan ?? 0.54) * depth,
          a: dimBase + (1 - dimBase) * Math.min(1, boost) });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  function drawRubik(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.82;
    const pt = makeProj(t * 0.55, 0.35 + 0.1 * Math.sin(t * 0.9), cx, cy, R);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const moveCount = o.moveCount ?? 14;
    const moves = makeMoves(moveCount);
    const sc = solveCycle(t, moveCount, 0.42, 1.2);
    const dots = [];
    const latRings = o.latRings ?? 15, lonDensity = o.lonDensity ?? 40;
    for (let li = 0; li <= latRings; li++) {
      const lat = -Math.PI / 2 + (li / latRings) * Math.PI;
      const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (let lj = 0; lj < lonCount; lj++) {
        const lon = (lj / lonCount) * 2 * Math.PI;
        const [x, y, z, inActive] = applyMoves([cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)], moves, sc);
        const [px, py, zr] = pt(x, y, z);
        const depth = (zr + 1) / 2;
        dots.push({ x: px, y: py, z: zr,
          r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth + (inActive ? (o.rActive ?? 0.3) : 0)) * rs,
          white: (o.inkFar ?? 0.62) - (o.inkSpan ?? 0.54) * depth - (inActive ? 0.14 : 0) });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  function drawWave(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.874;
    const pt = makeProj(t * 0.18, 0.38, cx, cy, 1);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const dots = [];
    const rings = o.rings ?? 15, lonDensity = o.lonDensity ?? 40;
    for (let ri = 0; ri <= rings; ri++) {
      const lat = -Math.PI / 2 + (ri / rings) * Math.PI;
      const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      const w = 0.62 * Math.sin(t * 2.1 - ri * 0.52) + 0.38 * Math.sin(t * 1.27 + ri * 0.83);
      const rr = R * (0.88 + 0.105 * w);
      const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
      for (let lj = 0; lj < lonCount; lj++) {
        const lon = (lj / lonCount) * 2 * Math.PI;
        const [px, py, z] = pt(cosLat * Math.cos(lon) * rr, sinLat * rr, cosLat * Math.sin(lon) * rr);
        const depth = (z / R + 1) / 2;
        const crest = Math.max(0, w);
        dots.push({ x: px, y: py, z,
          r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth) * (1 + 0.4 * crest) * rs,
          white: 0.66 - 0.56 * depth - 0.1 * crest });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  function drawWeb(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.8 * (o.spread ?? 1);
    const pt = makeProj(t * 0.12, 0.32, cx, cy, R);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const nodeN = o.nodeN ?? 30, thr = o.thr ?? 0.72;
    const nodeR = o.nodeR ?? 1.4, nodeRDepth = o.nodeRDepth ?? 1.8;
    const nodes = [];
    for (let i = 0; i < nodeN; i++) {
      const d = fibDir(i, nodeN);
      const x = d[0] + 0.3 * (vnoise(i * 0.31 + 9, t * 0.24) - 0.5) * 2;
      const y = d[1] + 0.3 * (vnoise(i * 0.53 + 27, t * 0.21) - 0.5) * 2;
      const z = d[2] + 0.3 * (vnoise(i * 0.77 + 55, t * 0.27) - 0.5) * 2;
      const l = Math.sqrt(x * x + y * y + z * z);
      nodes.push([x / l, y / l, z / l]);
    }
    const lines = [], dots = [];
    for (let i = 0; i < nodeN; i++) for (let j = i + 1; j < nodeN; j++) {
      const dx = nodes[i][0] - nodes[j][0], dy = nodes[i][1] - nodes[j][1], dz = nodes[i][2] - nodes[j][2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= thr) continue;
      const [x1, y1, z1] = pt(...nodes[i]);
      const [x2, y2, z2] = pt(...nodes[j]);
      const depth = ((z1 + z2) / 2 + 1) / 2;
      lines.push({ x1, y1, x2, y2, white: 0.42, a: (1 - dist / thr) * (0.3 + 0.55 * depth), w: Math.max(0.6, (o.lineW ?? 0.8) * rs) });
    }
    for (let i = 0; i < nodeN; i++) {
      const [px, py, z] = pt(...nodes[i]);
      const depth = (z + 1) / 2;
      const pulse = 1 + 0.25 * Math.sin(t * 1.4 + i * 2.7);
      dots.push({ x: px, y: py, z, r: (nodeR + nodeRDepth * depth) * pulse * rs, white: 0.55 - 0.45 * depth });
    }
    const signals = o.signals ?? 5;
    for (let s = 0; s < signals; s++) {
      const seg = Math.floor(t * 0.55 + s * 7.31);
      const a = Math.floor(hashD(seg, s * 3.1 + 1.7) * nodeN);
      const b = Math.floor(hashD(seg, s * 5.7 + 4.2) * nodeN);
      if (a === b) continue;
      const f = frac(t * 0.55 + s * 7.31);
      const x = lerp(nodes[a][0], nodes[b][0], f), y = lerp(nodes[a][1], nodes[b][1], f), z = lerp(nodes[a][2], nodes[b][2], f);
      const l = Math.max(1e-6, Math.sqrt(x * x + y * y + z * z));
      const [px, py, zr] = pt(x / l, y / l, z / l);
      const depth = (zr + 1) / 2;
      dots.push({ x: px, y: py, z: zr, r: (nodeR * 1.5 + nodeRDepth * depth) * rs, white: 0.05, a: 0.5 + 0.5 * depth });
    }
    paintLines(ctx, lines, dark);
    paint(ctx, dots, dark, o.rMin);
  }

  function drawBraid(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.76;
    const pt = makeProj(t * 0.4, 0.3, cx, cy, 1);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const dots = [];
    const ghostN = o.ghostN ?? 150;
    for (let i = 0; i < ghostN; i++) {
      const d = fibDir(i, ghostN);
      const [px, py, z] = pt(d[0] * R, d[1] * R, d[2] * R);
      const depth = (z / R + 1) / 2;
      dots.push({ x: px, y: py, z, r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
    }
    const strandN = o.strandN ?? 52, turns = o.turns ?? 3;
    for (let s = 0; s < 3; s++) {
      const phase = (s / 3) * 2 * Math.PI;
      for (let i = 0; i < strandN; i++) {
        const u = (frac(i / strandN + t * 0.045) * 2 - 1) * 0.96;
        const surf = Math.sqrt(Math.max(0, 1 - u * u));
        const endFade = Math.min(1, (1 - Math.abs(u)) / 0.1);
        const a = u * Math.PI * turns + phase;
        const weave = 1 + 0.075 * Math.sin(u * Math.PI * turns * 2 + phase * 2 + t * 0.8);
        const rr = surf * R * weave;
        const [px, py, zr] = pt(Math.cos(a) * rr, u * R * weave, Math.sin(a) * rr);
        const depth = (zr / R + 1) / 2;
        dots.push({ x: px, y: py, z: zr,
          r: ((o.rBase ?? 1.2) + (o.rDepth ?? 1.8) * depth) * rs,
          white: 0.55 - 0.45 * depth, a: endFade * (0.45 + 0.55 * depth) });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  function drawRibbon(ctx, size, t, dark, o) {
    const cx = size / 2, cy = size / 2, R = (size / 2) * 0.78;
    const spin = o.spin ?? 1;
    const camTilt = 0.3;
    const pt = makeProj(t * 0.1 * spin, camTilt, cx, cy, 1);
    const rs = radiusScale(size, o.rsPow ?? 0.6);
    const dots = [];
    const ghostN = o.ghostN ?? 150;
    for (let i = 0; i < ghostN; i++) {
      const d = fibDir(i, ghostN);
      const [px, py, z] = pt(d[0] * R, d[1] * R, d[2] * R);
      const depth = (z / R + 1) / 2;
      dots.push({ x: px, y: py, z, r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
    }
    const ya = t * 0.24 * spin;
    const ta = o.faceOn ? -camTilt : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
    const ux = Math.cos(ya), uy = 0, uz = Math.sin(ya);
    const vx = -uz * Math.sin(ta), vy = Math.cos(ta), vz = ux * Math.sin(ta);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const wobAmp = 0.23 * (o.wobMul ?? 1);
    const baseR = o.faceOn ? R / (1 + 0.85 * wobAmp) : R;
    const baseLanes = o.lanes ?? 5, segs = o.segs ?? 88;
    const lanes = Math.max(1, Math.round(baseLanes * (o.bandMul ?? 1)));
    for (let w = 0; w < lanes; w++) {
      const laneOff = (w - (lanes - 1) / 2) * 0.075;
      const edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * 2 * Math.PI;
        const wob = (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (o.wobMul ?? 1);
        const radial = o.faceOn ? 1 + wob : 1;
        const off = o.faceOn ? laneOff : laneOff + wob;
        const x = ux * Math.cos(a) + vx * Math.sin(a) + nx * off;
        const y = uy * Math.cos(a) + vy * Math.sin(a) + ny * off;
        const z = uz * Math.cos(a) + vz * Math.sin(a) + nz * off;
        const l = Math.sqrt(x * x + y * y + z * z);
        const rr = baseR * radial;
        const [px, py, zr] = pt((x / l) * rr, (y / l) * rr, (z / l) * rr);
        const depth = (zr / R + 1) / 2;
        dots.push({ x: px, y: py, z: zr,
          r: ((o.rBase ?? 1.1) + (o.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rs,
          white: 0.52 - 0.44 * depth + 0.18 * edge, a: 0.4 + 0.6 * depth });
      }
    }
    paint(ctx, dots, dark, o.rMin);
  }

  const smoothE = (x) => x * x * (3 - 2 * x);
  function polyPath(verts) {
    const V = verts.length, L = []; let total = 0;
    for (let i = 0; i < V; i++) {
      const a = verts[i], b = verts[(i + 1) % V];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      L.push(l); total += l;
    }
    return (f) => {
      let target = f * total, i = 0;
      while (target > L[i] && i < V - 1) { target -= L[i]; i++; }
      const a = verts[i], b = verts[(i + 1) % V];
      const ff = L[i] ? Math.min(1, target / L[i]) : 0;
      return [a[0] + (b[0] - a[0]) * ff, a[1] + (b[1] - a[1]) * ff];
    };
  }
  const CIRCLE = (f) => { const a = -Math.PI / 2 + f * 2 * Math.PI; return [Math.cos(a) * 0.24, Math.sin(a) * 0.24]; };
  const TRIANGLE = polyPath([[0.0, -0.26], [0.24, 0.16], [-0.24, 0.16]]);
  const SQUARE = polyPath([[0, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]]);
  const CYCLE = [CIRCLE, TRIANGLE, SQUARE];
  const HOLD = 1.4, MORPH = 0.9, SEG = HOLD + MORPH;

  function drawMorph(ctx, size, t, dark, o) {
    const K = CYCLE.length;
    const tc = t % (SEG * K);
    const k = Math.floor(tc / SEG);
    const local = tc - k * SEG;
    const m = local > HOLD ? smoothE((local - HOLD) / MORPH) : 0;
    const sprd = o.spread ?? 1;
    const pA = CYCLE[k], pB = CYCLE[(k + 1) % K];
    const M = 160;
    const pts = [];
    for (let i = 0; i < M; i++) {
      const f = i / M, a = pA(f), b = pB(f);
      pts.push([(a[0] + (b[0] - a[0]) * m) * sprd, (a[1] + (b[1] - a[1]) * m) * sprd]);
    }
    const L = []; let total = 0;
    for (let i = 0; i < M; i++) {
      const a = pts[i], b = pts[(i + 1) % M];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      L.push(l); total += l;
    }
    const n = Math.max(6, Math.round(34 * (o.iconD ?? 1)));
    const re = (o.rDot ?? 0.021) * 1.35 * sprd;
    const pulse = 1 + 0.02 * Math.sin(local * 3.1);
    const dots = [];
    const c2 = size / 2;
    let seg = 0, acc = 0;
    for (let k2 = 0; k2 < n; k2++) {
      const target = (k2 / n) * total;
      while (acc + L[seg] < target && seg < M - 1) { acc += L[seg]; seg++; }
      const a = pts[seg], b = pts[(seg + 1) % M];
      const f = L[seg] ? Math.min(1, (target - acc) / L[seg]) : 0;
      dots.push({ x: c2 + (a[0] + (b[0] - a[0]) * f) * pulse * size,
                  y: c2 + (a[1] + (b[1] - a[1]) * f) * pulse * size,
                  z: 0, r: Math.max(0.35, re * size), white: 0.1 });
    }
    paint(ctx, dots, dark, o.rMin);
  }

  const MODE_DRAWS = { orbits: drawOrbits, globe: drawGlobe, rubik: drawRubik, wave: drawWave,
    web: drawWeb, braid: drawBraid, ribbon: drawRibbon, ring: drawRibbon, morph: drawMorph };

  /* ------------ profiles + presets ------------ */
  const BASE_PROFILES = {
    globe:  { latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1.0, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
    orbits: { orbitN: 12, ghostN: 40, ghostR: 0.9, ghostA: 0.5, particles: 3, partR: 1.2, partRDepth: 1.6, rsPow: 0.6, rMin: 0.3 },
    rubik:  { latRings: 15, lonDensity: 40, moveCount: 14, rBase: 0.6, rDepth: 1.7, rActive: 0.3, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
    wave:   { rings: 15, lonDensity: 40, rBase: 0.6, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
    web:    { nodeN: 30, thr: 0.72, signals: 5, nodeR: 1.4, nodeRDepth: 1.8, lineW: 0.8, rsPow: 0.6, rMin: 0.3 },
    braid:  { strandN: 52, turns: 3.0, ghostN: 150, rBase: 1.2, rDepth: 1.8, rsPow: 0.6, rMin: 0.3 },
    ribbon: { lanes: 5, segs: 88, ghostN: 150, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
    ring:   { lanes: 5, segs: 88, ghostN: 0, faceOn: 1, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
    morph:  { rDot: 0.021, iconD: 1, rMin: 0.25 }
  };
  const COUNT_PAIRS = [["latRings", "lonDensity"], ["rings", "lonDensity"], ["lanes", "segs"]];
  const COUNT_KEYS = ["orbitN", "ghostN", "nodeN", "strandN", "signals"];
  const RADIUS_KEYS = ["rBase", "rDepth", "rActive", "rDot", "ghostR", "partR", "partRDepth", "nodeR", "nodeRDepth"];
  function scaleCounts(opts, scale) {
    const out = { ...opts }, done = new Set(), rt = Math.sqrt(scale);
    for (const [a, b] of COUNT_PAIRS) {
      if (out[a] != null && out[b] != null && !done.has(a) && !done.has(b)) {
        out[a] = Math.max(2, Math.round(out[a] * rt));
        out[b] = Math.max(2, Math.round(out[b] * rt));
        done.add(a); done.add(b);
      }
    }
    for (const k of COUNT_KEYS) {
      if (out[k] != null && out[k] !== 0 && !done.has(k)) out[k] = Math.max(1, Math.round(out[k] * scale));
    }
    if (out.iconD != null) out.iconD = Math.max(0.02, out.iconD * scale);
    return out;
  }
  function scaleRadii(opts, scale) {
    const out = { ...opts };
    for (const k of RADIUS_KEYS) if (out[k] != null) out[k] = out[k] * scale;
    out.rSizeMul = (out.rSizeMul ?? 1) * scale;
    return out;
  }
  const STATE_TO_MODE = { working: "orbits", searching: "globe", solving: "rubik", listening: "wave",
    connecting: "web", weaving: "braid", composing: "ribbon", breathing: "ring", shaping: "morph" };
  const PRESETS = {
    orbits: { 64: { speed: 1.885, count: 1, size: 1 }, 20: { speed: 3.9, count: 0.238, size: 2.4 } },
    globe:  { 64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } },
              20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } } },
    rubik:  { 64: { speed: 1.82, count: 0.35, size: 1.05 }, 20: { speed: 1.95, count: 0.088, size: 1.9 } },
    wave:   { 64: { speed: 4.388, count: 0.341, size: 1 }, 20: { speed: 3.998, count: 0.105, size: 1.6 } },
    web:    { 64: { speed: 3.315, count: 1.35, size: 0.95 }, 20: { speed: 6.63, count: 0.25, size: 1.52 } },
    braid:  { 64: { speed: 1.625, count: 0.5, size: 1 }, 20: { speed: 2.75, count: 0.1125, size: 1.36 } },
    ribbon: { 64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } },
              20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } } },
    ring:   { 64: { speed: 3.24, count: 0.25, size: 0.956, extra: { spin: 0, bandMul: 3.627, wobMul: 0.368 } },
              20: { speed: 3.78, count: 0.028, size: 1.622, extra: { spin: 0, bandMul: 3.968, wobMul: 0.565 } } },
    morph:  { 64: { speed: 2.405, count: 0.702, size: 0.395, extra: { spread: 1.45 } },
              20: { speed: 2.08, count: 0.53, size: 1.011, extra: { spread: 1.45 } } }
  };
  const presetCache = new Map();
  function resolvePreset(state, sizeKey) {
    const key = state + "-" + sizeKey;
    const hit = presetCache.get(key);
    if (hit) return hit;
    const mode = STATE_TO_MODE[state] ? state : "working";
    const modeKey = STATE_TO_MODE[mode];
    const preset = PRESETS[modeKey][sizeKey];
    let opts = { ...BASE_PROFILES[modeKey] };
    if (preset.count !== 1) opts = scaleCounts(opts, preset.count);
    if (preset.size !== 1) opts = scaleRadii(opts, preset.size);
    if (preset.extra) opts = { ...opts, ...preset.extra };
    const resolved = { mode: modeKey, speed: preset.speed, opts };
    presetCache.set(key, resolved);
    return resolved;
  }

  /* ------------ shared clock + public API ------------ */
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(2, devicePixelRatio || 1);
  const instances = new Set();
  let raf = 0;

  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t === "dark") return true;
    if (t === "light") return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function tick() {
    const dark = isDark();
    const now = performance.now() / 1000;
    for (const inst of instances) {
      if (!inst.canvas.isConnected) {
        // starInline() 은 캔버스를 문서 밖에서 만들어 돌려준다 — 삽입 전 첫 몇
        // 프레임에 지우면 안 되므로, 한 번이라도 연결됐던 것만 정리한다.
        if (inst.wasConnected) instances.delete(inst);
        continue;
      }
      inst.wasConnected = true;
      inst.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      inst.ctx.clearRect(0, 0, inst.px, inst.px);
      inst.draw(inst.ctx, inst.px, now * inst.speed, dark, inst.opts);
    }
    raf = instances.size ? requestAnimationFrame(tick) : 0;
  }

  /** state ∈ {working, searching, solving, listening, connecting, weaving,
   *  composing, breathing, shaping}; px = CSS pixel size. The 20-tuned preset
   *  drives px < 40, the 64-tuned one everything else. */
  function create(state, px = 20) {
    const c = document.createElement("canvas");
    c.width = Math.round(px * DPR);
    c.height = Math.round(px * DPR);
    c.style.width = px + "px";
    c.style.height = px + "px";
    c.style.display = "block";
    c.setAttribute("aria-hidden", "true");
    const { mode, speed, opts } = resolvePreset(state, px < 40 ? 20 : 64);
    const inst = { canvas: c, ctx: c.getContext("2d"), draw: MODE_DRAWS[mode], px, speed, opts, wasConnected: false };
    // 삽입 전에도 빈 채로 두지 않는다 — 대표 프레임을 즉시 한 장 그린다
    inst.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    inst.draw(inst.ctx, px, REDUCED ? 0.6 : (performance.now() / 1000) * speed, isDark(), opts);
    if (!REDUCED) {
      instances.add(inst);
      if (!raf) raf = requestAnimationFrame(tick);
    }
    return c;
  }

  window.ThinkingOrbs = { create, states: Object.keys(STATE_TO_MODE) };
})();
