// 棋盘组件：上下两位玩家各两只手。走棋方先点自己的一只手，再点对方的一只手（顺序反过来也行）。
import { HAND_NAMES } from './match.js';
import { R_CLASS, badgeText } from './explain.js';
import { esc } from './ui.js';

const live = (pair) => [0, 1].filter((k) => pair[k] !== 0);

function bestOf(moves) {
  return moves.reduce((a, b) => (score(b) > score(a) ? b : a));
}
function score(m) {
  if (m.result === 1) return 1000 - m.depth;
  if (m.result === 0) return 0;
  return -1000 + m.depth;
}

/**
 * props：
 *   match       对局状态（match.js）
 *   bottom      显示在下方的座位
 *   names       两个座位的名字
 *   tags        名字旁边的小标签（可选）
 *   canMove     当前走棋方是否由本界面操作
 *   showTurn    是否标出走棋方（联机等人时不标）
 *   hints       当前走棋方全部走法的评估（game.analyzeMoves 的结果），null 表示不显示
 *   status      中间状态栏的 HTML
 */
export function createBoard(root, { onMove }) {
  let props = null;
  let own = null; // 选中的自己的手
  let target = null; // 先选中的对方的手
  let lastCount = -1;

  function mover() {
    return props.match.turn;
  }
  function interactive() {
    return props.canMove && !props.match.result;
  }

  function autoSelect() {
    if (!interactive()) {
      own = target = null;
      return;
    }
    const mine = props.match.hands[mover()];
    const alive = live(mine);
    if (alive.length === 1) own = alive[0];
    else if (own !== null && mine[own] === 0) own = null;
  }

  function commit(i, j) {
    own = target = null;
    onMove(i, j);
  }

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.hand');
    if (!btn || !props || !interactive()) return;
    const seat = Number(btn.dataset.seat);
    const idx = Number(btn.dataset.idx);
    const p = mover();
    if (props.match.hands[seat][idx] === 0) return;
    if (seat === p) {
      if (target !== null) return commit(idx, target);
      own = own === idx && live(props.match.hands[p]).length > 1 ? null : idx;
    } else {
      if (own !== null) return commit(own, idx);
      target = target === idx ? null : idx;
    }
    draw();
  });

  root.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('.hand');
    const preview = root.querySelector('.preview');
    if (!preview || !props || !interactive()) return;
    let text = '';
    if (btn) {
      const seat = Number(btn.dataset.seat);
      const idx = Number(btn.dataset.idx);
      const p = mover();
      const mine = props.match.hands[p];
      const theirs = props.match.hands[1 - p];
      let i = null;
      let j = null;
      if (seat !== p && own !== null) [i, j] = [own, idx];
      if (seat === p && target !== null) [i, j] = [idx, target];
      if (i !== null && mine[i] && theirs[j]) {
        const sum = mine[i] + theirs[j];
        text = sum === 10 ? `${mine[i]} + ${theirs[j]} = 10 → 消掉这只手` : sum > 10 ? `${mine[i]} + ${theirs[j]} = ${sum} → ${sum % 10}` : `${mine[i]} + ${theirs[j]} = ${sum}`;
      }
    }
    preview.textContent = text || defaultPreview();
  });

  function defaultPreview() {
    if (!interactive()) return '';
    const p = mover();
    const mine = props.match.hands[p];
    const theirs = props.match.hands[1 - p];
    if (own !== null) return `已选${HAND_NAMES[own]} ${mine[own]}：再点对方的一只手，把它的数加过来`;
    if (target !== null) return `已选对方的 ${theirs[target]}：再点自己的一只手`;
    return '先点自己的一只手，再点对方的一只手';
  }

  function badgeFor(seat, idx) {
    const hints = props.hints;
    if (!hints || !interactive()) return '';
    const p = mover();
    let list = [];
    if (seat === p) list = hints.filter((m) => m.i === idx && (target === null || m.j === target));
    else if (own !== null) list = hints.filter((m) => m.i === own && m.j === idx);
    else return '';
    if (!list.length) return '';
    const m = bestOf(list);
    return `<span class="badge b-${R_CLASS[m.result]}">${badgeText(m.result, m.depth)}</span>`;
  }

  function handHtml(seat, idx, last, animate) {
    const { match } = props;
    const v = match.hands[seat][idx];
    const p = mover();
    const cls = ['hand', `seat-${seat}`];
    if (v === 0) cls.push('dead');
    if (interactive() && v !== 0) {
      cls.push('clickable');
      if (seat === p && own === idx) cls.push('selected');
      if (seat !== p && target === idx) cls.push('selected');
      if (seat !== p && own !== null) cls.push('targetable');
    }
    let tagLine = '';
    if (last) {
      if (last.by === seat && last.i === idx) {
        cls.push('last-to');
        if (animate) cls.push('anim-to');
        tagLine = `<span class="delta">${last.killed ? `+${last.add} = 10` : `+${last.add}`}</span>`;
      }
      if (last.by !== seat && last.j === idx) {
        cls.push('last-from');
        if (animate) cls.push('anim-from');
      }
    }
    const pips = v ? `<span class="pips">${'<i></i>'.repeat(v)}</span>` : '<span class="pips dead-mark">已消掉</span>';
    return `<button type="button" class="${cls.join(' ')}" data-seat="${seat}" data-idx="${idx}" ${v === 0 ? 'aria-disabled="true"' : ''}>
      <span class="hand-name">${HAND_NAMES[idx]}</span>
      <span class="hand-num">${v === 0 ? '✕' : v}</span>
      ${pips}${tagLine}${badgeFor(seat, idx)}
    </button>`;
  }

  function sideHtml(seat, pos, last, animate) {
    const { match, names, tags = [], showTurn = true } = props;
    const turn = showTurn && !match.result && match.turn === seat;
    const winner = match.result && match.result.winner === seat;
    const head = `<div class="side-head">
      <span class="pname">${esc(names[seat])}</span>
      ${tags[seat] ? `<span class="ptag">${esc(tags[seat])}</span>` : ''}
      ${turn ? '<span class="turn-tag">走棋中</span>' : ''}
      ${winner ? '<span class="win-tag">获胜</span>' : ''}
    </div>`;
    const hands = `<div class="hands">${handHtml(seat, 0, last, animate)}${handHtml(seat, 1, last, animate)}</div>`;
    return `<div class="side side-${pos} seat-${seat} ${turn ? 'is-turn' : ''}">${pos === 'top' ? head + hands : hands + head}</div>`;
  }

  function draw() {
    const { match, bottom, status = '' } = props;
    const last = match.moves.at(-1) ?? null;
    const animate = match.moves.length !== lastCount && lastCount !== -1;
    lastCount = match.moves.length;
    root.innerHTML = `<div class="board">
      ${sideHtml(1 - bottom, 'top', last, animate)}
      <div class="mid"><div class="status">${status}</div><div class="preview">${defaultPreview()}</div></div>
      ${sideHtml(bottom, 'bottom', last, animate)}
    </div>`;
  }

  const keyOf = (m) => `${m.moves.length}|${m.turn}|${m.hands.join()}|${m.result ? 1 : 0}`;

  return {
    render(next) {
      const reset = !props || keyOf(next.match) !== keyOf(props.match);
      props = next;
      if (reset) own = target = null;
      autoSelect();
      draw();
    },
    reset() {
      lastCount = -1;
      own = target = null;
    },
  };
}
