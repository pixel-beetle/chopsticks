// 页面入口：按地址栏的 #play / #drill / #ref / #doc 切换四个页面，首次打开时才初始化。
import { mountPlay } from './play.js';
import { mountDrills } from './drills.js';
import { mountReference } from './reference.js';
import { mountArticle } from './article.js';
import { $, $$ } from './ui.js';

const VIEWS = { play: mountPlay, drill: mountDrills, ref: mountReference, doc: mountArticle };
const mounted = new Set();

function show() {
  const name = location.hash.slice(1);
  const view = VIEWS[name] ? name : 'play';
  for (const key of Object.keys(VIEWS)) $(`#view-${key}`).hidden = key !== view;
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
  if (!mounted.has(view)) {
    mounted.add(view);
    VIEWS[view]($(`#view-${view}`));
  }
}

window.addEventListener('hashchange', () => {
  show();
  window.scrollTo(0, 0);
});
show();
