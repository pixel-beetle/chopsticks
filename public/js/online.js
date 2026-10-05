// 联机客户端：创建或加入房间，通过 WebSocket 接收服务器推送的房间状态，用 POST 提交走棋等操作。
// 本地 npm start 的服务器和 Cloudflare Worker 使用同一套接口。
import { store } from './ui.js';

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    const e = new Error('连不上联机服务器。请通过 npm start 启动的地址或部署好的网址打开本页。');
    e.status = 0;
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `请求失败（${res.status}）`);
    e.status = res.status;
    throw e;
  }
  return data;
}

// 座位凭证：sessionStorage 只属于当前标签页（刷新后仍在），localStorage 留一份备用（关掉标签页后再打开链接也能回到座位）。
function savedToken(roomId) {
  try {
    const own = sessionStorage.getItem(`chop.token.${roomId}`);
    if (own) return { token: own, resume: 'session' };
  } catch {
    // 忽略
  }
  const local = store.get('tokens', {})[roomId];
  return local ? { token: local, resume: 'local' } : { token: null, resume: null };
}
function saveToken(roomId, token) {
  try {
    if (token) sessionStorage.setItem(`chop.token.${roomId}`, token);
    else sessionStorage.removeItem(`chop.token.${roomId}`);
  } catch {
    // 忽略
  }
  const all = store.get('tokens', {});
  if (token) all[roomId] = token;
  else delete all[roomId];
  store.set('tokens', all);
}

const PING_MS = 25000;

export class OnlineClient {
  /**
   * @param {{ onRoom: (room: object) => void, onConnection: (state: 'online' | 'reconnecting' | 'closed', msg?: string) => void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.roomId = null;
    this.token = null;
    this.seat = null;
    this.ws = null;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  async create({ name, first, allowHints }) {
    const r = await post('/api/rooms', { name, first, allowHints });
    this.attach(r);
    return r;
  }

  async join(roomId, name) {
    const r = await post(`/api/rooms/${encodeURIComponent(roomId)}/join`, { name, ...savedToken(roomId) });
    this.attach(r);
    return r;
  }

  attach({ roomId, token, seat }) {
    this.roomId = roomId;
    this.token = token;
    this.seat = seat;
    if (token) saveToken(roomId, token);
    this.connect();
  }

  connect() {
    this.closeSocket();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${encodeURIComponent(this.roomId)}/ws?token=${encodeURIComponent(this.token ?? '')}`);
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onConnection('online');
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'room') this.handlers.onRoom(msg.room);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.handlers.onConnection('reconnecting');
      this.retryTimer = setTimeout(() => this.rejoin(), 2000);
    };
  }

  /** 断线后先确认房间还在、拿回座位，再重新连接。 */
  async rejoin() {
    const roomId = this.roomId;
    if (!roomId) return;
    try {
      const r = await post(`/api/rooms/${encodeURIComponent(roomId)}/join`, savedToken(roomId));
      if (this.roomId === roomId) this.attach(r);
    } catch (e) {
      if (this.roomId !== roomId) return;
      if (e.status === 404) {
        this.close();
        this.handlers.onConnection('closed', e.message);
      } else this.retryTimer = setTimeout(() => this.rejoin(), 4000);
    }
  }

  act(type, payload = {}) {
    return post(`/api/rooms/${encodeURIComponent(this.roomId)}/act`, { token: this.token, type, ...payload });
  }

  async leave() {
    if (this.roomId && this.token) {
      try {
        await this.act('leave');
      } catch {
        // 离开失败也照样断开
      }
      saveToken(this.roomId, null);
    }
    this.close();
  }

  closeSocket() {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  close() {
    this.closeSocket();
    this.roomId = null;
    this.token = null;
    this.seat = null;
  }
}
