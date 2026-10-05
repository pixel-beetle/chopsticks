// 对弈页：人机对战、同屏双人、联机对战，以及辅助分析、悔棋、摆局面、复盘。
import { analyzeMoves, lookup } from './game.js';
import { AI_LEVELS, chooseMove } from './ai.js';
import { HAND_NAMES, newMatch, playMove, resultReasonText, undo } from './match.js';
import { createBoard } from './board.js';
import { R_CLASS, TAG_TEXT, badgeText, evalText, hintList, isReachable, positionStory, reviewMatch, stageOf } from './explain.js';
import { OnlineClient } from './online.js';
import { $, $$, esc, seg, store, toast } from './ui.js';

const settings = {
  mode: 'ai',
  aiLevel: 'casual',
  aiSide: '0',
  hotFirst: '0',
  showEval: false,
  showHints: false,
  name: '',
  roomFirst: '0',
  roomHints: false,
  ...store.get('settings', {}),
};
const save = () => store.set('settings', settings);

const S = {
  match: newMatch(),
  humanSeat: 0,
  aiTimer: null,
  thinking: false,
  client: null,
  room: null,
  conn: 'closed',
  lastRoomMoves: -1,
};

let root;
let board;

const LAYOUT = `
<div class="play-layout">
  <div class="play-main">
    <div class="mode-switch" id="mode-switch"></div>
    <div class="card mode-panel" id="mode-panel"></div>
    <div id="board" class="board-wrap"></div>
    <div class="board-actions" id="board-actions"></div>
  </div>
  <aside class="play-side">
    <div class="card" id="assist-card">
      <div class="card-head">
        <h3>辅助分析</h3>
        <div class="toggles">
          <label class="switch"><input type="checkbox" data-opt="showEval"><span>局面评估</span></label>
          <label class="switch"><input type="checkbox" data-opt="showHints"><span>走法提示</span></label>
        </div>
      </div>
      <div id="assist-body" class="assist-body"></div>
    </div>
    <div class="card" id="chat-card" hidden>
      <div class="card-head"><h3>聊天</h3></div>
      <div id="chat-list" class="chat-list"></div>
      <div class="quick-chat">
        ${['你好！', '好棋！', '我想想…', '再来一局？', '承让了'].map((t) => `<button type="button" data-act="quick-chat" data-text="${t}">${t}</button>`).join('')}
      </div>
      <form id="chat-form" class="chat-form"><input name="text" maxlength="120" autocomplete="off" placeholder="说点什么…"><button type="submit">发送</button></form>
    </div>
    <div class="card" id="log-card">
      <div class="card-head"><h3>棋谱</h3><span id="log-meta" class="muted"></span></div>
      <div id="log-body" class="log-body"></div>
    </div>
    <details class="card rules-card">
      <summary>规则与入门要点</summary>
      <ol>
        <li>两人各两只手，开局每只手都是 1。</li>
        <li>轮到你时，把<b>对方</b>一只手上的数加到<b>自己</b>的一只手上，对方的手不变。</li>
        <li>超过 10 只留个位；正好凑满 10，这只手就消掉了，之后不能再用。</li>
        <li>先把自己两只手都消掉的人获胜。同一局面第三次出现判和。</li>
      </ol>
      <p class="tip">最实用的一条习惯：双方都有两只手时，走完不要留下“我的一只手 + 对方的一只手 = 10”（互补对）。可以证明这样的走法绝对安全。</p>
      <p class="muted">更多规律见“速查”和“文章”。</p>
    </details>
  </aside>
</div>
<dialog id="setup-dialog" class="dialog"></dialog>`;

// ---------- 当前模式下的各种信息 ----------

const isOnline = () => settings.mode === 'online';
const level = () => AI_LEVELS.find((l) => l.id === settings.aiLevel) ?? AI_LEVELS[1];

function currentMatch() {
  return isOnline() ? S.room?.match ?? null : S.match;
}

function mySeat() {
  if (isOnline()) return S.client?.seat ?? null;
  if (settings.mode === 'ai') return S.humanSeat;
  return null;
}

function names() {
  if (settings.mode === 'ai') return S.humanSeat === 0 ? ['你', '电脑'] : ['电脑', '你'];
  if (settings.mode === 'hotseat') return ['甲', '乙'];
  const seats = S.room?.seats ?? [null, null];
  return seats.map((s, k) => (s ? s.name : (S.room?.match.moves.length && S.room.names?.[k]) || '（空位）'));
}

