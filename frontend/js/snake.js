/**
 * snake.js — ゲームロジック
 * プレゼンテーション層 (S3 + CloudFront) 用
 * API Gateway 連携: スコア登録 / ランキング取得
 */

(function () {
  'use strict';

  /* ── Constants ── */
  const COLS = 20, ROWS = 20, SZ = 20;
  const W = COLS * SZ, H = ROWS * SZ;
  const BASE_SPEED = 180, MIN_SPEED = 60;

  const COLOR_BG    = '#fafffa';
  const COLOR_GRID  = '#e0ebe0';
  const COLOR_FOOD  = '#ef5350';
  const COLOR_EYES  = '#ffffff';
  const COLOR_PUPIL = '#1b5e20';
  const SNAKE_COLORS = [
    '#1b5e20', '#2e7d32', '#388e3c',
    '#43a047', '#4caf50', '#66bb6a', '#81c784'
  ];

  /* ── DOM ── */
  const canvas    = document.getElementById('game-canvas');
  const ctx       = canvas.getContext('2d');
  const scoreEl   = document.getElementById('score-val');
  const hiEl      = document.getElementById('hi-val');
  const msgEl     = document.getElementById('message');
  const levelEl   = document.getElementById('level-display');
  const actionBtn = document.getElementById('action-btn');

  // Modal elements
  const scoreModal    = document.getElementById('score-modal');
  const modalScoreEl  = document.getElementById('modal-final-score');
  const playerNameEl  = document.getElementById('player-name-input');
  const submitBtn     = document.getElementById('submit-score-btn');
  const skipBtn       = document.getElementById('skip-score-btn');

  // Ranking elements
  const rankingList   = document.getElementById('ranking-list');
  const rankingEmpty  = document.getElementById('ranking-empty');
  const rankingStatus = document.getElementById('ranking-status');

  /* ── State ── */
  let snake, dir, nextDir, food;
  let score = 0, hi = 0, lvl = 1, speed = BASE_SPEED;
  let state = 'idle';   // idle | running | paused | over
  let rafId = null, lastTs = 0;

  /* ── Canvas DPR / Resize ── */
  function setupCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const scale = (rect.width * dpr) / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function redrawCurrent() {
    if (state === 'running' || state === 'paused') {
      draw();
      if (state === 'paused') drawPauseOverlay();
    } else if (state === 'over') {
      draw();
      drawGameOverOverlay();
    } else {
      drawIdle();
    }
  }
  window.addEventListener('resize', () => {
    setupCanvas();
    redrawCurrent();
  });

  /* ── State machine ── */
  function setState(s) {
    state = s;
    switch (s) {
      case 'idle':    actionBtn.textContent = 'START';  break;
      case 'running': actionBtn.textContent = 'PAUSE';  break;
      case 'paused':  actionBtn.textContent = 'RESUME'; break;
      case 'over':    actionBtn.textContent = 'RETRY';  break;
    }
  }
  function handleAction() {
    if (state === 'idle' || state === 'over') startGame();
    else if (state === 'running')              pauseGame();
    else if (state === 'paused')               resumeGame();
  }

  /* ── Start / Reset ── */
  function startGame() {
    closeModal();
    cancelAnimationFrame(rafId);
    snake   = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
    dir     = {x:1,y:0};
    nextDir = {x:1,y:0};
    score   = 0;
    lvl     = 1;
    speed   = BASE_SPEED;
    lastTs  = 0;
    placeFood();
    updateHUD();
    levelEl.textContent = 'LEVEL 1';
    setState('running');
    rafId = requestAnimationFrame(loop);
  }

  /* ── Pause / Resume ── */
  function pauseGame() {
    if (state !== 'running') return;
    cancelAnimationFrame(rafId);
    setState('paused');
    drawPauseOverlay();
  }
  function resumeGame() {
    if (state !== 'paused') return;
    lastTs = 0;
    setState('running');
    rafId = requestAnimationFrame(loop);
  }
  function togglePause() {
    if (state === 'running')     pauseGame();
    else if (state === 'paused') resumeGame();
  }

  /* ── Food ── */
  function placeFood() {
    let pos;
    do {
      pos = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS)
      };
    } while (snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  /* ── Game loop ── */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (ts - lastTs < speed) return;
    lastTs = ts;
    update();
    draw();
  }

  function update() {
    dir = { ...nextDir };
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // 壁衝突
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      gameOver(); return;
    }
    // 自己衝突（テール除外）
    const body = snake.slice(0, -1);
    if (body.some(s => s.x === head.x && s.y === head.y)) {
      gameOver(); return;
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score++;
      if (score > hi) hi = score;
      updateHUD();
      if (score % 5 === 0) {
        lvl = Math.min(lvl + 1, 10);
        speed = Math.max(MIN_SPEED, BASE_SPEED - lvl * 15);
        levelEl.textContent = 'LEVEL ' + lvl;
      }
      placeFood();
    } else {
      snake.pop();
    }
  }

  /* ── Draw ── */
  function drawGrid() {
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * SZ + 0.5, 0);
      ctx.lineTo(i * SZ + 0.5, H);
      ctx.stroke();
    }
    for (let j = 1; j < ROWS; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * SZ + 0.5);
      ctx.lineTo(W, j * SZ + 0.5);
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function draw() {
    drawGrid();

    snake.forEach((seg, i) => {
      const ci = Math.min(SNAKE_COLORS.length - 1, Math.floor(i / 3));
      ctx.fillStyle = SNAKE_COLORS[ci];
      roundRect(seg.x * SZ + 1.5, seg.y * SZ + 1.5, SZ - 3, SZ - 3, 5);
      ctx.fill();

      if (i === 0) {
        const cx = seg.x * SZ + SZ / 2;
        const cy = seg.y * SZ + SZ / 2;
        const ox = dir.x * 3, oy = dir.y * 3;
        const px = Math.abs(dir.x) ? 0 : 4;
        const py = Math.abs(dir.y) ? 0 : 4;

        ctx.fillStyle = COLOR_EYES;
        ctx.beginPath();
        ctx.arc(cx + ox - px, cy + oy - py, 2.8, 0, Math.PI * 2);
        ctx.arc(cx + ox + px, cy + oy + py, 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = COLOR_PUPIL;
        ctx.beginPath();
        ctx.arc(cx + ox - px + dir.x, cy + oy - py + dir.y, 1.3, 0, Math.PI * 2);
        ctx.arc(cx + ox + px + dir.x, cy + oy + py + dir.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 250);
    const fx = food.x * SZ + SZ / 2;
    const fy = food.y * SZ + SZ / 2;
    const r  = (SZ / 2 - 3) * pulse;
    const grad = ctx.createRadialGradient(fx, fy, 1, fx, fy, r + 4);
    grad.addColorStop(0, COLOR_FOOD);
    grad.addColorStop(1, 'rgba(239, 83, 80, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fx, fy, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_FOOD;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(fx - r * 0.35, fy - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawIdle() {
    drawGrid();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2e7d32';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('SNAKE', W / 2, H / 2 - 6);
    ctx.fillStyle = '#8aa090';
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('START を押してゲーム開始', W / 2, H / 2 + 22);
  }

  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2e7d32';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 8);
    ctx.fillStyle = '#4e6a52';
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('ESC / RESUME で再開', W / 2, H / 2 + 20);
  }

  /* ── Game Over ── */
  function gameOver() {
    cancelAnimationFrame(rafId);
    setState('over');
    drawGameOverOverlay();
    // スコア登録モーダルを表示
    openScoreModal(score);
  }

  function drawGameOverOverlay() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c62828';
    ctx.font = 'bold 28px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('GAME OVER', W / 2, H / 2 - 14);
    ctx.fillStyle = '#4e6a52';
    ctx.font = '15px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('SCORE: ' + score, W / 2, H / 2 + 14);
  }

  function updateHUD() {
    scoreEl.textContent = score;
    hiEl.textContent    = hi;
  }

  /* ── Score Modal ── */
  function openScoreModal(finalScore) {
    if (!scoreModal) return;
    // スコアが0なら登録不要
    if (finalScore === 0) return;
    modalScoreEl.textContent = finalScore;
    playerNameEl.value = '';
    scoreModal.removeAttribute('hidden');
    setTimeout(() => playerNameEl.focus(), 100);
  }

  function closeModal() {
    if (scoreModal) scoreModal.setAttribute('hidden', '');
  }

  async function handleScoreSubmit() {
    const name = playerNameEl.value.trim();
     if (!name) {
    setRankingStatus('名前入力わすれていませんか？！');
    return;
  }
    submitBtn.disabled = true;
    submitBtn.textContent = '登録中…';
    try {
      await window.SnakeAPI.postScore(name, score, lvl);
      submitBtn.textContent = 'SUBMIT';
      submitBtn.disabled = false;
      setRankingStatus('ランキング更新中…');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadRanking();
      closeModal();
      setRankingStatus('登録完了！ランキングを更新しました');
    } catch (err) {
      submitBtn.textContent = 'SUBMIT';
      submitBtn.disabled = false;
      setRankingStatus('登録に失敗しました');
      console.warn('postScore error:', err);
    }
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', handleScoreSubmit);
    playerNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleScoreSubmit();
    });
  }
  if (skipBtn) {
    skipBtn.addEventListener('click', closeModal);
  }

  /* ── Ranking ── */
  function setRankingStatus(msg) {
    if (rankingStatus) rankingStatus.textContent = msg;
    if (msg) setTimeout(() => { if (rankingStatus) rankingStatus.textContent = ''; }, 3000);
  }

  async function loadRanking() {
    if (!rankingList || !window.SnakeAPI) return;
    try {
      const data = await window.SnakeAPI.getRanking(10);
      renderRanking(data);
    } catch (err) {
      if (rankingEmpty) rankingEmpty.textContent = 'ランキング取得できませんでした';
      console.warn('getRanking error:', err);
    }
  }

  function renderRanking(items) {
    if (!rankingList) return;
    rankingList.innerHTML = '';
    if (!items || items.length === 0) {
      if (rankingEmpty) rankingEmpty.style.display = 'block';
      return;
    }
    if (rankingEmpty) rankingEmpty.style.display = 'none';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      const rank = i + 1;
      li.innerHTML = `
        <span class="rank-num ${rank <= 3 ? 'top3' : ''}">${rank}</span>
        <span class="rank-name" title="${escHtml(item.player_name)}">${escHtml(item.player_name)}</span>
        <span class="rank-score">${item.score}</span>
      `;
      rankingList.appendChild(li);
    });
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Input: Keyboard ── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (scoreModal && !scoreModal.hidden) { closeModal(); return; }
      togglePause();
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (state === 'idle' || state === 'over') startGame();
      else if (state === 'paused') resumeGame();
      return;
    }
    if (state !== 'running') return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const map = {
      ArrowUp:    { x:  0, y: -1 },
      ArrowDown:  { x:  0, y:  1 },
      ArrowLeft:  { x: -1, y:  0 },
      ArrowRight: { x:  1, y:  0 },
      w: { x:  0, y: -1 },
      s: { x:  0, y:  1 },
      a: { x: -1, y:  0 },
      d: { x:  1, y:  0 },
    };
    const nd = map[key];
    if (!nd) return;
    if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
    e.preventDefault();
  });

  /* ── Action button ── */
  actionBtn.addEventListener('click', handleAction);

  /* ── D-pad ── */
  const dpadMap = {
    'btn-up':    { x:  0, y: -1 },
    'btn-down':  { x:  0, y:  1 },
    'btn-left':  { x: -1, y:  0 },
    'btn-right': { x:  1, y:  0 },
  };
  Object.entries(dpadMap).forEach(([id, nd]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const apply = (e) => {
      if (e && e.cancelable) e.preventDefault();
      if (state !== 'running') return;
      if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
    };
    el.addEventListener('touchstart', apply, { passive: false });
    el.addEventListener('click', apply);
  });

  /* ── Swipe gesture ── */
  let touchStart = null;
  const SWIPE_MIN = 24;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touchStart || state !== 'running') return;
    if (e.cancelable) e.preventDefault();
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    let nd;
    if (Math.abs(dx) > Math.abs(dy)) {
      nd = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    } else {
      nd = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    }
    if (nd.x !== -dir.x || nd.y !== -dir.y) nextDir = nd;
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  canvas.addEventListener('touchend',    () => { touchStart = null; });
  canvas.addEventListener('touchcancel', () => { touchStart = null; });

  /* ── Auto-pause on tab hidden ── */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') pauseGame();
  });

  /* ── Boot ── */
  setupCanvas();
  drawIdle();
  loadRanking();

})();
