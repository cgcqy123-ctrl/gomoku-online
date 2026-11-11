// 五子棋对局状态机单元测试（零依赖，纯 node）：node test/game.test.mjs
// 风格对齐象棋项目 test/game.test.mjs：problems 收集 + ✅/❌ + process.exit(1)
import assert from 'node:assert/strict';
import * as R from '../js/rules.js';
import { Game, PHASE, sideOfSeat, seatOfSide } from '../js/game.js';

const problems = [];
let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('❌ ' + name);
    problems.push(name + '：' + (e && e.message ? e.message : String(e)));
  }
};

const sq = (r, c) => R.idx(r, c);
const newGame = () => new Game([{ name: '甲' }, { name: '乙' }]).start();

/** 用 { '行,列': 'b' } 直接摆一个局面（单元测试专用，绕开逐步落子） */
function boardFrom(spec) {
  const b = R.initialBoard();
  for (const [k, v] of Object.entries(spec)) {
    const [r, c] = k.split(',').map(Number);
    b[R.idx(r, c)] = v;
  }
  return b;
}

/** 摆好棋盘并设定轮到谁走（phase 保持 play） */
function setup(spec, turn = R.BLACK) {
  const g = newGame();
  g.board = boardFrom(spec);
  g.turn = turn;
  return g;
}

/** 满盘无五连的 4 周期图案：(r+2c)%4 < 2 为黑，否则白 */
function fullPattern() {
  const b = new Array(225).fill(null);
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) b[R.idx(r, c)] = (r + 2 * c) % 4 < 2 ? R.BLACK : R.WHITE;
  }
  return b;
}

/** 固定种子的伪随机（与象棋测试同款） */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 开局 / 座位 ---------------- */

t('开局：黑方先行，座位/执方映射正确', () => {
  assert.equal(PHASE.LOBBY, 'lobby');
  assert.equal(PHASE.PLAY, 'play');
  assert.equal(PHASE.OVER, 'over');
  assert.equal(sideOfSeat(0), 'b');
  assert.equal(sideOfSeat(1), 'w');
  assert.equal(sideOfSeat(-1), null);
  assert.equal(sideOfSeat(2), null);
  assert.equal(seatOfSide('b'), 0);
  assert.equal(seatOfSide('w'), 1);

  const g = new Game([{ name: '甲' }, { name: '乙' }]);
  assert.equal(g.phase, PHASE.LOBBY);
  assert.equal(g.round, 0, '还没开局');
  assert.equal(g.turn, 'b', '默认轮到黑方');
  assert.deepEqual(g.history, []);
  assert.equal(g.players.length, 2);
  assert.deepEqual(
    g.players.map((p) => [p.seat, p.side, p.name, p.connected]),
    [[0, 'b', '甲', true], [1, 'w', '乙', true]]
  );
  assert.deepEqual(g.player(0), { seat: 0, side: 'b', name: '甲', connected: true });
  assert.equal(g.player(5), null);

  g.start();
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.round, 1);
  assert.equal(g.turn, 'b');
  assert.equal(g.board.length, 225);
  assert.ok(g.board.every((x) => x === null));
  assert.ok(g.startedAt > 0);
  assert.equal(g.plyCount, 0);

  const d = new Game();
  assert.deepEqual(d.players.map((p) => p.name), ['玩家1', '玩家2'], '缺省昵称');
  const e = new Game([{ name: '甲', connected: false }, { name: '乙' }]);
  assert.equal(e.players[0].connected, false);
  assert.equal(e.players[1].connected, true);
});

/* ---------------- 落子 ---------------- */

