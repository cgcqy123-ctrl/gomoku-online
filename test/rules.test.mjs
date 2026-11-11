// 五子棋规则引擎单元测试（零依赖，纯 node）：node test/rules.test.mjs
// 风格对齐象棋项目 test/rules.test.mjs：problems 收集 + ✅/❌ + process.exit(1)
import assert from 'node:assert/strict';
import * as R from '../js/rules.js';

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

/** 用 { '行,列': 'b' } 快速摆棋盘（行 0 在上，列 0 在左） */
function boardFrom(spec) {
  const b = R.initialBoard();
  for (const [k, v] of Object.entries(spec)) {
    const [r, c] = k.split(',').map(Number);
    b[R.idx(r, c)] = v;
  }
  return b;
}
const sq = (r, c) => R.idx(r, c);
/** 从 (r0,c0) 起沿 (dr,dc) 走 n 步的下标数组 */
const lineOf = (r0, c0, dr, dc, n) =>
  Array.from({ length: n }, (_, k) => sq(r0 + dr * k, c0 + dc * k));

/* ---------------- 棋盘表示 ---------------- */

t('棋盘规格与导出常量', () => {
  assert.equal(R.SIZE, 15);
  assert.equal(R.BLACK, 'b');
  assert.equal(R.WHITE, 'w');
  assert.deepEqual(R.SIDE_NAME, { b: '黑', w: '白' });
  assert.equal(R.other('b'), 'w');
  assert.equal(R.other('w'), 'b');

  const a = R.initialBoard();
  const b = R.initialBoard();
  assert.equal(a.length, 225);
  assert.ok(a.every((x) => x === null), '开局棋盘全空');
  assert.notEqual(a, b, 'initialBoard 每次返回新数组');

  assert.deepEqual(R.STARS, [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]);
  assert.deepEqual(R.STAR_POINTS, [sq(3, 3), sq(3, 11), sq(7, 7), sq(11, 3), sq(11, 11)]);
  assert.equal(new Set(R.STAR_POINTS).size, 5, '五个星位互不重复');
  assert.equal(R.STAR_POINTS[2], 112, '天元 H8 的下标是 112');
  assert.equal(R.DIRS.length, 4, '横/竖/两斜四个方向');
});

t('idx / rowOf / colOf / inBoard 互逆', () => {
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const i = R.idx(r, c);
      assert.equal(R.rowOf(i), r);
      assert.equal(R.colOf(i), c);
      assert.equal(R.idx(R.rowOf(i), R.colOf(i)), i);
    }
  }
  assert.equal(R.idx(0, 0), 0);
  assert.equal(R.idx(7, 7), 112);
  assert.equal(R.idx(14, 14), 224);
  for (const [r, c] of [[0, 0], [0, 14], [14, 0], [14, 14], [7, 7]]) {
    assert.ok(R.inBoard(r, c), '棋盘点 ' + r + ',' + c);
  }
  for (const [r, c] of [[-1, 0], [0, -1], [15, 0], [0, 15], [15, 15], [-1, -1]]) {
    assert.ok(!R.inBoard(r, c), '棋盘外 ' + r + ',' + c);
  }
});

t('cloneBoard 返回内容一致的新数组', () => {
  const b = R.initialBoard();
  b[sq(3, 4)] = 'b';
  const c = R.cloneBoard(b);
  assert.notEqual(c, b);
  assert.deepEqual(c, b);
  c[sq(3, 4)] = 'w';
  assert.equal(b[sq(3, 4)], 'b', '改副本不影响原棋盘');
});

/* ---------------- 坐标记谱 ---------------- */

t('coord：棋盘下标 → 坐标记谱', () => {
  assert.equal(R.coord(sq(7, 7)), 'H8', '天元');
  assert.equal(R.coord(sq(0, 0)), 'A15', '左上角');
  assert.equal(R.coord(sq(14, 14)), 'O1', '右下角');
  assert.equal(R.coord(sq(14, 0)), 'A1');
  assert.equal(R.coord(sq(0, 14)), 'O15');
  assert.equal(R.coord(sq(0, 8)), 'I15');
  assert.equal(R.coord(sq(14, 8)), 'I1');
});

