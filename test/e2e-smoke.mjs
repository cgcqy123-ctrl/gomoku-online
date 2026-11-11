// 端到端冒烟测试（需要 jsdom）：在 jsdom 里真跑 main.js，用假 Peer 模拟好友 + 观众
// 覆盖：建房 → 好友入座 → 开局 → 12 手 → 悔棋 → 求和拒绝 → 聊天 → 观众
//       → 认输 → 结算 → 再来一局 → 掉线重连 → 满员拒绝
// 运行：npm install && npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (rel) => pathToFileURL(path.join(ROOT, rel)).href;

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'https://example.com/',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.localStorage = dom.window.localStorage;

/* ---------------- 假 PeerJS（与象棋 e2e 同构） ---------------- */

const registry = new Map();
let connSeq = 0;

class FakeConn {
  constructor(remoteId) {
    this.id = 'c' + ++connSeq;
    this.peer = remoteId;
    this.open = false;
    this.h = {};
    this.remote = null;
    this.closed = false;
  }
  on(ev, cb) { (this.h[ev] = this.h[ev] || []).push(cb); return this; }
  emit(ev, arg) { for (const cb of this.h[ev] || []) cb(arg); }
  send(msg) {
    if (!this.open) throw new Error('conn is not open');
    const copy = JSON.parse(JSON.stringify(msg));
    const other = this.remote;
    if (other) setTimeout(() => other.emit('data', copy), 0);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    const other = this.remote;
    if (other && !other.closed) setTimeout(() => other.emit('close'), 0);
  }
  _open() { this.open = true; this.emit('open'); }
}

class FakePeer {
  constructor(id) {
    this.id = id || 'auto-' + Math.random().toString(36).slice(2, 8);
    this.h = {};
    if (registry.has(this.id)) {
      setTimeout(() => this.emit('error', { type: 'unavailable-id' }), 0);
      return;
    }
    registry.set(this.id, this);
    setTimeout(() => this.emit('open', this.id), 0);
  }
  on(ev, cb) { (this.h[ev] = this.h[ev] || []).push(cb); return this; }
  emit(ev, arg) { for (const cb of this.h[ev] || []) cb(arg); }
  connect(remoteId) {
    const a = new FakeConn(remoteId);
    const target = registry.get(remoteId);
    if (!target) {
      setTimeout(() => this.emit('error', { type: 'peer-unavailable' }), 0);
      return a;
    }
    const b = new FakeConn(this.id);
    a.remote = b;
    b.remote = a;
    setTimeout(() => {
      target.emit('connection', b);
      b._open();
      a._open();
    }, 0);
    return a;
  }
  destroy() { registry.delete(this.id); }
}

// 必须在 import main.js 之前把假的 Peer 挂上去
global.Peer = FakePeer;
dom.window.Peer = FakePeer;

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** 轮询等待条件成立（Windows 下定时器粒度粗，固定 tick 容易偶发失败） */
async function waitFor(fn, ms = 1500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    let v = false;
    try { v = !!fn(); } catch (_) { v = false; }
    if (v) return true;
    await tick(5);
  }
  try { return !!fn(); } catch (_) { return false; }
}
const PROBLEMS = [];
const ok = (c, m) => { if (!c) PROBLEMS.push(m); };
const $ = (id) => document.getElementById(id);
const findBtn = (root, text) =>
  [...root.querySelectorAll('button')].find((x) => x.textContent.includes(text)) || null;

/* ---------------- 载入 main.js ---------------- */

await import(url('js/main.js'));
await tick(10);
ok(!$('scr-home').classList.contains('hidden'), '启动后停在首页');

/* ---------------- 房主建房 ---------------- */

$('in-name').value = '甲';
$('btn-create').click();
await waitFor(() => !$('scr-lobby').classList.contains('hidden'));
const code = $('lobby-code').textContent.trim();
ok(/^[A-Z0-9]{4}$/.test(code), '房号是 4 位，实际：' + code);
const hostId = 'gomoku-' + code.toLowerCase();
ok(registry.has(hostId), '房主信令 id 带 gomoku- 前缀：' + hostId);
ok($('btn-start').disabled === true, '只有 1 人时不能开始');
ok(/房间 /.test($('chat-log').textContent), '建房系统消息已显示');

/* ---------------- 好友加入 ---------------- */

