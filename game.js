(() => {
  const CELL = 20;
  // Portrait phones get a taller board so cells stay a usable size.
  const portrait = window.matchMedia("(max-width: 640px)").matches;
  const COLS = portrait ? 24 : 40, ROWS = portrait ? 34 : 28;
  const W = COLS * CELL, H = ROWS * CELL;
  const TICK_START = 115, TICK_MIN = 50;
  const COMBO_WINDOW = 4000, COMBO_MAX = 5;
  const GOLD_LIFE = 7000, POWER_LIFE = 9000, EFFECT_TIME = 6000, SLOW_FACTOR = 1.7;
  const MAX_ROCKS = 10;

  const POWER = {
    slow: { emoji: "🐢", color: "#38bdf8", label: "Slow-motion" },
    ghost: { emoji: "👻", color: "#c084fc", label: "Spökläge" },
  };

  const canvas = document.getElementById("board");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const ui = {
    player: $("player"), score: $("score"), best: $("best"), combo: $("combo"), board: $("leaderboard"),
    start: $("overlay-start"), over: $("overlay-over"), pause: $("overlay-pause"),
    finalScore: $("final-score"), saveStatus: $("save-status"), username: $("username"),
  };

  let state = "menu"; // menu | playing | paused | over
  let username = localStorage.getItem("snakeUser") || "";
  let snake, prev, dir, queue, food, score, best = 0, tickMs, acc, last;
  let particles, popups, shake, flash, eatPulse;
  let gameTime, eaten, combo, lastEat, pickups, rocks, effects;
  let leaderboard = [];

  ui.username.value = username;

  const rand = (n) => Math.floor(Math.random() * n);
  const lerp = (a, b, t) => a + (b - a) * t;
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const wrapDist = (a, b) => {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return Math.min(dx, COLS - dx) + Math.min(dy, ROWS - dy);
  };

  function reset() {
    const cx = COLS / 2, cy = ROWS / 2;
    snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
    prev = snake.map((s) => ({ ...s }));
    dir = { x: 1, y: 0 };
    queue = [];
    score = 0; tickMs = TICK_START; acc = 0;
    particles = []; popups = []; shake = 0; flash = 0; eatPulse = 0;
    gameTime = 0; eaten = 0; combo = 1; lastEat = -Infinity;
    pickups = []; rocks = []; effects = { slow: 0, ghost: 0 };
    food = null;
    food = freeCell();
    updateHud();
  }

  function freeCell(minHeadDist = 0) {
    const taken = [...snake, ...rocks, ...pickups];
    if (food) taken.push(food);
    const free = [];
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) {
      const c = { x, y };
      if (taken.some((t) => same(t, c))) continue;
      if (minHeadDist && wrapDist(c, snake[0]) < minHeadDist) continue;
      free.push(c);
    }
    return free.length ? free[rand(free.length)] : null;
  }

  function show(el, on) { el.classList.toggle("hidden", !on); }

  function updateHud() {
    ui.player.textContent = username || "-";
    ui.score.textContent = score;
    ui.best.textContent = best;
    ui.combo.textContent = "x" + combo;
    ui.combo.classList.toggle("hot", combo > 1);
  }

  // Without the local Python server (e.g. on GitHub Pages) the game still works,
  // but there is no Excel leaderboard; only a personal best is kept in the browser.
  let hasServer = false;

  const bestKey = () => "snakeBest:" + username;
  const localBest = () => Number(localStorage.getItem(bestKey())) || 0;

  async function loadLeaderboard() {
    try {
      const res = await fetch("api/highscores");
      if (!res.ok) throw new Error("no server");
      leaderboard = await res.json();
      hasServer = Array.isArray(leaderboard);
    } catch { leaderboard = []; hasServer = false; }
    document.body.classList.toggle("no-server", !hasServer);
    ui.board.replaceChildren();
    if (!leaderboard.length) {
      const li = document.createElement("li");
      li.className = "empty"; li.textContent = "Inga resultat än";
      ui.board.append(li);
    }
    for (const row of leaderboard.slice(0, 10)) {
      const li = document.createElement("li");
      const name = document.createElement("span"); name.className = "name"; name.textContent = row.name;
      name.title = row.date;
      const pts = document.createElement("span"); pts.className = "pts"; pts.textContent = row.score;
      li.append(name, pts); ui.board.append(li);
    }
    best = Math.max(best, localBest(), ...leaderboard.filter((r) => r.name === username).map((r) => r.score), 0);
    updateHud();
  }

  async function submitScore() {
    if (!hasServer) { ui.saveStatus.textContent = ""; return; }
    ui.saveStatus.textContent = "Sparar...";
    try {
      const res = await fetch("api/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, score }),
      });
      ui.saveStatus.textContent = res.ok ? "Poängen sparad i highscores.xlsx"
        : res.status === 423 ? "Kunde inte spara: stäng highscores.xlsx i Excel och spela igen"
        : "Kunde inte spara poängen";
    } catch {
      ui.saveStatus.textContent = "Kunde inte nå servern (startade du via Starta_Snake.bat?)";
    }
    loadLeaderboard();
  }

  function startGame() {
    reset();
    state = "playing";
    show(ui.start, false); show(ui.over, false); show(ui.pause, false);
    last = performance.now();
  }

  function gameOver() {
    state = "over";
    shake = 14; flash = 1;
    burst(snake[0].x, snake[0].y, "#f87171", 30);
    best = Math.max(best, score);
    if (score > localBest()) localStorage.setItem(bestKey(), String(score));
    ui.finalScore.textContent = score;
    updateHud();
    show(ui.over, true);
    submitScore();
  }

  function burst(cx, cy, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.5;
      particles.push({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
    }
  }

  function popup(cx, cy, text, color) {
    popups.push({ x: (cx + 0.5) * CELL, y: cy * CELL, text, color, life: 1 });
  }

  function registerEat(base, cell, color) {
    combo = gameTime - lastEat <= COMBO_WINDOW ? Math.min(COMBO_MAX, combo + 1) : 1;
    lastEat = gameTime;
    const pts = base * combo;
    score += pts;
    eatPulse = 1;
    burst(cell.x, cell.y, color);
    popup(cell.x, cell.y, `+${pts}${combo > 1 ? ` (x${combo})` : ""}`, color);
  }

  function spawnExtras() {
    if (eaten % 5 === 0 && rocks.length < MAX_ROCKS) {
      const r = freeCell(7);
      if (r) rocks.push(r);
    }
    if (eaten % 4 === 0 && !pickups.some((p) => p.type in POWER)) {
      const c = freeCell(3);
      if (c) pickups.push({ ...c, type: Math.random() < 0.5 ? "slow" : "ghost", expires: gameTime + POWER_LIFE });
    }
    if (Math.random() < 0.25 && !pickups.some((p) => p.type === "gold")) {
      const c = freeCell(3);
      if (c) pickups.push({ ...c, type: "gold", expires: gameTime + GOLD_LIFE });
    }
  }

  function step() {
    if (queue.length) dir = queue.shift();
    prev = snake.map((s) => ({ ...s }));
    pickups = pickups.filter((p) => p.expires > gameTime);

    const head = { x: (snake[0].x + dir.x + COLS) % COLS, y: (snake[0].y + dir.y + ROWS) % ROWS };
    const ate = same(head, food);
    const pk = pickups.find((p) => same(p, head));
    const grow = ate || (pk && pk.type === "gold");
    const body = grow ? snake : snake.slice(0, -1);
    const ghost = gameTime < effects.ghost;

    if (!ghost && (rocks.some((r) => same(r, head)) || body.some((s) => same(s, head)))) { gameOver(); return; }

    snake.unshift(head);
    if (pk) {
      pickups.splice(pickups.indexOf(pk), 1);
      if (pk.type === "gold") {
        registerEat(50, head, "#fbbf24");
      } else {
        effects[pk.type] = gameTime + EFFECT_TIME;
        burst(head.x, head.y, POWER[pk.type].color, 20);
        popup(head.x, head.y, POWER[pk.type].label, POWER[pk.type].color);
      }
    }
    if (ate) {
      registerEat(10, head, "#fb7185");
      eaten++;
      tickMs = Math.max(TICK_MIN, tickMs - 2);
      if (eaten % 5 === 0) popup(head.x, head.y + 1.5, "HEJA GAIS! 💚🖤", "#4ade80");
    }
    if (grow) {
      prev.push({ ...prev[prev.length - 1] });
      if (snake.length === COLS * ROWS) { gameOver(); return; }
    } else {
      snake.pop();
    }
    if (ate) {
      food = null;
      food = freeCell();
      spawnExtras();
    }
    updateHud();
  }

  function turn(nx, ny) {
    const ref = queue.length ? queue[queue.length - 1] : dir;
    if (nx + ref.x === 0 && ny + ref.y === 0) return;
    if (nx === ref.x && ny === ref.y) return;
    if (queue.length < 2) queue.push({ x: nx, y: ny });
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; show(ui.pause, true); }
    else if (state === "paused") { state = "playing"; show(ui.pause, false); last = performance.now(); }
  }

  const KEYS = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
  };

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (KEYS[e.key]) {
      e.preventDefault();
      if (state === "playing") turn(...KEYS[e.key]);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (state === "over") startGame(); else togglePause();
    } else if (e.key === "p" || e.key === "P") togglePause();
  });

  // Touch: tap beside the snake's head to steer relative to its heading. turn() rejects 180° reversals.
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || state !== "playing") return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const k = W / rect.width;
    const dx = (e.clientX - rect.left) * k - (snake[0].x + 0.5) * CELL;
    const dy = (e.clientY - rect.top) * k - (snake[0].y + 0.5) * CELL;
    // Only the axis perpendicular to the current heading matters, so a tap far below
    // but slightly right still turns right when the snake is moving up or down.
    const ref = queue.length ? queue[queue.length - 1] : dir;
    const dead = CELL * 0.25;
    if (ref.x === 0) { if (Math.abs(dx) > dead) turn(Math.sign(dx), 0); }
    else if (Math.abs(dy) > dead) turn(0, Math.sign(dy));
  });
  ui.pause.addEventListener("click", togglePause);
  // A phone has no pause key, so pause when the page is hidden or the screen locks.
  document.addEventListener("visibilitychange", () => { if (document.hidden && state === "playing") togglePause(); });

  // Fit the board to the visible area (width and height) so it never needs scrolling on phones.
  function fitCanvas() {
    const px = (v) => parseFloat(v) || 0;
    const layout = getComputedStyle(document.querySelector(".layout"));
    const card = canvas.closest(".game-card"), cardCss = getComputedStyle(card);
    const hud = card.querySelector(".hud");
    const padX = px(layout.paddingLeft) + px(layout.paddingRight) + px(cardCss.paddingLeft) + px(cardCss.paddingRight) + 4;
    const padY = px(layout.paddingTop) + px(layout.paddingBottom) + px(cardCss.paddingTop) + px(cardCss.paddingBottom)
      + hud.offsetHeight + px(getComputedStyle(hud).marginBottom) + 4;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const w = Math.max(200, Math.min(800, vw - padX, (vh - padY) * W / H));
    canvas.style.width = Math.floor(w) + "px";
    canvas.style.height = Math.floor(w * H / W) + "px";
  }
  window.addEventListener("resize", fitCanvas);
  window.addEventListener("load", fitCanvas);
  window.addEventListener("orientationchange", () => setTimeout(fitCanvas, 200));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitCanvas);
  fitCanvas();

  $("start-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = ui.username.value.trim().slice(0, 20);
    if (!name) return;
    username = name;
    localStorage.setItem("snakeUser", name);
    best = 0;
    loadLeaderboard().then(startGame);
  });
  $("again").addEventListener("click", startGame);
  $("change").addEventListener("click", () => {
    state = "menu"; show(ui.over, false); show(ui.start, true); ui.username.focus(); ui.username.select();
  });

  function drawBackground(time) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d1428"); g.addColorStop(1, "#0a0f1d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
    drawCheer(time);
    // Dashed border hints that the walls are open.
    ctx.strokeStyle = "rgba(129,140,248,0.35)"; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    ctx.strokeRect(1, 1, W - 2, H - 2); ctx.setLineDash([]);
  }

  // Faint drifting "HEJA GAIS" texts in the background.
  const CHEERS = [
    { y: 0.12, size: 38, speed: 0.012, offset: 0.1, tilt: -0.08, color: "34,197,94", alpha: 0.10 },
    { y: 0.30, size: 26, speed: 0.020, offset: 0.55, tilt: 0.06, color: "255,255,255", alpha: 0.06 },
    { y: 0.47, size: 46, speed: 0.008, offset: 0.8, tilt: -0.05, color: "34,197,94", alpha: 0.08 },
    { y: 0.64, size: 30, speed: 0.016, offset: 0.3, tilt: 0.09, color: "255,255,255", alpha: 0.06 },
    { y: 0.80, size: 40, speed: 0.011, offset: 0.65, tilt: -0.07, color: "34,197,94", alpha: 0.09 },
    { y: 0.93, size: 24, speed: 0.022, offset: 0.05, tilt: 0.04, color: "255,255,255", alpha: 0.05 },
  ];

  function drawCheer(time) {
    ctx.save();
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const c of CHEERS) {
      ctx.font = `italic 800 ${c.size}px 'Segoe UI', sans-serif`;
      const span = W + 360;
      const x = ((c.offset * span + time * c.speed) % span) - 260;
      ctx.save();
      ctx.translate(x, c.y * H); ctx.rotate(c.tilt);
      ctx.fillStyle = `rgba(${c.color},${c.alpha})`;
      ctx.fillText("HEJA GAIS", 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // ctx.roundRect is missing in Safari < 16, so build the path by hand.
  function rrPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function roundRect(x, y, w, h, r) {
    rrPath(x, y, w, h, r); ctx.fill();
  }

  // Draw at (x, y) and at the wrapped position when near an edge.
  function wrapped(x, y, drawFn) {
    const xs = [x], ys = [y];
    if (x + CELL > W) xs.push(x - W);
    if (y + CELL > H) ys.push(y - H);
    for (const ox of xs) for (const oy of ys) drawFn(ox, oy);
  }

  function drawFood(time) {
    const cx = (food.x + 0.5) * CELL, cy = (food.y + 0.5) * CELL;
    const r = 6.5 + Math.sin(time / 180) * 1 + eatPulse * 2;
    ctx.save();
    ctx.shadowColor = "#fb7185"; ctx.shadowBlur = 18;
    const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r);
    g.addColorStop(0, "#fecdd3"); g.addColorStop(1, "#e11d48");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#4ade80"; ctx.fillRect(cx - 1, cy - r - 3, 2, 4);
  }

  function drawPickup(p, time) {
    const cx = (p.x + 0.5) * CELL, cy = (p.y + 0.5) * CELL;
    const left = Math.max(0, p.expires - gameTime) / (p.type === "gold" ? GOLD_LIFE : POWER_LIFE);
    const color = p.type === "gold" ? "#fbbf24" : POWER[p.type].color;
    const blink = left < 0.3 && Math.floor(time / 150) % 2 === 0;
    if (blink) return;
    const r = 8.5 + Math.sin(time / 140) * 1.2;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 20;
    ctx.fillStyle = "rgba(10,15,29,0.85)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    ctx.restore();
    ctx.font = "12px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.type === "gold" ? "⭐" : POWER[p.type].emoji, cx, cy + 1);
  }

  function drawRock(r) {
    const x = r.x * CELL, y = r.y * CELL;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#475069"; roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 5);
    ctx.restore();
    ctx.fillStyle = "#6b7694"; roundRect(x + 3, y + 3, CELL - 9, CELL - 10, 3);
  }

  function drawSnake(t) {
    const n = snake.length;
    const ghost = gameTime < effects.ghost;
    const fading = ghost && effects.ghost - gameTime < 1500 && Math.floor(performance.now() / 120) % 2 === 0;
    ctx.globalAlpha = ghost ? (fading ? 0.8 : 0.5) : 1;
    for (let i = n - 1; i >= 0; i--) {
      const p = prev[i] || snake[i], c = snake[i];
      // Shortest wrapped delta so segments slide across the open walls.
      let dx = c.x - p.x, dy = c.y - p.y;
      if (dx > 1) dx -= COLS; else if (dx < -1) dx += COLS;
      if (dy > 1) dy -= ROWS; else if (dy < -1) dy += ROWS;
      const x = (((p.x + dx * t) % COLS) + COLS) % COLS * CELL;
      const y = (((p.y + dy * t) % ROWS) + ROWS) % ROWS * CELL;
      const k = 1 - i / n;
      const inset = 1 + (1 - k) * 2;
      const hue = ghost ? 275 : 165 - (1 - k) * 25;
      wrapped(x, y, (ox, oy) => {
        ctx.save();
        if (i === 0) { ctx.shadowColor = ghost ? "#c084fc" : "#5eead4"; ctx.shadowBlur = 16; }
        ctx.fillStyle = i === 0 ? (ghost ? "#e9d5ff" : "#99f6e4") : `hsl(${hue}, 70%, ${42 + k * 14}%)`;
        roundRect(ox + inset, oy + inset, CELL - inset * 2, CELL - inset * 2, i === 0 ? 8 : 6);
        ctx.restore();
        if (i === 0) drawEyes(ox, oy);
      });
    }
    ctx.globalAlpha = 1;
  }

  function drawEyes(x, y) {
    const d = dir, cx = x + CELL / 2, cy = y + CELL / 2;
    const px = -d.y, py = d.x;
    for (const side of [-1, 1]) {
      const ex = cx + d.x * 4 + px * side * 4, ey = cy + d.y * 4 + py * side * 4;
      ctx.fillStyle = "#0b1020"; ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + d.x * 0.6 - 0.5, ey + d.y * 0.6 - 0.5, 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 * p.life + 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 14px 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const p of popups) {
      ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
      ctx.fillText(p.text, Math.min(Math.max(p.x, 40), W - 40), p.y - (1 - p.life) * 22);
    }
    ctx.globalAlpha = 1;
  }

  function drawEffects() {
    let y = 10;
    for (const key of Object.keys(POWER)) {
      const left = effects[key] - gameTime;
      if (left <= 0) continue;
      ctx.fillStyle = "rgba(10,15,29,0.7)"; roundRect(W - 150, y, 140, 26, 13);
      ctx.fillStyle = POWER[key].color; rrPath(W - 148, y + 2, 136 * (left / EFFECT_TIME), 22, 11);
      ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff"; ctx.font = "12px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${POWER[key].emoji} ${POWER[key].label}`, W - 140, y + 14);
      y += 32;
    }
  }

  function frame(now) {
    if (state === "playing") {
      const dt = Math.min(now - last, 100);
      last = now;
      gameTime += dt;
      acc += dt;
      if (combo > 1 && gameTime - lastEat > COMBO_WINDOW) { combo = 1; updateHud(); }
      while (state === "playing") {
        const eff = gameTime < effects.slow ? tickMs * SLOW_FACTOR : tickMs;
        if (acc < eff) break;
        acc -= eff; step();
      }
    }
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96; p.life -= 0.025; }
    particles = particles.filter((p) => p.life > 0);
    for (const p of popups) p.life -= 0.02;
    popups = popups.filter((p) => p.life > 0);
    eatPulse = Math.max(0, eatPulse - 0.08);

    ctx.save();
    if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.9; if (shake < 0.5) shake = 0; }
    drawBackground(now);
    if (snake) {
      rocks.forEach(drawRock);
      pickups.forEach((p) => drawPickup(p, now));
      if (food) drawFood(now);
      const eff = gameTime < effects.slow ? tickMs * SLOW_FACTOR : tickMs;
      drawSnake(state === "playing" ? Math.min(acc / eff, 1) : 1);
    }
    drawParticles();
    if (snake) drawEffects();
    ctx.restore();
    if (flash > 0) {
      ctx.fillStyle = `rgba(248,113,113,${flash * 0.35})`; ctx.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - 0.04);
    }
    requestAnimationFrame(frame);
  }

  reset();
  loadLeaderboard();
  requestAnimationFrame(frame);
  if (username) ui.username.select(); else ui.username.focus();
})();
