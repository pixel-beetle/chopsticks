// 自检：讲解模块的结论与穷举求解一致；对局状态机的重复判和、悔棋、终局正确。
// 运行：npm test
import assert from 'node:assert/strict';
import * as G from '../public/js/game.js';
import * as E from '../public/js/explain.js';
import * as M from '../public/js/match.js';

const T = G.getTable();
const reach = G.reachableFrom();
let checkedMoves = 0;

for (const code of reach) {
  const { mine, theirs } = G.decode(code);
  E.positionStory(mine, theirs);
  for (const mv of G.analyzeMoves(mine, theirs, T)) {
    const story = E.moveStory(mine, theirs, mv.i, mv.j);
    assert.equal(story.result, mv.result, `讲解与求解不一致：${mine.join('')}|${theirs.join('')} 走 ${mv.i}${mv.j}`);
    checkedMoves++;
  }
}
console.log(`讲解结论与求解一致：${reach.size} 个可达局面，${checkedMoves} 步`);

// 对局：被迫的第一步、获胜、重复判和、悔棋
{
  let m = M.newMatch();
  m = M.playMove(m, 0, 0);
  assert.deepEqual(m.hands, [[2, 1], [1, 1]]);
  assert.equal(m.turn, 1);
  assert.throws(() => M.playMove(M.newMatch({ hands: [[0, 3], [1, 1]] }), 0, 0));

  const w = M.playMove(M.newMatch({ hands: [[0, 3], [7, 1]], turn: 0 }), 1, 0);
  assert.deepEqual(w.result, { winner: 0, reason: 'win' });

  // 用广度优先搜索找一条不消手、回到起始局面的路线，走两圈，起始局面第三次出现时应判和
  let r = M.newMatch({ hands: [[1, 2], [3, 4]], turn: 0 });
  const seq = [];
  const startKey = JSON.stringify([r.hands, r.turn]);
  const queue = [[r, []]];
  const visited = new Set([startKey]);
  let cycle = null;
  while (queue.length && !cycle) {
    const [cur, path] = queue.shift();
    for (const [i, j] of G.legalMoves(cur.hands[cur.turn], cur.hands[1 - cur.turn])) {
      const nx = M.playMove(cur, i, j);
      if (nx.result) continue;
      const key = JSON.stringify([nx.hands, nx.turn]);
      if (key === startKey) { cycle = [...path, [i, j]]; break; }
      if (visited.has(key) || path.length > 8) continue;
      visited.add(key);
      queue.push([nx, [...path, [i, j]]]);
    }
  }
  assert.ok(cycle, '应能找到回到起点的循环');
  for (let round = 0; round < 2; round++) for (const [i, j] of cycle) { r = M.playMove(r, i, j); seq.push(r.result); }
  assert.deepEqual(r.result, { winner: null, reason: 'repetition' }, '同一局面第三次出现应判和');
  assert.equal(seq.filter(Boolean).length, 1);

  const u = M.undo(r, 1);
  assert.equal(u.result, null);
  assert.equal(u.moves.length, r.moves.length - 1);
  console.log(`对局状态机正常（循环长度 ${cycle.length}，第三次重复判和）`);
}

// 复盘：文章 8.2 节的示范对局，第 5 步应被标为败着
{
  let m = M.newMatch();
  for (const [i, j] of [[0, 0], [1, 0], [0, 1], [0, 1], [0, 0]]) m = M.playMove(m, i, j);
  assert.deepEqual(m.hands, [[7, 1], [2, 3]]);
  const review = E.reviewMatch(m);
  assert.equal(review[4].tag, 'blunder');
  assert.ok(review.slice(0, 4).every((x) => x.tag === 'ok'));
  console.log('复盘标注正常（示范对局第 5 步为败着）');
}
