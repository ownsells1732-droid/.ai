/* ==========================================================
   BUBBLE BLAST - 10 level bubble shooter
   Pure HTML5 Canvas + JavaScript, no libraries needed.
   ========================================================== */
(() => {
  'use strict';

  // ---------- Constants ----------
  const W = 480, H = 720;
  const R = 22;                       // bubble radius
  const COLS = 10;
  const ROWH = R * Math.sqrt(3);      // row height of hex grid
  const GRID_L = 9, TOP = 8;
  const LOSE_ROW = 13;                // bubbles reaching this row = game over
  const SHX = W / 2, SHY = H - 62;    // shooter position
  const NEXT_X = SHX - 95;            // "next bubble" position
  const SPEED = 980;                  // bubble speed px/sec
  const MIN_X = GRID_L + R, MAX_X = GRID_L + COLS * 2 * R;

  const PALETTE = [
    ['#ff5c7a', '#b3123f'], ['#ffd23f', '#b8860b'], ['#3ddc97', '#12805a'],
    ['#4cc9f0', '#1670a0'], ['#b388ff', '#5b2fb8'], ['#ff9f43', '#b35a0a'],
  ];

  // 10 levels: rows, colors, shots allowed, ceiling drops every N shots (0 = never)
  const LEVELS = [
    { rows: 4, colors: 3, shots: 30, drop: 0 },
    { rows: 5, colors: 3, shots: 32, drop: 0 },
    { rows: 5, colors: 4, shots: 34, drop: 0 },
    { rows: 6, colors: 4, shots: 36, drop: 0 },
    { rows: 6, colors: 4, shots: 36, drop: 8 },
    { rows: 7, colors: 5, shots: 40, drop: 8 },
    { rows: 7, colors: 5, shots: 40, drop: 7 },
    { rows: 8, colors: 5, shots: 42, drop: 7 },
    { rows: 8, colors: 6, shots: 44, drop: 7 },
    { rows: 9, colors: 6, shots: 46, drop: 7 },
  ];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const overlay = $('overlay');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // ---------- Save data ----------
  const KEY = 'bubbleBlastSave_v1';
  let save = { unlocked: 1, stars: Array(10).fill(0), best: Array(10).fill(0) };
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.stars) && Array.isArray(s.best)) save = Object.assign(save, s);
  } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };

  // ---------- Sound ----------
  let AC = null, muted = false;
  function tone(freq, dur, type = 'sine', vol = 0.07, slide = 0) {
    if (muted) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime;
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(AC.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* ignore */ }
  }
  const sfx = {
    shoot: () => tone(420, 0.12, 'triangle', 0.08, 260),
    bump: () => tone(180, 0.1, 'sine', 0.09, -60),
    pop: (n) => { tone(500 + n * 45, 0.16, 'sine', 0.09, 250); tone(760 + n * 55, 0.1, 'triangle', 0.05); },
    swap: () => tone(600, 0.07, 'square', 0.04),
    drop: () => tone(140, 0.25, 'sawtooth', 0.06, -50),
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.09), i * 120)),
    lose: () => [400, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.28, 'sawtooth', 0.06), i * 160)),
  };

  // ---------- Bubble sprites (pre-rendered for speed) ----------
  const SPR = (R * 2 + 6);
  const sprites = PALETTE.map(([base, dark]) => {
    const s = document.createElement('canvas');
    s.width = s.height = SPR * dpr;
    const g = s.getContext('2d');
    g.scale(dpr, dpr);
    const c = SPR / 2;
    const gr = g.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.08, c, c, R);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.22, base);
    gr.addColorStop(1, dark);
    g.beginPath(); g.arc(c, c, R - 1, 0, Math.PI * 2);
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.28)'; g.stroke();
    g.beginPath(); g.ellipse(c - R * 0.3, c - R * 0.42, R * 0.22, R * 0.12, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.65)'; g.fill();
    return s;
  });
  function drawBubble(x, y, ci, alpha = 1, scale = 1) {
    const n = SPR * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprites[ci], x - n / 2, y - n / 2, n, n);
    ctx.globalAlpha = 1;
  }

  // ---------- Game state ----------
  let grid = [], shift = 0;
  let level = 0, cfg = LEVELS[0];
  let score = 0, shotsLeft = 0, fired = 0, sinceDrop = 0, combo = 0;
  let state = 'menu';                 // menu | playing | won | lost
  let cur = 0, next = 0, ball = null;
  let aim = Math.PI / 2, recoil = 0;
  let falling = [], parts = [], texts = [], banner = null;

  const rand = (n) => Math.floor(Math.random() * n);
  const rowX = (r, c) => GRID_L + R + c * 2 * R + (((r + shift) & 1) ? R : 0);
  const rowY = (r) => TOP + R + r * ROWH;

  function nbrs(r, c) {
    const odd = (r + shift) & 1;
    const d = odd
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    const out = [];
    for (const [dr, dc] of d) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < grid.length && cc >= 0 && cc < COLS) out.push([rr, cc]);
    }
    return out;
  }
  const ensureRows = (n) => { while (grid.length < n) grid.push(Array(COLS).fill(null)); };
  const cellAt = (r, c) => (r < grid.length ? grid[r][c] : null);

  function presentColors() {
    const set = new Set();
    for (const row of grid) for (const v of row) if (v !== null) set.add(v);
    return [...set];
  }
  function pickColor() {
    const p = presentColors();
    return p.length ? p[rand(p.length)] : 0;
  }
  const isEmpty = () => grid.every((row) => row.every((v) => v === null));
  const lost = () => { for (let r = LOSE_ROW; r < grid.length; r++) if (grid[r].some((v) => v !== null)) return true; return false; };

  function makeRow(prevRow) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const left = c > 0 ? row[c - 1] : null;
      const up = prevRow ? prevRow[c] : null;
      const roll = Math.random();
      if (left !== null && roll < 0.35) row.push(left);
      else if (up !== null && up !== undefined && roll < 0.6) row.push(up);
      else row.push(rand(cfg.colors));
    }
    return row;
  }

  // ---------- Level setup ----------
  function startLevel(i) {
    level = i; cfg = LEVELS[i];
    score = 0; fired = 0; combo = 0; sinceDrop = 0;
    shotsLeft = cfg.shots; shift = 0;
    grid = [];
    for (let r = 0; r < cfg.rows; r++) {
      const row = makeRow(r > 0 ? grid[r - 1] : null);
      if (r > 0 && i >= 2) for (let c = 0; c < COLS; c++) if (Math.random() < 0.06) row[c] = null;
      grid.push(row);
    }
    dropFloating(false);
    ball = null; falling = []; parts = []; texts = [];
    cur = pickColor(); next = pickColor();
    state = 'playing';
    banner = { text: 'LEVEL ' + (i + 1), t: 1.6 };
    hideOverlay();
    updateHud();
  }

  // ---------- Core mechanics ----------
  function hitsGrid(x, y) {
    const lim = (R * 1.84) * (R * 1.84);
    for (let r = 0; r < grid.length; r++) {
      const ry = rowY(r);
      if (Math.abs(ry - y) > R * 2) continue;
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === null) continue;
        const dx = rowX(r, c) - x, dy = ry - y;
        if (dx * dx + dy * dy < lim) return true;
      }
    }
    return false;
  }

  function snap(b, needNeighbor) {
    const guess = Math.round((b.y - TOP - R) / ROWH);
    let best = null, bd = 1e9;
    for (let r = Math.max(0, guess - 1); r <= guess + 1; r++) {
      const off = ((r + shift) & 1) ? R : 0;
      const gc = Math.round((b.x - GRID_L - R - off) / (2 * R));
      for (let c = gc - 1; c <= gc + 1; c++) {
        if (c < 0 || c >= COLS) continue;
        if (cellAt(r, c) !== null) continue;
        if (needNeighbor && r > 0) {
          ensureRows(r + 1);
          if (!nbrs(r, c).some(([a, bb]) => grid[a][bb] !== null)) continue;
        }
        const d = Math.hypot(rowX(r, c) - b.x, rowY(r) - b.y);
        if (d < bd) { bd = d; best = [r, c]; }
      }
    }
    return best;
  }

  function flood(r, c) {
    const ci = grid[r][c];
    const seen = new Set([r * COLS + c]);
    const q = [[r, c]], out = [];
    while (q.length) {
      const [a, b] = q.pop();
      out.push([a, b]);
      for (const [rr, cc] of nbrs(a, b)) {
        const k = rr * COLS + cc;
        if (!seen.has(k) && grid[rr][cc] === ci) { seen.add(k); q.push([rr, cc]); }
      }
    }
    return out;
  }

  function dropFloating(spawn = true) {
    const seen = new Set(), q = [];
    if (grid.length) for (let c = 0; c < COLS; c++) if (grid[0][c] !== null) { seen.add(c); q.push([0, c]); }
    while (q.length) {
      const [r, c] = q.pop();
      for (const [rr, cc] of nbrs(r, c)) {
        const k = rr * COLS + cc;
        if (!seen.has(k) && grid[rr][cc] !== null) { seen.add(k); q.push([rr, cc]); }
      }
    }
    let n = 0;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== null && !seen.has(r * COLS + c)) {
          if (spawn) falling.push({ x: rowX(r, c), y: rowY(r), vx: (Math.random() - 0.5) * 120, vy: -80 - Math.random() * 120, ci: grid[r][c] });
          grid[r][c] = null; n++;
        }
      }
    }
    return n;
  }

  function burst(x, y, ci) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 220;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.3, max: 0.8, ci, size: 3 + Math.random() * 4 });
    }
  }

  function fire() {
    if (state !== 'playing' || ball || shotsLeft <= 0 || (banner && banner.t > 1.35)) return;
    ball = { x: SHX, y: SHY, vx: Math.cos(aim), vy: -Math.sin(aim), ci: cur };
    cur = next; next = pickColor();
    shotsLeft--; fired++; recoil = 1;
    sfx.shoot(); updateHud();
  }

  function swap() {
    if (state !== 'playing' || ball) return;
    [cur, next] = [next, cur];
    sfx.swap();
  }

  function land() {
    const cell = snap(ball, true) || snap(ball, false);
    if (!cell) { ball = null; afterShot(); return; }
    const [r, c] = cell;
    ensureRows(r + 1);
    const ci = ball.ci;
    grid[r][c] = ci;
    ball = null;

    const grp = flood(r, c);
    if (grp.length >= 3) {
      combo++;
      grp.forEach(([a, b]) => { burst(rowX(a, b), rowY(a), ci); grid[a][b] = null; });
      const dn = dropFloating();
      const gain = grp.length * 10 + Math.max(0, grp.length - 3) * 10 + dn * 25 + (combo > 1 ? (combo - 1) * 20 : 0);
      score += gain;
      texts.push({ x: rowX(r, c), y: rowY(r), t: 1, str: '+' + gain + (combo > 1 ? '  x' + combo : '') });
      sfx.pop(Math.min(grp.length + dn, 12));
    } else {
      combo = 0;
      sfx.bump();
    }
    afterShot();
  }

  function addRow() {
    grid.unshift(makeRow(null).map((v) => v));
    shift ^= 1;
    sfx.drop();
    banner = { text: 'NEW ROW!', t: 0.9 };
  }

  function afterShot() {
    if (isEmpty()) { win(); return; }
    sinceDrop++;
    if (cfg.drop && sinceDrop >= cfg.drop) { addRow(); sinceDrop = 0; }
    if (lost()) { lose('Bubbles reached the danger line!'); return; }
    if (shotsLeft <= 0) { lose('Out of shots!'); return; }
    const p = presentColors();
    if (!p.includes(cur)) cur = pickColor();
    if (!p.includes(next)) next = pickColor();
    updateHud();
  }

  // ---------- Win / Lose ----------
  function win() {
    state = 'won';
    const ratio = shotsLeft / cfg.shots;
    const stars = ratio >= 0.4 ? 3 : ratio >= 0.2 ? 2 : 1;
    const bonus = shotsLeft * 20;
    score += bonus;
    save.stars[level] = Math.max(save.stars[level], stars);
    save.best[level] = Math.max(save.best[level], score);
    if (level + 1 < LEVELS.length) save.unlocked = Math.max(save.unlocked, level + 2);
    persist(); updateHud(); sfx.win();
    setTimeout(() => showWin(stars, bonus), 650);
  }
  function lose(reason) {
    state = 'lost'; sfx.lose();
    setTimeout(() => showLose(reason), 500);
  }

  // ---------- Overlay screens ----------
  function hideOverlay() { overlay.classList.remove('show'); overlay.innerHTML = ''; }
  function showOverlay(html) { overlay.innerHTML = '<div class="card">' + html + '</div>'; overlay.classList.add('show'); }
  const starRow = (n) => '<div class="stars">' + [0, 1, 2].map((i) => (i < n ? '★' : '<span class="off">★</span>')).join('') + '</div>';

  function showMenu() {
    state = 'menu';
    let btns = '';
    for (let i = 0; i < LEVELS.length; i++) {
      const locked = i >= save.unlocked;
      const st = save.stars[i];
      btns += '<button class="lv" data-level="' + i + '"' + (locked ? ' disabled' : '') + '>' + (locked ? '🔒' : i + 1) +
        '<small>' + (locked ? '' : '★'.repeat(st) + '☆'.repeat(3 - st)) + '</small></button>';
    }
    const total = save.stars.reduce((a, b) => a + b, 0);
    showOverlay(
      '<h1>🫧 Bubble Blast</h1>' +
      '<p>Aim, shoot, match 3+ same colors.<br>Clear all bubbles before your shots run out!</p>' +
      '<div class="levels">' + btns + '</div>' +
      '<button class="btn" data-act="play">▶ Play Level ' + Math.min(save.unlocked, LEVELS.length) + '</button>' +
      '<p style="margin-top:10px;font-size:12px">⭐ ' + total + ' / 30 stars &nbsp;•&nbsp; Space / tap NEXT = swap bubble</p>'
    );
  }
  function showWin(stars, bonus) {
    const last = level === LEVELS.length - 1;
    const total = save.stars.reduce((a, b) => a + b, 0);
    showOverlay(
      '<h2>' + (last ? '🏆 You Won the Game!' : '🎉 Level Clear!') + '</h2>' + starRow(stars) +
      '<div class="big">' + score + ' pts</div>' +
      '<p>Shots used: ' + fired + ' &nbsp;•&nbsp; Bonus: +' + bonus + (last ? '<br>Total stars: ' + total + ' / 30' : '') + '</p>' +
      (last ? '' : '<button class="btn" data-act="next">Next Level ▶</button>') +
      '<button class="btn alt" data-act="retry">Replay</button>' +
      '<button class="btn alt" data-act="menu">Menu</button>'
    );
  }
  function showLose(reason) {
    showOverlay(
      '<h2>😵 Level Failed</h2><p>' + reason + '<br>Score: ' + score + ' &nbsp;•&nbsp; Shots used: ' + fired + '</p>' +
      '<button class="btn" data-act="retry">Try Again ↻</button>' +
      '<button class="btn alt" data-act="menu">Menu</button>'
    );
  }

  overlay.addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv && !lv.disabled) { startLevel(+lv.dataset.level); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'play') startLevel(Math.min(save.unlocked, LEVELS.length) - 1);
    else if (act === 'next') startLevel(level + 1);
    else if (act === 'retry') startLevel(level);
    else if (act === 'menu') showMenu();
  });

  // ---------- HUD ----------
  function updateHud() {
    $('hudLevel').textContent = level + 1;
    $('hudScore').textContent = score;
    const left = $('hudLeft');
    left.textContent = shotsLeft;
    left.classList.toggle('low', shotsLeft <= 5 && state === 'playing');
    $('hudFired').textContent = fired;
    $('hudBest').textContent = Math.max(save.best[level], score);
    $('dropInfo').textContent = cfg.drop
      ? '⚠ New row in ' + Math.max(0, cfg.drop - sinceDrop) + ' shot' + (cfg.drop - sinceDrop === 1 ? '' : 's')
      : '✔ Ceiling is safe on this level';
  }

  // ---------- Input ----------
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function setAim(p) {
    const dx = p.x - SHX, dy = p.y - SHY;
    let a = Math.atan2(-dy, dx);
    if (a < 0) a = dx >= 0 ? 0.2 : Math.PI - 0.2;
    aim = Math.min(Math.max(a, 0.2), Math.PI - 0.2);
  }
  let swapTap = false;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    if (Math.hypot(p.x - NEXT_X, p.y - SHY) < R * 1.6) { swap(); swapTap = true; return; }
    swapTap = false; setAim(p);
  });
  canvas.addEventListener('pointermove', (e) => setAim(toCanvas(e)));
  canvas.addEventListener('pointerup', (e) => {
    if (swapTap) { swapTap = false; return; }
    setAim(toCanvas(e)); fire();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); swap(); }
    else if (e.key === 'r' || e.key === 'R') { if (state !== 'menu') startLevel(level); }
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'ArrowLeft') aim = Math.min(aim + 0.05, Math.PI - 0.2);
    else if (e.key === 'ArrowRight') aim = Math.max(aim - 0.05, 0.2);
    else if (e.key === 'Enter' || e.key === 'ArrowUp') fire();
  });

  function toggleMute() { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; }
  $('btnMute').addEventListener('click', toggleMute);
  $('btnRestart').addEventListener('click', () => { if (state !== 'menu') startLevel(level); });
  $('btnMenu').addEventListener('click', showMenu);

  // ---------- Update ----------
  function update(dt) {
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 8);

    if (state === 'playing' && ball) {
      let dist = SPEED * dt;
      while (dist > 0 && ball) {
        const s = Math.min(dist, 5); dist -= s;
        ball.x += ball.vx * s; ball.y += ball.vy * s;
        if (ball.x < MIN_X) { ball.x = MIN_X; ball.vx = -ball.vx; }
        else if (ball.x > MAX_X) { ball.x = MAX_X; ball.vx = -ball.vx; }
        if (ball.y <= TOP + R) { ball.y = TOP + R; land(); break; }
        if (hitsGrid(ball.x, ball.y)) { land(); break; }
      }
    }
    for (const f of falling) { f.vy += 1500 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
    falling = falling.filter((f) => f.y < H + 40);
    for (const p of parts) { p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    parts = parts.filter((p) => p.life > 0);
    for (const t of texts) { t.y -= 40 * dt; t.t -= dt * 0.9; }
    texts = texts.filter((t) => t.t > 0);
  }

  // ---------- Aim preview ----------
  function trace() {
    let x = SHX, y = SHY, vx = Math.cos(aim), vy = -Math.sin(aim), d = 0;
    const pts = [];
    for (let i = 0; i < 500; i++) {
      x += vx * 5; y += vy * 5;
      if (x < MIN_X) { x = MIN_X; vx = -vx; } else if (x > MAX_X) { x = MAX_X; vx = -vx; }
      if (y <= TOP + R) { y = TOP + R; break; }
      if (hitsGrid(x, y)) break;
      d += 5;
      if (d % 25 === 0) pts.push([x, y]);
    }
    return { pts, end: { x, y } };
  }

  // ---------- Draw ----------
  function draw() {
    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a1a63'); bg.addColorStop(1, '#0f0828');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 14; i++) {
      ctx.beginPath(); ctx.arc((i * 97) % W, (i * 151) % H, 14 + (i % 4) * 9, 0, Math.PI * 2); ctx.fill();
    }

    // ceiling bar (flashes red when a new row is about to arrive)
    const warn = cfg.drop && state === 'playing' && cfg.drop - sinceDrop === 1;
    ctx.fillStyle = warn ? 'rgba(255,60,80,' + (0.55 + 0.35 * Math.sin(performance.now() / 120)) + ')' : 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, W, TOP);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, GRID_L - 1, H); ctx.fillRect(W - GRID_L + 1, 0, GRID_L - 1, H);

    // danger line
    const dy = rowY(LOSE_ROW) - R;
    ctx.save();
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(255,90,110,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, dy); ctx.lineTo(W, dy); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,90,110,0.7)'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('DANGER', 12, dy - 5);

    // grid bubbles
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c] !== null) drawBubble(rowX(r, c), rowY(r), grid[r][c]);

    // falling bubbles + particles
    for (const f of falling) drawBubble(f.x, f.y, f.ci, 0.95);
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = PALETTE[p.ci][0];
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // aim guide
    if (state === 'playing' && !ball) {
      const { pts, end } = trace();
      pts.forEach(([x, y], i) => {
        ctx.globalAlpha = 0.75 - (i / Math.max(pts.length, 1)) * 0.5;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      const cell = snap(end, true) || snap(end, false);
      if (cell) drawBubble(rowX(cell[0], cell[1]), rowY(cell[0]), cur, 0.28);
    }

    // shooter
    ctx.save();
    ctx.translate(SHX, SHY);
    const base = ctx.createRadialGradient(0, 0, 6, 0, 0, 42);
    base.addColorStop(0, '#5a4aa8'); base.addColorStop(1, '#2a1f66');
    ctx.fillStyle = base; ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.rotate(Math.PI / 2 - aim);
    ctx.fillStyle = '#7d6bd6';
    const len = 56 - recoil * 8;
    ctx.beginPath(); ctx.roundRect(-11, -len, 22, len - 6, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    if (!ball || true) drawBubble(SHX, SHY, cur);

    // flying ball
    if (ball) drawBubble(ball.x, ball.y, ball.ci);

    // next bubble
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.arc(NEXT_X, SHY, R + 9, 0, Math.PI * 2); ctx.fill();
    drawBubble(NEXT_X, SHY, next, 1, 0.85);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('NEXT ⇄', NEXT_X, SHY + R + 24);

    // shots remaining dots under shooter
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(shotsLeft + ' shots left', SHX + 95, SHY + 4);

    // floating score texts
    ctx.font = '800 18px system-ui, sans-serif';
    for (const t of texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, t.t));
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = '#ffd23f'; ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // banner
    if (banner) {
      const a = Math.min(1, banner.t * 2);
      ctx.globalAlpha = a;
      ctx.font = '900 44px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 8;
      ctx.strokeText(banner.text, W / 2, H / 2 - 40);
      ctx.fillStyle = '#fff'; ctx.fillText(banner.text, W / 2, H / 2 - 40);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Main loop ----------
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.033, (t - last) / 1000 || 0);
    last = t;
    update(dt); draw();
    requestAnimationFrame(frame);
  }

  // ---------- Init ----------
  startLevel(0);
  banner = null;
  showMenu();
  requestAnimationFrame(frame);
})();
