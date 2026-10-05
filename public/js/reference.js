// 速查页：一对一表、两手对一手（归一化与例外表、完整网格）、乘法对称、人类策略、局面查询。
import { encode, getTable, reachableFrom } from './game.js';
import { EXCEPTIONS, normalizer } from './strategy.js';
import { R_CLASS, R_TEXT, badgeText, evalText, hintList, isReachable, oneVsOneStory, positionStory, twoVsOneStory } from './explain.js';
import { $ } from './ui.js';

const D = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function cell(result, depth, extra = '', attrs = '') {
  return `<td class="c c-${R_CLASS[result]} ${extra}" ${attrs}>${badgeText(result, depth)}</td>`;
}

function oneVsOneTable() {
  const T = getTable();
  const head = `<tr><th>我＼对方</th>${D.map((y) => `<th>${y}</th>`).join('')}</tr>`;
  const rows = D.map((x) => {
    const tds = D.map((y) => {
      const code = encode([0, x], [0, y]);
      const unreachable = x % 2 === 0 && y % 2 === 0 ? 'unreach' : '';
      return cell(T.result[code], T.depth[code], unreachable, `data-v11="${x}${y}" title="我 ${x} 对 对方 ${y}"`);
    }).join('');
    return `<tr><th>${x}</th>${tds}</tr>`;
  }).join('');
  return `<table class="grid">${head}${rows}</table>`;
}

function normalizerTable() {
  return `<table class="plain"><tr><th>对方单手 s</th>${D.map((s) => `<td>${s}</td>`).join('')}</tr>
    <tr><th>乘以 u</th>${D.map((s) => `<td>${normalizer(s)}</td>`).join('')}</tr>
    <tr><th>归一化后的 s</th>${D.map((s) => `<td><b>${(normalizer(s) * s) % 10}</b></td>`).join('')}</tr></table>`;
}

function exceptionTable() {
  const T = getTable();
  const rows = [];
  for (const s of [1, 2, 5]) {
    for (const [hands, result] of Object.entries(EXCEPTIONS[s])) {
      const a = Number(hands[0]);
      const b = Number(hands[1]);
      rows.push(`<tr><td>${s}</td><td>${a}、${b}</td>${cell(result, T.depth[encode([a, b], [0, s])])}</tr>`);
    }
  }
  return `<table class="plain exc"><tr><th>归一化后对方单手</th><th>我的两只手</th><th>结果（我先走）</th></tr>${rows.join('')}</table>`;
}

function twoVsOneGrid(s) {
  const T = getTable();
  const reach = reachableFrom();
  const comp = 10 - s;
  const head = `<tr><th>我的手</th>${D.map((b) => `<th>${b}</th>`).join('')}</tr>`;
  const rows = D.map((a) => {
    const tds = D.map((b) => {
      if (b < a) return '<td class="c c-none"></td>';
      const code = encode([a, b], [0, s]);
      const extra = [reach.has(code) ? '' : 'unreach', a === comp || b === comp ? 'has-comp' : ''].join(' ');
      return cell(T.result[code], T.depth[code], extra, `data-v21="${a}${b}${s}" title="我 ${a}、${b} 对 对方 ${s}"`);
    }).join('');
    return `<tr><th>${a}</th>${tds}</tr>`;
  }).join('');
  return `<table class="grid">${head}${rows}</table>`;
}

function symmetryTable() {
  const row = (u) => `<tr><th>×${u}</th>${D.map((x) => `<td>${(x * u) % 10}</td>`).join('')}</tr>`;
  return `<table class="plain"><tr><th>原数</th>${D.map((x) => `<td><b>${x}</b></td>`).join('')}</tr>${row(3)}${row(7)}${row(9)}</table>`;
}

function parsePosition(text) {
  const m = String(text).replace(/\s/g, '').match(/^(\d)[,，、]?(\d)[|｜/](\d)[,，、]?(\d)$/);
  if (!m) return null;
  const mine = [Number(m[1]), Number(m[2])];
  const theirs = [Number(m[3]), Number(m[4])];
  if (!(mine[0] || mine[1]) || !(theirs[0] || theirs[1])) return null;
  return { mine, theirs };
}