t('落子：记谱、轮转、棋谱与 lastMove', () => {
  const g = newGame();
  const r1 = g.move(0, sq(7, 7));
  assert.deepEqual(r1, { ok: true, over: false, notation: 'H8' });
  assert.equal(g.board[sq(7, 7)], 'b');
  assert.equal(g.turn, 'w');
  assert.equal(g.lastMove, sq(7, 7));
  assert.equal(g.plyCount, 1);
  assert.deepEqual(g.history, [{ ply: 1, side: 'b', sq: 112, notation: 'H8' }]);

  const r2 = g.move(1, sq(0, 0));
  assert.deepEqual(r2, { ok: true, over: false, notation: 'A15' });
  assert.equal(g.board[sq(0, 0)], 'w');
  assert.equal(g.turn, 'b');
  assert.equal(g.lastMove, sq(0, 0));
  assert.equal(g.plyCount, 2);

  const v = g.view(0);
  assert.equal(v.moves.length, 2);
  assert.deepEqual(v.moves.map((m) => m.notation), ['H8', 'A15']);
  assert.deepEqual(v.moves.map((m) => m.side), ['b', 'w']);
  assert.deepEqual(v.moves.map((m) => m.ply), [1, 2]);
});

t('未开局 / 结束后不能落子', () => {
  assert.throws(() => new Game([{ name: '甲' }, { name: '乙' }]).move(0, 112), /对局还没开始或已经结束/);
  const g = newGame();
  g.resign(1);
  assert.equal(g.phase, PHASE.OVER);
  assert.throws(() => g.move(0, 112), /对局还没开始或已经结束/);
});

t('非法落子一律抛中文错误', () => {
  const g = newGame();
  assert.throws(() => g.move(1, sq(0, 0)), /还没轮到你落子/, '黑先，白方不能先走');
  assert.throws(() => g.move(-1, sq(0, 0)), /观战不能落子/);
  assert.throws(() => g.move(2, sq(0, 0)), /观战不能落子/, '没有 2 号座位');
  assert.throws(() => g.move(0, -1), /落点无效/);
  assert.throws(() => g.move(0, 225), /落点无效/);
  assert.throws(() => g.move(0, 1.5), /落点无效/);
  assert.throws(() => g.move(0, NaN), /落点无效/);
  assert.throws(() => g.move(0, 'H8'), /落点无效/, '直接 move 不接受坐标字符串（action 才会转换）');

  g.move(0, sq(7, 7));
  assert.throws(() => g.move(1, sq(7, 7)), /这里已经有棋子了/);
  assert.throws(() => g.move(0, sq(0, 0)), /还没轮到你落子/);
  g.move(1, sq(0, 0));
  assert.throws(() => g.move(1, sq(0, 1)), /还没轮到你落子/, '白方刚落完，不能连走');
});

/* ---------------- 五连 / 和棋结算 ---------------- */

t('五连结算：黑胜的 winner / reason / text / winLine / 视图', () => {
  const g = setup({ '7,2': 'b', '7,3': 'b', '7,4': 'b', '7,5': 'b' }, 'b');
  const line = [sq(7, 2), sq(7, 3), sq(7, 4), sq(7, 5), sq(7, 6)];
  const res = g.move(0, sq(7, 6));
  assert.deepEqual(res, { ok: true, over: true, notation: 'G8', win: line });
  assert.equal(g.phase, PHASE.OVER);
  assert.equal(g.result.winner, 'b');
  assert.equal(g.result.reason, 'five');
  assert.equal(g.result.text, '黑方胜（五连）');
  assert.equal(g.result.plies, g.history.length);
  assert.deepEqual(g.winLine, line);

  const v0 = g.view(0);
  const vs = g.view(-1);
  assert.deepEqual(v0.winLine, line);
  assert.deepEqual(v0.result, g.result);
  assert.equal(v0.result.winner, 'b');
  assert.equal(vs.spectator, true);
  assert.equal(vs.result.reason, 'five');
  assert.equal(vs.turn, 'w');

  assert.throws(() => g.move(1, sq(0, 0)), /对局还没开始或已经结束/);
  assert.throws(() => g.resign(1), /对局已经结束/);
  assert.throws(() => g.offerDraw(1), /对局已经结束/);
  assert.throws(() => g.requestUndo(1), /对局已经结束/);
  assert.equal(g.canRequestUndo(0), false, '结束后不能再悔棋');
});

