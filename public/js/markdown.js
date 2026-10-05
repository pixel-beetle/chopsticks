// 足够渲染本项目文章的 Markdown 子集：标题、段落、粗体、行内代码、链接、代码块、引用、表格、嵌套列表、分隔线。
import { esc } from './ui.js';

export function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => `<code>${esc(codes[Number(k)])}</code>`);
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function renderList(items) {
  let html = '';
  const stack = [];
  for (const it of items) {
    while (stack.length && it.indent < stack.at(-1).indent) html += `</li></${stack.pop().tag}>`;
    if (!stack.length || it.indent > stack.at(-1).indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      const start = it.ordered && it.number !== 1 ? ` start="${it.number}"` : '';
      stack.push({ indent: it.indent, tag });
      html += `<${tag}${start}><li>`;
    } else html += '</li><li>';
    html += inline(it.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** 返回 { html, headings: [{ level, text, id }] } */
export function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const id = `h-${headings.length}`;
      headings.push({ level, text: h[2].replace(/\*\*/g, ''), id });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n')).html}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      out.push(
        `<div class="table-scroll"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(LIST_ITEM);
        if (m) {
          items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), number: parseInt(m[2], 10) || 1, text: m[3] });
          i++;
        } else if (l.trim() && /^\s+/.test(l) && items.length) {
          items.at(-1).text += ` ${l.trim()}`;
          i++;
        } else break;
      }
      out.push(renderList(items));
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|-{3,}\s*$)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !lines[i].trim().startsWith('|')
    ) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${inline(para.join(''))}</p>`);
  }
  return { html: out.join('\n'), headings };
}
