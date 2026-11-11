// UI 冒烟测试（需要 jsdom）：node test/ui-smoke.mjs
// 覆盖：首页/大厅渲染 → 棋桌 225 热区 → 点热区落子 → 棋谱/last/胜线/结算 → 请求条 → 操作栏
//       → 聊天/快捷语/tab/菜单 → 五连高亮 → 随机整局模拟
// 风格对齐象棋项目 test/ui-smoke.mjs：problems 收集 + ✅/❌ + process.exit
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

const R = await import(url('js/rules.js'));
const { Game } = await import(url('js/game.js'));
const UI = await import(url('js/ui.js'));

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
const $ = (id) => document.getElementById(id);
const sq = (r, c) => R.idx(r, c);
const findBtn = (root, text) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text)) || null;

let pending = null;
/** 渲染棋桌：把 game.view(seat) 挂上与 main.js 相同的装饰字段 */
function renderGame(game, seat = 0, opt = {}) {
  const v = game.view(seat);
  v._code = opt.code || 'AB12';
  v._isHost = opt.isHost !== undefined ? opt.isHost : seat === 0;
  v._spectators = opt.spectators || [];
  pending = null;
  UI.renderTable(v, (act) => { pending = act; });
  return v;
}
function clickSq(n) {
  const hit = document.querySelector('#board-grid .hit[data-sq="' + n + '"]');
  ok(!!hit, '热区存在：' + n);
  if (hit) hit.click();
}
/** 固定种子的伪随机（保证模拟对局可复现） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

UI.bindUI();

/* ---------------- 首页 / 大厅 ---------------- */

UI.showScreen('home');
ok(!$('scr-home').classList.contains('hidden'), '首页应可见');
ok($('scr-lobby').classList.contains('hidden'), '房间页应隐藏');
ok($('scr-table').classList.contains('hidden'), '棋桌应隐藏');

UI.renderLobby({
  code: 'AB12',
  players: [{ name: '甲', connected: true }, { name: null, connected: false }],
  spectators: [],
  isHost: true,
  canStart: false,
  tip: '测试提示',
  youSeat: 0,
});
ok($('lobby-code').textContent === 'AB12', '房号显示');
let seats = document.querySelectorAll('#seat-list li.seat-item');
ok(seats.length === 2, '座位列表 2 项（黑/白），实际 ' + seats.length);
ok(seats[0] && seats[0].classList.contains('filled') && seats[0].classList.contains('black'), '0 号位有名字且是黑方');
ok(seats[1] && !seats[1].classList.contains('filled') && seats[1].classList.contains('white'), '1 号位空着且是白方');
ok(seats[0].querySelector('.idx').textContent === '黑', '黑方标记');
ok(seats[1].querySelector('.idx').textContent === '白', '白方标记');
ok(/黑方 · 先行/.test(seats[0].querySelector('.tag').textContent), '黑方先行标签');
ok(/白方/.test(seats[1].querySelector('.tag').textContent), '白方标签');
ok(/（你）/.test(seats[0].querySelector('.nm').textContent), 'youSeat 显示「（你）」');
ok($('lobby-spec').textContent === '第 3 位起自动成为观战', '无观众时的提示，实际：' + $('lobby-spec').textContent);
ok($('btn-start').disabled === true, '人不齐不能开始');
ok(!$('btn-start').classList.contains('hidden'), '房主能看到开始按钮');
ok(/等待对手入座（1\/2）/.test($('btn-start').textContent), '开始按钮显示人数进度，实际：' + $('btn-start').textContent);
ok($('lobby-tip').textContent === '测试提示', '大厅 tip 透传');

UI.renderLobby({
  code: 'AB12',
  players: [{ name: '甲', connected: true }, { name: '乙', connected: false }],
  spectators: ['旁观者', '路人'],
  isHost: true,
  canStart: true,
  youSeat: 0,
  tip: '',
});
seats = document.querySelectorAll('#seat-list li.seat-item');
ok($('btn-start').disabled === false, '两人齐了可以开始');
ok($('btn-start').textContent === '开始对局', '开始按钮文案');
ok(/观战：旁观者、路人/.test($('lobby-spec').textContent), '观战名单');
ok(/离线/.test(seats[1].textContent), '掉线座位显示离线');
ok(/把房号发给朋友/.test($('lobby-tip').textContent), '房主默认 tip');

