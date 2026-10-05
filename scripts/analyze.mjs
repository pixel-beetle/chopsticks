// 复现文章中的结构性结论：局面计数、分层、不变量、对称性、残局规律、开局陷阱。
// 运行：npm run analyze
import * as G from '../public/js/game.js';
import * as S from '../public/js/strategy.js';

const T = G.solve();
const reach = G.reachableFrom();
const START = G.encode(G.START, G.START);
const lc = G.liveCount;
const fmt = (code) => { const { mine, theirs } = G.decode(code); return `${mine.join('')}|${theirs.join('')}`; };
const zh = (r) => (r === G.WIN ? '胜' : r === G.LOSS ? '负' : '和');
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const title = (s) => console.log(`\n=== ${s} ===`);
const tally = (codes) => {
  const c = { 胜: 0, 负: 0, 和: 0 };
  for (const code of codes) c[zh(T.result[code])]++;
  return c;
};
const layerOf = (code) => { const { mine, theirs } = G.decode(code); return `${lc(mine)}v${lc(theirs)}`; };

title('1. 局面计数与总体胜负');
console.log('全部局面', T.codes.length, tally(T.codes));
console.log('可达局面', reach.size, tally(reach));
console.log('开局 11|11：', zh(T.result[START]));

title('2. 分层（走棋方活手数 v 对方活手数）');
for (const k of ['2v2', '2v1', '1v2', '1v1']) {
  const codes = [...reach].filter((c) => layerOf(c) === k);
  console.log(k, codes.length, tally(codes));
}

title('3. 不变量 gcd(四个数, 10)');
const gOf = (code) => { const { mine, theirs } = G.decode(code); return [...mine, ...theirs].reduce(gcd, 10); };
const byG = {};
for (const code of T.codes) {
  const g = gOf(code);
  byG[g] ??= { total: 0, reachable: 0 };
  byG[g].total++;
  if (reach.has(code)) byG[g].reachable++;
}
console.log(byG);
console.log('gcd=1 但不可达：', T.codes.filter((c) => !reach.has(c) && gOf(c) === 1).map(fmt).join(' '));

title('4. 双手阶段的强连通分量');
{
  const nodes = [...reach].filter((c) => layerOf(c) === '2v2');
  const inLayer = new Set(nodes);
  let index = 0; const idx = new Map(), low = new Map(), on = new Set(), st = [], sccs = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
    for (const w of G.successors(v).children) {
      if (!inLayer.has(w)) continue;
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) { const comp = []; let w; do { w = st.pop(); on.delete(w); comp.push(w); } while (w !== v); sccs.push(comp); }
  };
  for (const v of nodes) if (!idx.has(v)) strong(v);
  sccs.sort((a, b) => b.length - a.length);
  console.log('双手对双手可达局面', nodes.length, '最大强连通分量', sccs[0].length, '其余', sccs.slice(1).map((c) => c.map(fmt).join(',')).join(' '));
}

title('5. 乘以 3、7、9 的对称性');
{
  const mul = (code, u) => { const { mine, theirs } = G.decode(code); return G.encode(mine.map((x) => (x * u) % 10), theirs.map((x) => (x * u) % 10)); };
  let ok = true;
  for (const code of T.codes) for (const u of [3, 7, 9]) if (T.result[mul(code, u)] !== T.result[code] || T.depth[mul(code, u)] !== T.depth[code]) ok = false;
  const seen = new Set(); let orbits = 0;
  for (const code of reach) { if (seen.has(code)) continue; orbits++; for (const u of [1, 3, 7, 9]) seen.add(mul(code, u)); }
  console.log('胜负与步数在乘法下不变：', ok, '  可达局面的对称类数：', orbits);
}

title('6. 一对一：斐波那契接龙');
{
  let ok = true;
  console.log('我\\对方 ' + [1, 2, 3, 4, 5, 6, 7, 8, 9].join('     '));
  for (let x = 1; x <= 9; x++) {
    let line = `  ${x}    `;
    for (let y = 1; y <= 9; y++) {
      const code = G.encode([0, x], [0, y]);
      const r = T.result[code];
      if (S.oneVsOne(x, y) !== r) ok = false;
      line += (zh(r) + (r ? T.depth[code] : '')).padEnd(6);
    }
    console.log(line);
  }
  console.log('接龙规则与“x ≡ 2y (mod 5) 为和棋”与求解结果一致：', ok);
  console.log('从 1、1 开始：', S.oneVsOneSequence(1, 1).seq.join(','), '  从 2、1 开始：', S.oneVsOneSequence(2, 1).seq.join(','), '(循环)');
}