t('五连结算：白胜', () => {
  const g = setup({ '9,3': 'w', '9,4': 'w', '9,5': 'w', '9,6': 'w' }, 'w');
  const res = g.move(1, sq(9, 7));
  assert.equal(res.over, true);
  assert.equal(res.notation, 'H6');
  assert.equal(g.result.winner, 'w');
  assert.equal(g.result.reason, 'five');
  assert.equal(g.result.text, '白方胜（五连）');
  assert.deepEqual(res.win, [sq(9, 3), sq(9, 4), sq(9, 5), sq(9, 6), sq(9, 7)]);
});

t('长连（6 子）也判胜，winLine 是整条棋串', () => {
  const g = setup({ '5,1': 'b', '5,2': 'b', '5,3': 'b', '5,4': 'b', '5,5': 'b' }, 'b');
  const res = g.move(0, sq(5, 6));
  const line = [sq(5, 1), sq(5, 2), sq(5, 3), sq(5, 4), sq(5, 5), sq(5, 6)];
  assert.equal(res.over, true);
  assert.deepEqual(res.win, line);
  assert.deepEqual(g.winLine, line);
  assert.equal(g.result.reason, 'five');
  assert.equal(g.result.text, '黑方胜（五连）');
});

t('四连不判胜，对局继续', () => {
  const g = setup({ '6,4': 'b', '6,5': 'b', '6,6': 'b', '6,7': 'b' }, 'b');
  const res = g.move(0, sq(6, 9));
  assert.equal(res.over, false);
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.result, null);
  assert.equal(g.winLine, null);
  assert.equal(g.turn, 'w');
});

t('满盘无五连 → 和棋（棋盘下满）', () => {
  const full = fullPattern();
  assert.equal(R.isFull(full), true);
  assert.equal(R.winner(full), null, '4 周期图案本身没有五连');

  const hole = sq(7, 7); // H8
  assert.equal(full[hole], 'b', '按图案 H8 应落黑子');
  const g = newGame();
  g.board = full.slice();
  g.board[hole] = null;
  g.turn = 'b';
  assert.equal(R.isFull(g.board), false, '补最后一子前还差一格');

  const res = g.move(0, hole);
  assert.deepEqual(res, { ok: true, over: true, notation: 'H8' });
  assert.equal('win' in res, false, '和棋没有五连线');
  assert.equal(g.phase, PHASE.OVER);
  assert.equal(R.isFull(g.board), true);
  assert.equal(R.winner(g.board), null);
  assert.equal(R.winLine(g.board, hole), null);
  assert.equal(g.result.winner, null);
  assert.equal(g.result.reason, 'board-full');
  assert.equal(g.result.text, '和棋（棋盘下满）');
  assert.equal(g.result.plies, 1);
  assert.equal(g.view(0).result.reason, 'board-full');
  assert.equal(g.view(-1).result.winner, null);
});

/* ---------------- 悔棋（需对方同意） ---------------- */

t('悔棋：刚走完对面没应，只退 1 手', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  assert.equal(g.canRequestUndo(0), true, '刚走完也能申请悔棋');
  assert.equal(g.canRequestUndo(1), false, '白方还没落过子');
  assert.equal(g.view(0).canUndo, true);
  assert.deepEqual(g.requestUndo(0), { ok: true });
  assert.equal(g.view(0).offers.undo, 0);
  assert.equal(g.view(1).offers.undo, 0);
  assert.equal(g.canRequestUndo(0), false, '请求挂起时不能再申请');
  assert.throws(() => g.move(1, sq(0, 0)), /先处理还没答复的悔棋 \/ 求和请求/);
  assert.throws(() => g.replyUndo(0, true), /不能自己答应自己/);

  const r = g.replyUndo(1, true);
  assert.deepEqual(r, { ok: true, over: false, accepted: true, popped: 1 });
  assert.equal(g.plyCount, 0);
  assert.equal(g.turn, 'b');
  assert.equal(g.board.join(','), R.initialBoard().join(','));
  assert.equal(g.lastMove, null);
  assert.equal(g.view(0).offers.undo, null);
  g.move(0, sq(7, 7)); // 悔棋后可以继续走
});