UI.renderLobby({
  code: 'ZZ99',
  players: [{ name: '甲', connected: true }, { name: '乙', connected: true }],
  spectators: [],
  isHost: false,
  canStart: true,
  tip: '',
  youSeat: 1,
});
ok($('btn-start').classList.contains('hidden'), '非房主看不到开始按钮');
ok($('lobby-tip').textContent === '等待房主开始对局…', '非房主默认 tip');
ok(/（你）/.test(document.querySelectorAll('#seat-list li.seat-item')[1].textContent), '1 号位 youSeat 标记');

/* ---------------- 棋桌：基本渲染 ---------------- */

const g = new Game([{ name: '甲' }, { name: '乙' }]).start();
renderGame(g, 0);
ok(!$('scr-table').classList.contains('hidden'), '渲染后进入棋桌');
ok($('scr-lobby').classList.contains('hidden'), '大厅隐藏');
ok(document.querySelectorAll('#board-grid svg.lines').length === 1, '只插入一个 svg.lines');
ok(document.querySelectorAll('#board-grid svg.lines line').length === 30, '15 横 + 15 竖 = 30 条线，实际 ' + document.querySelectorAll('#board-grid svg.lines line').length);
ok(document.querySelectorAll('#board-grid svg.lines line.border').length === 4, '最外圈 4 条 border 线');
ok(document.querySelectorAll('#board-grid svg.lines circle.star').length === 5, '5 个星位');
ok(document.querySelectorAll('#board-grid svg.lines text.c-label').length === 30, '30 个坐标标签');
ok(document.querySelector('#board-grid svg.lines').getAttribute('viewBox') === '-1.7 -1.7 17.4 17.4', 'SVG viewBox 符合契约');
ok(document.querySelectorAll('#board-grid .stone').length === 0, '开局没有棋子');
ok(document.querySelectorAll('#board-grid .hit').length === 225, '225 个点击热区，实际 ' + document.querySelectorAll('#board-grid .hit').length);
ok(document.querySelectorAll('#board-grid .hit.empty').length === 225, '开局热区全部是有空点标记');
ok($('move-list').textContent.includes('黑方先行，还没有落子'), '空棋谱提示');
ok($('move-list').querySelectorAll('li').length === 1 && $('move-list').querySelector('li.empty'), '空棋谱占位 li');
ok(/轮到你落子（黑方）/.test($('actions').textContent), '黑方先手提示，实际：' + $('actions').textContent);
ok($('board-grid').classList.contains('turn-b') && !$('board-grid').classList.contains('turn-w'), '黑方回合落子预览类 turn-b');
ok($('t-code').textContent === 'AB12', '棋桌房号显示');
ok($('t-room').textContent === '甲 vs 乙', '对阵显示，实际：' + $('t-room').textContent);
ok($('side-spec').textContent === '', '无观众时观战数为空');
ok($('offer-bar').classList.contains('hidden'), '没有请求时请求条隐藏');

const chips = document.querySelectorAll('#t-players .player-chip');
ok(chips.length === 2, '两个玩家 chip，实际 ' + chips.length);
ok(!!document.querySelector('#t-players .dot-side.b') && !!document.querySelector('#t-players .dot-side.w'), '黑白执方圆点');
ok(chips[0].classList.contains('active'), '当前落子方（黑）chip 高亮');
ok(!chips[1].classList.contains('active'), '白方 chip 不活跃');
ok(chips[0].classList.contains('me'), '自己（黑）chip 有 me 类');

renderGame(g, 1);
let sideChip = document.querySelector('#t-players .player-chip .dot-side.w');
ok(!!sideChip && sideChip.closest('.player-chip').classList.contains('me'), '白方视角自己（白）有 me 类');
sideChip = document.querySelector('#t-players .player-chip .dot-side.b');
ok(!!sideChip && !sideChip.closest('.player-chip').classList.contains('me'), '白方视角对方没有 me 类');
renderGame(g, -1);
ok(document.querySelectorAll('#t-players .player-chip.me').length === 0, '观战视角没有 me 类');
renderGame(g, 0);

