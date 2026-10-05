// 把求解结果和“人类规则”翻译成讲解文字：走法提示、局面解读、练习题解析、复盘都用它。
// 讲解只用文章里的人类规则（一对一接龙、两手对一手的补数与例外表、互补对），
// 结论和穷举求解完全一致（见 scripts/analyze.mjs 第 9 节与本文件的自检）。
//
// 输出的 HTML 片段只包含程序生成的数字和固定文字，不含用户输入。

import { analyzeMoves, applyMove, encode, getTable, legalMoves, liveCount, lookup, moveScore, reachableFrom, WIN, LOSS, DRAW } from './game.js';
import { complementPairs, oneVsOne, oneVsOneSequence, twoVsOne } from './strategy.js';

const single = (pair) => (pair[0] !== 0 ? pair[0] : pair[1]);
const neg = (r) => (r === DRAW ? DRAW : -r);
const uniq = (list) => [...new Set(list)];
const uniqueBy = (list, key) => list.filter((x, k) => list.findIndex((y) => key(y) === key(x)) === k);

export const R_TEXT = { [WIN]: '胜', [LOSS]: '负', [DRAW]: '和' };
export const R_CLASS = { [WIN]: 'win', [LOSS]: 'loss', [DRAW]: 'draw' };

const res = (r) => `<b class="r-${R_CLASS[r]}">${R_TEXT[r]}</b>`;

export function stageOf(mine, theirs) {
  const m = liveCount(mine);
  const t = liveCount(theirs);
  if (m === 2 && t === 2) return { id: '2v2', name: '双手对双手' };
  if (m === 2) return { id: '2v1', name: '两手对一手' };
  if (t === 2) return { id: '1v2', name: '一手对两手' };
  return { id: '1v1', name: '一对一' };
}

let reachSet = null;
export function isReachable(mine, theirs) {
  reachSet ??= reachableFrom();
  return reachSet.has(encode(mine, theirs));
}

/** “必胜（还剩 5 步）”这类完整说法。depth 为双方合计的剩余步数。 */
export function evalText(result, depth) {
  if (result === WIN) return `必胜（最快还剩 ${depth} 步）`;
  if (result === LOSS) return `必败（最多还能撑 ${depth} 步）`;
  return '和棋（双方都下对的话谁也赢不了）';
}

export function badgeText(result, depth) {
  return result === DRAW ? '和' : `${R_TEXT[result]}${depth}`;
}

function sequenceHtml(seq, loop) {
  const shown = loop ? seq.slice(0, 12) : seq;
  const items = shown.map((v, k) => `<i class="${k % 2 === 0 ? 's-a' : 's-b'}">${v}</i>`).join('');
  return `<span class="seq">${items}${loop ? '<i class="s-more">…</i>' : ''}</span>`;
}

/** 一对一：A 持 x、B 持 y，A 先走。 */
export function oneVsOneStory(x, y, who = ['你', '对方']) {
  const [A, B] = who;
  const result = oneVsOne(x, y);
  if ((x + y) % 10 === 0) return { result, html: `${A}的 ${x} + ${B}的 ${y} = 10，${A}直接凑十获胜。` };
  const { seq, loop } = oneVsOneSequence(x, y);
  if (result === DRAW) {
    return {
      result,
      html: `一对一接龙（${A}先写）：${sequenceHtml(seq, true)} ${x} ≡ 2 × ${y}（模 5），数列永远出现不了 0，${res(DRAW)}。`,
    };
  }
  const writer = (seq.length - 1) % 2 === 0 ? A : B;
  return {
    result,
    html: `一对一接龙（${A}先写，两人轮流写下前两个数之和的个位）：${sequenceHtml(seq, false)} 第 ${seq.length} 个数 0 由${writer}写出，${writer}赢。`,
  };
}

function normalizedText(k, a, b, s) {
  const { u, normalized } = k;
  const label = `“单手 ${normalized.s}、两手 ${normalized.hands.join('、')}”`;
  if (u === 1) return `单手已经是 ${s}，不用归一化，查${label}`;
  return `乘以 ${u} 归一化（只看个位）：${s} → ${normalized.s}，${a}、${b} → ${normalized.hands.join('、')}，即${label}`;
}

/** 两手对一手：A 有两只手 a、b，B 只剩一只手 s，A 先走。 */
export function twoVsOneStory(a, b, s, who = ['你', '对方']) {
  const [A, B] = who;
  const k = twoVsOne(a, b, s);
  const comp = 10 - s;
  switch (k.reason) {
    case 'double-complement':
      return {
        result: k.result,
        html: `${A}两只手都是 ${comp}，正好是${B}单手 ${s} 的补数：消掉一只，另一只还是补数，${B}下一步凑十获胜。${A}${res(LOSS)}。`,
      };
    case 'forced-kill': {
      const st = oneVsOneStory(s, k.other, [B, A]);
      return {
        result: k.result,
        html: `${A}手里的 ${comp} 是${B}单手 ${s} 的补数，必须马上消掉，否则${B}下一步就凑十获胜。消掉后剩${A} ${k.other} 对${B} ${s}，${B}先走。${st.html}`,
      };
    }
    case 'exception':
      return {
        result: k.result,
        html: `${A}手里没有补数 ${comp}。${normalizedText(k, a, b, s)}，在例外表中：两手方${res(k.result)}。`,
      };
    default:
      return {
        result: DRAW,
        html: `${A}手里没有补数 ${comp}。${normalizedText(k, a, b, s)}，不在例外表中，所以是${res(DRAW)}。`,
      };
  }
}

