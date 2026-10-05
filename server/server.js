// 凑十碰手指的网页服务器：提供静态页面，并承担联机对局的房间与裁判。
// 零依赖：服务器到浏览器用 Server-Sent Events 推送房间状态，浏览器到服务器用 POST 提交操作。
// 运行：npm start（默认端口 8080，可用环境变量 PORT 修改）

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { newMatch, playMove, finish } from '../public/js/match.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOUNTS = [
  ['/docs/', path.join(ROOT, 'docs')],
  ['/', path.join(ROOT, 'public')],
];
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_ROOMS = 2000;
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_CHAT = 40;
const MAX_BODY = 4096;

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {{ token: string, name: string }} Seat
 * @typedef {{ res: http.ServerResponse, token: string | null }} Client
 * @typedef {{
 *   id: string, seats: (Seat | null)[], clients: Set<Client>, match: object, first: number,
 *   game: number, score: number[], drawOffer: number | null, rematch: boolean[],
 *   chat: { seat: number | null, name: string, text: string, t: number }[],
 *   allowHints: boolean, updatedAt: number
 * }} Room
 */

function newRoomId() {
  for (let k = 0; k < 50; k++) {
    const id = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(id)) return id;
  }
  throw new HttpError(503, '房间太多了，请稍后再试');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanName(name, fallback) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || fallback;
}

function seatOf(room, token) {
  if (!token) return null;
  const k = room.seats.findIndex((s) => s && s.token === token);
  return k === -1 ? null : k;
}