const hit112 = document.querySelector('#board-grid .hit[data-sq="112"]');
const hx = parseFloat(hit112.style.getPropertyValue('--x'));
const hy = parseFloat(hit112.style.getPropertyValue('--y'));
ok(Math.abs(hx - 50) < 1e-9 && Math.abs(hy - 50) < 1e-9, '天元 H8 的 --x/--y 是 50/50，实际 ' + hx + '/' + hy);
const hit0 = document.querySelector('#board-grid .hit[data-sq="0"]');
const expectX = ((0 + 1.7) / 17.4) * 100;
ok(Math.abs(parseFloat(hit0.style.getPropertyValue('--x')) - expectX) < 1e-9, '左上角 --x 符合 (col+1.7)/17.4*100');
ok(Math.abs(parseFloat(hit0.style.getPropertyValue('--y')) - expectX) < 1e-9, '左上角 --y 符合 (row+1.7)/17.4*100');

/* ---------------- 点热区落子 ---------------- */

hit112.click();
ok(pending && pending.type === 'move' && pending.sq === 112, '点空热区发出 move(H8)，实际：' + JSON.stringify(pending));
g.action(0, pending);
renderGame(g, 0);
ok(document.querySelectorAll('#board-grid .stone').length === 1, '落子后出现 1 颗棋子');
const stone = document.querySelector('#board-grid .stone.last');
ok(!!stone && stone.classList.contains('b'), '黑棋落地');
ok(stone && stone.dataset.sq === '112', '棋子 data-sq 正确');
ok(stone && Math.abs(parseFloat(stone.style.getPropertyValue('--x')) - 50) < 1e-9, '棋子 --x 50');
ok(document.querySelectorAll('#board-grid .stone.last').length === 1, '最后落子有 last 标记');
ok(document.querySelectorAll('#board-grid .hit.empty').length === 224, '已占点热区不再是 empty');
ok(document.querySelectorAll('#board-grid svg.lines').length === 1, '重渲染不重复插 SVG');
ok(document.querySelectorAll('#board-grid svg.lines line').length === 30, '重渲染线仍是 30 条');
ok(document.querySelectorAll('#t-players .player-chip.active .dot-side').length === 1, '轮到白方时活跃 chip 换成白方');
ok(document.querySelector('#t-players .player-chip.active .dot-side').classList.contains('w'), '白方 chip 活跃');
ok($('move-list').textContent.includes('H8'), '棋谱出现 H8');
ok($('move-list').querySelectorAll('li').length === 1, '棋谱两两一行');
ok($('move-list').querySelector('li.newest') !== null, '最新一行有 newest');
ok($('move-list').querySelector('.b').textContent === 'H8', '黑方记谱在 .b');
ok($('move-list').querySelector('.w').textContent === '', '白方还没走，.w 为空');
ok(/等待 乙 落子/.test($('actions').textContent), '轮到对手时等待提示，实际：' + $('actions').textContent);
ok(!$('board-grid').classList.contains('turn-b') && !$('board-grid').classList.contains('turn-w'), '等待对方时没有落子预览类');

// 占位点击（黑方视角、轮到白方，也先提示占位）
document.querySelector('#board-grid .hit[data-sq="112"]').click();
ok($('toast').textContent === '这里已经有棋子了', '点已占交叉点提示，实际：' + $('toast').textContent);

// 白方视角：轮到白方，出现 turn-w
renderGame(g, 1);
ok($('board-grid').classList.contains('turn-w') && !$('board-grid').classList.contains('turn-b'), '白方回合 turn-w');
ok(/轮到你落子（白方）/.test($('actions').textContent), '白方回合提示');
clickSq(96);
ok(pending && pending.type === 'move' && pending.sq === 96, '白方点空热区发出 move(G9)');
g.action(1, pending);
renderGame(g, 1);
ok(document.querySelectorAll('#board-grid .stone').length === 2, '两手后 2 颗棋子');
ok(document.querySelectorAll('#board-grid .stone.w').length === 1, '白棋落地');
ok($('move-list').querySelectorAll('li').length === 1, '两手在一行棋谱');
ok($('move-list').querySelector('.w').textContent === 'G9', '白方记谱在 .w');
ok(/等待 甲 落子/.test($('actions').textContent), '白方视角等待黑方，实际：' + $('actions').textContent);