t('悔棋：对面已应招则退 2 手，回到自己走棋之前', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  g.move(1, sq(0, 0));
  assert.equal(g.turn, 'b');
  g.requestUndo(0);
  const r = g.replyUndo(1, true);
  assert.equal(r.popped, 2);
  assert.equal(g.plyCount, 0);
  assert.equal(g.turn, 'b');
  assert.equal(g.board.join(','), R.initialBoard().join(','));
  assert.equal(g.lastMove, null);

  // 走满 4 手后黑方悔棋：退回 2 手，保留前两手
  const g2 = newGame();
  g2.move(0, sq(7, 7)); // H8
  g2.move(1, sq(0, 0)); // A15
  g2.move(0, sq(7, 8)); // I8
  g2.move(1, sq(0, 1)); // B15
  const before = g2.view(0);
  assert.equal(g2.turn, 'b');
  g2.requestUndo(0);
  const r2 = g2.replyUndo(1, true);
  assert.equal(r2.popped, 2);
  assert.equal(g2.plyCount, 2);
  assert.equal(g2.turn, 'b');
  assert.equal(g2.board[sq(7, 7)], 'b');
  assert.equal(g2.board[sq(0, 0)], 'w');
  assert.equal(g2.board[sq(7, 8)], null);
  assert.equal(g2.board[sq(0, 1)], null);
  assert.equal(g2.lastMove, sq(0, 0));
  assert.deepEqual(g2.view(0).moves, before.moves.slice(0, 2));
});

t('悔棋：黑方刚走完也能悔棋，退的是自己那一手', () => {
  const g = newGame();
  g.move(0, sq(7, 7)); // 黑
  g.move(1, sq(0, 0)); // 白
  g.requestUndo(1); // 白方刚走完、轮到黑
  assert.equal(g.view(0).offers.undo, 1);
  const r = g.replyUndo(0, true);
  assert.equal(r.popped, 1);
  assert.equal(g.plyCount, 1);
  assert.equal(g.turn, 'w');
  assert.equal(g.board[sq(0, 0)], null, '白子收回');
  assert.equal(g.board[sq(7, 7)], 'b', '黑子还在');
  assert.equal(g.lastMove, sq(7, 7));
});

t('悔棋：拒绝则局面不变', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  g.move(1, sq(0, 0));
  g.requestUndo(0);
  const board = g.board.join(',');
  const hist = JSON.stringify(g.history);
  const r = g.replyUndo(1, false);
  assert.deepEqual(r, { ok: true, over: false, accepted: false });
  assert.equal(g.board.join(','), board);
  assert.equal(JSON.stringify(g.history), hist);
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.view(0).offers.undo, null);
  g.move(0, sq(7, 8)); // 拒绝后可以正常继续
});

t('悔棋限制：未落子 / 观战 / 无请求 / 重复请求 / 请求挂起', () => {
  const g = newGame();
  assert.equal(g.view(1).canUndo, false);
  assert.throws(() => g.requestUndo(0), /你还没落过子，没有可悔的/);
  g.move(0, sq(7, 7));
  assert.throws(() => g.requestUndo(1), /你还没落过子，没有可悔的/, '白方还没落过子');
  assert.throws(() => g.requestUndo(-1), /观战不能悔棋/);
  assert.equal(g.canRequestUndo(-1), false);
  assert.throws(() => g.replyUndo(1, true), /没有待回应的悔棋请求/);
  assert.throws(() => g.replyUndo(-1, true), /没有待回应的悔棋请求/);

  g.requestUndo(0);
  assert.throws(() => g.requestUndo(0), /已经有一个悔棋请求在等回应/);
  assert.throws(() => g.replyUndo(-1, true), /观战不能回应悔棋/);
  assert.throws(() => g.replyUndo(0, true), /不能自己答应自己/);
  assert.equal(g.view(0).canUndo, false, '有请求挂起时不能再悔棋');
  g.replyUndo(1, false);
  assert.equal(g.view(0).canUndo, true, '拒绝后恢复可悔棋');
});