t('coord / parseCoord 对全部 225 个点互逆', () => {
  for (let i = 0; i < 225; i++) assert.equal(R.parseCoord(R.coord(i)), i, R.coord(i));
});

t('parseCoord 接受合法坐标（含小写与首尾空白）', () => {
  assert.equal(R.parseCoord('H8'), 112);
  assert.equal(R.parseCoord('h8'), 112);
  assert.equal(R.parseCoord('A15'), 0);
  assert.equal(R.parseCoord('O1'), 224);
  assert.equal(R.parseCoord(' a1 '), 210);
  assert.equal(R.parseCoord('O15'), 14);
});

t('parseCoord 非法坐标一律返回 -1', () => {
  const bad = ['H0', 'H16', 'P8', 'A0', 'A16', '', '   ', 'H', '8', 'H8x', '8H', 'H-8', 'HH8', 'H 8', null, undefined, 88, {}];
  for (const x of bad) assert.equal(R.parseCoord(x), -1, '应判非法：' + String(x));
});

/* ---------------- 落子不可变 ---------------- */

t('applyMove 落子返回新棋盘，不修改原棋盘', () => {
  const b = R.initialBoard();
  const snapshot = b.join(',');
  const next = R.applyMove(b, sq(7, 7), 'b');
  assert.equal(b.join(','), snapshot, '原棋盘保持不变');
  assert.notEqual(next, b);
  assert.equal(next[sq(7, 7)], 'b');

  const next2 = R.applyMove(next, sq(0, 0), 'w');
  assert.equal(next2[sq(0, 0)], 'w');
  assert.equal(next2[sq(7, 7)], 'b');
  assert.equal(next[sq(0, 0)], null, '第二手不改第一手的结果');
});

t('applyMove 不修改同一棋子外的其它格', () => {
  const b = boardFrom({ '7,7': 'b' });
  const n = R.applyMove(b, sq(0, 14), 'w');
  assert.equal(n[sq(7, 7)], 'b');
  assert.equal(n.length, 225);
  assert.equal(n.filter((x) => x !== null).length, 2);
});

/* ---------------- 满盘判定 ---------------- */

t('isFull：空盘与差一子都不是满盘', () => {
  assert.equal(R.isFull(R.initialBoard()), false);
  const oneLeft = R.initialBoard();
  for (let i = 0; i < 225; i++) oneLeft[i] = 'b';
  oneLeft[224] = null;
  assert.equal(R.isFull(oneLeft), false);
  oneLeft[224] = 'w';
  assert.equal(R.isFull(oneLeft), true);
});

/* ---------------- 五连判定 ---------------- */

t('winLine：横向五连返回整条棋串', () => {
  const b = boardFrom({ '7,2': 'b', '7,3': 'b', '7,4': 'b', '7,5': 'b', '7,6': 'b' });
  const expect = lineOf(7, 2, 0, 1, 5);
  assert.deepEqual(R.winLine(b, sq(7, 4)), { side: 'b', line: expect });
  for (const i of expect) {
    assert.deepEqual(R.winLine(b, i), { side: 'b', line: expect }, '从棋串任意一点看都是同一条线');
  }
});

t('winLine：竖向五连', () => {
  const b = boardFrom({ '5,3': 'w', '6,3': 'w', '7,3': 'w', '8,3': 'w', '9,3': 'w' });
  assert.deepEqual(R.winLine(b, sq(7, 3)), { side: 'w', line: lineOf(5, 3, 1, 0, 5) });
});

