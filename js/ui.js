// 五子棋界面渲染与交互（只负责 DOM，不含规则判定与网络）
// 数据源：game.view(seat) 生成的视图对象；用户动作通过 actionCb 交给 main.js 转发。

const V = new URL(import.meta.url).search; // 跟随 index.html 的 ?v= 做缓存穿透
const R = await import('./rules.js' + V);

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const LETTERS = 'ABCDEFGHIJKLMNO';
const QUICK = ['你好 👋', '开局吧', '这步厉害', '五连！', '手下留情', '再来一局？'];

// 棋盘坐标公式（契约 §5）：四周留 PAD 格、总跨度 SPAN 格，用百分比定位
const PAD = 1.7;
const SPAN = 17.4;
const posX = (sq) => ((R.colOf(sq) + PAD) / SPAN) * 100;
const posY = (sq) => ((R.rowOf(sq) + PAD) / SPAN) * 100;

let actionCb = null;
let chatCb = null;
let boardSig = '';
let linesEl = null;
let toastTimer = 0;
let resignArmed = false;
let resignArmTimer = 0;
let quickReady = false;
let uiBound = false;

/* ---------------- 基础 ---------------- */

export function showScreen(name) {
  for (const id of ['home', 'lobby', 'table']) {
    const el = $('scr-' + id);
    if (el) el.classList.toggle('hidden', id !== name);
  }
  if (name === 'table') layoutBoard();
}