// 黑方走第三手，棋谱换行
g.move(0, sq(5, 5)); // F10
renderGame(g, 0);
ok(document.querySelectorAll('#move-list li').length === 2, '三手后棋谱两行');
const rows = document.querySelectorAll('#move-list li');
ok(rows[0].querySelector('.b').textContent === 'H8' && rows[0].querySelector('.w').textContent === 'G9', '第一行是 H8/G9');
ok(rows[1].querySelector('.b').textContent === 'F10' && rows[1].querySelector('.w').textContent === '', '第二行是 F10/空');
ok(rows[1].classList.contains('newest') && !rows[0].classList.contains('newest'), 'newest 只标在最后一行');

/* ---------------- 非自己回合 / 观战点击 ---------------- */

renderGame(g, 0); // 黑方视角，但轮到白方
clickSq(0);
ok($('toast').textContent === '还没轮到你落子', '非自己回合点空点提示，实际：' + $('toast').textContent);

const vs = renderGame(g, -1);
ok(vs.spectator === true && vs.mySide === null, '观战视图字段');
ok(/观战中/.test($('actions').textContent), '观战状态提示');
ok(!$('board-grid').classList.contains('turn-b') && !$('board-grid').classList.contains('turn-w'), '观战没有落子预览类');
clickSq(0);
ok($('toast').textContent === '观战中，只能看棋', '观战点棋盘提示，实际：' + $('toast').textContent);
ok($('offer-bar').classList.contains('hidden'), '没人请求时观战请求条隐藏');
ok(document.querySelectorAll('#actions button').length === 0, '观战没有操作按钮');

renderGame(g, -1, { spectators: ['甲', '乙', '丙'] });
ok($('side-spec').textContent === '观战 3', '观战人数显示，实际：' + $('side-spec').textContent);

/* ---------------- 掉线标记 ---------------- */

const gp = new Game([{ name: '甲' }, { name: '乙' }]).start();
gp.players[1].connected = false;
renderGame(gp, 0);
ok(!!document.querySelector('#t-players .player-chip .off'), '掉线玩家显示离线标记');

/* ---------------- 五连高亮 + 结算浮层 ---------------- */

const gw = new Game([{ name: '甲' }, { name: '乙' }]).start();
gw.move(0, sq(7, 2)); // H11
gw.move(1, sq(0, 0)); // A15
gw.move(0, sq(7, 3)); // I11
gw.move(1, sq(0, 2)); // C15
gw.move(0, sq(7, 4)); // J11
gw.move(1, sq(0, 4)); // E15
gw.move(0, sq(7, 5)); // K11
gw.move(1, sq(0, 6)); // G15
renderGame(gw, 0);
clickSq(sq(7, 6)); // L11，第五颗黑子
ok(pending && pending.type === 'move' && pending.sq === sq(7, 6), '点五连最后一手发出 move');
gw.action(0, pending);
renderGame(gw, 0);
ok(gw.phase === 'over', '五连后对局结束');
ok(document.querySelectorAll('#board-grid .stone').length === 9, '九手后 9 颗棋子');
ok(document.querySelectorAll('#board-grid .stone.win').length === 5, '五连高亮 5 颗，实际 ' + document.querySelectorAll('#board-grid .stone.win').length);
ok(!!document.querySelector('#board-grid .stone.win.last'), '最后一手同时在胜线里');
ok(!$('overlay').classList.contains('hidden'), '结束后显示结算浮层');
ok($('overlay').dataset.mode === 'result', '浮层 dataset.mode=result');
ok(/你赢了！/.test($('overlay-panel').textContent), '房主/赢家标题「你赢了！」，实际：' + $('overlay-panel').textContent);
ok(/黑方胜（五连） · 共 9 手/.test($('overlay-panel').textContent), '结算副标题含胜因与手数');
ok(!!findBtn($('overlay-panel'), '再来一局'), '房主有「再来一局」');
findBtn($('overlay-panel'), '再来一局').click();
ok(pending && pending.type === 'restart', '再来一局发出 restart');
ok(document.querySelectorAll('#actions button').length === 0, '结束后操作栏不再有按钮');
ok(/本局结束/.test($('actions').textContent), '结束后状态文字');