t('winLine：两条斜线五连（右下 / 右上）', () => {
  const d1 = boardFrom({ '2,1': 'b', '3,2': 'b', '4,3': 'b', '5,4': 'b', '6,5': 'b' });
  assert.deepEqual(R.winLine(d1, sq(4, 3)), { side: 'b', line: lineOf(2, 1, 1, 1, 5) });
  const d2 = boardFrom({ '2,11': 'w', '3,10': 'w', '4,9': 'w', '5,8': 'w', '6,7': 'w' });
  assert.deepEqual(R.winLine(d2, sq(4, 9)), { side: 'w', line: lineOf(2, 11, 1, -1, 5) });
});

t('winLine：四连不判胜', () => {
  const b = boardFrom({ '6,4': 'b', '6,5': 'b', '6,6': 'b', '6,7': 'b' });
  for (const i of lineOf(6, 4, 0, 1, 4)) assert.equal(R.winLine(b, i), null);
  assert.equal(R.winner(b), null);
});

t('winLine：长连（6 子）判胜，line 是整条棋串', () => {
  const b = boardFrom({ '5,1': 'b', '5,2': 'b', '5,3': 'b', '5,4': 'b', '5,5': 'b', '5,6': 'b' });
  const expect = lineOf(5, 1, 0, 1, 6);
  assert.deepEqual(R.winLine(b, sq(5, 3)), { side: 'b', line: expect });
  for (const i of expect) assert.deepEqual(R.winLine(b, i), { side: 'b', line: expect });
  assert.deepEqual(R.winner(b), { side: 'b', line: expect });
});

t('winLine：边界不串行（行末 + 下一行行首不算五连）', () => {
  const b = boardFrom({
    '0,12': 'b', '0,13': 'b', '0,14': 'b',
    '1,0': 'b', '1,1': 'b',
  });
  assert.equal(R.winLine(b, sq(0, 12)), null, '行末三子只能算三连');
  assert.equal(R.winLine(b, sq(1, 0)), null, '下一行行首两子不算接上');
  assert.equal(R.winner(b), null, '行的回绕不能拼成五连');
});

t('winLine：空点 / 断点 / 无关点不构成五连', () => {
  assert.equal(R.winLine(R.initialBoard(), sq(7, 7)), null, '空点返回 null');
  const b = boardFrom({ '9,2': 'b', '9,3': 'b', '9,4': 'w', '9,5': 'b', '9,6': 'b' });
  assert.equal(R.winLine(b, sq(9, 2)), null, '中间夹白子断开，左右各两子不算五连');
  const c = boardFrom({ '12,0': 'w', '12,1': 'w', '12,2': 'w', '12,3': 'w', '12,4': 'w', '3,3': 'b' });
  assert.equal(R.winLine(c, sq(3, 3)), null, '棋盘别处有五连，这颗孤子不算');
});

/* ---------------- 全盘扫描 ---------------- */

t('winner：全盘扫描，不依赖最后一手', () => {
  const b = boardFrom({ '10,5': 'w', '10,6': 'w', '10,7': 'w', '10,8': 'w', '10,9': 'w' });
  assert.deepEqual(R.winner(b), { side: 'w', line: lineOf(10, 5, 0, 1, 5) });
  assert.equal(R.winner(R.initialBoard()), null);
  assert.equal(R.winner(boardFrom({ '6,4': 'b', '6,5': 'b', '6,6': 'b', '6,7': 'b' })), null);
});

t('winner：4 周期满盘图案无五连（和棋摆法）', () => {
  // 与 game.test 的和棋摆法同款：(r+2c)%4 < 2 为黑，否则为白。
  // 横/竖/两斜上的同色连最多 2~3 子，所以满盘也没有五连。
  const b = new Array(225).fill(null);
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) b[R.idx(r, c)] = (r + 2 * c) % 4 < 2 ? 'b' : 'w';
  }
  assert.equal(R.isFull(b), true);
  assert.equal(R.winner(b), null);
  for (let i = 0; i < 225; i++) assert.equal(R.winLine(b, i), null, '第 ' + i + ' 点无五连');
});

/* ---------------- 汇总 ---------------- */

if (problems.length) {
  console.error('\n❌ 规则引擎测试失败 ' + problems.length + ' 项：\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('✅ 规则引擎通过 ' + passed + ' 项');
