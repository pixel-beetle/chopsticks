// Cloudflare 部署入口：静态页面由 Workers 静态资源提供，联机房间每个对应一个 Durable Object。
// 房间状态写进 Durable Object 的存储；推送用可休眠的 WebSocket，没人操作时连接挂着也不占运行时间。
// 接口与本地 server/server.js 完全相同，房间规则共用 server/rooms.js。

import { DurableObject } from 'cloudflare:workers';
import { ROOM_IDLE_MS, RoomError, act, createRoom, joinRoom, parseBody, seatOf, snapshot } from '../server/rooms.js';

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

function errorResponse(e) {
  if (e instanceof RoomError) return json(e.status, { error: e.message });
  console.error(e);
  return json(500, { error: '服务器出错了' });
}

const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const parts = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', id, action]
      if (parts[1] !== 'rooms') throw new RoomError(404, '接口不存在');

      if (parts.length === 2 && request.method === 'POST') {
        const body = await request.text();
        for (let k = 0; k < 30; k++) {
          const id = String(1000 + Math.floor(Math.random() * 9000));
          const stub = env.ROOMS.get(env.ROOMS.idFromName(id));
          const res = await stub.fetch(`https://room/api/rooms/${id}/init`, { method: 'POST', body });
          if (res.status !== 409) return res;
        }
        throw new RoomError(503, '房间太多了，请稍后再试');
      }

      const [, , id, action] = parts;
      if (!/^\d{4}$/.test(id ?? '') || !['join', 'act', 'ws'].includes(action)) throw new RoomError(404, '接口不存在');
      return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(request);
    } catch (e) {
      return errorResponse(e);
    }
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    // 浏览器每 25 秒发一次 ping，由运行时直接回 pong，不会唤醒房间
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) ?? null;
    });
  }

  sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  presence() {
    const online = [false, false];
    let spectators = 0;
    for (const ws of this.sockets()) {
      const seat = seatOf(this.room, ws.deserializeAttachment()?.token ?? null);
      if (seat === null) spectators++;
      else online[seat] = true;
    }
    return { online, spectators };
  }

  active() {
    return Boolean(this.room) && (this.sockets().length > 0 || Date.now() - this.room.updatedAt < ROOM_IDLE_MS);
  }

  async save() {
    this.room.updatedAt = Date.now();
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS + 60000);
  }

  broadcast() {
    if (!this.room) return;
    const text = JSON.stringify({ type: 'room', room: snapshot(this.room, this.presence()) });
    for (const ws of this.sockets()) {
      try {
        ws.send(text);
      } catch {
        // 连接正在关闭，忽略
      }
    }
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const [, , id, action] = url.pathname.split('/').filter(Boolean);
      // 先读完请求体再做任何判断：转发过来的请求如果没读完就返回，运行时会报错
      const text = request.method === 'POST' ? await request.text() : '';

      if (action === 'init') {
        if (this.active()) return json(409, { error: '房间号已被占用' });
        const token = newToken();
        this.room = createRoom(parseBody(text), { id, token });
        await this.save();
        return json(200, { roomId: id, token, seat: 0 });
      }

      if (!this.active()) throw new RoomError(404, `房间 ${id} 不存在或已过期`);

      if (action === 'ws') {
        if (request.headers.get('Upgrade') !== 'websocket') throw new RoomError(426, '需要 WebSocket 连接');
        const { 0: client, 1: server } = new WebSocketPair();
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ token: url.searchParams.get('token') || null });
        this.broadcast();
        return new Response(null, { status: 101, webSocket: client });
      }

      if (request.method !== 'POST') throw new RoomError(405, '不支持的请求方式');
      const body = parseBody(text);
      if (action === 'join') {
        const seatOnline = (seat) => this.presence().online[seat];
        const r = joinRoom(this.room, body, { seatOnline, newToken });
        await this.save();
        this.broadcast();
        return json(200, { roomId: this.room.id, ...r });
      }
      if (action === 'act') {
        act(this.room, seatOf(this.room, body.token), body);
        await this.save();
        this.broadcast();
        return json(200, { ok: true });
      }
      throw new RoomError(404, '接口不存在');
    } catch (e) {
      return errorResponse(e);
    }
  }

  async webSocketClose(ws) {
    try {
      ws.close(1000, 'bye');
    } catch {
      // 已经关闭
    }
    this.broadcast();
  }

  async webSocketError() {
    this.broadcast();
  }

  async alarm() {
    if (!this.room) return;
    if (this.sockets().length === 0 && Date.now() - this.room.updatedAt >= ROOM_IDLE_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
    } else await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_MS + 60000);
  }
}
