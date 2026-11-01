// Constellation: draws the planets, moons and pulses from data.json.
// The data has no dates or times, so pulses fire in the (already shuffled) order given.
(() => {
  'use strict';
  const PALETTE = ['#38d9f5', '#ffb347', '#a78bfa', '#f472b6', '#5eead4'];
  const NEUTRAL = '#9db0cc';
  const GOLDEN = 2.399963;
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
    area = { x0: 20, x1: W - feedW - 20, y0: mobile ? 110 : 120, y1: H - (mobile ? Math.max(150, H * 0.24) + 30 : 56) };
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

  function layout(data) {
    const unit = Math.max(0.62, Math.min(1.25, Math.min(area.x1 - area.x0, area.y1 - area.y0) / 620));
    const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
    const rx = (area.x1 - area.x0) / 2, ry = (area.y1 - area.y0) / 2;
    const active = [], idle = [];
    data.repos.forEach((r, i) => (r.l > 0 ? active : idle).push(i));
    nodes = data.repos.map((r, i) => {
      const col = r.c >= 0 ? PALETTE[r.c % PALETTE.length] : NEUTRAL;
      const radius = (r.l === 0 ? 5 : 7 + r.l * 4.2) * unit * (i === 0 && r.l > 0 ? 1.25 : 1);
      const rnd = rng(hash(r.n));
      return {
        i, d: r, col, R: radius, active: r.l > 0, ring: r.l >= 3 && i < 3, rnd,
        phase: rnd() * 6.28, dx: 0.5 + rnd() * 0.9, tilt: -0.4 + rnd() * 0.3,
        moons: r.m.map((m, k) => ({ r: 1.5 + m * 0.9, orbit: radius + (9 + k * 6) * unit, a: rnd() * 6.28, v: (0.25 + rnd() * 0.45) * (rnd() < 0.5 ? -1 : 1) / (1 + k * 0.35) })),
        x: cx, y: cy, bx: cx, by: cy, sprite: null,
      };
    });
    active.forEach((i, k) => {
      if (k === 0) return;
      const r = 0.2 + 0.64 * Math.sqrt(k / active.length);
      const a = k * GOLDEN + nodes[i].rnd() * 0.4;
      nodes[i].bx = cx + Math.cos(a) * rx * r; nodes[i].by = cy + Math.sin(a) * ry * r;
    });
    idle.forEach((i, k) => {
      const a = (k / Math.max(1, idle.length)) * 6.283 + nodes[i].rnd() * 0.35;
      const r = 0.84 + nodes[i].rnd() * 0.14;
      nodes[i].bx = cx + Math.cos(a) * rx * r; nodes[i].by = cy + Math.sin(a) * ry * r;
    });
    // push overlapping planets apart; the hub stays put
    for (let it = 0; it < 60; it++) {
      for (const a of nodes) for (const b of nodes) {
        if (a === b) continue;
        const dx = b.bx - a.bx, dy = b.by - a.by, d = Math.hypot(dx, dy) || 0.01;
        const min = (a.R + b.R) * 2.1 + 16;
        if (d < min) {
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          if (a.i !== 0) { a.bx -= ux * push; a.by -= uy * push; }
          if (b.i !== 0) { b.bx += ux * push; b.by += uy * push; }
        }
      }
      for (const n of nodes) { n.bx = Math.max(area.x0 + n.R * 2, Math.min(area.x1 - n.R * 2, n.bx)); n.by = Math.max(area.y0 + n.R * 2, Math.min(area.y1 - n.R * 2, n.by)); }
    }
    nodes.forEach((n) => { n.x = n.bx; n.y = n.by; n.sprite = planetSprite(n); });
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
  function planetSprite(n) {
    const R = n.R, S = Math.ceil((R * 2 + 6) * DPR);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); const mid = S / 2, rr = R * DPR, r = rng(hash(n.d.n) + 7);
    const base = n.active ? n.col : mix(n.col, '#4b5563', 0.55);
    g.save(); g.beginPath(); g.arc(mid, mid, rr, 0, 6.283); g.clip();
    const body = g.createRadialGradient(mid - rr * 0.35, mid - rr * 0.4, rr * 0.1, mid, mid, rr * 1.05);
    body.addColorStop(0, mix(base, '#ffffff', 0.45)); body.addColorStop(0.45, base); body.addColorStop(1, mix(base, '#000000', 0.7));
    g.fillStyle = body; g.fillRect(0, 0, S, S);
    const gas = n.d.l >= 3 || r() < 0.45;
    if (gas) { // horizontal bands
      for (let k = 0; k < 7 + n.d.l; k++) {
        const y = mid - rr + r() * rr * 2, h = rr * (0.05 + r() * 0.16);
        g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.1 + r() * 0.2})` : `rgba(255,255,255,${0.06 + r() * 0.14})`;
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= S; x += S / 8) g.lineTo(x, y + Math.sin(x / S * 9 + k) * h * 0.4);
        for (let x = S; x >= 0; x -= S / 8) g.lineTo(x, y + h + Math.sin(x / S * 7 + k) * h * 0.4);
        g.fill();
      }
    } else { // mottled surface
      for (let k = 0; k < 16; k++) {
        const x = r() * S, y = r() * S, br = rr * (0.15 + r() * 0.35);
        const b = g.createRadialGradient(x, y, 0, x, y, br);
        const dark = r() < 0.55;
        b.addColorStop(0, dark ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.2)'); b.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = b; g.fillRect(x - br, y - br, br * 2, br * 2);
      }
    }
    const shadeG = g.createRadialGradient(mid - rr * 0.5, mid - rr * 0.5, rr * 0.2, mid + rr * 0.15, mid + rr * 0.15, rr * 1.25);
    shadeG.addColorStop(0, 'rgba(0,0,0,0)'); shadeG.addColorStop(0.6, 'rgba(0,0,12,.28)'); shadeG.addColorStop(1, 'rgba(0,0,12,.82)');
    g.fillStyle = shadeG; g.fillRect(0, 0, S, S);
    const rim = g.createRadialGradient(mid, mid, rr * 0.78, mid, mid, rr);
    rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, rgba('#cfe6ff', n.active ? 0.5 : 0.22));
    g.fillStyle = rim; g.fillRect(0, 0, S, S);
    g.restore();
    return c;
  }

  const glowCache = {};
  function glow(col) {
    if (glowCache[col]) return glowCache[col];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, rgba(col, 0.55)); gr.addColorStop(0.35, rgba(col, 0.18)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (glowCache[col] = c);
  }

  function drawRing(n, front) {
    const R = n.R; ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.tilt);
    for (const [k, a] of [[1.55, 0.5], [1.8, 0.32], [2.05, 0.22]]) {
      ctx.strokeStyle = rgba('#e9d8b8', a * (n.active ? 1 : 0.5));
      ctx.lineWidth = Math.max(1.2, R * 0.14);
      ctx.beginPath(); ctx.ellipse(0, 0, R * k, R * k * 0.32, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawNode(n, t) {
    const pulse = n.active ? 0.5 + 0.5 * Math.sin(t * 1.5 + n.phase) : 0;
    if (n.active) {
      const gs = n.R * (3.4 + pulse * 0.9);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + pulse * 0.35;
      ctx.drawImage(glow(n.col), n.x - gs, n.y - gs, gs * 2, gs * 2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (n.ring) drawRing(n, false);
    const back = n.moons.filter((m) => Math.sin(m.a) < 0), front = n.moons.filter((m) => Math.sin(m.a) >= 0);
    const moon = (m) => {
      const mx = n.x + Math.cos(m.a) * m.orbit, my = n.y + Math.sin(m.a) * m.orbit * 0.42;
      ctx.beginPath(); ctx.arc(mx, my, m.r, 0, 6.283); ctx.fillStyle = n.active ? '#dfe7f3' : '#6b7688'; ctx.fill();
    };
    back.forEach(moon);
    ctx.globalAlpha = n.active ? 1 : 0.55;
    const s = n.sprite.width / DPR; ctx.drawImage(n.sprite, n.x - s / 2, n.y - s / 2, s, s);
    ctx.globalAlpha = 1;
    if (n.ring) drawRing(n, true);
    front.forEach(moon);
    // label: named and public repos get a name; busy stars get a small dim one
    const named = n.d.k !== 'star';
    if (named || (n.active && n.d.l >= 2) || !mobile) {
      const size = named ? (mobile ? 11 : 13) : 10.5;
      ctx.font = `${named ? 600 : 400} ${size}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = named ? '#ffffff' : n.active ? 'rgba(200,212,230,.75)' : 'rgba(150,165,190,.4)';
      const ly = n.y + n.R * (n.ring ? 2.1 : 1.35) + size + 3;
      ctx.fillText(n.d.n, n.x, ly);
      if (named && n.d.t !== null && n.active && (!mobile || n.i === 0)) {
        ctx.font = `400 ${size - 2}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(200,212,230,.7)';
        ctx.fillText(`${n.d.t.toLocaleString()} commits · 30 days`, n.x, ly + size);
      }
    }
  }

  // ---------- pulses ----------
  function spawn() {
    if (!events.length || pulses.length > 36) return;
    const [ri, type, sz] = events[cursor % events.length]; cursor++;
    const a = nodes[ri]; if (!a) return;
    let b = nodes[0];
    if (a === b) { const others = nodes.filter((n) => n.active && n !== a); b = others.length ? others[Math.floor(Math.random() * others.length)] : a; }
    pulses.push({ a, b, type, sz, t0: performance.now(), dur: 1500 + Math.random() * 1100 });
    bursts.push({ x: a.x, y: a.y, t0: performance.now(), col: a.col, max: 14 });
  }

  function drawPulses(now) {
    pulses = pulses.filter((p) => {
      const k = (now - p.t0) / p.dur;
      if (k >= 1) { bursts.push({ x: p.b.x, y: p.b.y, t0: now, col: p.b.col, max: p.b.R * 1.9 }); return false; }
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const x = p.a.x + (p.b.x - p.a.x) * e, y = p.a.y + (p.b.y - p.a.y) * e;
      const fade = Math.min(1, k * 8, (1 - k) * 6);
      ctx.globalAlpha = fade;
      // a short trail
      for (let j = 1; j <= 4; j++) {
        const kk = Math.max(0, e - j * 0.03);
        ctx.globalAlpha = fade * (0.35 - j * 0.07);
        ctx.fillStyle = '#fff'; ctx.beginPath();
        ctx.arc(p.a.x + (p.b.x - p.a.x) * kk, p.a.y + (p.b.y - p.a.y) * kk, 1.3, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = fade; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.shadowColor = '#cfe3ff'; ctx.shadowBlur = 10;
      if (p.type === 'c') { ctx.beginPath(); ctx.arc(x, y, 1.4 + p.sz * 0.75, 0, 6.283); ctx.fill(); }
      else if (p.type === 'p') { ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.283); ctx.stroke(); }
      else { const s = 5.2; ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      return true;
    });
    bursts = bursts.filter((b) => {
      const k = (now - b.t0) / 900; if (k >= 1) return false;
      ctx.strokeStyle = rgba(b.col, 0.6 * (1 - k)); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(b.x, b.y, 3 + b.max * k, 0, 6.283); ctx.stroke(); return true;
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
      const amp = n.active ? 5 : 9;
      n.x = n.bx + Math.sin(t * 0.17 * n.dx + n.phase) * amp * 1.6;
      n.y = n.by + Math.cos(t * 0.13 * n.dx + n.phase * 1.7) * amp;
      for (const m of n.moons) m.a += m.v * dt;
    }
    ctx.lineWidth = 1;
    for (const [a, b] of edges) {
      ctx.strokeStyle = 'rgba(150,180,230,.11)';
      ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke();
    }
    for (const n of [...nodes].sort((p, q) => p.y - q.y)) drawNode(n, t);
    if (now > nextSpawn) { spawn(); nextSpawn = now + 260 + Math.random() * 380; }
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
        const col = r.c >= 0 ? PALETTE[r.c % PALETTE.length] : NEUTRAL;
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
      for (const [a, b] of edges) { ctx.strokeStyle = 'rgba(150,180,230,.11)'; ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); ctx.stroke(); }
      for (const n of nodes) drawNode(n, now / 1000);
      return;
    }
    requestAnimationFrame(frame);
  });
})();