function queryResult(text) {
  const pos = parsePosition(text);
  if (!pos) return '<p class="r-loss">格式：走棋方两只手|对方两只手，例如 15|23 或 07|13（0 表示已消掉）。</p>';
  const { mine, theirs } = pos;
  const T = getTable();
  const code = encode(mine, theirs);
  const r = T.result[code];
  const story = positionStory(mine, theirs, ['走棋方', '对方']);
  const list = hintList(mine, theirs, ['走棋方', '对方']);
  return `<div class="eval eval-${R_CLASS[r]}">
      <div class="eval-head"><b>${mine.join('、')} 对 ${theirs.join('、')}</b>（${story.stage.name}）：走棋方<b>${evalText(r, T.depth[code])}</b></div>
      <div class="story">${story.html}</div>
      ${isReachable(mine, theirs) ? '' : '<div class="muted">这个局面从开局走不到，规则讲解不一定适用。</div>'}
    </div>
    <div class="hint-list">${list
      .map(
        (h) => `<div class="hint hint-${R_CLASS[h.result]}"><div class="hint-head"><span class="badge b-${R_CLASS[h.result]}">${badgeText(h.result, h.depth)}</span><span class="hl">${h.story.headline}</span></div><div class="story">${h.story.html}</div></div>`,
      )
      .join('')}</div>`;
}

let currentS = 2;

