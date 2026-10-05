// 适合人类记忆的“压缩知识”与按层级划分的策略。
// 这些函数只用到：一对一的斐波那契规则（K1）、两手对一手的规则（K2）和往前看一两步，
// 不查完整的求解表，用来证明“人脑可执行的规则”能达到完美下法。

import { applyMove, legalMoves, liveCount, sorted, WIN, DRAW, LOSS } from './game.js';

const UNIT_INVERSE = { 1: 1, 3: 7, 7: 3, 9: 9 };

const single = (pair) => (pair[0] !== 0 ? pair[0] : pair[1]);
const negate = (r) => (r === DRAW ? DRAW : -r);

/** 一对一：走棋方 x，对方 y。像斐波那契数列一样接龙相加，先得到 0（凑满 10）的一方获胜。 */
export function oneVsOne(x, y) {
  if ((x + y) % 10 === 0) return WIN;
  if (x % 5 !== 0 && (x - 2 * y) % 5 === 0) return DRAW; // x ≡ 2y (mod 5)：永远凑不满 10
  let a = x;
  let b = y;
  for (let n = 2; ; n++) {
    const c = (a + b) % 10;
    if (c === 0) return n % 2 === 0 ? WIN : LOSS;
    a = b;
    b = c;
  }
}

/** 一对一时的完整接龙序列（用于教学展示），从走棋方新得到的数开始。 */
export function oneVsOneSequence(x, y, limit = 30) {
  const seq = [];
  let a = x;
  let b = y;
  const seen = new Set();
  for (let n = 0; n < limit; n++) {
    const c = (a + b) % 10;
    seq.push(c);
    if (c === 0) return { seq, loop: false };
    const key = b * 10 + c;
    if (seen.has(key)) return { seq, loop: true };
    seen.add(key);
    a = b;
    b = c;
  }
  return { seq, loop: true };
}

/** 两手对一手例外表：对方单手归一化为 1、2、5 之后，不持有补数时的非和棋局面。 */
export const EXCEPTIONS = {
  1: { 88: LOSS, 44: LOSS, 67: WIN },
  2: { 15: WIN, 33: WIN, 17: LOSS, 67: LOSS, 77: LOSS, 79: LOSS, 99: LOSS },
  5: { 19: LOSS, 28: LOSS, 37: LOSS, 46: LOSS },
};

/** 把对方单手 s 归一化成 1、2 或 5 所需乘的数 u（u ∈ {1,3,7,9}）。 */
export function normalizer(s) {
  if (s === 5) return 1;
  if (s % 2 === 1) return UNIT_INVERSE[s];
  return [1, 3, 7, 9].find((u) => (u * s) % 10 === 2);
}

/**
 * 两手对一手、两手方走棋：我 (a, b) 对 对方单手 s。
 * 返回 { result, reason }，reason 用于教学解释。
 */
export function twoVsOne(a, b, s) {
  const comp = (10 - s) % 10;
  if (a === comp || b === comp) {
    const other = a === comp ? b : a;
    if (other === comp) return { result: LOSS, reason: 'double-complement' };
    return { result: negate(oneVsOne(s, other)), reason: 'forced-kill', other };
  }
  const u = normalizer(s);
  const ns = (u * s) % 10;
  const [p, q] = sorted([(u * a) % 10, (u * b) % 10]);
  const hit = EXCEPTIONS[ns][`${p}${q}`];
  if (hit !== undefined) return { result: hit, reason: 'exception', u, normalized: { s: ns, hands: [p, q] } };
  return { result: DRAW, reason: 'default-draw', u, normalized: { s: ns, hands: [p, q] } };
}

/**
 * 仅用 K1/K2 和浅层推理评估任意局面（走棋方视角）。
 * useExceptions = false 时假装不知道例外表（例外局面一律当和棋），用来衡量例外表的价值。
 */
export function evaluateByRules(mine, theirs, useExceptions = true) {
  const k2 = (a, b, s) => {
    const r = twoVsOne(a, b, s);
    return !useExceptions && r.reason === 'exception' ? DRAW : r.result;
  };
  const m = liveCount(mine);
  const t = liveCount(theirs);
  const outcomes = legalMoves(mine, theirs).map(([i, j]) => applyMove(mine, theirs, i, j));
  if (outcomes.some((r) => r.won)) return WIN;
  if (m === 1 && t === 1) return oneVsOne(single(mine), single(theirs));
  if (m === 2 && t === 1) return k2(mine[0], mine[1], single(theirs));
  if (m === 1 && t === 2) {
    return Math.max(...outcomes.map((r) => negate(k2(theirs[0], theirs[1], single(r.mine)))));
  }
  for (const r of outcomes) {
    if (r.killed && k2(theirs[0], theirs[1], single(r.mine)) === LOSS) return WIN;
  }
  return DRAW;
}

function opponentCanWinNow(theirs, mine) {
  return legalMoves(theirs, mine).some(([i, j]) => applyMove(theirs, mine, i, j).won);
}

export function complementPairs(mine, theirs) {
  const list = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if (mine[i] && theirs[j] && mine[i] + theirs[j] === 10) list.push([i, j]);
    }
  }
  return list;
}

export const RULE_LEVELS = [
  { level: 1, name: '基本功', desc: '能赢就赢；不让对方下一步直接获胜' },
  { level: 2, name: '不留互补对', desc: '在基本功之上：双手对双手时，走完不留“我的手 + 对方的手 = 10”' },
  { level: 3, name: '会算残局', desc: '再加上：一对一按斐波那契接龙推算；对方单手时持有补数必须消' },
  { level: 4, name: '完整规则', desc: '再加上：两手对一手的 11 种例外，等价于完美下法' },
];

/**
 * 按规则层级给每一步打分，返回得分最高的候选走法（按位置区分的 [i, j] 及结果）。
 * 第一关键字是规则能看出的胜负，第二关键字是“不留互补对”等习惯。
 */
export function ruleCandidates(mine, theirs, level) {
  const bothTwo = liveCount(mine) === 2 && liveCount(theirs) === 2;
  const scored = legalMoves(mine, theirs).map(([i, j]) => {
    const r = applyMove(mine, theirs, i, j);
    let value;
    if (r.won) value = 2;
    else if (level >= 3) value = negate(evaluateByRules(theirs, r.mine, level >= 4));
    else value = opponentCanWinNow(theirs, r.mine) ? LOSS : DRAW;
    let habit = 0;
    if (level >= 2 && bothTwo && !r.won) {
      if (!r.killed && complementPairs(r.mine, theirs).length === 0) habit = 2;
      else if (r.killed) habit = 1;
    }
    if (value === WIN && r.killed) habit += 3;
    return { i, j, next: r.mine, won: r.won, killed: r.killed, value, habit };
  });
  const bestValue = Math.max(...scored.map((s) => s.value));
  const top = scored.filter((s) => s.value === bestValue);
  const bestHabit = Math.max(...top.map((s) => s.habit));
  return top.filter((s) => s.habit === bestHabit);
}