// 结束后点击棋盘
clickSq(0);
ok($('toast').textContent === '对局还没开始或已经结束', '结束后点棋盘提示，实际：' + $('toast').textContent);

// 输家视角（白方）
renderGame(gw, 1);
ok(/你输了/.test($('overlay-panel').textContent), '输家标题「你输了」');
ok(/等待房主开新局…/.test($('overlay-panel').textContent), '非房主等待房主开新局');
ok(!findBtn($('overlay-panel'), '再来一局'), '非房主没有「再来一局」');

// 观战视角
renderGame(gw, -1);
ok(/黑方胜/.test($('overlay-panel').textContent), '观战标题显示「黑方胜」');
ok(/观战结束/.test($('overlay-panel').textContent), '观战结算提示');
ok(!findBtn($('overlay-panel'), '再来一局'), '观战没有「再来一局」');

/* ---------------- 请求条：悔棋 ---------------- */

const g3 = new Game([{ name: '甲' }, { name: '乙' }]).start();
g3.move(0, sq(7, 7));
g3.move(1, sq(0, 0));
g3.requestUndo(0);
renderGame(g3, 1); // 乙（白方）视角
ok(!$('offer-bar').classList.contains('hidden'), '对方请求悔棋时出现请求条');
ok(/甲 请求悔棋/.test($('offer-bar').textContent), '请求条文案，实际：' + $('offer-bar').textContent);
ok(!!findBtn($('offer-bar'), '同意') && !!findBtn($('offer-bar'), '拒绝'), '请求条有同意/拒绝按钮');
findBtn($('offer-bar'), '同意').click();
ok(pending && pending.type === 'undoReply' && pending.accept === true, '同意按钮发出 undoReply(accept:true)');
renderGame(g3, 1);
findBtn($('offer-bar'), '拒绝').click();
ok(pending && pending.type === 'undoReply' && pending.accept === false, '拒绝按钮发出 undoReply(accept:false)');

// 请求方视角
renderGame(g3, 0);
ok(/已发出悔棋请求，等待对方同意…/.test($('offer-bar').textContent), '请求方看到等待文案，实际：' + $('offer-bar').textContent);
ok(!findBtn($('offer-bar'), '同意'), '请求方没有同意按钮');
ok(findBtn($('actions'), '求和') && findBtn($('actions'), '求和').disabled === true, '请求挂起时「求和」按钮禁用');
ok(findBtn($('actions'), '悔棋') && findBtn($('actions'), '悔棋').disabled === true, '请求挂起时「悔棋」按钮禁用');

// 观战视角：能看到请求，但不能回应
renderGame(g3, -1);
ok(/甲 请求悔棋/.test($('offer-bar').textContent), '观战也能看到请求条');
ok($('offer-bar').querySelectorAll('button').length === 0, '观战没有回应按钮');

/* ---------------- 请求条：求和 ---------------- */

const g4 = new Game([{ name: '甲' }, { name: '乙' }]).start();
g4.move(0, sq(7, 7));
g4.offerDraw(0);
renderGame(g4, 1);
ok(!$('offer-bar').classList.contains('hidden'), '求和请求条出现');
ok(/甲 请求求和/.test($('offer-bar').textContent), '求和请求条文案，实际：' + $('offer-bar').textContent);
findBtn($('offer-bar'), '同意').click();
ok(pending && pending.type === 'drawReply' && pending.accept === true, '同意求和发出 drawReply');
renderGame(g4, 0);
ok(/已发出求和请求，等待对方同意…/.test($('offer-bar').textContent), '求和请求方等待文案');

/* ---------------- 操作栏：悔棋/求和/认输 ---------------- */

