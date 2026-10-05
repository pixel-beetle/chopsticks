// 文章页：读取 docs/ 下的研究文章并渲染，左侧是目录。
import { renderMarkdown } from './markdown.js';
import { $, esc } from './ui.js';

const DOC = '/docs/凑十碰手指-完整解剖.md';

export async function mountArticle(root) {
  root.innerHTML = '<div class="article-layout"><nav class="toc card" id="toc"></nav><article class="card article" id="article"><p class="muted">正在加载文章…</p></article></div>';
  let text;
  try {
    const res = await fetch(encodeURI(DOC));
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch {
    $('#article', root).innerHTML = '<p class="r-loss">文章加载失败。请用 <code>npm start</code> 启动服务器后再打开本页，或直接阅读 <code>docs/</code> 目录下的 Markdown 文件。</p>';
    return;
  }
  const { html, headings } = renderMarkdown(text);
  $('#article', root).innerHTML = html;
  $('#toc', root).innerHTML = `<div class="toc-title">目录</div>${headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => `<button type="button" class="toc-item toc-${h.level}" data-target="${h.id}">${esc(h.text)}</button>`)
    .join('')}`;
  $('#toc', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (b) document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