/** twoVsOneStory 的一句话版本，用在“往前想两步”的分支里。A 是两手方，B 是单手方。 */
function twoVsOneShort(a, b, s, [A, B]) {
  const k = twoVsOne(a, b, s);
  const comp = 10 - s;
  if (k.reason === 'double-complement') return `${A}两只手都是补数 ${comp}`;
  if (k.reason === 'forced-kill') return `${A}手里有补数 ${comp}，必须消掉，之后一对一：${B}的 ${s} 先走，${A}剩 ${k.other}`;
  const norm = `“单手 ${k.normalized.s}、两手 ${k.normalized.hands.join('、')}”`;
  return k.reason === 'exception' ? `归一化后是${norm}，在例外表中` : `归一化后是${norm}，不在例外表中`;
}

function moveHeadline(mine, theirs, i, j) {
  const x = mine[i];
  const y = theirs[j];
  const sum = x + y;
  if (sum === 10) return `${x} + ${y} = 10，消掉这只手`;
  if (sum > 10) return `${x} + ${y} = ${sum}，留个位 ${sum % 10}`;
  return `${x} + ${y} = ${sum}`;
}

/**
 * 解释一步棋：A 用自己第 i 只手加 B 的第 j 只手。
 * 返回 { result: 规则推出的结果（A 的视角）, headline, html }。
 */
export function moveStory(mine, theirs, i, j, who = ['你', '对方']) {
  const [A, B] = who;
  const r = applyMove(mine, theirs, i, j);
  const after = r.mine;
  const headline = moveHeadline(mine, theirs, i, j);
  if (r.won) return { result: WIN, headline: `${headline}，两只手全部消掉`, html: `${A}直接获胜。` };

  const m = liveCount(mine);
  const t = liveCount(theirs);

  if (m === 1 && t === 1) {
    const st = oneVsOneStory(single(theirs), after[i], [B, A]);
    return { result: neg(st.result), headline, html: st.html };
  }

  if (m === 1 && t === 2) {
    const st = twoVsOneStory(theirs[0], theirs[1], after[i], [B, A]);
    return { result: neg(st.result), headline, html: `${A}变成 ${after[i]}，轮到${B}两手对一手：${st.html}` };
  }

  if (m === 2 && t === 1) {
    const s = single(theirs);
    const comp = 10 - s;
    if (r.killed) {
      const st = oneVsOneStory(s, single(after), [B, A]);
      return { result: neg(st.result), headline, html: `消掉补数后进入一对一，${B}先走。${st.html}` };
    }
    if (after.includes(comp)) {
      const why = after[i] === comp ? `${A}自己凑出了 ${comp}` : `${A}没有消掉手里的 ${comp}`;
      return { result: LOSS, headline, html: `${why}，它是${B}单手 ${s} 的补数，${B}下一步凑十获胜。${A}${res(LOSS)}。` };
    }
    const branches = uniq(after).map((v) => {
      const s2 = (s + v) % 10;
      const k = twoVsOne(after[0], after[1], s2);
      return { v, s2, result: k.result, text: twoVsOneShort(after[0], after[1], s2, [A, B]) };
    });
    const result = Math.min(...branches.map((x) => x.result));
    const lines = branches.map((x) => `${B}加 ${x.v} 变成 ${x.s2}：${x.text}，${A}${res(x.result)}`).join('；');
    return { result, headline, html: `${B}只有一只手 ${s}，有这些回应——${lines}。${B}会挑对${A}最不利的。` };
  }

  // 双手对双手
  if (r.killed) {
    const st = twoVsOneStory(theirs[0], theirs[1], single(after), [B, A]);
    const result = neg(st.result);
    const verdict =
      result === WIN ? `这正是双手阶段的赢法。` : result === LOSS ? `这是一个<b>贪消陷阱</b>：消手反而输了。` : '';
    return { result, headline, html: `消掉一只手后，${B}两手对${A}一手、${B}先走：${st.html} ${verdict}` };
  }
  const pairs = complementPairs(after, theirs);
  if (pairs.length === 0) {
    return {
      result: DRAW,
      headline,
      html: `走完盘面上没有互补对：${B}这一步消不了手，轮到${A}时还是双手对双手，${A}不会必败。<b>这一步绝对安全。</b>`,
    };
  }
  const branches = uniqueBy(pairs, ([, pj]) => theirs[pj]).map(([pi, pj]) => {
    const rest = theirs[1 - pj];
    const k = twoVsOne(after[0], after[1], rest);
    return { pi, pj, rest, result: k.result, text: twoVsOneShort(after[0], after[1], rest, [A, B]) };
  });
  const result = branches.some((x) => x.result === LOSS) ? LOSS : DRAW;
  const lines = branches
    .map((x) => `${B}用${A}的 ${after[x.pi]} 消掉自己的 ${theirs[x.pj]}、只剩 ${x.rest}，轮到${A}两手对一手：${x.text}，${A}${res(x.result)}`)
    .join('；');
  return {
    result,
    headline,
    html: `留下了互补对（${uniq(pairs.map(([pi, pj]) => `${after[pi]} + ${theirs[pj]}`)).join('、')} = 10），${B}可以消手。${lines}。`,
  };
}

