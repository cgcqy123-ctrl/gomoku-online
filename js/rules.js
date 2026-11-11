// 五子棋规则引擎：棋盘表示 / 落子 / 五连判定 / 坐标记谱
// 纯函数、零依赖，浏览器和 Node 都能直接跑（不碰 DOM、不碰网络）。
//
// 棋盘：15 行 × 15 列，行 0 在最上面，行 14 在最下面。
// 一维数组 board[row * 15 + col]，元素是 'b'（黑）/ 'w'（白）/ null。
// 坐标：列 A-O（自左向右），行 1-15（自下向上），比如天元是 H8。

export const SIZE = 15;
export const BLACK = 'b';
export const WHITE = 'w';
export const SIDE_NAME = { b: '黑', w: '白' };

/** 星位（天元 + 四星），[row, col] */
export const STARS = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
];

/** 四个判定方向：横、竖、右下、右上 */
export const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const LETTERS = 'ABCDEFGHIJKLMNO';

/* ---------------- 基础工具 ---------------- */

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;
export const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const other = (side) => (side === BLACK ? WHITE : BLACK);
export const initialBoard = () => new Array(SIZE * SIZE).fill(null);
export const cloneBoard = (board) => board.slice();

/** 星位下标，方便界面画点 */
export const STAR_POINTS = STARS.map(([r, c]) => idx(r, c));

/** 棋盘下标 → 坐标记谱，例如 H8 / A15 / O1 */
export function coord(sq) {
  return LETTERS[colOf(sq)] + (SIZE - rowOf(sq));
}

/** 坐标记谱 → 棋盘下标，非法返回 -1（例如 'H8'、'a15'） */
export function parseCoord(text) {
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(String(text || '').trim());
  if (!m) return -1;
  const c = m[1].toUpperCase().charCodeAt(0) - 65;
  const r = SIZE - Number(m[2]);
  return inBoard(r, c) ? idx(r, c) : -1;
}

/** 落子后的新棋盘（不修改原棋盘） */
export function applyMove(board, sq, side) {
  const next = board.slice();
  next[sq] = side;
  return next;
}

/** 棋盘是否下满（用于和棋判定） */
export function isFull(board) {
  return board.every((x) => x !== null);
}

/* ---------------- 五连判定 ---------------- */

/**
 * 以 sq 为落点检查是否连成五子（长连 6+ 也算）。
 * 返回 { side, line } —— line 是包含 sq 的整条连续同色棋串（用于界面高亮）；
 * 没有五连返回 null。
 */
export function winLine(board, sq) {
  const side = board[sq];
  if (!side) return null;
  for (const [dr, dc] of DIRS) {
    const line = [sq];
    for (const sign of [-1, 1]) {
      let r = rowOf(sq) + dr * sign;
      let c = colOf(sq) + dc * sign;
      while (inBoard(r, c) && board[idx(r, c)] === side) {
        if (sign < 0) line.unshift(idx(r, c));
        else line.push(idx(r, c));
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 5) return { side, line };
  }
  return null;
}

/**
 * 全盘检查是否已经有五连，返回 { side, line } 或 null。
 * 房主侧结算时用；随机对局测试也用它做不变量校验。
 */
export function winner(board) {
  for (let i = 0; i < board.length; i++) {
    if (!board[i]) continue;
    const win = winLine(board, i);
    if (win) return win;
  }
  return null;
}
