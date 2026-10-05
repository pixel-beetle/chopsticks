// 复现文章中的策略检验：各层人类策略是否会走败着、能否兑现胜局、两两对战结果、设陷阱的效果。
// 运行：npm run lab
import * as G from '../public/js/game.js';
import * as S from '../public/js/strategy.js';
import { trapScore } from '../public/js/ai.js';

const T = G.solve();
const START = G.encode(G.START, G.START);
const reach = G.reachableFrom();

const asMoves = (theirs, list) => list.map((m) => ({ won: m.won, child: m.won ? null : G.encode(theirs, m.next) }));
const allMoves = (mine, theirs) =>
  G.legalMoves(mine, theirs).map(([i, j]) => {
    const r = G.applyMove(mine, theirs, i, j);
    return { won: r.won, child: r.won ? null : G.encode(theirs, r.mine) };
  });

// 往前看 k 步的蛮力搜索（一对一按接龙规则精确计算），对照“结构性知识”的价值
function searchPolicy(k) {
  const memo = new Map();
  const value = (code, depth) => {
    const key = code * 16 + depth;
    if (memo.has(key)) return memo.get(key);
    const { mine, theirs } = G.decode(code);
    let v;
    const ms = allMoves(mine, theirs);
    if (ms.some((m) => m.won)) v = 1;
    else if (G.liveCount(mine) === 1 && G.liveCount(theirs) === 1) v = S.oneVsOne(mine[1], theirs[1]);
    else if (depth === 0) v = 0;
    else v = Math.max(...ms.map((m) => -value(m.child, depth - 1)));
    memo.set(key, v);
    return v;
  };
  return (mine, theirs) => {
    const scored = allMoves(mine, theirs).map((m) => ({ m, v: m.won ? 2 : -value(m.child, k - 1) }));
    const best = Math.max(...scored.map((s) => s.v));
    return scored.filter((s) => s.v === best).map((s) => s.m);
  };
}
const rules = (level) => (mine, theirs) => asMoves(theirs, S.ruleCandidates(mine, theirs, level));
const perfect = (mine, theirs) => asMoves(theirs, G.bestMoves(mine, theirs, T).best);
const trap = (model) => (mine, theirs) => {
  const { best } = G.bestMoves(mine, theirs, T);
  if (best[0].result !== G.DRAW) return asMoves(theirs, best);
  const scored = best.map((m) => ({ m, s: trapScore(theirs, m.next, model, T) }));
  const top = Math.max(...scored.map((x) => x.s));
  return asMoves(theirs, scored.filter((x) => x.s === top).map((x) => x.m));
};

const policies = {
  随手: allMoves,
  第一层: rules(1),
  第二层: rules(2),
  第三层: rules(3),
  第四层: rules(4),
  往前算2步: searchPolicy(2),
  往前算4步: searchPolicy(4),
  往前算6步: searchPolicy(6),
  完美: perfect,
};

// 在“对手可以任意下”的前提下，枚举该策略可能遇到的所有局面，统计它可能走出败着/错过赢棋的局面数
function soundness(policy) {
  const seen = new Set();
  const stack = [[START, true], [START, false]];
  let losing = 0, missed = 0, turns = 0;
  while (stack.length) {
    const [code, mineTurn] = stack.pop();
    const key = code * 2 + (mineTurn ? 1 : 0);
    if (seen.has(key)) continue;
    seen.add(key);
    const { mine, theirs } = G.decode(code);
    if (mineTurn) {
      turns++;
      const r = T.result[code];
      let lose = false, miss = false;
      for (const m of policy(mine, theirs)) {
        const after = m.won ? 1 : -T.result[m.child];
        if (after === -1 && r !== -1) lose = true;
        if (r === 1 && after === 0) miss = true;
        if (!m.won) stack.push([m.child, false]);
      }
      losing += lose; missed += miss;
    } else for (const m of allMoves(mine, theirs)) if (!m.won) stack.push([m.child, true]);
  }
  return { 遇到的局面: turns, 可能走败着: losing, 可能错过赢棋: missed };
}
console.log('=== 1. 策略可靠性（对手任意下）===');
for (const [name, p] of Object.entries(policies)) console.log(name.padEnd(6, '　'), JSON.stringify(soundness(p)));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function play(pA, pB, rng, start = START, maxPlies = 400) {
  let code = start, turn = 0;
  const seen = new Map();
  for (let ply = 0; ply < maxPlies; ply++) {
    const k = code * 2 + turn;
    const rep = (seen.get(k) || 0) + 1;
    seen.set(k, rep);
    if (rep >= 3) return 0;
    const { mine, theirs } = G.decode(code);
    const ms = (turn === 0 ? pA : pB)(mine, theirs);
    const m = ms[Math.floor(rng() * ms.length)];
    if (m.won) return turn === 0 ? 1 : -1;
    code = m.child;
    turn ^= 1;
  }
  return 0;
}

console.log('\n=== 2. 第四层（只用规则）能否兑现所有胜局 ===');
{
  let won = 0, total = 0;
  const rng = mulberry32(7);
  for (const code of reach) {
    if (T.result[code] !== G.WIN) continue;
    for (let k = 0; k < 5; k++) { total++; if (play(policies.第四层, perfect, rng, code) === 1) won++; }
  }
  console.log(`从必胜局面出发对抗完美防守：${won}/${total} 盘获胜`);
}

function matchup(pa, pb, n, seed) {
  const rng = mulberry32(seed);
  let w = 0, d = 0, l = 0;
  for (let k = 0; k < n; k++) {
    const r = k % 2 === 0 ? play(pa, pb, rng) : -play(pb, pa, rng);
    if (r > 0) w++; else if (r < 0) l++; else d++;
  }
  const pct = (x) => Math.round((100 * x) / n);
  return `${pct(w)}/${pct(d)}/${pct(l)}`;
}
console.log('\n=== 3. 对战（行玩家 胜/和/负 %，先后手各半，每组 4000 盘）===');
const rows = ['随手', '第一层', '第二层', '第三层', '第四层', '完美'];
const cols = ['随手', '第一层', '第二层', '第三层', '第四层', '完美'];
console.log('        ' + cols.map((c) => c.padStart(10, '　')).join(''));
for (const a of rows) console.log(a.padEnd(4, '　') + cols.map((b) => matchup(policies[a], policies[b], 4000, 99).padStart(13)).join(''));

console.log('\n=== 4. 设陷阱（保证不输的前提下，专挑对手最容易走错的着法；每组 3000 盘）===');
for (const [label, model] of [['按第二层建模', 2], ['按第三层建模', 3]]) {
  const p = trap(model);
  console.log(label, ' 对随手', matchup(p, allMoves, 3000, 5), ' 对第二层', matchup(p, policies.第二层, 3000, 5), ' 对第三层', matchup(p, policies.第三层, 3000, 5));
}
console.log('对照：完美（不设陷阱）', ' 对第二层', matchup(perfect, policies.第二层, 3000, 5), ' 对第三层', matchup(perfect, policies.第三层, 3000, 5));