title('7. 两手对一手：补数强制消 + 11 种例外');
{
  let mism = 0, nonForced = 0, nonForcedDecisive = 0;
  for (const code of reach) {
    if (layerOf(code) !== '2v1') continue;
    const { mine, theirs } = G.decode(code);
    const k = S.twoVsOne(mine[0], mine[1], theirs[1]);
    if (k.result !== T.result[code]) mism++;
    if (k.reason === 'exception' || k.reason === 'default-draw') { nonForced++; if (k.result !== G.DRAW) nonForcedDecisive++; }
  }
  console.log('规则与求解不一致的局面数：', mism, `  不持有补数的局面 ${nonForced} 个，其中非和棋 ${nonForcedDecisive} 个`);
  for (let s = 1; s <= 9; s++) {
    const exc = [], forced = [];
    for (let a = 1; a <= 9; a++) for (let b = a; b <= 9; b++) {
      const code = G.encode([a, b], [0, s]);
      if (!reach.has(code)) continue;
      const k = S.twoVsOne(a, b, s);
      if (k.reason === 'exception') exc.push(`${a}${b}${zh(k.result)}${T.depth[code]}`);
      if (k.reason === 'forced-kill' && a !== b) forced.push(`${k.other}${zh(k.result)}`);
    }
    console.log(`对方单手 ${s}（补数 ${10 - s}，乘 ${S.normalizer(s)}）例外：${exc.join(' ')}  | 消掉补数后剩下的手：${forced.join(' ')}`);
  }
  const lost1v2 = [...reach].filter((c) => layerOf(c) === '1v2' && T.result[c] === G.LOSS).map(fmt);
  console.log('单手方走棋的必败局面：', lost1v2.join(' '));
}

title('8. 双手对双手');
{
  const all22L = T.codes.filter((c) => layerOf(c) === '2v2' && T.result[c] === G.LOSS).length;
  console.log('双手对双手走棋方必败的局面（含不可达）：', all22L);
  let safeMoves = 0, safeLosing = 0, withSafe = 0, offered = 0, forcedPair = 0, offeredKillSafe = 0;
  for (const code of reach) {
    if (layerOf(code) !== '2v2') continue;
    const { mine, theirs } = G.decode(code);
    const moves = G.analyzeMoves(mine, theirs, T);
    const safe = moves.filter((m) => !m.killed && S.complementPairs(m.next, theirs).length === 0);
    safeMoves += safe.length;
    safeLosing += safe.filter((m) => m.result === G.LOSS).length;
    if (safe.length) { withSafe++; continue; }
    if (S.complementPairs(mine, theirs).length) {
      offered++;
      if (moves.filter((m) => m.killed).every((m) => m.result !== G.LOSS)) offeredKillSafe++;
    } else forcedPair++;
  }
  console.log(`“不留互补对”的走法 ${safeMoves} 次，其中输棋 ${safeLosing} 次；有安全步的局面 ${withSafe} 个`);
  console.log(`没有安全步：对方已留互补对 ${offered} 个（其中任何消手都安全的 ${offeredKillSafe} 个），怎么走都形成互补对 ${forcedPair} 个`);
}

title('9. 规则（不查表）与完整求解是否完全一致');
{
  let mism = 0;
  for (const code of reach) { const { mine, theirs } = G.decode(code); if (S.evaluateByRules(mine, theirs) !== T.result[code]) mism++; }
  console.log('不一致的可达局面数：', mism);
}

title('10. 开局：最早可能出现败着的局面');
{
  const prev = new Map([[START, null]]);
  const q = [START];
  const dist = new Map([[START, 0]]);
  let firstDepth = null;
  for (let h = 0; h < q.length; h++) {
    const code = q[h];
    const d = dist.get(code);
    if (firstDepth !== null && d > firstDepth) break;
    const { mine, theirs } = G.decode(code);
    const bad = G.analyzeMoves(mine, theirs, T).filter((m) => m.result === G.LOSS);
    if (T.result[code] === G.DRAW && bad.length) {
      firstDepth = d;
      const line = []; let c = code; while (c !== null) { line.unshift(fmt(c)); c = prev.get(c); }
      console.log(`已走 ${d} 步：${line.join(' → ')}  败着：${bad.map((m) => m.next.join('')).join(',')}`);
    }
    for (const ch of G.successors(code).children) if (!prev.has(ch)) { prev.set(ch, code); dist.set(ch, d + 1); q.push(ch); }
  }
  const pv = (mine, theirs) => {
    const out = []; let me = mine, op = theirs;
    for (let k = 0; k < 30; k++) {
      const m = G.bestMoves(me, op, T).best[0];
      out.push(m.next.filter(Boolean).join('、') + (m.won ? '（赢）' : m.killed ? '（消）' : ''));
      if (m.won) break;
      [me, op] = [op, m.next];
    }
    return out.join(' → ');
  };
  console.log('败着 15|23 → 17 之后对方的最优路线：', pv([2, 3], [1, 7]));
  const deepest = Math.max(...[...reach].map((c) => T.depth[c]));
  console.log('可达局面中最长的最优对局步数：', deepest);
}
