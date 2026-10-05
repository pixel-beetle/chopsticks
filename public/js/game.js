// 碰手指（加到自己手上、凑十消手、先消光者胜）的规则引擎与完全求解器。
// 浏览器与 Node 共用，不依赖任何库。
//
// 记号：一方的两只手记为 [x, y]，取值 0..9，0 表示这只手已经消掉。
// 局面总是“从轮到走棋的一方看”：mine = 走棋方，theirs = 对方。

export const MOD = 10;
export const WIN = 1;
export const DRAW = 0;
export const LOSS = -1;

export const START = Object.freeze([1, 1]);

export function sorted(pair) {
  return pair[0] <= pair[1] ? [pair[0], pair[1]] : [pair[1], pair[0]];
}

export function alive(pair) {
  return pair[0] !== 0 || pair[1] !== 0;
}

export function liveCount(pair) {
  return (pair[0] !== 0) + (pair[1] !== 0);
}

/** 规范编码：两边各自排序后拼成 4 位十进制数 abcd（a≤b, c≤d）。 */
export function encode(mine, theirs) {
  const [a, b] = sorted(mine);
  const [c, d] = sorted(theirs);
  return a * 1000 + b * 100 + c * 10 + d;
}

export function decode(code) {
  return {
    mine: [Math.floor(code / 1000), Math.floor(code / 100) % 10],
    theirs: [Math.floor(code / 10) % 10, code % 10],
  };
}

export function isValidPosition(mine, theirs) {
  return alive(mine) && alive(theirs);
}

/**
 * 走一步：用对方第 j 只手的数加到自己第 i 只手上。
 * 返回走完后自己的两只手（保持左右位置）以及是否已经获胜。
 */
export function applyMove(mine, theirs, i, j) {
  if (mine[i] === 0) throw new Error('不能使用已经消掉的手');
  if (theirs[j] === 0) throw new Error('不能加对方已经消掉的手');
  const next = [mine[0], mine[1]];
  const sum = mine[i] + theirs[j];
  next[i] = sum % MOD;
  return { mine: next, sum, killed: next[i] === 0, won: !alive(next) };
}

/** 所有合法走法 [i, j]（按位置区分，可能有结果相同的重复走法）。 */
export function legalMoves(mine, theirs) {
  const moves = [];
  for (let i = 0; i < 2; i++) {
    if (mine[i] === 0) continue;
    for (let j = 0; j < 2; j++) {
      if (theirs[j] === 0) continue;
      moves.push([i, j]);
    }
  }
  return moves;
}

/** 所有规范局面编码（双方都至少有一只活手），共 54 × 54 = 2916 个。 */
export function allPositions() {
  const sides = [];
  for (let a = 0; a < MOD; a++) {
    for (let b = a; b < MOD; b++) {
      if (a === 0 && b === 0) continue;
      sides.push([a, b]);
    }
  }
  const codes = [];
  for (const s of sides) for (const t of sides) codes.push(encode(s, t));
  return codes;
}

/** 从规范局面出发的去重后继：{ win: 是否有一步直接获胜, children: 后继局面编码（已换成对方视角） } */
export function successors(code) {
  const { mine, theirs } = decode(code);
  let win = false;
  const children = new Set();
  for (const [i, j] of legalMoves(mine, theirs)) {
    const r = applyMove(mine, theirs, i, j);
    if (r.won) win = true;
    else children.add(encode(theirs, r.mine));
  }
  return { win, children: [...children] };
}

/**
 * 逆向归纳求解全部局面。
 * result[code]：走棋方在双方最优下的结局（WIN / LOSS / DRAW），非法局面为 NaN 标记 2。
 * depth[code]：最优对局下到终局还要走的总步数（胜方求最快、负方求最慢；和棋为 -1）。
 */
export function solve() {
  const SIZE = 10000;
  const result = new Int8Array(SIZE).fill(2);
  const depth = new Int16Array(SIZE).fill(-1);
  const codes = allPositions();
  const parents = new Map();
  const remaining = new Int16Array(SIZE);
  const succ = new Map();

  for (const code of codes) {
    parents.set(code, []);
    result[code] = DRAW;
  }
  for (const code of codes) {
    const s = successors(code);
    succ.set(code, s);
    remaining[code] = s.children.length;
    for (const ch of s.children) parents.get(ch).push(code);
  }

  const resolved = new Uint8Array(SIZE);
  const queue = [];
  for (const code of codes) {
    if (succ.get(code).win) {
      result[code] = WIN;
      depth[code] = 1;
      resolved[code] = 1;
      queue.push(code);
    }
  }
  // 按深度非降的顺序出队，保证胜方深度取最小、负方深度取最大。
  for (let head = 0; head < queue.length; head++) {
    const code = queue[head];
    for (const p of parents.get(code)) {
      if (resolved[p]) continue;
      if (result[code] === LOSS) {
        result[p] = WIN;
        depth[p] = depth[code] + 1;
        resolved[p] = 1;
        queue.push(p);
      } else if (--remaining[p] === 0) {
        result[p] = LOSS;
        depth[p] = depth[code] + 1;
        resolved[p] = 1;
        queue.push(p);
      }
    }
  }
  return { result, depth, codes, successors: succ };
}

let cachedTable = null;
export function getTable() {
  if (!cachedTable) cachedTable = solve();
  return cachedTable;
}

export function lookup(mine, theirs, table = getTable()) {
  const code = encode(mine, theirs);
  return { result: table.result[code], depth: table.depth[code], code };
}

/**
 * 评估当前局面下的每一步（按位置区分），结果从走棋方视角给出：
 * { i, j, next, sum, killed, won, result, depth }
 * depth 为走完这一步之后到终局的总步数（含这一步）。
 */
export function analyzeMoves(mine, theirs, table = getTable()) {
  return legalMoves(mine, theirs).map(([i, j]) => {
    const r = applyMove(mine, theirs, i, j);
    if (r.won) return { i, j, next: r.mine, sum: r.sum, killed: true, won: true, result: WIN, depth: 1 };
    const child = lookup(theirs, r.mine, table);
    return {
      i,
      j,
      next: r.mine,
      sum: r.sum,
      killed: r.killed,
      won: false,
      result: child.result === DRAW ? DRAW : -child.result,
      depth: child.result === DRAW ? -1 : child.depth + 1,
    };
  });
}

/** 走法优劣排序用的分数：越大越好。胜：越快越好；负：越慢越好。 */
export function moveScore(m) {
  if (m.result === WIN) return 1000 - m.depth;
  if (m.result === DRAW) return 0;
  return -1000 + m.depth;
}

export function bestMoves(mine, theirs, table = getTable()) {
  const moves = analyzeMoves(mine, theirs, table);
  const best = Math.max(...moves.map(moveScore));
  return { moves, best: moves.filter((m) => moveScore(m) === best) };
}

/** 从开局出发所有可达局面（走棋方视角的规范编码）。 */
export function reachableFrom(startCode = encode(START, START)) {
  const seen = new Set([startCode]);
  const queue = [startCode];
  for (let head = 0; head < queue.length; head++) {
    for (const ch of successors(queue[head]).children) {
      if (!seen.has(ch)) {
        seen.add(ch);
        queue.push(ch);
      }
    }
  }
  return seen;
}

export function resultText(result) {
  if (result === WIN) return '必胜';
  if (result === LOSS) return '必败';
  return '和棋';
}