function tags() {
  if (settings.mode === 'ai') return S.humanSeat === 0 ? ['', level().name] : [level().name, ''];
  if (settings.mode === 'hotseat') return ['', ''];
  const seats = S.room?.seats ?? [null, null];
  return seats.map((s, k) => [k === mySeat() ? '你' : '', s && !s.online ? '离线' : ''].filter(Boolean).join(' · '));
}

/** 讲解里对走棋方和对方的称呼。 */
function who(mover) {
  if (settings.mode === 'hotseat') return mover === 0 ? ['甲', '乙'] : ['乙', '甲'];
  const me = mySeat();
  if (me === null) return ['走棋方', '对方'];
  if (settings.mode === 'ai') return mover === me ? ['你', '电脑'] : ['电脑', '你'];
  return mover === me ? ['你', '对方'] : ['对方', '你'];
}

function roomFull() {
  return Boolean(S.room?.seats.every(Boolean));
}

function canMove() {
  const m = currentMatch();
  if (!m || m.result) return false;
  if (settings.mode === 'hotseat') return true;
  if (settings.mode === 'ai') return m.turn === S.humanSeat;
  return roomFull() && m.turn === mySeat();
}

function assistAllowed() {
  if (!isOnline()) return true;
  return Boolean(S.room && (S.room.allowHints || S.room.match.result || mySeat() === null));
}

// ---------- 走棋 ----------

function onMove(i, j) {
  if (isOnline()) {
    S.client.act('move', { i, j }).catch((e) => toast(e.message));
    return;
  }
  try {
    S.match = playMove(S.match, i, j);
  } catch (e) {
    toast(e.message);
    return;
  }
  renderGame();
  maybeAi();
}

function maybeAi() {
  clearTimeout(S.aiTimer);
  S.thinking = false;
  const m = S.match;
  if (settings.mode !== 'ai' || m.result || m.turn === S.humanSeat) return;
  S.thinking = true;
  S.aiTimer = setTimeout(() => {
    S.thinking = false;
    if (S.match !== m) return;
    const p = m.turn;
    const { i, j } = chooseMove(settings.aiLevel, m.hands[p], m.hands[1 - p]);
    S.match = playMove(m, i, j);
    renderGame();
    maybeAi();
  }, 650);
}

function newGame(start) {
  clearTimeout(S.aiTimer);
  if (settings.mode === 'ai') {
    S.humanSeat = settings.aiSide === 'random' ? Math.round(Math.random()) : Number(settings.aiSide);
    S.match = newMatch(start ?? { turn: 0 });
  } else {
    S.match = newMatch(start ?? { turn: Number(settings.hotFirst) });
  }
  board.reset();
  renderAll();
  maybeAi();
}

function undoMove() {
  if (isOnline()) return;
  clearTimeout(S.aiTimer);
  let m = S.match;
  if (!m.moves.length) return toast('已经退回到起始局面了');
  if (settings.mode === 'hotseat') m = undo(m, 1);
  else {
    while (m.moves.length) {
      const last = m.moves.at(-1);
      m = undo(m, 1);
      if (last.by === S.humanSeat) break;
    }
  }
  S.match = m;
  board.reset();
  renderGame();
  maybeAi();
}

// ---------- 渲染 ----------

function renderAll() {
  renderModeSwitch();
  renderModePanel();
  renderGame();
}

function renderGame() {
  renderBoard();
  renderActions();
  renderAssist();
  renderLog();
  renderChat();
}

function renderModeSwitch() {
  $('#mode-switch', root).innerHTML = seg(
    'mode',
    [
      ['ai', '人机对战'],
      ['hotseat', '同屏双人'],
      ['online', '联机对战'],
    ],
    settings.mode,
  );
}

