// 联机房间的规则：创建、入座、走棋与各种操作、对外快照。
// 本地 Node 服务器（server/server.js）和 Cloudflare Worker（worker/index.js）共用。
// 房间状态是纯 JSON 对象，可以直接写进 Durable Object 的存储。

import { finish, newMatch, playMove } from '../public/js/match.js';

export const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_CHAT = 40;

export class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function cleanName(name, fallback) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || fallback;
}

export function seatOf(room, token) {
  if (!token) return null;
  const k = room.seats.findIndex((s) => s && s.token === token);
  return k === -1 ? null : k;
}

export function createRoom({ name, allowHints, first } = {}, { id, token }) {
  const startSeat = first === 1 ? 1 : first === 'random' ? Math.round(Math.random()) : 0;
  const creator = cleanName(name, '玩家一');
  return {
    id,
    seats: [{ token, name: creator }, null],
    names: [creator, ''], // 座位空出来以后仍保留上一位玩家的名字，棋谱和结局里用
    match: newMatch({ turn: startSeat }),
    first: startSeat,
    game: 1,
    score: [0, 0, 0],
    drawOffer: null,
    rematch: [false, false],
    chat: [],
    allowHints: Boolean(allowHints),
    updatedAt: Date.now(),
  };
}

/**
 * 入座或重连。resume 为 'local' 表示凭证来自本机其他标签页保存的记录：
 * 只有那个座位离线时才接管，避免同一浏览器的两个标签页抢同一个座位。
 * seatOnline(seat) 由调用方提供，表示该座位当前是否有连接。
 */
export function joinRoom(room, { name, token, resume } = {}, { seatOnline, newToken }) {
  const existing = seatOf(room, token);
  if (existing !== null && (resume !== 'local' || !seatOnline(existing))) {
    if (name) room.names[existing] = room.seats[existing].name = cleanName(name, room.seats[existing].name);
    return { token, seat: existing };
  }
  const free = room.seats.findIndex((s) => s === null);
  if (free === -1) return { token: null, seat: null };
  const seatToken = newToken();
  const seatName = cleanName(name, free === 0 ? '玩家一' : '玩家二');
  room.seats[free] = { token: seatToken, name: seatName };
  room.names[free] = seatName;
  if (room.match.result || room.match.moves.length) {
    // 换了新对手：重新开始，比分清零
    room.match = newMatch({ turn: room.first });
    room.game = 1;
    room.score = [0, 0, 0];
    room.rematch = [false, false];
    room.drawOffer = null;
  }
  return { token: seatToken, seat: free };
}

function settle(room) {
  const r = room.match.result;
  if (!r) return;
  if (r.winner === null) room.score[2]++;
  else room.score[r.winner]++;
  room.drawOffer = null;
  room.rematch = [false, false];
}

/** 执行一个操作；不合法时抛出 RoomError。 */
export function act(room, seat, body) {
  if (seat === null) throw new RoomError(403, '你是观战者，不能操作');
  const full = room.seats.every(Boolean);
  const m = room.match;
  switch (body.type) {
    case 'move': {
      if (!full) throw new RoomError(409, '等对手加入后才能开始');
      if (m.result) throw new RoomError(409, '这一局已经结束');
      if (m.turn !== seat) throw new RoomError(409, '还没轮到你');
      try {
        room.match = playMove(m, body.i, body.j);
      } catch (e) {
        throw new RoomError(400, e.message);
      }
      room.drawOffer = null;
      settle(room);
      return;
    }
    case 'resign':
      if (!full || m.result || m.moves.length === 0) throw new RoomError(409, '现在不能认输');
      room.match = finish(m, { winner: 1 - seat, reason: 'resign' });
      settle(room);
      return;
    case 'draw-offer':
      if (!full || m.result) throw new RoomError(409, '现在不能提和');
      if (room.drawOffer === 1 - seat) {
        room.match = finish(m, { winner: null, reason: 'agreement' });
        settle(room);
      } else room.drawOffer = seat;
      return;
    case 'draw-accept':
      if (room.drawOffer !== 1 - seat || m.result) throw new RoomError(409, '对方没有提和');
      room.match = finish(m, { winner: null, reason: 'agreement' });
      settle(room);
      return;
    case 'draw-decline':
      if (room.drawOffer === 1 - seat) room.drawOffer = null;
      return;
    case 'rematch':
      if (!m.result) throw new RoomError(409, '这一局还没结束');
      room.rematch[seat] = true;
      if (room.rematch.every(Boolean)) {
        room.first = 1 - room.first;
        room.match = newMatch({ turn: room.first });
        room.game++;
        room.rematch = [false, false];
        room.drawOffer = null;
      }
      return;
    case 'chat': {
      const text = String(body.text ?? '').trim().slice(0, 120);
      if (!text) return;
      room.chat = [...room.chat, { seat, name: room.seats[seat].name, text, t: Date.now() }].slice(-MAX_CHAT);
      return;
    }
    case 'rename':
      room.names[seat] = room.seats[seat].name = cleanName(body.name, room.seats[seat].name);
      return;
    case 'leave':
      if (full && !m.result && m.moves.length > 0) {
        room.match = finish(m, { winner: 1 - seat, reason: 'leave' });
        settle(room);
      }
      room.seats[seat] = null;
      room.rematch = [false, false];
      room.drawOffer = null;
      return;
    default:
      throw new RoomError(400, '未知操作');
  }
}

/** 发给浏览器的房间快照（不含任何座位凭证）。online[k] 表示座位 k 是否在线。 */
export function snapshot(room, { online = [false, false], spectators = 0 } = {}) {
  return {
    id: room.id,
    seats: room.seats.map((s, k) => (s ? { name: s.name, online: Boolean(online[k]) } : null)),
    names: room.names,
    spectators,
    match: room.match,
    game: room.game,
    score: room.score,
    drawOffer: room.drawOffer,
    rematch: room.rematch,
    chat: room.chat,
    allowHints: room.allowHints,
  };
}

/** 解析请求体：只接受 JSON 对象。 */
export function parseBody(text, maxBytes = 4096) {
  if (text.length > maxBytes) throw new RoomError(413, '请求太大');
  if (!text) return {};
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new RoomError(400, '请求格式不对');
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