function joinAs(name) {
  const peer = new FakePeer();
  const conn = peer.connect(hostId);
  const box = { name, peer, conn, seat: null, spectator: false, states: 0, view: null, toasts: [], chats: [], lobby: null, full: false };
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'joined') {
      box.seat = msg.seat;
      box.spectator = !!msg.spectator;
    } else if (msg.t === 'state') {
      box.states++;
      box.view = msg.view;
    } else if (msg.t === 'lobby') {
      box.lobby = msg;
    } else if (msg.t === 'toast') {
      box.toasts.push(msg.msg);
    } else if (msg.t === 'chat') {
      box.chats.push(msg.msg);
    } else if (msg.t === 'full') {
      box.full = true;
    }
  });
  conn.on('open', () => conn.send({ t: 'hello', name }));
  return box;
}

const foe = joinAs('乙');
await waitFor(() => foe.seat === 1 && $('btn-start').disabled === false, 2000);
ok(foe.seat === 1, '乙 应该坐 1 号位（白方），实际 ' + foe.seat);
ok(foe.spectator === false, '乙 是玩家不是观众');
ok(foe.lobby && foe.lobby.players && foe.lobby.players[0].name === '甲', '好友收到大厅名单');
ok(document.querySelectorAll('#seat-list .seat-item.filled').length === 2, '大厅显示两个座位都有名字');

/* ---------------- 开局 ---------------- */

$('btn-start').click();
await waitFor(() => foe.view && foe.view.phase === 'play');
ok(!$('scr-table').classList.contains('hidden'), '开局后进入棋桌');
ok(document.querySelectorAll('#board-grid .stone').length === 0, '开局棋盘没有棋子');
ok(document.querySelectorAll('#board-grid .hit').length === 225, '225 个点击热区');
ok(document.querySelectorAll('#board-grid svg.lines line').length === 30, '30 条棋盘线');
ok(document.querySelectorAll('#board-grid svg.lines circle.star').length === 5, '5 个星位');
ok($('t-room').textContent === '甲 vs 乙', '对阵显示，实际：' + $('t-room').textContent);
ok(/轮到你落子（黑方）/.test($('actions').textContent), '房主轮到落子，实际：' + $('actions').textContent);
ok(foe.view && foe.view.mySide === 'w', '好友执白');
ok(foe.view && foe.view.turn === 'b', '黑方先行');

/* ---------------- 双方按脚本走 12 手（分散落点，不会提前五连） ---------------- */

const B = [112, 80, 144, 48, 176, 38]; // 黑：H8 F10 J6 D12 L4 I13
const W = [96, 128, 64, 160, 39, 187]; // 白：G9 I7 E11 K5 J13 H3

function hostClick(n) {
  const hit = document.querySelector('#board-grid .hit[data-sq="' + n + '"]');
  ok(!!hit, '房主端热区存在：' + n);
  if (hit) hit.click();
}

for (let i = 0; i < 6; i++) {
  hostClick(B[i]);
  await waitFor(() => foe.view && foe.view.moves.length === 2 * i + 1);
  ok(foe.view && foe.view.moves.length === 2 * i + 1, '第 ' + (2 * i + 1) + ' 手后好友收到状态，实际 ' + (foe.view && foe.view.moves.length));
  foe.conn.send({ t: 'action', a: { type: 'move', sq: W[i] } });
  await waitFor(() => foe.view && foe.view.moves.length === 2 * i + 2);
  ok(foe.view && foe.view.moves.length === 2 * i + 2, '第 ' + (2 * i + 2) + ' 手后好友收到状态，实际 ' + (foe.view && foe.view.moves.length));
}

ok(document.querySelectorAll('#board-grid .stone').length === 12, '房主端 12 颗棋子');
ok(document.querySelectorAll('#board-grid .stone.b').length === 6, '黑棋 6 颗');
ok(document.querySelectorAll('#board-grid .stone.w').length === 6, '白棋 6 颗');
ok(document.querySelectorAll('#board-grid .stone.last').length === 1, '只有最后一手有 last 标记');
ok(document.querySelector('#board-grid .stone.last').dataset.sq === String(W[5]), '最后落子是 W6(H3)');
ok(document.querySelectorAll('#move-list li').length === 6, '棋谱 6 行');
ok(document.querySelectorAll('#move-list .b')[0].textContent === 'H8', '棋谱第一手 H8');
ok(foe.states >= 12, '好友持续收到状态，实际 ' + foe.states);
ok(foe.view.board[112] === 'b' && foe.view.board[96] === 'w', '好友棋盘与房主一致');
ok($('board-grid').classList.contains('turn-b'), '轮到黑方时棋盘有落子预览类');
ok(!$('board-grid').classList.contains('turn-w'), '黑方回合不显示 turn-w');
ok(/轮到你落子（黑方）/.test($('actions').textContent), '12 手后轮黑方');

