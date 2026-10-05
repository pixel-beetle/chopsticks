// 练习题：从全部可达局面中抽题，答完给出规则讲解。
import { analyzeMoves, decode, getTable, reachableFrom, WIN, LOSS, DRAW } from './game.js';
import { twoVsOne } from './strategy.js';
import { newMatch } from './match.js';
import { createBoard } from './board.js';
import { R_CLASS, R_TEXT, badgeText, evalText, hintList, moveStory, oneVsOneStory, stageOf, twoVsOneStory } from './explain.js';
import { $, $$, store } from './ui.js';

const DRILLS = [
  {
    id: 'v11',
    name: '一对一接龙',
    kind: 'judge',
    prompt: '双方都只剩一只手，轮到你（下方）走。你的结果是？',
    tip: '每个新数是前两个数之和的个位，两人轮流写，先写出 0 的人赢——这就是斐波那契数列。“我 ≡ 2 × 对方（模 5）”时永远写不出 0，是和棋。',
  },
  {
    id: 'v21',
    name: '两手对一手',
    kind: 'judge',
    prompt: '你（下方）两只手，对方只剩一只手，轮到你走。你的结果是？',
    tip: '先看手里有没有对方单手的补数（10 − s）：有就必须马上消，然后一对一接龙；没有就把三个数乘以 u 归一化，查 11 种例外，不在表里就是和棋。',
  },
  {
    id: 'trap',
    name: '贪消陷阱',
    kind: 'judge',
    prompt: '你可以走下面这步消手。走完之后，你的结果是？',
    tip: '互补对是双向的。消完之后，对方变成两手对你一手、对方先走：用两手对一手的规则判断对方是必败（好消）、和棋，还是必胜（陷阱）。',
  },
  {
    id: 'safe',
    name: '找不输的一步',
    kind: 'move',
    prompt: '双手对双手，有的走法会输。走一步不会输的棋（先点自己的手，再点对方的手）。',
    tip: '走完不留互补对的棋一定安全；如果做不到，比较“自己消手”和“留下互补对”两种结果。',
  },
  {
    id: 'win',
    name: '找出赢棋',
    kind: 'move',
    prompt: '这个局面你必胜。找出保持胜势的一步（先点自己的手，再点对方的手）。',
    tip: '双手阶段只能靠在对的时机消手取胜；残局用接龙和例外表推算。',
  },
];

const MIX = { id: 'mix', name: '综合', prompt: '', tip: '五类题目随机出现。' };
const ANSWERS = [
  [WIN, '胜', '1'],
  [DRAW, '和', '2'],
  [LOSS, '负', '3'],
];

const single = (pair) => (pair[0] !== 0 ? pair[0] : pair[1]);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let pools = null;
function buildPools() {
  const T = getTable();
  const p = { v11: [], v21hot: [], v21: [], trap: { [WIN]: [], [DRAW]: [], [LOSS]: [] }, safe: [], win: [] };
  for (const code of reachableFrom()) {
    const { mine, theirs } = decode(code);
    const stage = stageOf(mine, theirs).id;
    const r = T.result[code];
    const moves = analyzeMoves(mine, theirs, T);
    const immediate = moves.some((m) => m.won);
    if (stage === '1v1' && !immediate) p.v11.push(code);
    if (stage === '2v1') {
      const k = twoVsOne(mine[0], mine[1], single(theirs));
      (r !== DRAW || k.reason === 'forced-kill' ? p.v21hot : p.v21).push(code);
    }
    if (stage === '2v2') {
      for (const m of moves) if (m.killed) p.trap[m.result].push({ code, i: m.i, j: m.j, depth: m.depth });
      if (r === DRAW && moves.some((m) => m.result === LOSS)) p.safe.push(code);
    }
    if (r === WIN && !immediate && moves.some((m) => m.result !== WIN)) p.win.push(code);
  }
  return p;
}