/* ---------------- 求和 ---------------- */

t('求和：请求 → 拒绝 / 同意 / 不能自己答应', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  assert.deepEqual(g.offerDraw(0), { ok: true });
  assert.equal(g.view(1).offers.draw, 0);
  assert.throws(() => g.move(1, sq(0, 0)), /先处理还没答复的悔棋 \/ 求和请求/);
  assert.throws(() => g.replyDraw(0, true), /不能自己答应自己/);
  assert.throws(() => g.replyDraw(-1, true), /观战不能回应求和/);
  const r = g.replyDraw(1, false);
  assert.deepEqual(r, { ok: true, over: false, accepted: false });
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.view(0).offers.draw, null);
  g.move(1, sq(0, 0)); // 拒绝后恢复正常走棋

  const g2 = newGame();
  g2.move(0, sq(7, 7));
  g2.offerDraw(1);
  const ok = g2.replyDraw(0, true);
  assert.deepEqual(ok, { ok: true, over: true, accepted: true });
  assert.equal(g2.phase, PHASE.OVER);
  assert.equal(g2.result.winner, null);
  assert.equal(g2.result.reason, 'draw');
  assert.equal(g2.result.text, '和棋（双方同意）');
  assert.equal(g2.result.plies, 1);

  const g3 = newGame();
  g3.move(0, sq(7, 7));
  g3.offerDraw(0);
  assert.throws(() => g3.offerDraw(1), /已经有一个求和请求在等回应/);
  assert.throws(() => g3.requestUndo(0), /先处理求和请求/);
  g3.replyDraw(1, false);
  assert.throws(() => g3.offerDraw(-1), /观战不能求和/);
  assert.throws(() => g3.replyDraw(1, true), /没有待回应的求和请求/);
});

/* ---------------- 认输 ---------------- */

t('认输：对方获胜并结束对局', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  assert.deepEqual(g.resign(0), { ok: true, over: true });
  assert.equal(g.phase, PHASE.OVER);
  assert.equal(g.result.winner, 'w');
  assert.equal(g.result.reason, 'resign');
  assert.equal(g.result.text, '白方胜（认输）');
  assert.equal(g.result.plies, 1);
  assert.throws(() => g.resign(1), /对局已经结束/);
  assert.throws(() => g.move(0, sq(0, 0)), /对局还没开始或已经结束/);
  assert.throws(() => g.offerDraw(0), /对局已经结束/);

  const g2 = newGame();
  g2.move(0, sq(7, 7));
  assert.throws(() => g2.resign(-1), /观战不能认输/);
  g2.resign(1);
  assert.equal(g2.result.winner, 'b');
  assert.equal(g2.result.text, '黑方胜（认输）');

  assert.throws(() => new Game().resign(0), /对局已经结束/, '大厅里不能认输');
});

/* ---------------- 统一动作入口 ---------------- */

t('action 统一入口：分发与无效操作', () => {
  const g = newGame();
  assert.throws(() => g.action(0, null), /无效操作/);
  assert.throws(() => g.action(0, undefined), /无效操作/);
  assert.throws(() => g.action(0, 'move'), /无效操作/);
  assert.throws(() => g.action(0, {}), /无效操作/);
  assert.throws(() => g.action(0, { type: 'bogus' }), /无效操作/);

  // sq 走 Number() 转换，网络传来的字符串也能落子
  assert.equal(g.action(0, { type: 'move', sq: String(sq(7, 7)) }).notation, 'H8');
  assert.throws(() => g.action(0, { type: 'move', sq: 'abc' }), /落点无效/);
  assert.equal(g.action(1, { type: 'move', sq: sq(0, 0) }).notation, 'A15');

  // resign / undo / draw 全走 action
  g.action(0, { type: 'draw' });
  assert.equal(g.view(1).offers.draw, 0);
  assert.deepEqual(g.action(1, { type: 'drawReply', accept: false }), { ok: true, over: false, accepted: false });
  assert.equal(g.action(1, { type: 'undo' }).ok, true, '白方已落过子，可以请求悔棋');
  assert.equal(g.view(0).offers.undo, 1);
  const r = g.action(0, { type: 'undoReply', accept: true });
  assert.equal(r.accepted, true);
  assert.equal(r.popped, 1, '白方刚走完只退 1 手');
  assert.equal(g.history.length, 1);
  assert.equal(g.turn, 'w');
  g.action(1, { type: 'resign' });
  assert.equal(g.result.winner, 'b');
});