const g5 = new Game([{ name: '甲' }, { name: '乙' }]).start();
renderGame(g5, 0);
ok(findBtn($('actions'), '悔棋') && findBtn($('actions'), '悔棋').disabled === true, '还没落子时悔棋按钮禁用');
ok(findBtn($('actions'), '求和') && findBtn($('actions'), '求和').disabled === false, '无请求时求和按钮可用');
let resignBtn = findBtn($('actions'), '认输');
ok(!!resignBtn, '有认输按钮');
resignBtn.click();
ok(pending === null, '第一次点认输只进入二次确认，不发动作');
resignBtn = findBtn($('actions'), '确定认输');
ok(!!resignBtn, '第一次点后文字变「确定认输」');
resignBtn.click();
ok(pending && pending.type === 'resign', '第二次点发 resign');

const g6 = new Game([{ name: '甲' }, { name: '乙' }]).start();
g6.move(0, sq(7, 7));
renderGame(g6, 0);
ok(findBtn($('actions'), '悔棋') && findBtn($('actions'), '悔棋').disabled === false, '落过子后悔棋可用');
renderGame(g6, 1);
ok(findBtn($('actions'), '悔棋') && findBtn($('actions'), '悔棋').disabled === true, '白方还没落子，悔棋禁用');

/* ---------------- 聊天 / 快捷语 / tab ---------------- */

const sent = [];
UI.setChatSender((text) => sent.push(text));
UI.renderChat(
  [
    { kind: 'sys', text: '甲 加入了房间' },
    { kind: 'say', name: '甲', text: '你好' },
    { kind: 'say', name: '我', text: '五连！' },
  ],
  '我'
);
ok(document.querySelectorAll('#chat-log .msg').length === 3, '聊天显示 3 条');
ok(!!document.querySelector('#chat-log .msg.sys'), '系统消息样式独立');
ok(!!document.querySelector('#chat-log .msg.me'), '自己的消息有 me 类');
ok(!!document.querySelector('#chat-log .msg .who'), '玩家消息带昵称');
ok(/五连！/.test($('chat-log').textContent), '聊天内容渲染');
const many = [];
for (let i = 0; i < 70; i++) many.push({ kind: 'say', name: '甲', text: '第 ' + i + ' 条' });
UI.renderChat(many, '甲');
ok(document.querySelectorAll('#chat-log .msg').length === 60, '聊天最多保留 60 条，实际 ' + document.querySelectorAll('#chat-log .msg').length);
UI.renderChat([{ kind: 'sys', text: '甲 加入了房间' }, { kind: 'say', name: '甲', text: '你好' }, { kind: 'say', name: '我', text: '五连！' }], '我');
ok(document.querySelectorAll('#chat-log .msg').length === 3, '聊天重新渲染回 3 条');

