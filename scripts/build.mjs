// 把网页（public/）和文章（docs/）合并到 dist/，作为 Cloudflare 部署的静态资源。
// wrangler dev / wrangler deploy 会自动先运行它（见 wrangler.jsonc 的 build 配置）。
import { cp, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

await rm(dist, { recursive: true, force: true });
await cp(new URL('public/', root), dist, { recursive: true });
await cp(new URL('docs/', root), new URL('docs/', dist), { recursive: true });
console.log('已生成 dist/');