export function mountReference(root) {
  root.innerHTML = `
  <div class="ref-layout">
    <section class="card ref-card">
      <h2>记号与读表方法</h2>
      <p>所有结论都站在<b>轮到走棋的一方</b>看。“胜 13”表示走棋方必胜，双方合计还要走 13 步；“负 6”表示走棋方必败，最多还能撑 6 步；“和”表示双方都下对的话谁也赢不了。灰色斜纹的格子从开局走不到（例如四个数全是偶数），只为完整列出。点任意格子可以看到推理过程。</p>
    </section>

    <section class="card ref-card">
      <h2>一对一：斐波那契接龙</h2>
      <p>双方都只剩一只手时没有选择：两人轮流把前两个数相加（只留个位），先写出 0 的人赢。几个好记的规律：两数相加为 10 直接赢；两数相同走棋方必胜；我是 5 时对方是偶数我赢、奇数我输；<b>我 ≡ 2 × 对方（模 5）时永远循环，是和棋</b>。</p>
      <div class="table-scroll">${oneVsOneTable()}</div>
      <div class="detail" id="v11-detail"><span class="muted">点表中的格子看接龙过程。</span></div>
    </section>

    <section class="card ref-card">
      <h2>两手对一手：补数必消 + 11 种例外</h2>
      <p>我有两只手、对方只剩一只手 s、轮到我走：<b>手里有 10 − s 必须马上消</b>，之后按一对一接龙判断；<b>两只手都是 10 − s 必输</b>；手里没有补数时，把三个数都乘以 u（只看个位），对方变成 1、2 或 5，再查下面的例外表，<b>不在表里就是和棋</b>。</p>
      <div class="two-col">
        <div><h3>归一化乘数</h3><div class="table-scroll">${normalizerTable()}</div>
          <p class="muted">乘以 3、7、9 不改变胜负（见下方“对称性”），所以只需要记 s = 1、2、5 三种情况。</p></div>
        <div><h3>例外表（归一化后）</h3>${exceptionTable()}</div>
      </div>
      <h3>完整结果网格</h3>
      <div class="s-picker" id="s-picker">对方单手 s：${D.map((s) => `<button type="button" data-s="${s}" class="${s === currentS ? 'on' : ''}">${s}</button>`).join('')}</div>
      <p class="muted">行、列是我的两只手。带粗边框的格子表示我手里有补数 <span id="comp-label"></span>，必须马上消掉。</p>
      <div class="table-scroll" id="v21-grid">${twoVsOneGrid(currentS)}</div>
      <div class="detail" id="v21-detail"><span class="muted">点网格里的格子看推理过程。</span></div>
    </section>

    <section class="card ref-card">
      <h2>对称性：乘以 3、7、9</h2>
      <p>把局面里四个数同时乘以 3、7 或 9（只留个位），胜负和步数完全不变。原因是游戏只用到加法和“是不是 0”，而 3、7、9 与 10 互质。<b>乘以 9 就是把每个数换成补数。</b>2706 个可达局面因此归并成 685 类。</p>
      <div class="table-scroll">${symmetryTable()}</div>
      <p>例：<code>03|11</code> → ×3 → <code>09|33</code> → ×3 → <code>07|99</code> → ×3 → <code>01|77</code>，四个局面都是走棋方必败。</p>
    </section>

    <section class="card ref-card">
      <h2>人类策略：四层口诀</h2>
      <ol class="levels">
        <li><b>基本功</b>：只剩一只手且能凑 10 就直接赢；不要走出让对方下一步直接获胜的棋。</li>
        <li><b>不留互补对</b>：双方都有两只手时，走完不要留下“我的手 + 对方的手 = 10”。这一条可以严格证明绝对安全，性价比最高。</li>
        <li><b>会算残局</b>：一对一用接龙推算；对方只剩一只手 s 时，手里有 10 − s 必须马上消，绝不要自己凑出 10 − s。</li>
        <li><b>完整规则</b>：记住两手对一手的 11 种例外；双手阶段要不要消手，往前想两步。<b>做到这一层就等于完美下法</b>——程序验证过在所有局面上都不会走错。</li>
      </ol>
      <h3>每一步按顺序问自己</h3>
      <ol class="steps">
        <li>能直接赢吗？（只剩一只手，并且能凑 10）</li>
        <li>一对一：没得选，接龙看结果。</li>
        <li>我两手、对方一手 s：有 10 − s 就消；没有就看两种走法，别凑出 10 − s，再看对方的两种回应之后我会不会落进例外表里的“负”。</li>
        <li>我一手、对方两手：两种走法之后对方都是“两手对一手、对方先走”，挑一个对方必败或和棋的。</li>
        <li>双手对双手：能消且消完后对方必败——消，这就是赢棋；否则走一步不留互补对的棋；实在做不到，比较“消手”和“留对”的后果。</li>
      </ol>
      <h3>口诀</h3>
      <p class="mottos">凑十才消，满了留个位。· 不留互补对，稳如泰山。· 对方单手，补数必消；自己凑补，等于送命。· 一对一，接龙算；“二倍关系”转圈圈。· 送上门的消，先想想谁更受益。· 少一只手更好，但要在对的时机少。</p>
    </section>

    <section class="card ref-card">
      <h2>局面查询</h2>
      <p>输入“走棋方两只手|对方两只手”，例如 <code>15|23</code>、<code>49|11</code>、<code>07|13</code>（0 表示已消掉）。</p>
      <form id="query-form" class="query-form"><input name="q" value="49|11" autocomplete="off"><button type="submit" class="primary">查询</button></form>
      <div id="query-result"></div>
    </section>
  </div>`;

  const setS = (s) => {
    currentS = s;
    $('#v21-grid', root).innerHTML = twoVsOneGrid(s);
    $('#comp-label', root).textContent = `${10 - s}`;
    root.querySelectorAll('#s-picker button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === s));
    $('#v21-detail', root).innerHTML = '<span class="muted">点网格里的格子看推理过程。</span>';
  };
  setS(currentS);

  root.addEventListener('click', (e) => {
    const sBtn = e.target.closest('[data-s]');
    if (sBtn) return setS(Number(sBtn.dataset.s));
    const c11 = e.target.closest('[data-v11]');
    if (c11) {
      const [x, y] = c11.dataset.v11.split('').map(Number);
      const st = oneVsOneStory(x, y, ['我', '对方']);
      const note = x % 2 === 0 && y % 2 === 0 ? '<div class="muted">两个数都是偶数的局面实战中不会出现。</div>' : '';
      $('#v11-detail', root).innerHTML = `<b>我 ${x} 对 对方 ${y}，我先走：</b>${R_TEXT[st.result]}。${st.html}${note}`;
      return;
    }
    const c21 = e.target.closest('[data-v21]');
    if (c21) {
      const [a, b, s] = c21.dataset.v21.split('').map(Number);
      const st = twoVsOneStory(a, b, s, ['我', '对方']);
      const result = getTable().result[encode([a, b], [0, s])];
      const reach = isReachable([a, b], [0, s]);
      $('#v21-detail', root).innerHTML = `<b>我 ${a}、${b} 对 对方 ${s}，我先走：</b>${R_TEXT[result]}。${st.html}${
        reach ? '' : '<div class="muted">这个局面从开局走不到，规则不一定适用。</div>'
      }`;
    }
  });
  $('#query-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    $('#query-result', root).innerHTML = queryResult(e.target.elements.q.value);
  });
  $('#query-result', root).innerHTML = queryResult('49|11');
}
