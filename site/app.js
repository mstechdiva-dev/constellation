// Constellation: draws the planets, moons and pulses from data.json.
// The data has no dates or times, so pulses fire in the (already shuffled) order given.
(() => {
  'use strict';
  const PALETTE = ['#38d9f5', '#ffb347', '#a78bfa', '#f472b6', '#5eead4'];
  const NEUTRAL = '#9db0cc';
  const GOLDEN = 2.399963;
  // planets outside the announced projects get a muted colour picked from their star name, so it says nothing about grouping
  const MUTED = ['#c8935f', '#b9694f', '#7d9fd0', '#8fb38c', '#d1b06e', '#a08cc4', '#6fb0b3', '#c9808f'];
  const PAD_X = 22, PAD_Y = 12; // breathing room between planets, also covers the drift
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1, mobile = false, area = { x0: 0, x1: 0, y0: 0, y1: 0 };
  let nodes = [], edges = [], pulses = [], bursts = [], events = [], cursor = 0, stars = null;

  function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(hex, to, f) { const a = rgb(hex), b = rgb(to); return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * f)).join(',')})`; }
  const rgba = (hex, a) => { const c = rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  async function load() {
    const urls = ['data.json'];
    if (['localhost', '127.0.0.1'].includes(location.hostname)) urls.push('data.sample.json');
    for (const u of urls) {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* try next */ }
    }
    return null;
  }

  // ---------- layout ----------
  function size() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    mobile = W < 768;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const feedW = mobile ? 0 : 320;
    area = { x0: 20, x1: W - feedW - 20, y0: mobile ? 130 : 142, y1: H - (mobile ? Math.max(150, H * 0.24) + 72 : 56) };
    makeStars();
  }

  function makeStars() {
    stars = document.createElement('canvas');
    stars.width = canvas.width; stars.height = canvas.height;
    const g = stars.getContext('2d'); const r = rng(42);
    for (let i = 0; i < Math.round(W * H / 5200); i++) {
      g.fillStyle = `rgba(220,230,255,${(0.12 + r() * 0.4).toFixed(2)})`;
      const s = (r() < 0.06 ? 1.6 : 0.9) * DPR;
      g.fillRect(r() * stars.width, r() * stars.height, s, s);
    }
  }

  // what a label looks like for a planet, and whether it is wanted at this screen size
  function labelSpec(n) {
    const named = n.d.k !== 'star';
    const wanted = named || !mobile || (n.active && n.d.l >= 2 && W >= 380);
    const size = named ? (mobile ? 10.5 : 13) : 10.5;
    const sub = named && n.d.t !== null && n.active; // the count shows on phones too; the header says it is 30 days
    return { named, wanted, size, sub };
  }

  const subText = (n) => `${n.d.t.toLocaleString()} commit${n.d.t === 1 ? '' : 's'}`;

  // the box a planet takes up: the planet, its ring and moons, and (optionally) its label
  function measure(n) {
    const sp = labelSpec(n), R = n.R;
    const moonExt = n.moons.length ? Math.max(...n.moons.map((m) => m.orbit)) + 4 : 0;
    const hw = Math.max(R * (n.ring ? 2.15 : 1.05), moonExt);
    const top = Math.max(R * (n.ring ? 1.2 : 1.05), moonExt * 0.42 + 4);
    const ly = R * (n.ring ? 2.1 : 1.35) + sp.size + 3; // label baseline, relative to the planet centre
    ctx.font = `${sp.named ? 600 : 400} ${sp.size}px system-ui, sans-serif`;
    let lw = ctx.measureText(n.d.n).width;
    if (sp.sub) { ctx.font = `400 ${sp.size - 1.5}px system-ui, sans-serif`; lw = Math.max(lw, ctx.measureText(subText(n)).width); }
    const labelBottom = ly + (sp.sub ? sp.size : 0) + 3;
    n.spec = sp; n.ly = ly;
    n.planetBox = { l: -hw, r: hw, t: -top, b: top };
    n.fullBox = { l: -Math.max(hw, lw / 2), r: Math.max(hw, lw / 2), t: -top, b: Math.max(top, labelBottom) };
    n.box = sp.wanted ? n.fullBox : n.planetBox;
  }

  const overlap = (a, ax, ay, b, bx, by) => {
    const ox = Math.min(ax + a.r, bx + b.r) - Math.max(ax + a.l, bx + b.l) + PAD_X;
    const oy = Math.min(ay + a.b, by + b.b) - Math.max(ay + a.t, by + b.t) + PAD_Y;
    return ox > 0 && oy > 0 ? [ox, oy] : null;
  };

  function layout(data) {
    const unit = Math.max(0.62, Math.min(1.25, Math.min(area.x1 - area.x0, area.y1 - area.y0) / 620)) * (mobile ? 0.7 : 1);
    const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
    const rx = (area.x1 - area.x0) / 2, ry = (area.y1 - area.y0) / 2;
    const active = [], idle = [];
    data.repos.forEach((r, i) => (r.l > 0 ? active : idle).push(i));
    nodes = data.repos.map((r, i) => {
      const col = r.c >= 0 ? PALETTE[r.c % PALETTE.length] : MUTED[hash(r.n) % MUTED.length];
      const radius = (r.l === 0 ? 5 : 7 + r.l * 4.2) * unit * (i === 0 && r.l > 0 ? 1.25 : 1);
      const rnd = rng(hash(r.n));
      const n = {
        i, d: r, col, R: radius, active: r.l > 0, ring: r.l >= 3 && i < 3, rnd, flash: 0, showLabel: false,
        phase: rnd() * 6.28, dx: 0.7 + rnd() * 1.1, tilt: -0.4 + rnd() * 0.3, spin: (r.l > 0 ? 9 + rnd() * 12 : 3 + rnd() * 3) * (rnd() < 0.2 ? -1 : 1),
        moons: r.m.map((m, k) => ({ r: 1.8 + m * 1.1, orbit: radius + (10 + k * 7) * unit, a: rnd() * 6.28, v: (0.5 + rnd() * 0.7) * (rnd() < 0.5 ? -1 : 1) / (1 + k * 0.3) })),
        x: cx, y: cy, bx: cx, by: cy,
      };
      return n;
    });
    nodes.forEach(measure);
    active.forEach((i, k) => {
      if (k === 0) return;
      const r = 0.22 + 0.7 * Math.sqrt(k / active.length);
      const a = k * GOLDEN + nodes[i].rnd() * 0.4;
      nodes[i].bx = cx + Math.cos(a) * rx * r; nodes[i].by = cy + Math.sin(a) * ry * r;
    });
    idle.forEach((i, k) => {
      const a = (k / Math.max(1, idle.length)) * 6.283 + nodes[i].rnd() * 0.35;
      const r = 0.86 + nodes[i].rnd() * 0.14;
      nodes[i].bx = cx + Math.cos(a) * rx * r; nodes[i].by = cy + Math.sin(a) * ry * r;
    });

    // push overlapping boxes apart along the axis with the smaller overlap; the hub stays put
    const clamp = (n) => {
      n.bx = Math.max(area.x0 - n.box.l, Math.min(area.x1 - n.box.r, n.bx));
      n.by = Math.max(area.y0 - n.box.t, Math.min(area.y1 - n.box.b, n.by));
    };
    nodes.forEach(clamp);
    for (let it = 0; it < 500; it++) {
      let moved = false;
      for (let p = 0; p < nodes.length; p++) for (let q = p + 1; q < nodes.length; q++) {
        const a = nodes[p], b = nodes[q];
        const o = overlap(a.box, a.bx, a.by, b.box, b.bx, b.by);
        if (!o) continue;
        moved = true;
        const useX = o[0] < o[1];
        const dir = useX ? Math.sign((b.bx + (b.box.l + b.box.r) / 2) - (a.bx + (a.box.l + a.box.r) / 2) || (p % 2 ? 1 : -1))
          : Math.sign((b.by + (b.box.t + b.box.b) / 2) - (a.by + (a.box.t + a.box.b) / 2) || (p % 2 ? 1 : -1));
        const amt = (useX ? o[0] : o[1]) / (a.i === 0 || b.i === 0 ? 1 : 2) + 0.5;
        const mvA = a.i === 0 ? 0 : 1, mvB = b.i === 0 ? 0 : 1;
        if (useX) { a.bx -= dir * amt * mvA; b.bx += dir * amt * mvB; } else { a.by -= dir * amt * mvA; b.by += dir * amt * mvB; }
      }
      nodes.forEach((n) => { if (n.i !== 0) clamp(n); });
      if (!moved) break;
    }

    // labels: named ones always show; the rest show only where they fit without touching anything
    for (const n of nodes) n.showLabel = n.spec.named;
    const eff = (n) => (n.showLabel ? n.fullBox : n.planetBox);
    for (const n of [...nodes].filter((m) => !m.spec.named && m.spec.wanted).sort((a, b) => b.d.l - a.d.l)) {
      n.showLabel = !nodes.some((m) => m !== n && overlap(n.fullBox, n.bx, n.by, eff(m), m.bx, m.by));
    }
    nodes.forEach((n) => { n.x = n.bx; n.y = n.by; makePlanet(n); });

    // edges: each active planet to the hub, and to its nearest active neighbour
    edges = [];
    const seen = new Set();
    const add = (a, b) => { const k = a < b ? a + '-' + b : b + '-' + a; if (a !== b && !seen.has(k)) { seen.add(k); edges.push([a, b]); } };
    active.forEach((i) => {
      if (i !== active[0]) add(i, active[0]);
      let best = -1, bd = 1e9;
      active.forEach((j) => { if (j !== i) { const d = Math.hypot(nodes[i].bx - nodes[j].bx, nodes[i].by - nodes[j].by); if (d < bd) { bd = d; best = j; } } });
      if (best >= 0) add(i, best);
    });
  }

  // ---------- planets ----------
  // A planet is two layers. The surface texture is twice as wide as the planet and repeats, so
  // sliding it sideways makes the planet spin. The shade layer (light, dark side, rim) stays still.
  function makePlanet(n) {
    const R = n.R, S = Math.ceil((R * 2 + 6) * DPR), mid = S / 2, rr = R * DPR;
    const r = rng(hash(n.d.n) + 7);
    const base = n.active ? n.col : mix(n.col, '#4b5563', 0.4);
    const tex = document.createElement('canvas'); tex.width = S * 2; tex.height = S;
    const g = tex.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, S * 2, S);
    const TAU = Math.PI * 2;
    const gas = n.d.l >= 3 || r() < 0.45;
    if (gas) {
      for (let k = 0; k < 7 + n.d.l; k++) {
        const y = mid - rr + r() * rr * 2, h = rr * (0.05 + r() * 0.16), f1 = 1 + Math.floor(r() * 3), f2 = 1 + Math.floor(r() * 3), ph = r() * TAU;
        g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.1 + r() * 0.2})` : `rgba(255,255,255,${0.06 + r() * 0.14})`;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= S * 2; x += S / 16) g.lineTo(x, y + Math.sin(x / S * TAU * f1 + ph) * h * 0.55);
        for (let x = S * 2; x >= 0; x -= S / 16) g.lineTo(x, y + h + Math.sin(x / S * TAU * f2 + ph * 1.7) * h * 0.55);
        g.fill();
      }
      for (let k = 0; k < 2; k++) { // a storm or two so the spin is easy to see
        const x = r() * S, y = mid - rr * 0.6 + r() * rr * 1.2, sw = rr * (0.18 + r() * 0.2);
        for (const ox of [x, x + S]) {
          const b = g.createRadialGradient(ox, y, 0, ox, y, sw);
          b.addColorStop(0, 'rgba(255,255,255,.32)'); b.addColorStop(1, 'rgba(255,255,255,0)');
          g.save(); g.translate(ox, y); g.scale(1.7, 1); g.translate(-ox, -y); g.fillStyle = b; g.fillRect(ox - sw, y - sw, sw * 2, sw * 2); g.restore();
        }
      }
    } else {
      for (let k = 0; k < 18; k++) {
        const x = r() * S, y = r() * S, br = rr * (0.15 + r() * 0.35), dark = r() < 0.55;
        for (const ox of [x, x + S]) {
          const b = g.createRadialGradient(ox, y, 0, ox, y, br);
          b.addColorStop(0, dark ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.22)'); b.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = b; g.fillRect(ox - br, y - br, br * 2, br * 2);
        }
      }
    }
    const shade = document.createElement('canvas'); shade.width = shade.height = S;
    const s = shade.getContext('2d');
    s.save(); s.beginPath(); s.arc(mid, mid, rr, 0, TAU); s.clip();
    const lit = s.createRadialGradient(mid - rr * 0.38, mid - rr * 0.42, rr * 0.05, mid - rr * 0.2, mid - rr * 0.2, rr * 1.0);
    lit.addColorStop(0, 'rgba(255,255,255,.34)'); lit.addColorStop(0.55, 'rgba(255,255,255,0)');
    s.fillStyle = lit; s.fillRect(0, 0, S, S);
    const dark = s.createRadialGradient(mid - rr * 0.5, mid - rr * 0.5, rr * 0.2, mid + rr * 0.15, mid + rr * 0.15, rr * 1.25);
    dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(0.6, 'rgba(0,0,12,.3)'); dark.addColorStop(1, 'rgba(0,0,12,.84)');
    s.fillStyle = dark; s.fillRect(0, 0, S, S);
    const rim = s.createRadialGradient(mid, mid, rr * 0.78, mid, mid, rr);
    rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, rgba('#cfe6ff', n.active ? 0.5 : 0.22));
    s.fillStyle = rim; s.fillRect(0, 0, S, S);
    s.restore();
    n.tex = tex; n.shade = shade; n.S = S;
  }

  const glowCache = {};
  function glow(col) {
    if (glowCache[col]) return glowCache[col];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(col, 0.6)); gr.addColorStop(0.35, rgba(col, 0.2)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (glowCache[col] = c);
  }

  function drawRing(n, front, t) {
    const R = n.R; ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.tilt + Math.sin(t * 0.3 + n.phase) * 0.03);
    for (const [k, a] of [[1.55, 0.5], [1.8, 0.32], [2.05, 0.22]]) {
      ctx.strokeStyle = rgba('#e9d8b8', a * (n.active ? 1 : 0.5) * (0.85 + 0.15 * Math.sin(t * 1.2 + k * 3)));
      ctx.lineWidth = Math.max(1.2, R * 0.14);
      ctx.beginPath(); ctx.ellipse(0, 0, R * k, R * k * 0.32, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawNode(n, t) {
    const pulse = n.active ? 0.5 + 0.5 * Math.sin(t * 1.9 + n.phase) : 0;
    if (n.active || n.flash > 0) {
      const gs = n.R * (3.4 + pulse * 1.3 + n.flash * 1.6);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, (n.active ? 0.45 + pulse * 0.45 : 0.2) + n.flash * 0.6);
      ctx.drawImage(glow(n.col), n.x - gs, n.y - gs, gs * 2, gs * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (n.ring) drawRing(n, false, t);
    const back = n.moons.filter((m) => Math.sin(m.a) < 0), front = n.moons.filter((m) => Math.sin(m.a) >= 0);
    const moon = (m) => {
      const mx = n.x + Math.cos(m.a) * m.orbit, my = n.y + Math.sin(m.a) * m.orbit * 0.42;
      ctx.beginPath(); ctx.arc(mx, my, m.r, 0, 6.283); ctx.fillStyle = n.active ? '#e6edf8' : '#6b7688'; ctx.fill();
    };
    back.forEach(moon);
    const s = n.S / DPR;
    ctx.globalAlpha = n.active ? 1 : 0.55;
    ctx.save(); ctx.beginPath(); ctx.arc(n.x, n.y, n.R, 0, 6.283); ctx.clip();
    const off = ((t * n.spin * DPR) % n.S + n.S) % n.S;
    ctx.drawImage(n.tex, off, 0, n.S, n.S, n.x - s / 2, n.y - s / 2, s, s);
    ctx.restore();
    ctx.drawImage(n.shade, n.x - s / 2, n.y - s / 2, s, s);
    ctx.globalAlpha = 1;
    if (n.ring) drawRing(n, true, t);
    front.forEach(moon);
    if (n.showLabel) {
      const sp = n.spec;
      ctx.font = `${sp.named ? 600 : 400} ${sp.size}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = sp.named ? '#ffffff' : n.active ? 'rgba(200,212,230,.75)' : 'rgba(150,165,190,.4)';
      const ly = n.y + n.ly;
      ctx.fillText(n.d.n, n.x, ly);
      if (sp.sub) {
        ctx.font = `400 ${sp.size - 1.5}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(200,212,230,.7)';
        ctx.fillText(subText(n), n.x, ly + sp.size);
      }
    }
  }

  // ---------- pulses ----------
  function spawn() {
    if (!events.length || pulses.length > 60) return;
    const [ri, type, sz] = events[cursor % events.length]; cursor++;
    const a = nodes[ri]; if (!a) return;
    let b = nodes[0];
    if (a === b) { const others = nodes.filter((n) => n.active && n !== a); b = others.length ? others[Math.floor(Math.random() * others.length)] : a; }
    pulses.push({ a, b, type, sz, t0: performance.now(), dur: 1300 + Math.random() * 1000 });
    a.flash = Math.max(a.flash, 0.5);
    bursts.push({ x: a.x, y: a.y, t0: performance.now(), col: a.col, max: 16 });
  }

  function drawPulses(now) {
    pulses = pulses.filter((p) => {
      const k = (now - p.t0) / p.dur;
      if (k >= 1) { // impact: the planet flashes and a ring spreads out from it
        p.b.flash = 1;
        bursts.push({ x: p.b.x, y: p.b.y, t0: now, col: p.b.col, max: p.b.R * 2.8 });
        bursts.push({ x: p.b.x, y: p.b.y, t0: now + 140, col: '#ffffff', max: p.b.R * 1.9 });
        return false;
      }
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = p.a.x + (p.b.x - p.a.x) * e, y = p.a.y + (p.b.y - p.a.y) * e;
      const fade = Math.min(1, k * 8, (1 - k) * 6);
      for (let j = 1; j <= 8; j++) { // a longer, glowing trail
        const kk = Math.max(0, e - j * 0.028);
        ctx.globalAlpha = fade * (0.5 - j * 0.055);
        ctx.fillStyle = '#dbeafe'; ctx.beginPath();
        ctx.arc(p.a.x + (p.b.x - p.a.x) * kk, p.a.y + (p.b.y - p.a.y) * kk, 2.2 - j * 0.12, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = fade; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#9fd0ff'; ctx.shadowBlur = 16;
      if (p.type === 'c') { ctx.beginPath(); ctx.arc(x, y, 2.2 + p.sz * 0.9, 0, 6.283); ctx.fill(); }
      else if (p.type === 'p') { ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, 7 + Math.sin(now / 120) * 1.2, 0, 6.283); ctx.stroke(); }
      else { const s = 7; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      return true;
    });
    bursts = bursts.filter((b) => {
      const k = (now - b.t0) / 1000; if (k < 0) return true; if (k >= 1) return false;
      ctx.strokeStyle = rgba(b.col, 0.75 * (1 - k)); ctx.lineWidth = 2 * (1 - k) + 0.6;
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 + b.max * (1 - Math.pow(1 - k, 2)), 0, 6.283); ctx.stroke(); return true;
    });
  }

  // ---------- frame ----------
  let last = 0, nextSpawn = 0;
  function frame(now) {
    const t = now / 1000, dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(stars, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const n of nodes) {
      const amp = n.active ? 6 : 8;
      n.x = n.bx + Math.sin(t * 0.3 * n.dx + n.phase) * amp * 1.6;
      n.y = n.by + Math.cos(t * 0.23 * n.dx + n.phase * 1.7) * amp;
      for (const m of n.moons) m.a += m.v * dt;
      n.flash = Math.max(0, n.flash - dt * 1.6);
    }
    ctx.lineWidth = 1;
    for (const [a, b] of edges) {
      ctx.strokeStyle = 'rgba(150,180,230,.13)';
      ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
    }
    for (const n of [...nodes].sort((p, q) => p.y - q.y)) drawNode(n, t);
    if (now > nextSpawn) { spawn(); nextSpawn = now + 140 + Math.random() * 260; }
    drawPulses(now);
    requestAnimationFrame(frame);
  }

  // ---------- header and feed ----------
  function countUp(el, to) {
    if (reduce || to === 0) { el.textContent = to.toLocaleString(); return; }
    const t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 1400); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function buildFeed(data) {
    const list = $('feed-list');
    if (!data.feed.length) { $('feed').hidden = true; return; }
    const make = () => {
      const frag = document.createDocumentFragment();
      for (const [ri, msg] of data.feed) {
        const r = data.repos[ri]; if (!r) continue;
        const col = r.c >= 0 ? PALETTE[r.c % PALETTE.length] : MUTED[hash(r.n) % MUTED.length];
        const row = document.createElement('div'); row.className = 'item';
        const dot = document.createElement('i'); dot.style.background = col; dot.style.boxShadow = `0 0 8px ${col}`;
        const box = document.createElement('div');
        const name = document.createElement('b'); name.textContent = r.n; if (r.k !== 'star') name.className = 'named';
        const text = document.createElement('span'); text.textContent = msg;
        box.append(name, text); row.append(dot, box); frag.append(row);
      }
      return frag;
    };
    list.append(make());
    if (!reduce) { list.append(make()); list.style.setProperty('--dur', `${Math.max(40, data.feed.length * 3.6)}s`); list.classList.add('run'); }
  }

  $('full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  });

  let current = null, resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (current) { size(); layout(current); } }, 120);
  });

  load().then((data) => {
    if (!data || !data.repos || !data.repos.length) { $('empty').hidden = false; $('feed').hidden = true; return; }
    current = data; events = data.events;
    size(); layout(data); buildFeed(data);
    countUp($('t-c'), data.totals.c); countUp($('t-p'), data.totals.p); countUp($('t-i'), data.totals.i);
    if (reduce) {
      // one still frame, no motion
      const now = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(stars, 0, 0); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      for (const [a, b] of edges) { ctx.strokeStyle = 'rgba(150,180,230,.13)'; ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke(); }
      for (const n of nodes) drawNode(n, now / 1000);
      return;
    }
    requestAnimationFrame(frame);
  });
})();
