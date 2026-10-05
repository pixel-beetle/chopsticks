// 联机客户端：创建或加入房间，订阅服务器推送的房间状态，提交走棋等操作。
import { store } from './ui.js';

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('连不上服务器。联机需要用 npm start 启动的服务器打开本页面。');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
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

export class OnlineClient {
  /**
   * @param {{ onRoom: (room: object) => void, onConnection: (state: 'online' | 'reconnecting' | 'closed', msg?: string) => void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.roomId = null;
    this.token = null;
    this.seat = null;
    this.es = null;
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
    this.es?.close();
    const url = `/api/rooms/${encodeURIComponent(this.roomId)}/events?token=${encodeURIComponent(this.token ?? '')}`;
    const es = new EventSource(url);
    this.es = es;
    es.addEventListener('room', (e) => this.handlers.onRoom(JSON.parse(e.data)));
    es.onopen = () => this.handlers.onConnection('online');
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        this.handlers.onConnection('closed', '房间不存在或已过期');
      } else this.handlers.onConnection('reconnecting');
    };
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

  close() {
    this.es?.close();
    this.es = null;
    this.roomId = null;
    this.token = null;
    this.seat = null;
  }
}