function snapshot(room) {
  const online = [0, 0];
  let spectators = 0;
  for (const c of room.clients) {
    const seat = seatOf(room, c.token);
    if (seat === null) spectators++;
    else online[seat]++;
  }
  return {
    id: room.id,
    seats: room.seats.map((s, k) => (s ? { name: s.name, online: online[k] > 0 } : null)),
    // 座位空出来以后仍保留上一位玩家的名字，棋谱和结局里用
    names: (room.names = room.seats.map((s, k) => (s ? s.name : room.names?.[k] ?? ''))),
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

function send(client, data) {
  client.res.write(`event: room\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  room.updatedAt = Date.now();
  const data = snapshot(room);
  for (const c of room.clients) send(c, data);
}

function settle(room) {
  const r = room.match.result;
  if (!r) return;
  if (r.winner === null) room.score[2]++;
  else room.score[r.winner]++;
  room.drawOffer = null;
  room.rematch = [false, false];
}

function createRoom({ name, allowHints, first }) {
  if (rooms.size >= MAX_ROOMS) throw new HttpError(503, '房间太多了，请稍后再试');
  const token = randomBytes(16).toString('hex');
  const startSeat = first === 1 ? 1 : first === 'random' ? Math.round(Math.random()) : 0;
  const room = {
    id: newRoomId(),
    seats: [{ token, name: cleanName(name, '玩家一') }, null],
    clients: new Set(),
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
  rooms.set(room.id, room);
  return { room, token, seat: 0 };
}

function seatOnline(room, seat) {
  for (const c of room.clients) if (seatOf(room, c.token) === seat) return true;
  return false;
}

/** resume 为 'local' 表示凭证来自本机其他标签页保存的记录：只有那个座位离线时才接管，避免同一浏览器的两个标签页抢同一个座位。 */
function joinRoom(room, { name, token, resume }) {
  const existing = seatOf(room, token);
  if (existing !== null && (resume !== 'local' || !seatOnline(room, existing))) {
    if (name) room.seats[existing].name = cleanName(name, room.seats[existing].name);
    return { token, seat: existing };
  }
  const free = room.seats.findIndex((s) => s === null);
  if (free === -1) return { token: null, seat: null };
  const newToken = randomBytes(16).toString('hex');
  room.seats[free] = { token: newToken, name: cleanName(name, free === 0 ? '玩家一' : '玩家二') };
  if (room.match.result || room.match.moves.length) {
    // 换了新对手：重新开始，比分清零
    room.match = newMatch({ turn: room.first });
    room.game = 1;
    room.score = [0, 0, 0];
    room.rematch = [false, false];
    room.drawOffer = null;
  }
  return { token: newToken, seat: free };
}

function act(room, seat, body) {
  if (seat === null) throw new HttpError(403, '你是观战者，不能操作');
  const full = room.seats.every(Boolean);
  const m = room.match;
  switch (body.type) {
    case 'move': {
      if (!full) throw new HttpError(409, '等对手加入后才能开始');
      if (m.result) throw new HttpError(409, '这一局已经结束');
      if (m.turn !== seat) throw new HttpError(409, '还没轮到你');
      try {
        room.match = playMove(m, body.i, body.j);
      } catch (e) {
        throw new HttpError(400, e.message);
      }
      room.drawOffer = null;
      settle(room);
      return;
    }
    case 'resign':
      if (!full || m.result || m.moves.length === 0) throw new HttpError(409, '现在不能认输');
      room.match = finish(m, { winner: 1 - seat, reason: 'resign' });
      settle(room);
      return;
    case 'draw-offer':
      if (!full || m.result) throw new HttpError(409, '现在不能提和');
      if (room.drawOffer === 1 - seat) {
        room.match = finish(m, { winner: null, reason: 'agreement' });
        settle(room);
      } else room.drawOffer = seat;
      return;
    case 'draw-accept':
      if (room.drawOffer !== 1 - seat || m.result) throw new HttpError(409, '对方没有提和');
      room.match = finish(m, { winner: null, reason: 'agreement' });
      settle(room);
      return;
    case 'draw-decline':
      if (room.drawOffer === 1 - seat) room.drawOffer = null;
      return;
    case 'rematch':
      if (!m.result) throw new HttpError(409, '这一局还没结束');
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
      room.seats[seat].name = cleanName(body.name, room.seats[seat].name);
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
      throw new HttpError(400, '未知操作');
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '请求太大');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求格式不对');
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function getRoom(id) {
  const room = rooms.get(id);
  if (!room) throw new HttpError(404, `房间 ${id} 不存在或已过期`);
  return room;
}

function openEvents(req, res, room, token) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const client = { res, token };
  room.clients.add(client);
  broadcast(room);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    room.clients.delete(client);
    if (rooms.has(room.id)) broadcast(room);
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', id, action]
  if (parts[1] !== 'rooms') throw new HttpError(404, '接口不存在');

  if (parts.length === 2 && req.method === 'POST') {
    const body = await readJson(req);
    const { room, token, seat } = createRoom(body);
    return json(res, 200, { roomId: room.id, token, seat });
  }

  const room = getRoom(parts[2]);
  const action = parts[3];

  if (action === 'events' && req.method === 'GET') return openEvents(req, res, room, url.searchParams.get('token'));

  if (action === 'join' && req.method === 'POST') {
    const body = await readJson(req);
    const r = joinRoom(room, body);
    broadcast(room);
    return json(res, 200, { roomId: room.id, ...r });
  }

  if (action === 'act' && req.method === 'POST') {
    const body = await readJson(req);
    act(room, seatOf(room, body.token), body);
    broadcast(room);
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, '接口不存在');
}

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '路径不合法');
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    let file = path.join(dir, pathname.slice(prefix.length));
    if (file !== dir && !file.startsWith(dir + path.sep)) throw new HttpError(403, '禁止访问');
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      return res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      // 继续尝试下一个挂载点
    }
  }
  throw new HttpError(404, '找不到页面');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else throw new HttpError(405, '不支持的请求方式');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? '服务器出错了' : e.message });
    else res.end();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clients.size === 0 && now - room.updatedAt > ROOM_IDLE_MS) rooms.delete(id);
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`凑十碰手指已启动：http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  局域网内其他设备访问：http://${a.address}:${PORT}/`);
    }
  }
});