export function toast(msg, ms = 2400) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function setChatSender(fn) {
  chatCb = fn;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function btn(text, kind, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + kind;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

/** 从视图里按座位号找玩家（视图里 players 固定 2 项且按下标排列，这里仍按 seat 找更稳） */
function playerOf(view, seat) {
  return (view.players || []).find((p) => p.seat === seat) || null;
}

/* ---------------- 房间大厅 ---------------- */

export function renderLobby({
  code,
  players = [],
  spectators = [],
  isHost = false,
  canStart = false,
  tip = '',
  youSeat = -1,
} = {}) {
  showScreen('lobby');
  const codeEl = $('lobby-code');
  if (codeEl) codeEl.textContent = code || '----';

  const ul = $('seat-list');
  if (ul) {
    ul.innerHTML = '';
    for (const seat of [0, 1]) {
      const p = players[seat] || { name: '', connected: false };
      const li = document.createElement('li');
      const sideCls = seat === 0 ? 'black' : 'white';
      li.className = 'seat-item ' + sideCls + (p.name ? ' filled' : '');
      li.innerHTML =
        `<span class="idx">${seat === 0 ? '黑' : '白'}</span>` +
        `<span class="nm">${p.name ? escapeHtml(p.name) : '空位'}` +
        `${p.name && seat === youSeat ? '（你）' : ''}` +
        `${p.name && p.connected === false ? ' <i>离线</i>' : ''}</span>` +
        `<span class="tag">${seat === 0 ? '黑方 · 先行' : '白方'}</span>`;
      ul.appendChild(li);
    }
  }

  const specNames = (spectators || []).filter(Boolean);
  const specEl = $('lobby-spec');
  if (specEl) specEl.textContent = specNames.length ? `观战：${specNames.join('、')}` : '第 3 位起自动成为观战';

  const startBtn = $('btn-start');
  if (startBtn) {
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = !canStart;
    const filled = players.filter((p) => p && p.name).length;
    startBtn.textContent = canStart ? '开始对局' : `等待对手入座（${filled}/2）`;
  }

  const tipEl = $('lobby-tip');
  if (tipEl) {
    tipEl.textContent = tip || (isHost ? '把房号发给朋友，两人到齐后点「开始对局」' : '等待房主开始对局…');
  }
}

/* ---------------- 棋盘线（只画一次，之后复用） ---------------- */

function addLine(svg, x1, y1, x2, y2, cls = 'gl') {
  const l = document.createElementNS(SVGNS, 'line');
  l.setAttribute('x1', x1);
  l.setAttribute('y1', y1);
  l.setAttribute('x2', x2);
  l.setAttribute('y2', y2);
  l.setAttribute('class', cls);
  svg.appendChild(l);
}

function addLabel(svg, x, y, txt) {
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('class', 'c-label');
  t.setAttribute('text-anchor', 'middle');
  t.textContent = txt;
  svg.appendChild(t);
}

function buildLines() {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-1.7 -1.7 17.4 17.4');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'lines');

  const N = R.SIZE; // 15
  const last = N - 1; // 14
  // 15 条横线 + 15 条竖线，最外圈的 4 条再带 border 类
  for (let i = 0; i < N; i++) {
    const edge = i === 0 || i === last;
    addLine(svg, 0, i, last, i, edge ? 'gl border' : 'gl');
    addLine(svg, i, 0, i, last, edge ? 'gl border' : 'gl');
  }
  // 5 个星位
  for (const [r, c] of R.STARS) {
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', c);
    dot.setAttribute('cy', r);
    dot.setAttribute('r', 0.1);
    dot.setAttribute('class', 'star');
    svg.appendChild(dot);
  }
  // 底部坐标 A..O
  for (let c = 0; c < N; c++) addLabel(svg, c, last + 1.15, LETTERS[c]);
  // 左侧坐标 15..1（行 0 在最上面）
  for (let r = 0; r < N; r++) addLabel(svg, -1.1, r + 0.22, String(N - r));
  return svg;
}

/** 用 #board-box 的宽高取 min，给 #board 设等宽高（正方形棋盘） */
function layoutBoard() {
  const box = $('board-box');
  const board = $('board');
  if (!box || !board) return;
  const bw = box.clientWidth || 0;
  const bh = box.clientHeight || 0;
  if (bw > 40 && bh > 40) {
    const w = Math.round(Math.min(bw, bh));
    board.style.width = w + 'px';
    board.style.height = w + 'px';
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => layoutBoard());
  if (typeof window.ResizeObserver === 'function') {
    try {
      const ro = new window.ResizeObserver(() => layoutBoard());
      const box = document.getElementById('board-box');
      if (box) ro.observe(box);
    } catch (_) { /* 忽略：部分环境没有 ResizeObserver */ }
  }
}

/* ---------------- 棋桌 ---------------- */

/** 清空棋盘上除 SVG 线之外的所有节点（棋子 / 热区） */
function clearBoardNodes(grid) {
  for (const el of [...grid.children]) if (el !== linesEl) el.remove();
}

export function resetSelection() {
  boardSig = '';
  const grid = $('board-grid');
  if (grid) grid.classList.remove('turn-b', 'turn-w');
}

/**
 * 渲染棋桌。view 由 game.view(seat) 得出，另外可带 _code / _isHost / _spectators。
 * actionCb 负责把动作发给房主（本地直接调用 / 远端走网络）。
 */
export function renderTable(view, cb) {
  actionCb = cb;
  const sig = (view.board ? view.board.join('') : '') + '#' + view.turn + '#' + view.phase;
  if (sig !== boardSig) boardSig = sig;
  showScreen('table');

  const codeEl = $('t-code');
  if (codeEl && view._code) codeEl.textContent = view._code;

  const p0 = playerOf(view, 0);
  const p1 = playerOf(view, 1);
  const roomEl = $('t-room');
  if (roomEl) roomEl.textContent = `${p0 ? p0.name : '黑方'} vs ${p1 ? p1.name : '白方'}`;

  const specEl = $('side-spec');
  if (specEl) {
    const specs = view._spectators || [];
    specEl.textContent = specs.length ? `观战 ${specs.length}` : '';
  }

  renderPlayers(view);
  renderBoard(view);
  renderMoves(view);
  renderOffers(view);
  renderActions(view);
  renderQuick();

  const ov = $('overlay');
  if (view.phase === 'over' && view.result) {
    if (!ov || ov.dataset.mode !== 'menu') renderResult(view);
  } else if (!ov || ov.dataset.mode !== 'menu') {
    clearOverlay();
  }
  layoutBoard();
}

function renderPlayers(view) {
  const root = $('t-players');
  if (!root) return;
  root.innerHTML = '';
  for (const p of view.players || []) {
    const chip = document.createElement('div');
    const active = view.phase === 'play' && view.turn === p.side;
    const me = view.mySide !== null && view.mySide === p.side;
    chip.className = 'player-chip' + (active ? ' active' : '') + (me ? ' me' : '');
    chip.innerHTML =
      `<span class="dot-side ${p.side}"></span>` +
      `<span class="nm">${escapeHtml(p.name)}</span>` +
      (p.connected === false ? '<i class="off">离线</i>' : '');
    root.appendChild(chip);
  }
}

function renderBoard(view) {
  const grid = $('board-grid');
  if (!grid) return;
  if (!linesEl) {
    linesEl = buildLines();
    grid.appendChild(linesEl);
  }
  clearBoardNodes(grid);

  // 棋子（pointer-events: none，点击交给下面的热区）
  const winSet = new Set(view.winLine || []);
  for (let sq = 0; sq < view.board.length; sq++) {
    const side = view.board[sq];
    if (!side) continue;
    const stone = document.createElement('div');
    stone.className = 'stone ' + side;
    if (view.lastMove === sq) stone.classList.add('last');
    if (winSet.has(sq)) stone.classList.add('win');
    stone.dataset.sq = String(sq);
    stone.style.setProperty('--x', posX(sq));
    stone.style.setProperty('--y', posY(sq));
    grid.appendChild(stone);
  }

  // 225 个透明点击热区，铺满棋盘（在棋子上方，占领点击）
  const total = R.SIZE * R.SIZE;
  for (let sq = 0; sq < total; sq++) {
    const hit = document.createElement('div');
    hit.className = 'hit' + (view.board[sq] ? '' : ' empty');
    hit.dataset.sq = String(sq);
    hit.style.setProperty('--x', posX(sq));
    hit.style.setProperty('--y', posY(sq));
    hit.addEventListener('click', () => onSquareClick(view, sq));
    grid.appendChild(hit);
  }

  const myTurn = view.phase === 'play' && !!view.mySide && view.turn === view.mySide;
  grid.classList.toggle('turn-b', myTurn && view.mySide === R.BLACK);
  grid.classList.toggle('turn-w', myTurn && view.mySide === R.WHITE);
}

function onSquareClick(view, sq) {
  if (!view.mySide) {
    toast('观战中，只能看棋');
    return;
  }
  if (view.phase !== 'play') {
    toast('对局还没开始或已经结束');
    return;
  }
  if (view.board[sq]) {
    toast('这里已经有棋子了');
    return;
  }
  if (view.turn !== view.mySide) {
    toast('还没轮到你落子');
    return;
  }
  if (actionCb) actionCb({ type: 'move', sq });
}

function renderMoves(view) {
  const ol = $('move-list');
  if (!ol) return;
  ol.innerHTML = '';
  const moves = view.moves || [];
  if (!moves.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '黑方先行，还没有落子';
    ol.appendChild(li);
    return;
  }
  const newest = Math.floor((moves.length - 1) / 2);
  for (let i = 0; i < moves.length; i += 2) {
    const li = document.createElement('li');
    if (i / 2 === newest) li.className = 'newest';
    const black = moves[i];
    const white = moves[i + 1];
    li.innerHTML =
      `<span class="no">${i / 2 + 1}.</span>` +
      `<span class="b">${black ? escapeHtml(black.notation) : ''}</span>` +
      `<span class="w">${white ? escapeHtml(white.notation) : ''}</span>`;
    ol.appendChild(li);
  }
  ol.scrollTop = ol.scrollHeight;
}

function renderOffers(view) {
  const bar = $('offer-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const offers = view.offers || {};
  const undo = offers.undo === undefined ? null : offers.undo;
  const draw = offers.draw === undefined ? null : offers.draw;
  const mine = (seat) => seat !== null && seat !== undefined && seat === view.seat;
  let text = '';
  let kind = null;
  if (undo !== null && undo !== undefined) {
    text = mine(undo) ? '已发出悔棋请求，等待对方同意…' : `${(playerOf(view, undo) || { name: '对方' }).name} 请求悔棋`;
    kind = mine(undo) ? null : 'undo';
  } else if (draw !== null && draw !== undefined) {
    text = mine(draw) ? '已发出求和请求，等待对方同意…' : `${(playerOf(view, draw) || { name: '对方' }).name} 请求求和`;
    kind = mine(draw) ? null : 'draw';
  }
  if (!text) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const txt = document.createElement('span');
  txt.className = 'txt';
  txt.textContent = text;
  bar.appendChild(txt);
  if (kind && view.mySide) {
    bar.appendChild(btn('同意', 'primary tiny', () => actionCb && actionCb({ type: kind + 'Reply', accept: true })));
    bar.appendChild(btn('拒绝', 'ghost tiny', () => actionCb && actionCb({ type: kind + 'Reply', accept: false })));
  }
}

function renderActions(view) {
  const bar = $('actions');
  if (!bar) return;
  bar.innerHTML = '';

  const status = document.createElement('span');
  if (view.phase === 'over') {
    status.className = 'wait';
    status.textContent = '本局结束';
  } else if (view.phase === 'lobby') {
    status.className = 'wait';
    status.textContent = '等待房主开始对局…';
  } else if (!view.mySide) {
    status.className = 'wait';
    status.textContent = '观战中';
  } else if (view.turn === view.mySide) {
    status.className = 'status';
    status.textContent = `轮到你落子（${R.SIDE_NAME[view.mySide]}方）`;
  } else {
    status.className = 'wait';
    const foe = (view.players || []).find((p) => p.side === view.turn);
    status.textContent = `等待 ${foe ? foe.name : '对手'} 落子…`;
  }
  bar.appendChild(status);

  if (!view.mySide || view.phase !== 'play') return;

  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  bar.appendChild(spacer);

  const canUndo = view.canUndo !== undefined ? !!view.canUndo : (view.moves || []).length > 0;
  const undoBtn = btn('悔棋', 'ghost tiny', () => actionCb && actionCb({ type: 'undo' }));
  undoBtn.disabled = !canUndo;
  bar.appendChild(undoBtn);

  const pending = (view.offers || {}).undo != null || (view.offers || {}).draw != null;
  const drawBtn = btn('求和', 'ghost tiny', () => actionCb && actionCb({ type: 'draw' }));
  drawBtn.disabled = pending;
  bar.appendChild(drawBtn);

  const resignBtn = btn(resignArmed ? '确定认输' : '认输', 'ghost tiny danger', () => {
    if (!resignArmed) {
      resignArmed = true;
      resignBtn.textContent = '确定认输';
      clearTimeout(resignArmTimer);
      resignArmTimer = setTimeout(() => {
        resignArmed = false;
        resignBtn.textContent = '认输';
      }, 4000);
      return;
    }
    resignArmed = false;
    clearTimeout(resignArmTimer);
    if (actionCb) actionCb({ type: 'resign' });
  });
  bar.appendChild(resignBtn);
}

function renderQuick() {
  const box = $('quick');
  if (!box || quickReady) return;
  quickReady = true;
  for (const q of QUICK) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = q;
    b.addEventListener('click', () => chatCb && chatCb(q));
    box.appendChild(b);
  }
}

/* ---------------- 聊天 ---------------- */

const CHAT_KEEP = 60;

export function renderChat(list = [], me = '') {
  const log = $('chat-log');
  if (!log) return;
  log.innerHTML = '';
  const items = Array.isArray(list) ? list.slice(-CHAT_KEEP) : [];
  for (const m of items) {
    if (!m) continue;
    const div = document.createElement('div');
    if (m.kind === 'sys') {
      div.className = 'msg sys';
      div.textContent = m.text;
    } else {
      div.className = 'msg' + (m.name && m.name === me ? ' me' : '');
      div.innerHTML = `<span class="who">${escapeHtml(m.name || '')}</span>${escapeHtml(m.text || '')}`;
    }
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

/* ---------------- 结算 / 菜单浮层 ---------------- */

function renderResult(view) {
  const ov = $('overlay');
  const panel = $('overlay-panel');
  if (!ov || !panel) return;
  const r = view.result;
  let title;
  let cls;
  if (!r.winner) {
    title = '和棋';
    cls = 'wd';
  } else if (view.mySide) {
    const win = r.winner === view.mySide;
    title = win ? '你赢了！' : '你输了';
    cls = win ? 'wr' : 'wb';
  } else {
    title = `${R.SIDE_NAME[r.winner]}方胜`;
    cls = r.winner === R.BLACK ? 'wr' : 'wb';
  }
  panel.innerHTML =
    `<h2 class="${cls}">${title}</h2>` +
    `<p class="calc">${escapeHtml(r.text)} · 共 ${r.plies} 手</p>` +
    '<div class="ov-actions"></div>';
  const acts = panel.querySelector('.ov-actions');
  if (!view.mySide) {
    const s = document.createElement('span');
    s.className = 'wait';
    s.textContent = '观战结束';
    acts.appendChild(s);
  } else if (view._isHost) {
    acts.appendChild(btn('再来一局', 'primary', () => actionCb && actionCb({ type: 'restart' })));
  } else {
    const s = document.createElement('span');
    s.className = 'wait';
    s.textContent = '等待房主开新局…';
    acts.appendChild(s);
  }
  ov.classList.remove('hidden');
  ov.dataset.mode = 'result';
}

/** 菜单浮层（房号 / 角色说明 / 关闭 / 离开房间） */
export function showMenu({ code, role, onQuit } = {}) {
  const ov = $('overlay');
  const panel = $('overlay-panel');
  if (!ov || !panel) return;
  const roleText =
    role === 'host'
      ? '你是房主（黑方先行），房主离开房间就散局了'
      : role === 'spectator'
        ? '你是观战，离开房间可以再输入房号回来'
        : '离开房间可以再输入房号回来';
  panel.innerHTML =
    `<h2 class="wd">房间 ${escapeHtml(code || '----')}</h2>` +
    `<p class="calc">${roleText}</p>` +
    '<div class="ov-actions"></div>';
  const acts = panel.querySelector('.ov-actions');
  acts.appendChild(btn('关闭', 'ghost', () => clearOverlay()));
  acts.appendChild(btn('离开房间', 'primary', () => {
    clearOverlay();
    if (onQuit) onQuit();
  }));
  ov.classList.remove('hidden');
  ov.dataset.mode = 'menu';
}

export function clearOverlay() {
  const ov = $('overlay');
  if (!ov) return;
  delete ov.dataset.mode;
  ov.classList.add('hidden');
}

/* ---------------- 侧栏切换 / 聊天绑定 ---------------- */

export function bindUI() {
  const tabMoves = $('tab-moves');
  const tabChat = $('tab-chat');
  const showTab = (name) => {
    if (tabMoves) tabMoves.classList.toggle('active', name === 'moves');
    if (tabChat) tabChat.classList.toggle('active', name === 'chat');
    const moves = $('move-list');
    const pane = $('chat-pane');
    if (moves) moves.classList.toggle('hidden', name !== 'moves');
    if (pane) pane.classList.toggle('hidden', name !== 'chat');
  };

  if (!uiBound) {
    uiBound = true;
    if (tabMoves) tabMoves.addEventListener('click', () => showTab('moves'));
    if (tabChat) tabChat.addEventListener('click', () => showTab('chat'));

    const form = $('chat-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('chat-input');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        if (chatCb) chatCb(text);
      });
    }
  }
  renderQuick();
}
