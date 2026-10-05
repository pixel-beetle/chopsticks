// 联机接口的集成测试：对本地服务器或 Cloudflare（wrangler dev / 已部署的网址）都适用。
// 运行：node scripts/online-test.mjs [服务器地址，默认 http://localhost:8080]
// 需要 Node.js 22 或更新的版本（内置 WebSocket）。
import assert from 'node:assert/strict';
import { chooseMove } from '../public/js/ai.js';

const base = process.argv[2] ?? 'http://localhost:8080';
const wsBase = base.replace(/^http/, 'ws');

async function post(url, body) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

/** 打开一条推送连接，记录收到的每个房间快照。 */
function listen(roomId, token) {
  const ws = new WebSocket(`${wsBase}/api/rooms/${roomId}/ws?token=${token ?? ''}`);
  const conn = { ws, last: null, waiters: [] };
  ws.onmessage = (e) => {
    if (e.data === 'pong') {
      conn.pong = true;
      return;
    }
    conn.last = JSON.parse(e.data).room;
    conn.waiters = conn.waiters.filter((w) => !w(conn.last));
  };
  conn.until = (pred, ms = 8000) =>
    new Promise((resolve, reject) => {
      if (conn.last && pred(conn.last)) return resolve(conn.last);
      const timer = setTimeout(() => reject(new Error('等待房间状态超时')), ms);
      conn.waiters.push((room) => {
        if (!pred(room)) return false;
        clearTimeout(timer);
        resolve(room);
        return true;
      });
    });
  conn.opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('WebSocket 连接失败'));
  });
  return conn;
}

const step = (msg) => console.log(`✓ ${msg}`);

const created = await post('/api/rooms', { name: '甲', first: 0, allowHints: false });
assert.equal(created.status, 200);
const { roomId, token: tA } = created.data;
step(`创建房间 ${roomId}`);

const A = listen(roomId, tA);
await A.opened;
let room = await A.until((r) => r.seats[0]?.online);
assert.equal(room.seats[1], null);
step('房主连上推送，显示在线，等待对手');

const joined = await post(`/api/rooms/${roomId}/join`, { name: '乙' });
assert.equal(joined.data.seat, 1);
const tB = joined.data.token;
const B = listen(roomId, tB);
await B.opened;
room = await A.until((r) => r.seats[1]?.online);
step('对手加入，双方都在线');

assert.equal((await post(`/api/rooms/${roomId}/act`, { token: tB, type: 'move', i: 0, j: 0 })).status, 409);
assert.equal((await post(`/api/rooms/${roomId}/act`, { token: tA, type: 'move', i: 7, j: 0 })).status, 400);
assert.equal((await post(`/api/rooms/${roomId}/act`, { token: 'nope', type: 'move', i: 0, j: 0 })).status, 403);
step('没轮到、走法非法、冒充身份都会被拒绝');

const spectator = await post(`/api/rooms/${roomId}/join`, { name: '丙' });
assert.equal(spectator.data.seat, null);
const C = listen(roomId, null);
await C.opened;
await A.until((r) => r.spectators === 1);
step('第三个人加入时成为观战者');

// 完美对完美：一定以“同一局面第三次出现”判和结束
const tokens = [tA, tB];
for (let ply = 0; ply < 3000; ply++) {
  room = await A.until((r) => r.match.moves.length === ply || r.match.result);
  if (room.match.result) break;
  const m = room.match;
  const p = m.turn;
  const { i, j } = chooseMove('perfect', m.hands[p], m.hands[1 - p]);
  const r = await post(`/api/rooms/${roomId}/act`, { token: tokens[p], type: 'move', i, j });
  assert.equal(r.status, 200, r.data.error);
}
room = await C.until((r) => r.match.result);
assert.deepEqual(room.match.result, { winner: null, reason: 'repetition' });
assert.deepEqual(room.score, [0, 0, 1]);
step(`完美对完美下了 ${room.match.moves.length} 步，重复判和；观战者同步收到结果`);

await post(`/api/rooms/${roomId}/act`, { token: tA, type: 'rematch' });
await post(`/api/rooms/${roomId}/act`, { token: tB, type: 'rematch' });
room = await A.until((r) => r.game === 2);
assert.equal(room.match.turn, 1);
step('再来一局：第 2 局由乙先走');

await post(`/api/rooms/${roomId}/act`, { token: tB, type: 'move', i: 0, j: 0 });
await post(`/api/rooms/${roomId}/act`, { token: tA, type: 'resign' });
room = await B.until((r) => r.match.result);
assert.deepEqual(room.match.result, { winner: 1, reason: 'resign' });
assert.deepEqual(room.score, [0, 1, 1]);
step('认输后比分 0 : 1，和 1');

await post(`/api/rooms/${roomId}/act`, { token: tA, type: 'chat', text: '再见' });
room = await B.until((r) => r.chat.length === 1);
assert.equal(room.chat[0].name, '甲');
step('聊天消息送达');

B.ws.close();
await A.until((r) => r.seats[1] && !r.seats[1].online);
step('乙断线后显示离线');

const back = await post(`/api/rooms/${roomId}/join`, { token: tB, resume: 'session' });
assert.equal(back.data.seat, 1);
const B2 = listen(roomId, tB);
await B2.opened;
await A.until((r) => r.seats[1]?.online);
step('乙用原凭证重连，回到原座位');

B2.ws.send('ping');
await new Promise((r) => setTimeout(r, 500));
assert.ok(B2.pong, '应收到 pong');
step('心跳 ping/pong 正常');

await post(`/api/rooms/${roomId}/act`, { token: tB, type: 'leave' });
room = await A.until((r) => r.seats[1] === null);
assert.equal(room.names[1], '乙');
step('乙离开房间，座位空出，名字保留');

assert.equal((await post('/api/rooms/0000/join', {})).status, 404);
step('不存在的房间返回 404');

const page = await fetch(base + '/');
assert.equal(page.status, 200);
const doc = await fetch(`${base}/docs/${encodeURIComponent('凑十碰手指-完整解剖.md')}`);
assert.equal(doc.status, 200);
assert.match(await doc.text(), /凑十碰手指/);
step('首页和文章文件可以访问');

for (const c of [A, B2, C]) c.ws.close();
console.log('\n全部通过');
process.exit(0);
