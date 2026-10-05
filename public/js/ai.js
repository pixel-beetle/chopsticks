// 电脑对手：各难度共用同一套规则引擎与求解表。
import { analyzeMoves, encode, getTable, moveScore, DRAW, WIN } from './game.js';
import { ruleCandidates } from './strategy.js';

export const AI_LEVELS = [
  { id: 'beginner', name: '入门', desc: '只会基本功：能赢就赢，不送对方直接获胜', rule: 1 },
  { id: 'casual', name: '进阶', desc: '基本功 + 双手阶段不留互补对', rule: 2 },
  { id: 'advanced', name: '高手', desc: '再加上会算残局，但不知道两手对一手的例外表', rule: 3 },
  { id: 'perfect', name: '完美', desc: '穷举最优：永远不输，你一失误就赢', perfect: true },
  { id: 'trapper', name: '陷阱大师', desc: '同样完美，并且专挑你最容易走错的着法', perfect: true, trapModel: 2 },
];

/**
 * 对方（oppHands）走棋、我（myHands）刚走完时，按第 modelLevel 层规则建模的对手走出败着的概率。
 */
export function trapScore(oppHands, myHands, modelLevel, table = getTable()) {
  if (table.result[encode(oppHands, myHands)] !== DRAW) return 0;
  const cands = ruleCandidates(oppHands, myHands, modelLevel);
  const losing = cands.filter((m) => !m.won && table.result[encode(myHands, m.next)] === WIN).length;
  return losing / cands.length;
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/** 返回电脑的一步 { i, j }：用自己的第 i 只手加对方的第 j 只手。 */
export function chooseMove(levelId, mine, theirs, rng = Math.random, table = getTable()) {
  const level = AI_LEVELS.find((l) => l.id === levelId) ?? AI_LEVELS[3];
  if (!level.perfect) {
    const m = pick(ruleCandidates(mine, theirs, level.rule), rng);
    return { i: m.i, j: m.j };
  }
  const moves = analyzeMoves(mine, theirs, table);
  const best = Math.max(...moves.map(moveScore));
  let top = moves.filter((m) => moveScore(m) === best);
  if (level.trapModel && top[0].result === DRAW) {
    const scored = top.map((m) => ({ m, s: trapScore(theirs, m.next, level.trapModel, table) }));
    const maxS = Math.max(...scored.map((x) => x.s));
    top = scored.filter((x) => x.s === maxS).map((x) => x.m);
  }
  const m = pick(top, rng);
  return { i: m.i, j: m.j };
}