/* ---------------- 再来一局 ---------------- */

t('再开一局：清空棋谱/结果，round 递增', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  g.move(1, sq(0, 0));
  g.resign(0);
  assert.equal(g.phase, PHASE.OVER);
  const at = g.startedAt;
  g.start();
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.round, 2);
  assert.equal(g.turn, 'b');
  assert.equal(g.plyCount, 0);
  assert.equal(g.result, null);
  assert.equal(g.winLine, null);
  assert.equal(g.lastMove, null);
  assert.deepEqual(g.offers, { undo: null, draw: null });
  assert.ok(g.board.every((x) => x === null));
  assert.ok(g.startedAt >= at);
});

/* ---------------- 视图 ---------------- */

t('view：字段与契约 §2 一致', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  const v0 = g.view(0);
  const v1 = g.view(1);
  const vs = g.view(-1);
  const keys = ['phase', 'round', 'seat', 'spectator', 'mySide', 'turn', 'board', 'players', 'moves', 'lastMove', 'winLine', 'offers', 'canUndo', 'result', 'startedAt'];
  assert.deepEqual(Object.keys(v0).sort(), keys.slice().sort());

  assert.equal(v0.phase, 'play');
  assert.equal(v0.round, 1);
  assert.equal(v0.seat, 0);
  assert.equal(v0.spectator, false);
  assert.equal(v0.mySide, 'b');
  assert.equal(v1.seat, 1);
  assert.equal(v1.spectator, false);
  assert.equal(v1.mySide, 'w');
  assert.equal(vs.seat, -1);
  assert.equal(vs.spectator, true);
  assert.equal(vs.mySide, null);

  assert.equal(v0.turn, 'w');
  assert.equal(v0.board.length, 225);
  assert.equal(v0.board[sq(7, 7)], 'b');
  assert.equal(v0.players.length, 2);
  for (const p of v0.players) assert.deepEqual(Object.keys(p).sort(), ['connected', 'name', 'seat', 'side']);
  assert.equal(v0.players[0].name, '甲');
  assert.equal(v0.players[0].side, 'b');
  assert.equal(v0.players[1].side, 'w');
  assert.equal(v0.moves.length, 1);
  assert.deepEqual(v0.moves[0], { ply: 1, side: 'b', sq: sq(7, 7), notation: 'H8' });
  assert.equal(v0.lastMove, sq(7, 7));
  assert.equal(v0.winLine, null);
  assert.deepEqual(v0.offers, { undo: null, draw: null });
  assert.equal(v0.canUndo, true, '黑方落过子且没人请求');
  assert.equal(v1.canUndo, false, '白方还没落过子');
  assert.equal(vs.canUndo, false);
  assert.equal(v0.result, null);
  assert.ok(v0.startedAt > 0);
});