function renderModePanel() {
  const panel = $('#mode-panel', root);
  if (settings.mode === 'ai') {
    panel.innerHTML = `
      <div class="field-row">
        <label class="field"><span>电脑难度</span>
          <select id="ai-level">${AI_LEVELS.map((l) => `<option value="${l.id}" ${l.id === settings.aiLevel ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
        </label>
        <div class="field"><span>我执</span>${seg('aiSide', [['0', '先手'], ['1', '后手'], ['random', '随机']], settings.aiSide)}</div>
        <button type="button" class="primary" data-act="new">新开一局</button>
      </div>
      <p class="muted level-desc">${esc(level().desc)}</p>`;
    return;
  }
  if (settings.mode === 'hotseat') {
    panel.innerHTML = `
      <div class="field-row">
        <div class="field"><span>先走</span>${seg('hotFirst', [['0', '甲（下方）'], ['1', '乙（上方）']], settings.hotFirst)}</div>
        <button type="button" class="primary" data-act="new">新开一局</button>
      </div>
      <p class="muted">两人用同一台设备轮流走棋。打开右侧的“走法提示”可以一起研究每一步的好坏。</p>`;
    return;
  }
  if (!S.room) {
    panel.innerHTML = `
      <div class="lobby">
        <label class="field"><span>昵称</span><input id="nick" maxlength="12" value="${esc(settings.name)}" placeholder="比如：小明"></label>
        <div class="lobby-grid">
          <div class="lobby-box">
            <h4>创建房间</h4>
            <div class="field"><span>先手</span>${seg('roomFirst', [['0', '我先'], ['1', '对方先'], ['random', '随机']], settings.roomFirst)}</div>
            <label class="check"><input type="checkbox" id="room-hints" ${settings.roomHints ? 'checked' : ''}> 允许对局中使用辅助分析（练习用）</label>
            <button type="button" class="primary" data-act="create">创建房间</button>
          </div>
          <div class="lobby-box">
            <h4>加入房间</h4>
            <input id="join-code" inputmode="numeric" maxlength="4" placeholder="4 位房间号">
            <button type="button" data-act="join">加入</button>
          </div>
        </div>
        <p class="muted">${S.conn === 'closed' && S.connMsg ? `<b class="r-loss">${esc(S.connMsg)}</b> ` : ''}创建房间后把邀请链接发给朋友即可。联机需要服务器：部署到 Cloudflare 的网址可以直接用；本地运行 <code>npm start</code> 时，同一局域网的朋友用终端里显示的局域网地址打开。</p>
      </div>`;
    return;
  }
  const r = S.room;
  const me = mySeat();
  const connText = { online: '已连接', reconnecting: '正在重连…', closed: '已断开' }[S.conn];
  const player = (k) => {
    const s = r.seats[k];
    if (!s) return `<span class="pl seat-${k} empty">等待加入</span>`;
    return `<span class="pl seat-${k}"><i class="dot ${s.online ? 'on' : ''}"></i>${esc(s.name)}${k === me ? '（你）' : ''}</span>`;
  };
  panel.innerHTML = `
    <div class="room">
      <div class="room-top">
        <div class="room-id">房间 <b>${r.id}</b></div>
        <button type="button" data-act="copy">复制邀请链接</button>
        ${me !== null ? '<button type="button" data-act="rename">改名</button>' : ''}
        <button type="button" class="ghost" data-act="leave">离开房间</button>
      </div>
      <div class="room-score">${player(0)}<b class="score">${r.score[0]} : ${r.score[1]}</b>${player(1)}<span class="muted">和 ${r.score[2]} · 第 ${r.game} 局</span></div>
      <div class="muted room-meta">
        <span class="conn conn-${S.conn}">${connText}</span>
        ${me === null ? ' · 房间已满，你正在观战' : ''}
        ${r.spectators ? ` · ${r.spectators} 人观战` : ''}
        · ${r.allowHints ? '本房间允许辅助分析' : '本房间对局中关闭辅助分析，结束后可复盘'}
      </div>
    </div>`;
}

function statusHtml(m) {
  const nm = names();
  const waiting = isOnline() && !roomFull();
  if (waiting && !m.result) return `等待对手加入… 把房间号 <b>${S.room.id}</b> 或邀请链接发给朋友`;
  if (m.result) {
    const w = m.result.winner;
    let reason = resultReasonText(m.result);
    if (m.result.reason === 'resign') reason = `${esc(nm[1 - w])}认输`;
    if (m.result.reason === 'leave') reason = '对方离开了房间';
    const tail = waiting ? '<br><span class="muted">等待新对手加入…</span>' : '';
    if (w === null) return `<b>和棋</b> · ${reason}${tail}`;
    const me = mySeat();
    const head = me === null ? `${esc(nm[w])}获胜！` : w === me ? '你赢了！' : `${esc(nm[w])}获胜`;
    return `<b class="${me === null || w === me ? 'r-win' : 'r-loss'}">${head}</b> · ${reason}${tail}`;
  }
  const mover = nm[m.turn];
  const me = mySeat();
  if (me !== null && m.turn === me) return '<b>轮到你走</b>';
  if (settings.mode === 'ai') return '电脑思考中…';
  return `轮到 <b>${esc(mover)}</b> 走`;
}

function renderBoard() {
  const m = currentMatch();
  const wrap = $('#board', root);
  if (!m) {
    wrap.innerHTML = '<div class="board board-empty"><p>创建或加入一个房间后，棋盘会出现在这里。</p></div>';
    board.reset();
    return;
  }
  const p = m.turn;
  const hints = settings.showHints && assistAllowed() && canMove() ? analyzeMoves(m.hands[p], m.hands[1 - p]) : null;
  const me = mySeat();
  board.render({
    match: m,
    bottom: me ?? 0,
    names: names(),
    tags: tags(),
    canMove: canMove(),
    showTurn: !(isOnline() && !roomFull()),
    hints,
    status: statusHtml(m),
  });
}

function renderActions() {
  const el = $('#board-actions', root);
  const m = currentMatch();
  if (!isOnline()) {
    el.innerHTML = `
      <button type="button" data-act="undo" ${S.match.moves.length ? '' : 'disabled'}>悔棋</button>
      <button type="button" data-act="setup">摆局面</button>
      <button type="button" data-act="restart">重新开始</button>`;
    return;
  }
  const me = mySeat();
  if (!S.room || me === null || !roomFull()) {
    el.innerHTML = '';
    return;
  }
  const r = S.room;
  if (m.result) {
    const mine = r.rematch[me];
    const theirs = r.rematch[1 - me];
    el.innerHTML = mine
      ? '<span class="muted">已申请再来一局，等待对方…</span>'
      : `<button type="button" class="primary" data-act="rematch">${theirs ? '对方想再来一局，同意' : '再来一局'}</button>`;
    return;
  }
  let draw = '<button type="button" data-act="draw-offer">提和</button>';
  if (r.drawOffer === me) draw = '<span class="muted">已提和，等待对方回应…</span>';
  if (r.drawOffer === 1 - me) {
    draw = `<span class="offer">对方提议和棋</span><button type="button" class="primary" data-act="draw-accept">接受</button><button type="button" data-act="draw-decline">拒绝</button>`;
  }
  el.innerHTML = `${draw}<button type="button" class="ghost" data-act="resign" ${m.moves.length ? '' : 'disabled'}>认输</button>`;
}

function renderAssist() {
  $$('[data-opt]', root).forEach((input) => {
    input.checked = assistAllowed() && Boolean(settings[input.dataset.opt]);
    input.disabled = !assistAllowed();
  });
  const body = $('#assist-body', root);
  const m = currentMatch();
  if (!m) {
    body.innerHTML = '<p class="muted">进入房间后可以使用。</p>';
    return;
  }
  if (!assistAllowed()) {
    body.innerHTML = '<p class="muted">这个房间在对局中关闭了辅助分析。对局结束后，棋谱里会自动给出复盘。</p>';
    return;
  }
  if (!settings.showEval && !settings.showHints) {
    body.innerHTML = '<p class="muted">打开“局面评估”可以看到当前局面的胜负和判断依据；打开“走法提示”会在棋盘上标出每一步的结果（胜 / 和 / 负，数字是双方合计还剩几步），并给出规则讲解。对局结束后棋谱会自动复盘。</p>';
    return;
  }
  const p = m.turn;
  const mine = m.hands[p];
  const theirs = m.hands[1 - p];
  const w = who(p);
  const parts = [];
  if (m.result) {
    parts.push('<p class="muted">对局已结束，复盘见下方棋谱。</p>');
  } else {
    if (settings.showEval) {
      const r = lookup(mine, theirs);
      const story = positionStory(mine, theirs, w);
      parts.push(`<div class="eval eval-${R_CLASS[r.result]}">
        <div class="eval-head">从<b>${esc(w[0])}</b>看：<b>${evalText(r.result, r.depth)}</b><span class="stage">${story.stage.name}</span></div>
        <div class="story">${story.html}</div>
        ${isReachable(mine, theirs) ? '' : '<div class="muted">注意：这个局面从开局走不到，规则讲解不一定适用，以电脑评估为准。</div>'}
      </div>`);
    }
    if (settings.showHints) {
      if (!canMove()) {
        parts.push('<p class="muted">轮到对方走，提示会在你走棋时出现。</p>');
      } else {
        const list = hintList(mine, theirs, w);
        parts.push(`<div class="hint-list">${list
          .map(
            (h) => `<div class="hint hint-${R_CLASS[h.result]}">
              <button type="button" class="hint-head" data-act="hint" data-i="${h.i}" data-j="${h.j}">
                <span class="badge b-${R_CLASS[h.result]}">${badgeText(h.result, h.depth)}</span>
                <span class="hl">${HAND_NAMES[h.i]}：${h.story.headline}</span>
              </button>
              <div class="story">${h.story.html}</div>
            </div>`,
          )
          .join('')}</div>`);
      }
    }
  }
  body.innerHTML = parts.join('');
}

function moveText(mv) {
  const sum = mv.from + mv.add;
  let t = `${HAND_NAMES[mv.i]} ${mv.from} + ${mv.add} = ${sum}`;
  if (mv.won) t += '，获胜';
  else if (mv.killed) t += '，消手';
  else if (sum > 10) t += ` → ${mv.to}`;
  return t;
}

function renderLog() {
  const m = currentMatch();
  const body = $('#log-body', root);
  const meta = $('#log-meta', root);
  if (!m) {
    body.innerHTML = '';
    meta.textContent = '';
    return;
  }
  const nm = names();
  const showReview = Boolean(m.result) || (settings.showEval && assistAllowed());
  const review = showReview ? reviewMatch(m) : null;
  meta.textContent = m.moves.length ? `${m.moves.length} 步` : '';
  if (!m.moves.length) {
    const start = m.start.hands;
    const custom = start.some((h) => h[0] !== 1 || h[1] !== 1);
    body.innerHTML = `<p class="muted">${custom ? `从摆好的局面开始：${esc(nm[0])} ${start[0].join('、')}，${esc(nm[1])} ${start[1].join('、')}。` : '还没有走棋。'}第一步由${esc(nm[m.start.turn])}走。</p>`;
    return;
  }
  const items = m.moves.map((mv, k) => {
    const rv = review?.[k];
    const tag = rv && TAG_TEXT[rv.tag] ? `<span class="tag tag-${rv.tag}">${TAG_TEXT[rv.tag]}</span>` : '';
    let better = '';
    if (rv && (rv.tag === 'blunder' || rv.tag === 'miss')) {
      const { mine, theirs } = mv.before;
      better = `<div class="better">走之前：${evalText(rv.before.result, rv.before.depth)}。更好的走法：${rv.best
        .map((b) => `${mine[b.i]} + ${theirs[b.j]}（${badgeText(b.result, b.depth)}）`)
        .join('、')}</div>`;
    }
    return `<li class="mv by-${mv.by} ${rv ? `row-${rv.tag}` : ''}"><span class="who seat-${mv.by}">${esc(nm[mv.by])}</span>${moveText(mv)}${tag}${better}</li>`;
  });
  let summary = '';
  if (review && m.result) {
    const count = (seat, tag) => review.filter((x) => x.mv.by === seat && x.tag === tag).length;
    const line = (seat) => {
      const b = count(seat, 'blunder');
      const miss = count(seat, 'miss');
      if (!b && !miss) return `${esc(nm[seat])}没有失误`;
      return `${esc(nm[seat])}：${b ? `败着 ${b} 次` : ''}${b && miss ? '，' : ''}${miss ? `错失胜机 ${miss} 次` : ''}`;
    };
    summary = `<div class="review-summary"><b>复盘</b>（电脑穷举评估）：${line(0)}；${line(1)}。</div>`;
  }
  body.innerHTML = `<ol class="log">${items.join('')}</ol>${summary}`;
  body.scrollTop = body.scrollHeight;
}

function renderChat() {
  const card = $('#chat-card', root);
  card.hidden = !(isOnline() && S.room);
  if (card.hidden) return;
  const list = $('#chat-list', root);
  const me = mySeat();
  list.innerHTML = S.room.chat.length
    ? S.room.chat
        .map((c) => `<div class="chat-msg ${c.seat === me ? 'mine' : ''}"><span class="who seat-${c.seat}">${esc(c.name)}</span>${esc(c.text)}</div>`)
        .join('')
    : '<p class="muted">还没有消息。</p>';
  list.scrollTop = list.scrollHeight;
}

// ---------- 摆局面 ----------

function openSetup() {
  const dlg = $('#setup-dialog', root);
  const m = S.match;
  const nm = names();
  const bottom = mySeat() ?? 0;
  const top = 1 - bottom;
  const sel = (id, v) => `<select data-hand="${id}">${[...Array(10).keys()].map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${x === 0 ? '0（已消）' : x}</option>`).join('')}</select>`;
  dlg.innerHTML = `
    <form method="dialog" class="setup">
      <h3>摆局面</h3>
      <p class="muted">设置每只手上的数（0 表示已经消掉），然后从这个局面开始下或研究。</p>
      <div class="setup-row"><b>${esc(nm[top])}（上方）</b>${sel(`${top}0`, m.hands[top][0])}${sel(`${top}1`, m.hands[top][1])}</div>
      <div class="setup-row"><b>${esc(nm[bottom])}（下方）</b>${sel(`${bottom}0`, m.hands[bottom][0])}${sel(`${bottom}1`, m.hands[bottom][1])}</div>
      <div class="setup-row"><b>谁先走</b>${seg('setupTurn', [[String(bottom), `${nm[bottom]}`], [String(top), `${nm[top]}`]], String(m.turn))}</div>
      <div class="setup-eval" id="setup-eval"></div>
      <div class="setup-actions"><button value="cancel" type="submit" class="ghost">取消</button><button type="button" class="primary" data-setup="ok">从这个局面开始</button></div>
    </form>`;
  const read = () => {
    const hands = [[0, 0], [0, 0]];
    $$('[data-hand]', dlg).forEach((s) => {
      hands[Number(s.dataset.hand[0])][Number(s.dataset.hand[1])] = Number(s.value);
    });
    const turn = Number($('[data-seg="setupTurn"] .on', dlg).dataset.value);
    return { hands, turn };
  };
  const update = () => {
    const { hands, turn } = read();
    const out = $('#setup-eval', dlg);
    if (!(hands[0][0] || hands[0][1]) || !(hands[1][0] || hands[1][1])) {
      out.innerHTML = '<b class="r-loss">每人至少要有一只手没消掉。</b>';
      return false;
    }
    const r = lookup(hands[turn], hands[1 - turn]);
    out.innerHTML = `${stageOf(hands[turn], hands[1 - turn]).name}，从先走的${esc(nm[turn])}看：<b class="r-${R_CLASS[r.result]}">${evalText(r.result, r.depth)}</b>${
      isReachable(hands[turn], hands[1 - turn]) ? '' : '<br><span class="muted">这个局面从开局走不到（例如四个数全是偶数），可以研究，但实战中不会出现。</span>'
    }`;
    return true;
  };
  dlg.oninput = update;
  dlg.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.closest('[data-seg="setupTurn"]')) {
      $$('[data-seg="setupTurn"] button', dlg).forEach((x) => x.classList.toggle('on', x === b));
      update();
    }
    if (b.dataset.setup === 'ok' && update()) {
      const start = read();
      dlg.close();
      clearTimeout(S.aiTimer);
      S.match = newMatch(start);
      board.reset();
      renderAll();
      maybeAi();
    }
  };
  update();
  dlg.showModal();
}

// ---------- 联机 ----------

function ensureClient() {
  if (S.client) return S.client;
  S.client = new OnlineClient({
    onRoom(room) {
      S.room = room;
      if (room.match.moves.length < S.lastRoomMoves) board.reset();
      S.lastRoomMoves = room.match.moves.length;
      renderModePanel();
      renderGame();
    },
    onConnection(state, msg) {
      S.conn = state;
      if (state === 'closed') {
        S.room = null;
        S.connMsg = msg;
        S.client.close();
        setRoomInUrl(null);
        renderAll();
        if (msg) toast(msg);
      } else if (S.room) renderModePanel();
    },
  });
  return S.client;
}

function setRoomInUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('room', id);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function inviteLink() {
  const url = new URL(location.href);
  url.search = `?room=${S.room.id}`;
  url.hash = 'play';
  return url.toString();
}

async function createRoom() {
  readNick();
  try {
    const c = ensureClient();
    const r = await c.create({ name: settings.name, first: settings.roomFirst === 'random' ? 'random' : Number(settings.roomFirst), allowHints: settings.roomHints });
    S.connMsg = '';
    setRoomInUrl(r.roomId);
    toast(`房间 ${r.roomId} 已创建，把邀请链接发给朋友吧`);
  } catch (e) {
    toast(e.message, 4000);
  }
}

async function joinRoom(id) {
  readNick();
  const code = String(id ?? '').trim();
  if (!/^\d{4}$/.test(code)) return toast('请输入 4 位房间号');
  try {
    const c = ensureClient();
    const r = await c.join(code, settings.name);
    S.connMsg = '';
    setRoomInUrl(r.roomId);
    if (r.seat === null) toast('房间已满，你正在观战');
  } catch (e) {
    S.connMsg = e.message;
    setRoomInUrl(null);
    renderModePanel();
    toast(e.message, 4000);
  }
}

function readNick() {
  const nick = $('#nick', root);
  if (nick) {
    settings.name = nick.value.trim().slice(0, 12);
    save();
  }
}

async function leaveRoom() {
  if (!S.client) return;
  const m = S.room?.match;
  if (m && !m.result && m.moves.length && roomFull() && mySeat() !== null && !confirm('对局还没结束，离开会判你输。确定离开吗？')) return;
  await S.client.leave();
  S.room = null;
  S.conn = 'closed';
  setRoomInUrl(null);
  renderAll();
}

async function roomAct(type, payload) {
  try {
    await S.client.act(type, payload);
  } catch (e) {
    toast(e.message);
  }
}

// ---------- 事件 ----------

function setMode(mode) {
  if (mode === settings.mode) return;
  settings.mode = mode;
  save();
  clearTimeout(S.aiTimer);
  board.reset();
  if (mode !== 'online') newGame();
  else renderAll();
}

function onClick(e) {
  const segBtn = e.target.closest('.seg button');
  if (segBtn && segBtn.closest('#setup-dialog')) return;
  if (segBtn) {
    const name = segBtn.closest('.seg').dataset.seg;
    const value = segBtn.dataset.value;
    if (name === 'mode') return setMode(value);
    settings[name] = value;
    save();
    $$('button', segBtn.closest('.seg')).forEach((b) => b.classList.toggle('on', b === segBtn));
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.act) {
    case 'new':
      return newGame();
    case 'restart':
      return newGame(S.match.start);
    case 'undo':
      return undoMove();
    case 'setup':
      return openSetup();
    case 'hint':
      if (canMove()) onMove(Number(btn.dataset.i), Number(btn.dataset.j));
      return;
    case 'create':
      return createRoom();
    case 'join':
      return joinRoom($('#join-code', root).value);
    case 'copy': {
      const link = inviteLink();
      navigator.clipboard?.writeText(link).then(
        () => toast('邀请链接已复制'),
        () => prompt('复制这个链接发给朋友：', link),
      ) ?? prompt('复制这个链接发给朋友：', link);
      return;
    }
    case 'rename': {
      const name = prompt('新的昵称（最多 12 个字）', settings.name);
      if (name === null) return;
      settings.name = name.trim().slice(0, 12);
      save();
      return roomAct('rename', { name: settings.name });
    }
    case 'leave':
      return leaveRoom();
    case 'resign':
      if (confirm('确定认输吗？')) roomAct('resign');
      return;
    case 'draw-offer':
    case 'draw-accept':
    case 'draw-decline':
    case 'rematch':
      return roomAct(btn.dataset.act);
    case 'quick-chat':
      return roomAct('chat', { text: btn.dataset.text });
    default:
  }
}

function onChange(e) {
  const t = e.target;
  if (t.id === 'ai-level') {
    settings.aiLevel = t.value;
    save();
    renderModePanel();
    renderBoard();
  } else if (t.dataset.opt) {
    settings[t.dataset.opt] = t.checked;
    save();
    renderGame();
  } else if (t.id === 'room-hints') {
    settings.roomHints = t.checked;
    save();
  } else if (t.id === 'nick') readNick();
}

export function mountPlay(el) {
  root = el;
  root.innerHTML = LAYOUT;
  board = createBoard($('#board', root), { onMove });
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'join-code') joinRoom(e.target.value);
  });
  $('#chat-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    roomAct('chat', { text });
  });

  const roomId = new URL(location.href).searchParams.get('room');
  if (roomId) {
    settings.mode = 'online';
    save();
    renderAll();
    joinRoom(roomId);
    return;
  }
  if (settings.mode === 'online') renderAll();
  else newGame();
}
