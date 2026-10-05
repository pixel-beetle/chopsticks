// 一盘对局的状态机：浏览器（人机、同屏）与服务器（联机裁判）共用。
// 状态是纯 JSON 对象，可以直接在网络上传输；所有操作都返回新对象，不修改原对象。
//
// 座位 0、1 表示两位玩家，hands[seat] 保留左右位置（下标 0 = 左手，1 = 右手）。

import { applyMove, encode } from './game.js';

export const HAND_NAMES = ['左手', '右手'];
export const REPEAT_LIMIT = 3;

function positionKey(hands, turn) {
  return encode(hands[turn], hands[1 - turn]) * 2 + turn;
}

function validHands(hands) {
  return (
    Array.isArray(hands) &&
    hands.length === 2 &&
    hands.every(
      (h) => Array.isArray(h) && h.length === 2 && h.every((x) => Number.isInteger(x) && x >= 0 && x <= 9) && (h[0] || h[1]),
    )
  );
}

/** 新开一局。默认开局 1,1 对 1,1；也可以从任意局面开始（摆局面）。 */
export function newMatch({ hands = [[1, 1], [1, 1]], turn = 0 } = {}) {
  if (!validHands(hands)) throw new Error('局面不合法：每只手是 0 到 9，并且每人至少有一只手没消掉');
  if (turn !== 0 && turn !== 1) throw new Error('走棋方不合法');
  const h = [[...hands[0]], [...hands[1]]];
  return {
    start: { hands: [[...h[0]], [...h[1]]], turn },
    hands: h,
    turn,
    moves: [],
    seen: { [positionKey(h, turn)]: 1 },
    result: null, // { winner: 0 | 1 | null, reason: 'win' | 'resign' | 'repetition' | 'agreement' }
  };
}

export function isLegal(match, i, j) {
  if (match.result) return false;
  const mine = match.hands[match.turn];
  const theirs = match.hands[1 - match.turn];
  return (i === 0 || i === 1) && (j === 0 || j === 1) && mine[i] !== 0 && theirs[j] !== 0;
}

/** 走棋方用自己的第 i 只手加上对方的第 j 只手。 */
export function playMove(match, i, j) {
  if (match.result) throw new Error('对局已经结束');
  if (!isLegal(match, i, j)) throw new Error('这一步不合法');
  const p = match.turn;
  const mine = match.hands[p];
  const theirs = match.hands[1 - p];
  const r = applyMove(mine, theirs, i, j);
  const hands = p === 0 ? [r.mine, [...theirs]] : [[...theirs], r.mine];
  const move = {
    by: p,
    i,
    j,
    from: mine[i],
    add: theirs[j],
    to: r.mine[i],
    killed: r.killed,
    won: r.won,
    before: { mine: [...mine], theirs: [...theirs] },
  };
  const next = { ...match, hands, turn: 1 - p, moves: [...match.moves, move], seen: { ...match.seen } };
  if (r.won) {
    next.result = { winner: p, reason: 'win' };
    return next;
  }
  const key = positionKey(hands, next.turn);
  next.seen[key] = (next.seen[key] || 0) + 1;
  if (next.seen[key] >= REPEAT_LIMIT) next.result = { winner: null, reason: 'repetition' };
  return next;
}

export function finish(match, result) {
  return { ...match, result };
}

/** 撤回最后 count 步（从起始局面重新走一遍，重复计数也随之恢复）。 */
export function undo(match, count = 1) {
  let m = newMatch(match.start);
  for (const mv of match.moves.slice(0, Math.max(0, match.moves.length - count))) m = playMove(m, mv.i, mv.j);
  return m;
}

export function resultReasonText(result) {
  switch (result?.reason) {
    case 'win':
      return '两只手全部消掉';
    case 'resign':
      return '对方认输';
    case 'repetition':
      return `同一局面第 ${REPEAT_LIMIT} 次出现，判和`;
    case 'agreement':
      return '双方同意和棋';
    case 'leave':
      return '对方离开了房间';
    default:
      return '';
  }
}