$('chat-input').value = ' 好棋  ';
$('chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
ok(sent.length === 1 && sent[0] === '好棋', '表单提交去空格后发送，实际：' + JSON.stringify(sent));
ok($('chat-input').value === '', '发送后清空输入');
const quickBtns = document.querySelectorAll('#quick button');
ok(quickBtns.length === 6, '6 个快捷语，实际 ' + quickBtns.length);
quickBtns[0].click();
ok(sent.length === 2 && sent[1] === quickBtns[0].textContent, '快捷语点击发送');

$('tab-chat').click();
ok(!$('chat-pane').classList.contains('hidden'), '切到聊天显示聊天面板');
ok($('move-list').classList.contains('hidden'), '聊天时隐藏棋谱');
ok($('tab-chat').classList.contains('active') && !$('tab-moves').classList.contains('active'), 'tab 激活态切换');
$('tab-moves').click();
ok(!$('move-list').classList.contains('hidden') && $('chat-pane').classList.contains('hidden'), '切回棋谱');

/* ---------------- 菜单浮层 ---------------- */

let quitCalled = 0;
UI.showMenu({ code: 'AB12', role: 'host', onQuit: () => quitCalled++ });
ok(!$('overlay').classList.contains('hidden'), '菜单浮层显示');
ok($('overlay').dataset.mode === 'menu', '菜单 dataset.mode=menu');
ok(/房间 AB12/.test($('overlay-panel').textContent), '菜单显示房号');
ok(/房主/.test($('overlay-panel').textContent), '菜单显示角色说明');
findBtn($('overlay-panel'), '关闭').click();
ok($('overlay').classList.contains('hidden'), '关闭菜单');

UI.showMenu({ code: 'AB12', role: 'spectator', onQuit: () => quitCalled++ });
ok(/观战/.test($('overlay-panel').textContent), '观战角色说明');
findBtn($('overlay-panel'), '离开房间').click();
ok(quitCalled === 1, '离开房间触发回调');
ok($('overlay').classList.contains('hidden'), '离开后关闭浮层');

// 菜单和结算浮层互斥：菜单打开时渲染棋桌不覆盖菜单；关掉菜单后结算回来
UI.showMenu({ code: 'AB12', role: 'host' });
renderGame(gw, 0);
ok($('overlay').dataset.mode === 'menu', '菜单打开时渲染棋桌不覆盖菜单');
UI.clearOverlay();
renderGame(gw, 0);
ok($('overlay').dataset.mode === 'result' && /你赢了！/.test($('overlay-panel').textContent), '关掉菜单后结算浮层恢复');

/* ---------------- 整局模拟：点击走到底 ---------------- */

const rand = rng(2026); // 固定种子：83 手时黑方五连，保证可复现
const gs = new Game([{ name: '甲' }, { name: '乙' }]).start();
let simGuard = 0;
while (gs.phase === 'play' && simGuard < 150) {
  renderGame(gs, gs.turn === 'b' ? 0 : 1);
  ok(document.querySelectorAll('#board-grid .stone').length === gs.history.length, '模拟中棋子数 = 手数');
  const empties = [];
  for (let i = 0; i < 225; i++) if (!gs.board[i]) empties.push(i);
  const pick = empties[Math.floor(rand() * empties.length)];
  clickSq(pick);
  ok(pending && pending.type === 'move' && pending.sq === pick, '模拟对局点热区发出 move');
  if (!pending) break;
  gs.action(gs.turn === 'b' ? 0 : 1, pending);
  simGuard++;
}
renderGame(gs, 0);
ok(gs.history.length > 10, '模拟对局走了 10 手以上，实际 ' + gs.history.length);
ok(document.querySelectorAll('#board-grid .stone').length === gs.history.length, '整局棋子数与棋谱一致');
ok(document.querySelectorAll('#board-grid svg.lines').length === 1, '整局只一个 SVG');
ok(document.querySelectorAll('#board-grid svg.lines line').length === 30, '整局后线仍是 30 条');
ok(document.querySelectorAll('#board-grid .hit').length === 225, '整局后热区仍是 225');
ok(document.querySelectorAll('#move-list li').length === Math.ceil(gs.history.length / 2), '棋谱行数 = ceil(手数/2)，实际 ' + document.querySelectorAll('#move-list li').length);
ok(gs.phase === 'over', '模拟对局在 ' + simGuard + ' 步内结束');
ok(gs.result && gs.result.reason === 'five', '模拟对局以五连结束，实际：' + (gs.result && gs.result.reason));
ok(!$('overlay').classList.contains('hidden'), '模拟对局结束后显示结算');
ok($('overlay').dataset.mode === 'result', '模拟对局结算 mode=result');
ok(/你赢了！/.test($('overlay-panel').textContent), '房主（黑方）赢棋标题，实际：' + $('overlay-panel').textContent);
ok(document.querySelectorAll('#board-grid .stone.win').length === gs.winLine.length, '模拟对局胜线高亮数量 = winLine 长度');
ok(document.querySelectorAll('#board-grid .stone').length === gs.history.length, '模拟对局结束后棋子数与手数一致');

/* ---------------- 汇总 ---------------- */

if (problems.length) {
  console.error('❌ UI 冒烟测试失败：\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('✅ UI 冒烟测试通过（225 热区 / 30 线 / 5 星位 / 胜线高亮 / 请求条 / 聊天 / 菜单 / 模拟对局 ' + gs.history.length + ' 手）');
process.exit(0);