t('view：副本与内部状态隔离', () => {
  const g = newGame();
  g.move(0, sq(7, 7));
  const v = g.view(0);
  v.board[0] = 'w';
  v.moves[0].notation = 'X';
  v.moves.push({ ply: 2 });
  v.players[0].name = '改过';
  v.players.push({});
  v.offers.undo = 1;
  assert.equal(g.board[0], null, 'view.board 是副本');
  assert.equal(g.history.length, 1);
  assert.equal(g.history[0].notation, 'H8');
  assert.equal(g.players.length, 2);
  assert.equal(g.players[0].name, '甲');
  assert.deepEqual(g.offers, { undo: null, draw: null });

  // 五连后的 winLine 也是副本
  const w = setup({ '7,2': 'b', '7,3': 'b', '7,4': 'b', '7,5': 'b' }, 'b');
  w.move(0, sq(7, 6));
  const vw = w.view(-1);
  const line = vw.winLine.slice();
  vw.winLine.push(999);
  assert.deepEqual(w.winLine, line, '改 view.winLine 不影响内部');
});

/* ---------------- 随机对局不变量 ---------------- */

t('随机对局不变量：状态自洽，最多 225 手必结束', () => {
  const rand = rng(20261111);
  for (let gi = 0; gi < 5; gi++) {
    const g = newGame();
    for (let ply = 0; ply < 225 && g.phase === PHASE.PLAY; ply++) {
      assert.equal(R.winner(g.board), null, '对局进行中不应已有五连');
      assert.equal(g.result, null, '未结束不应有 result');
      const empties = [];
      for (let i = 0; i < 225; i++) if (!g.board[i]) empties.push(i);
      assert.equal(empties.length, 225 - ply, '空点数 = 225 - 已落子数');

      const pick = empties[Math.floor(rand() * empties.length)];
      const seat = seatOfSide(g.turn);
      const side = g.turn;
      const res = g.action(seat, { type: 'move', sq: pick });
      assert.equal(res.notation, R.coord(pick));
      assert.equal(g.history.length, ply + 1, '棋谱条数 = 手数');
      assert.equal(g.board[pick], side);
      assert.deepEqual(g.history[g.history.length - 1], {
        ply: ply + 1,
        side,
        sq: pick,
        notation: R.coord(pick),
      });
      assert.equal(g.view(0).moves.length, g.history.length);

      if (g.phase === PHASE.PLAY) {
        assert.equal(g.result, null);
        assert.equal(g.turn, R.other(side), '落子后轮换');
        assert.equal(g.winLine, null);
        assert.equal(g.lastMove, pick);
      } else {
        const win = R.winner(g.board);
        assert.equal(g.result.plies, g.history.length);
        if (g.result.reason === 'five') {
          assert.ok(win, 'reason=five 必须真的存在五连');
          assert.equal(g.result.winner, win.side);
          const winAt = R.winLine(g.board, pick);
          assert.ok(winAt, '落点必须处在一段五连里');
          assert.deepEqual(g.winLine, winAt.line, 'winLine 应是落点所在棋串');
          assert.ok(g.winLine.length >= 5);
          assert.ok(g.winLine.includes(pick));
          assert.ok(g.winLine.every((i) => g.board[i] === win.side), '整条线同色');
          assert.match(g.result.text, /方胜（五连）/);
        } else {
          assert.equal(g.result.reason, 'board-full', '只有五连或满盘两种结束方式');
          assert.equal(win, null);
          assert.equal(g.result.winner, null);
          assert.ok(R.isFull(g.board));
          assert.match(g.result.text, /和棋（棋盘下满）/);
        }
      }
    }
    assert.equal(g.phase, PHASE.OVER, '最多 225 手必须结束');
    assert.equal(g.history.length, g.result.plies);
    // 整局棋谱序号连续、黑白交替、坐标合法
    g.history.forEach((h, i) => {
      assert.equal(h.ply, i + 1);
      assert.equal(h.side, i % 2 === 0 ? 'b' : 'w');
      assert.equal(R.parseCoord(h.notation), h.sq);
    });
    const v = g.view(-1);
    assert.equal(v.moves.length, g.history.length);
    assert.deepEqual(v.board, g.board);
  }
});

/* ---------------- 汇总 ---------------- */

if (problems.length) {
  console.error('\n❌ 对局状态机测试失败 ' + problems.length + ' 项：\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('✅ 对局状态机通过 ' + passed + ' 项');