/* ---------------- 悔棋：房主请求，好友同意 ---------------- */

const pliesBeforeUndo = foe.view.moves.length;
const undoBtn = findBtn($('actions'), '悔棋');
ok(undoBtn && !undoBtn.disabled, '轮到自己时可以点悔棋');
if (undoBtn) undoBtn.click();
await waitFor(() => foe.view && foe.view.offers.undo === 0);
ok(foe.view.offers.undo === 0, '好友收到悔棋请求');
ok(/等待对方同意/.test($('offer-bar').textContent), '房主端显示「等待对方同意」，实际：' + $('offer-bar').textContent);
foe.conn.send({ t: 'action', a: { type: 'undoReply', accept: true } });
await waitFor(() => foe.view && foe.view.moves.length === pliesBeforeUndo - 2);
ok(foe.view.moves.length === pliesBeforeUndo - 2, '悔棋后回退两手：' + pliesBeforeUndo + ' → ' + foe.view.moves.length);
ok(document.querySelectorAll('#board-grid .stone').length === 10, '房主端棋子回退到 10 颗');
ok($('offer-bar').classList.contains('hidden'), '悔棋完成后请求条消失');
ok(foe.view.offers.undo === null, '悔棋完成后请求状态清空');

/* ---------------- 求和：好友发起，房主拒绝 ---------------- */

foe.conn.send({ t: 'action', a: { type: 'draw' } });
await waitFor(() => foe.view && foe.view.offers.draw === 1 && !$('offer-bar').classList.contains('hidden'));
ok(foe.view.offers.draw === 1, '房主收到求和请求');
ok(/乙 请求求和/.test($('offer-bar').textContent), '求和请求条文案，实际：' + $('offer-bar').textContent);
const rejectDraw = findBtn($('offer-bar'), '拒绝');
ok(!!rejectDraw, '有「拒绝」按钮');
if (rejectDraw) rejectDraw.click();
await waitFor(() => foe.view && foe.view.offers.draw === null && foe.view.phase === 'play');
ok(foe.view.offers.draw === null, '拒绝后请求消失');
ok(foe.view.phase === 'play', '拒绝求和后对局继续');
ok($('offer-bar').classList.contains('hidden'), '拒绝后请求条隐藏');

/* ---------------- 聊天 ---------------- */