function makeQuestion(type) {
  pools ??= buildPools();
  const T = getTable();
  if (type === 'mix') type = pick(DRILLS).id;
  const q = { type };
  let code;
  if (type === 'v11') code = pick(pools.v11);
  else if (type === 'v21') code = Math.random() < 0.65 ? pick(pools.v21hot) : pick(pools.v21);
  else if (type === 'trap') {
    const bucket = pick([WIN, DRAW, LOSS].filter((r) => pools.trap[r].length));
    const t = pick(pools.trap[bucket]);
    code = t.code;
    q.kill = { i: t.i, j: t.j };
    q.answer = bucket;
    q.depth = t.depth;
  } else code = pick(pools[type]);
  const { mine, theirs } = decode(code);
  // 随机交换左右手，让题目看起来不总是“小数在左”
  q.mine = Math.random() < 0.5 ? mine : [mine[1], mine[0]];
  q.theirs = Math.random() < 0.5 ? theirs : [theirs[1], theirs[0]];
  if (q.kill) {
    const a = mine[q.kill.i];
    const b = theirs[q.kill.j];
    q.kill = { i: q.mine.indexOf(a), j: q.theirs.indexOf(b) };
  }
  if (q.answer === undefined) {
    q.answer = T.result[code];
    q.depth = T.depth[code];
  }
  return q;
}

const statsKey = 'drillStats';
function loadStats() {
  return store.get(statsKey, {});
}
function bump(type, ok) {
  const all = loadStats();
  const s = all[type] ?? { right: 0, total: 0, streak: 0, best: 0 };
  s.total++;
  if (ok) {
    s.right++;
    s.streak++;
    s.best = Math.max(s.best, s.streak);
  } else s.streak = 0;
  all[type] = s;
  store.set(statsKey, all);
}

let root;
let board;
let mode = store.get('drillMode', 'mix');
let q = null;
let answered = null;

function drillOf(type) {
  return DRILLS.find((d) => d.id === type);
}

function next() {
  q = makeQuestion(mode);
  answered = null;
  board.reset();
  render();
}

function judge(value) {
  if (answered || drillOf(q.type).kind !== 'judge') return;
  answered = { value, ok: value === q.answer };
  bump(mode, answered.ok);
  render();
}

function onMove(i, j) {
  if (answered) return;
  const moves = analyzeMoves(q.mine, q.theirs);
  const m = moves.find((x) => x.i === i && x.j === j);
  const ok = q.type === 'safe' ? m.result !== LOSS : m.result === WIN;
  answered = { move: m, ok };
  bump(mode, ok);
  render();
}

function explanation() {
  const { mine, theirs } = q;
  if (q.type === 'v11') return oneVsOneStory(single(mine), single(theirs)).html;
  if (q.type === 'v21') return twoVsOneStory(mine[0], mine[1], single(theirs)).html;
  if (q.type === 'trap') {
    const st = moveStory(mine, theirs, q.kill.i, q.kill.j);
    return st.html;
  }
  const list = hintList(mine, theirs);
  return `<div class="hint-list">${list
    .map(
      (h) => `<div class="hint hint-${R_CLASS[h.result]} ${answered.move && answered.move.i === h.i && answered.move.j === h.j ? 'chosen' : ''}">
        <div class="hint-head"><span class="badge b-${R_CLASS[h.result]}">${badgeText(h.result, h.depth)}</span><span class="hl">${h.story.headline}</span></div>
        <div class="story">${h.story.html}</div>
      </div>`,
    )
    .join('')}</div>`;
}

/** 走完一步之后的结果说法；depth 是包含这一步在内的剩余步数。 */
function afterText(result, depth) {
  if (result === WIN && depth === 1) return '直接获胜';
  return evalText(result, depth - 1);
}

function statsHtml() {
  const s = loadStats()[mode];
  if (!s || !s.total) return '还没有做题记录';
  return `答对 <b>${s.right}</b> / ${s.total}（${Math.round((100 * s.right) / s.total)}%）· 当前连对 <b>${s.streak}</b> · 最佳连对 ${s.best}`;
}