/** 局面解读：站在走棋方 A 的角度说明这个局面靠哪条规则判断。 */
export function positionStory(mine, theirs, who = ['你', '对方']) {
  const [A, B] = who;
  const stage = stageOf(mine, theirs);
  const winNow = legalMoves(mine, theirs).find(([i, j]) => applyMove(mine, theirs, i, j).won);
  if (winNow) {
    return { stage, html: `${A}只剩一只手 ${mine[winNow[0]]}，加上${B}的 ${theirs[winNow[1]]} 正好凑满 10，直接获胜。` };
  }
  if (stage.id === '1v1') return { stage, html: oneVsOneStory(single(mine), single(theirs), who).html };
  if (stage.id === '2v1') return { stage, html: twoVsOneStory(mine[0], mine[1], single(theirs), who).html };
  if (stage.id === '1v2') {
    const x = single(mine);
    const lines = uniq(theirs.filter(Boolean)).map((y) => {
      const t = (x + y) % 10;
      const k = twoVsOne(theirs[0], theirs[1], t);
      return `加 ${y} 变成 ${t}：${twoVsOneShort(theirs[0], theirs[1], t, [B, A])}，${A}${res(neg(k.result))}`;
    });
    return { stage, html: `${A}只剩一只手，走完后${B}两手对一手、${B}先走。${lines.join('；')}。` };
  }
  const pairs = complementPairs(mine, theirs);
  const moves = legalMoves(mine, theirs).map(([i, j]) => ({ i, j, r: applyMove(mine, theirs, i, j) }));
  const safe = uniq(moves.filter((mv) => !mv.r.killed && complementPairs(mv.r.mine, theirs).length === 0).map((mv) => `${mine[mv.i]}+${theirs[mv.j]}`));
  const parts = [`双手对双手：走棋方永远不会必败，唯一的赢法是在对的时机消手。`];
  if (pairs.length) {
    const kills = uniqueBy(pairs, ([pi]) => mine[pi]).map(([pi, pj]) => {
      const left = mine[1 - pi];
      const k = twoVsOne(theirs[0], theirs[1], left);
      return `消掉 ${mine[pi]}（加${B}的 ${theirs[pj]}）后剩 ${left}，${B}先走：${twoVsOneShort(theirs[0], theirs[1], left, [B, A])}，${A}${res(neg(k.result))}`;
    });
    parts.push(`盘面上有互补对，${A}可以消手——${kills.join('；')}。`);
  }
  parts.push(
    safe.length
      ? `不留互补对的安全走法：${safe.join('、')}。`
      : `没有不留互补对的走法，需要往前想两步，比较“消手”和“留对”的后果。`,
  );
  return { stage, html: parts.join('') };
}

/** 当前局面全部走法（按位置区分）的完美评估 + 规则讲解，按优劣排序，并对结果相同的重复走法去重。 */
export function hintList(mine, theirs, who = ['你', '对方'], table = getTable()) {
  const seen = new Set();
  const list = [];
  for (const mv of analyzeMoves(mine, theirs, table)) {
    const key = `${mine[mv.i]}+${theirs[mv.j]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const story = moveStory(mine, theirs, mv.i, mv.j, who);
    list.push({ ...mv, key, score: moveScore(mv), story });
  }
  return list.sort((a, b) => b.score - a.score);
}

/** 复盘：标出每一步是败着、错失胜机还是正常。 */
export function reviewMatch(match, table = getTable()) {
  return match.moves.map((mv, k) => {
    const { mine, theirs } = mv.before;
    const before = lookup(mine, theirs, table);
    const moves = analyzeMoves(mine, theirs, table);
    const played = moves.find((x) => x.i === mv.i && x.j === mv.j);
    const bestScore = Math.max(...moves.map(moveScore));
    const seen = new Set();
    const best = moves
      .filter((x) => moveScore(x) === bestScore)
      .filter((x) => {
        const key = `${mine[x.i]}+${theirs[x.j]}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    let tag = 'ok';
    if (before.result === WIN && played.result === LOSS) tag = 'blunder';
    else if (before.result === WIN && played.result === DRAW) tag = 'miss';
    else if (before.result === DRAW && played.result === LOSS) tag = 'blunder';
    else if (before.result === WIN && played.result === WIN) tag = 'keep';
    return { k, mv, before, played, best, tag, bestScore, isBest: moveScore(played) === bestScore };
  });
}

export const TAG_TEXT = { blunder: '败着', miss: '错失胜机', keep: '', ok: '' };