foe.conn.send({ t: 'chat', text: '这步漂亮' });
await waitFor(() => /这步漂亮/.test($('chat-log').textContent));
ok(/这步漂亮/.test($('chat-log').textContent), '房主能看到好友的聊天');
await waitFor(() => foe.chats.some((m) => m && m.text === '这步漂亮'));
ok(foe.chats.some((m) => m && m.text === '这步漂亮'), '好友能看到自己发出的消息（房主回显）');
$('chat-input').value = '开局！';
$('chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => foe.chats.some((m) => m && m.text === '开局！'));
ok(/开局！/.test($('chat-log').textContent), '房主聊天本地显示');
ok(foe.chats.some((m) => m && m.text === '开局！'), '好友收到房主聊天');

/* ---------------- 观众 ---------------- */

const spec = joinAs('观众丙');
await waitFor(() => spec.view && spec.states > 0 && spec.spectator === true, 2000);
ok(spec.spectator === true, '第三位自动成为观众');
ok(typeof spec.seat === 'number' && spec.seat >= 2, '观众拿到观战座位号，实际 ' + spec.seat);
ok(spec.view && spec.view.spectator === true, '观众收到观战视角');
ok(spec.view && spec.view.mySide === null, '观众没有执方');
ok(spec.states > 0, '观众也能收到状态');
await waitFor(() => $('side-spec').textContent === '观战 1');
ok($('side-spec').textContent === '观战 1', '房主端显示观战人数，实际：' + $('side-spec').textContent);

// 观众加入后再走两手，确认观众也同步
hostClick(B[5]);
await waitFor(() => foe.view && foe.view.moves.length === 11);
ok(foe.view.moves.length === 11, '悔棋后黑方再下一手，实际 ' + foe.view.moves.length);
foe.conn.send({ t: 'action', a: { type: 'move', sq: W[5] } });
await waitFor(() => foe.view && foe.view.moves.length === 12 && spec.view && spec.view.moves.length === 12);
ok(foe.view.moves.length === 12, '补回两手后 12 手，实际 ' + foe.view.moves.length);
ok(spec.view.moves.length === foe.view.moves.length, '观众与好友手数一致');
ok(spec.states >= 3, '观众持续收到状态，实际 ' + spec.states);

/* ---------------- 认输 → 结算 → 再来一局 ---------------- */

let resignBtn = findBtn($('actions'), '认输');
ok(!!resignBtn, '有认输按钮');
if (resignBtn) resignBtn.click();
await tick(5);
resignBtn = findBtn($('actions'), '确定认输');
ok(!!resignBtn, '认输需要二次确认（第一次只变文字）');
if (resignBtn) resignBtn.click();
await waitFor(() => foe.view && foe.view.phase === 'over' && spec.view && spec.view.phase === 'over');
ok(!$('overlay').classList.contains('hidden'), '结束后弹出结算浮层');
ok($('overlay').dataset.mode === 'result', '结算浮层 mode=result');
ok(/你输了/.test($('overlay-panel').textContent), '房主（黑方）认输后显示「你输了」，实际：' + $('overlay-panel').textContent);
ok(/白方胜（认输）/.test($('overlay-panel').textContent), '结算副标题含「白方胜（认输）」');
ok(foe.view.phase === 'over' && foe.view.result.winner === 'w', '好友收到结果：白方胜');
ok(foe.view.result.reason === 'resign', '结束原因是认输');
ok(spec.view.phase === 'over', '观众也收到结果');
foe.conn.send({ t: 'action', a: { type: 'restart' } });
await waitFor(() => foe.toasts.some((m) => /只有房主能开新局/.test(String(m || ''))));
ok(foe.toasts.some((m) => /只有房主能开新局/.test(String(m || ''))), '非房主 restart 被拒绝（只有房主能开新局）');
const again = findBtn($('overlay-panel'), '再来一局');
ok(!!again, '房主有「再来一局」');
if (again) again.click();
await waitFor(() => foe.view && foe.view.phase === 'play' && foe.view.moves.length === 0);
ok(foe.view.phase === 'play', '再来一局后好友回到对局');
ok(foe.view.moves.length === 0, '新一局棋谱清空');
ok(document.querySelectorAll('#board-grid .stone').length === 0, '新一局棋盘清空');
ok(document.querySelectorAll('#board-grid .hit').length === 225, '新一局热区仍 225');
ok($('overlay').classList.contains('hidden'), '再来一局后关闭结算浮层');
ok(/新的一局开始，黑方先行/.test($('chat-log').textContent), '再来一局系统消息');

/* ---------------- 掉线重连 ---------------- */

foe.conn.close();
await waitFor(() => !!document.querySelector('#t-players .player-chip .off'));
ok(!!document.querySelector('#t-players .player-chip .off'), '掉线后房主端显示离线标记');
ok(/掉线/.test($('chat-log').textContent), '掉线系统消息');
const foeBack = joinAs('乙');
await waitFor(() => foeBack.view && foeBack.view.phase === 'play' && !document.querySelector('#t-players .player-chip .off'), 2000);
ok(foeBack.seat === 1, '同名重连应该回到 1 号位，实际 ' + foeBack.seat);
ok(foeBack.view && foeBack.view.phase === 'play', '重连后立刻收到当前局面');
ok(!document.querySelector('#t-players .player-chip .off'), '重连后离线标记消失');

/* ---------------- 满员拒绝（2 玩家 + 6 观众） ---------------- */

for (let i = 0; i < 5; i++) joinAs('围观' + i);
await waitFor(() => $('side-spec').textContent === '观战 6', 3000);
const extra = joinAs('多出来的');
await waitFor(() => extra.full === true, 2000);
ok(extra.full === true, '第 9 个人应该被拒绝（房间已满）');

/* ---------------- 汇总 ---------------- */

if (PROBLEMS.length) {
  console.error('❌ 端到端测试失败：\n - ' + PROBLEMS.join('\n - '));
  process.exit(1);
}
console.log(
  '✅ 端到端通过：房号 ' + code + '｜好友入座｜走棋 12 手｜悔棋｜求和拒绝｜聊天｜观战｜认输重开｜掉线重连｜满员拒绝'
);
process.exit(0);
