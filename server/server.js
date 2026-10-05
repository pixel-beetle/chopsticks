// 凑十碰手指的本地服务器：提供静态页面，并承担联机房间。适合局域网对战和开发调试。
// 零依赖：浏览器用 POST 提交操作，服务器通过 WebSocket 推送房间状态（这里实现了够用的最小 WebSocket）。
// 部署到 Cloudflare 时用的是 worker/index.js，两边共用 server/rooms.js 里的房间规则。
// 运行：npm start（默认端口 8080，可用环境变量 PORT 修改）

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { ROOM_IDLE_MS, RoomError, act, createRoom, joinRoom, parseBody, seatOf, snapshot } from './rooms.js';

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
const MAX_BODY = 4096;

/**
 * @typedef {{ token: string | null, send(text: string): void, close(): void, lastSeen: number }} Client
 * @type {Map<string, { state: object, clients: Set<Client> }>}
 */
const rooms = new Map();
const newToken = () => randomBytes(16).toString('hex');

function newRoomId() {
  for (let k = 0; k < 50; k++) {
    const id = String(1000 + Math.floor(Math.random() * 9000));
    if (!rooms.has(id)) return id;
  }
  throw new RoomError(503, '房间太多了，请稍后再试');
}

function presence(entry) {
  const online = [false, false];
  let spectators = 0;
  for (const c of entry.clients) {
    const seat = seatOf(entry.state, c.token);
    if (seat === null) spectators++;
    else online[seat] = true;
  }
  return { online, spectators };
}

function broadcast(entry) {
  entry.state.updatedAt = Date.now();
  const text = JSON.stringify({ type: 'room', room: snapshot(entry.state, presence(entry)) });
  for (const c of entry.clients) c.send(text);
}

function getRoom(id) {
  const entry = rooms.get(id);
  if (!entry) throw new RoomError(404, `房间 ${id} 不存在或已过期`);
  return entry;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RoomError(413, '请求太大');
    chunks.push(chunk);
  }
  return parseBody(Buffer.concat(chunks).toString('utf8'), MAX_BODY);
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', id, action]
  if (parts[1] !== 'rooms' || req.method !== 'POST') throw new RoomError(404, '接口不存在');

  if (parts.length === 2) {
    if (rooms.size >= MAX_ROOMS) throw new RoomError(503, '房间太多了，请稍后再试');
    const body = await readJson(req);
    const id = newRoomId();
    const token = newToken();
    rooms.set(id, { state: createRoom(body, { id, token }), clients: new Set() });
    return json(res, 200, { roomId: id, token, seat: 0 });
  }

  const entry = getRoom(parts[2]);
  const body = await readJson(req);
  if (parts[3] === 'join') {
    const seatOnline = (seat) => presence(entry).online[seat];
    const r = joinRoom(entry.state, body, { seatOnline, newToken });
    broadcast(entry);
    return json(res, 200, { roomId: entry.state.id, ...r });
  }
  if (parts[3] === 'act') {
    act(entry.state, seatOf(entry.state, body.token), body);
    broadcast(entry);
    return json(res, 200, { ok: true });
  }
  throw new RoomError(404, '接口不存在');
}

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new RoomError(400, '路径不合法');
  }
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    let file = path.join(dir, pathname.slice(prefix.length));
    if (file !== dir && !file.startsWith(dir + path.sep)) throw new RoomError(403, '禁止访问');
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
  throw new RoomError(404, '找不到页面');
}

// ---------- 最小 WebSocket：握手、发送文本帧、处理关闭帧与心跳 ----------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (data.length < 126) head = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([head, data]);
}

function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/rooms\/(\d{4})\/ws$/);
  const entry = m && rooms.get(m[1]);
  const key = req.headers['sec-websocket-key'];
  if (!entry || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return rejectUpgrade(socket, 404, 'Not Found');

  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const client = {
    token: url.searchParams.get('token') || null,
    lastSeen: Date.now(),
    send: (text) => socket.writable && socket.write(wsFrame(text)),
    close: () => socket.destroy(),
  };
  entry.clients.add(client);
  broadcast(entry);

  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  socket.on('data', (chunk) => {
    client.lastSeen = Date.now();
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (len > 64 * 1024) return socket.destroy();
      const maskAt = offset;
      if (masked) offset += 4;
      if (buf.length < offset + len) return;
      const payload = Buffer.from(buf.subarray(offset, offset + len));
      if (masked) for (let k = 0; k < payload.length; k++) payload[k] ^= buf[maskAt + (k % 4)];
      buf = buf.subarray(offset + len);
      if (opcode === 0x8) {
        socket.end(wsFrame(Buffer.alloc(0), 0x8));
        return;
      }
      if (opcode === 0x9) socket.write(wsFrame(payload, 0xa));
      else if (opcode === 0x1 && payload.toString() === 'ping') client.send('pong');
    }
  });
  const drop = () => {
    if (!entry.clients.delete(client)) return;
    if (rooms.has(entry.state.id)) broadcast(entry);
  };
  socket.on('close', drop);
  socket.on('error', drop);
}

// ---------- 启动 ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, url);
    else throw new RoomError(405, '不支持的请求方式');
  } catch (e) {
    const status = e instanceof RoomError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? '服务器出错了' : e.message });
    else res.end();
  }
});

server.on('upgrade', handleUpgrade);

// 清理：断掉 75 秒没有心跳的连接，删除闲置太久的房间
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of rooms) {
    for (const c of entry.clients) if (now - c.lastSeen > 75000) c.close();
    if (entry.clients.size === 0 && now - entry.state.updatedAt > ROOM_IDLE_MS) rooms.delete(id);
  }
}, 30000).unref();

server.listen(PORT, HOST, () => {
  console.log(`凑十碰手指已启动：http://localhost:${PORT}/`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  局域网内其他设备访问：http://${a.address}:${PORT}/`);
    }
  }
});
