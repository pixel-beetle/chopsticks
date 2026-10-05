// 联机测试用的机器人对手：加入指定房间，轮到自己时按“完美”难度走棋，一局结束后自动申请再来一局。
// 运行：node scripts/bot.mjs <房间号> [服务器地址，默认 http://localhost:8080]
// 需要 Node.js 22 或更新的版本（内置 WebSocket）。
import { chooseMove } from '../public/js/ai.js';

const [roomId, base = 'http://localhost:8080'] = process.argv.slice(2);
if (!roomId) {
  console.error('用法：node scripts/bot.mjs <房间号> [服务器地址]');
  process.exit(1);
}

const post = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
};

const { token, seat } = await post(`/api/rooms/${roomId}/join`, { name: '机器人' });
if (seat === null) throw new Error('房间已满');
console.log(`已加入房间 ${roomId}，座位 ${seat}`);
await post(`/api/rooms/${roomId}/act`, { token, type: 'chat', text: '你好，我是测试机器人' });

const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws?token=${token}`);
setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25000);
let lastMoves = -1;
let lastGame = 0;
ws.onclose = () => {
  console.log('连接已断开');
  process.exit(0);
};
ws.onmessage = (e) => {
  if (e.data === 'pong') return;
  const { room } = JSON.parse(e.data);
  const m = room.match;
  if (m.result && room.game !== lastGame) {
    lastGame = room.game;
    console.log('本局结束：', JSON.stringify(m.result), '比分', room.score.join(':'));
    setTimeout(() => post(`/api/rooms/${roomId}/act`, { token, type: 'rematch' }).catch(() => {}), 500);
  }
  if (!m.result && m.turn === seat && room.seats.every(Boolean) && m.moves.length !== lastMoves) {
    lastMoves = m.moves.length;
    const { i, j } = chooseMove('perfect', m.hands[seat], m.hands[1 - seat]);
    setTimeout(() => post(`/api/rooms/${roomId}/act`, { token, type: 'move', i, j }).catch((err) => console.log(err.message)), 700);
  }
};