function render() {
  const d = drillOf(q.type);
  $('#drill-tabs', root).innerHTML = [MIX, ...DRILLS]
    .map((x) => `<button type="button" data-mode="${x.id}" class="${x.id === mode ? 'on' : ''}">${x.name}</button>`)
    .join('');
  $('#drill-stats', root).innerHTML = statsHtml();
  $('#drill-tip', root).innerHTML = `<b>${mode === 'mix' ? `综合 · ${d.name}` : d.name}</b>：${d.tip}`;

  let prompt = d.prompt;
  if (q.type === 'trap') {
    prompt += `<div class="kill-move">消手：你的${q.kill.i === 0 ? '左手' : '右手'} ${q.mine[q.kill.i]} + 对方的 ${q.theirs[q.kill.j]} = 10</div>`;
  }
  $('#drill-prompt', root).innerHTML = prompt;

  board.render({
    match: newMatch({ hands: [q.mine, q.theirs], turn: 0 }),
    bottom: 0,
    names: ['你', '对方'],
    canMove: d.kind === 'move' && !answered,
    hints: null,
    status: `<span class="stage">${stageOf(q.mine, q.theirs).name}</span>`,
  });

  const answersEl = $('#drill-answers', root);
  if (d.kind === 'judge') {
    answersEl.innerHTML = ANSWERS.map(([v, label, key]) => {
      let cls = `ans ans-${R_CLASS[v]}`;
      if (answered) {
        if (v === q.answer) cls += ' correct';
        else if (v === answered.value) cls += ' wrong';
      }
      return `<button type="button" class="${cls}" data-answer="${v}" ${answered ? 'disabled' : ''}>${label}<kbd>${key}</kbd></button>`;
    }).join('');
  } else answersEl.innerHTML = '';

  const fb = $('#drill-feedback', root);
  if (!answered) {
    fb.innerHTML = '';
    fb.hidden = true;
    return;
  }
  fb.hidden = false;
  let head;
  if (d.kind === 'judge') {
    const ans = q.type === 'trap' ? `走完这步你${afterText(q.answer, q.depth)}` : `你${evalText(q.answer, q.depth)}`;
    head = answered.ok ? `<b class="r-win">答对了！</b>${ans}。` : `<b class="r-loss">不对。</b>正确答案是“${R_TEXT[q.answer]}”：${ans}。`;
  } else {
    const m = answered.move;
    const res = `走 ${q.mine[m.i]} + ${q.theirs[m.j]} 之后你${afterText(m.result, m.depth)}`;
    head = answered.ok ? `<b class="r-win">很好！</b>${res}。` : `<b class="r-loss">这步不行。</b>${res}。下面是每一步的结果：`;
  }
  fb.innerHTML = `<div class="fb-head">${head}</div><div class="story">${explanation()}</div>
    <div class="fb-actions"><button type="button" class="primary" data-act="next">下一题 <kbd>Enter</kbd></button></div>`;
}

export function mountDrills(el) {
  root = el;
  root.innerHTML = `
    <div class="drill-layout">
      <div class="drill-tabs seg" id="drill-tabs"></div>
      <div class="card drill-card">
        <div class="drill-top"><div id="drill-tip" class="drill-tip"></div><div id="drill-stats" class="muted drill-stats"></div></div>
        <div id="drill-prompt" class="drill-prompt"></div>
        <div id="drill-board" class="board-wrap drill-board"></div>
        <div id="drill-answers" class="drill-answers"></div>
        <div id="drill-feedback" class="drill-feedback" hidden></div>
        <div class="drill-foot"><button type="button" class="ghost" data-act="skip">换一题</button><button type="button" class="ghost" data-act="reset">清空本类记录</button></div>
      </div>
    </div>`;
  board = createBoard($('#drill-board', root), { onMove });
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-mode]');
    if (tab) {
      mode = tab.dataset.mode;
      store.set('drillMode', mode);
      return next();
    }
    const ans = e.target.closest('[data-answer]');
    if (ans) return judge(Number(ans.dataset.answer));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next' || act === 'skip') next();
    if (act === 'reset') {
      const all = loadStats();
      delete all[mode];
      store.set(statsKey, all);
      render();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.target.closest?.('input, textarea, select, dialog')) return;
    if (!q) return;
    const a = ANSWERS.find(([, , key]) => key === e.key);
    if (a && !answered) judge(a[0]);
    else if (e.key === 'Enter' && answered) next();
  });
  next();
}
