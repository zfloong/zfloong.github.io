/**
 * 拖动排序（指针事件）
 *
 * 编辑模式下：卡片可在同组内 / 跨组 / 跨分类拖动，顶部页签也能拖动换序。
 * 卡片拖到某个页签上停一会儿（DWELL_MS）会切到那个分类，所以"跨分类"就是
 * 把卡片拖到目标页签上等它切过去，再放进目标分组。
 *
 * 用指针事件而不是 HTML5 拖放：drag 事件在触摸屏上不可用，拖影也不可控；
 * 这里自己画一个跟手的克隆 + 一个撑开布局的占位符。
 */

const PIN_TOL = 5;      // 位移超过几像素才算拖动，否则算点击
const DWELL_MS = 450;   // 拖到页签上停多久切分类

let drag = null;
let dwellTimer = null;
let dwellTab = null;
let reorder = null;
let suppressUntil = 0;

function isEditMode() {
  return document.body.classList.contains('edit-mode');
}

/** 刚拖完那一下的 click 是误触，编辑器要用这个把"点卡片开表单"让开 */
function isDragClickSuppressed() {
  return Date.now() < suppressUntil;
}

function initDragSort(options) {
  reorder = options.onReorder;
  document.addEventListener('pointerdown', onPointerDown);
}

function onPointerDown(e) {
  if (!isEditMode() || e.button !== 0) return;
  if (e.target.closest('.edit-panel, .edit-bar, .sec-add, .edit-add-group, .edit-add-cat')) return;

  const wrap = e.target.closest('.card-wrap');
  const tab = e.target.closest('.tab-btn');
  const el = wrap || tab;
  if (!el) return;

  // 卡片是 <a>、图标是 <img>，浏览器默认它们可"原生拖动"。不掐掉的话手速慢一点就会被
  // 原生 dragstart 抢走，并回一个 pointercancel 把我们的指针流当场断掉 —— 表现为
  // "有时能拖有时不能"（实测：不拦 4/4 次被抢走，拦了 0 次）。
  // 触屏不拦：pointerdown 一旦被取消，触摸的 click 就不发了，点卡片开表单会失效。
  if (e.pointerType !== 'touch') e.preventDefault();

  drag = {
    kind: wrap ? 'card' : 'tab',
    el,
    active: false,
    x0: e.clientX,
    y0: e.clientY,
    offX: 0,
    offY: 0,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.abs(e.clientX - drag.x0) < PIN_TOL && Math.abs(e.clientY - drag.y0) < PIN_TOL) return;
    beginDrag(e);
  }
  if (drag.clone) drag.clone.style.transform = `translate(${e.clientX - drag.offX}px, ${e.clientY - drag.offY}px)`;
  updateTarget(e);
}

function beginDrag(e) {
  const rect = drag.el.getBoundingClientRect();
  drag.active = true;
  drag.offX = e.clientX - rect.left;
  drag.offY = e.clientY - rect.top;

  drag.ph = document.createElement('div');
  drag.ph.className = drag.kind === 'card' ? 'drag-ph' : 'drag-ph drag-ph-tab';
  drag.ph.style.width = `${rect.width}px`;
  drag.ph.style.height = `${rect.height}px`;

  drag.clone = drag.el.cloneNode(true);
  drag.clone.classList.add('drag-clone');
  drag.clone.style.width = `${rect.width}px`;
  drag.clone.style.height = `${rect.height}px`;
  drag.clone.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  document.body.appendChild(drag.clone);

  drag.el.classList.add('dragging');
  drag.el.parentElement.insertBefore(drag.ph, drag.el);
}

function updateTarget(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) return;

  const tab = under.closest('.tab-btn');
  if (drag.kind === 'card' && tab) {
    scheduleDwell(tab);
    return;
  }
  clearDwell();

  if (drag.kind === 'card') {
    const grid = under.closest('.grid');
    if (!grid) return;
    placePlaceholder(grid, insertionIndex(grid, e.clientX, e.clientY, '.card-wrap'), '.card-wrap');
  } else {
    const tabs = document.querySelector('.nav-tabs');
    if (!tabs) return;
    placePlaceholder(tabs, insertionIndex(tabs, e.clientX, 0, '.tab-btn'), '.tab-btn');
  }
}

/** 被拖的和占位符都不算：这样下标在"占位符/数组"两边是同一个坐标系 —— 
 *  数据侧先删掉被拖的那张再按这个下标插入，正好落在占位符显示的位置 */
function siblingsOf(parent, selector) {
  return [...parent.children].filter(n => n !== drag.ph && n !== drag.el && n.matches(selector));
}

function placePlaceholder(parent, index, selector) {
  const siblings = siblingsOf(parent, selector);
  parent.insertBefore(drag.ph, siblings[index] || null);
}

/** 插入点按 DOM 顺序（即行的顺序）找：整张卡上方，或同一行里靠左，就插在它前面 */
function insertionIndex(parent, x, y, selector) {
  const siblings = siblingsOf(parent, selector);
  for (let i = 0; i < siblings.length; i++) {
    const rect = siblings[i].getBoundingClientRect();
    if (drag.kind === 'card') {
      if (y < rect.top) return i;
      if (y <= rect.bottom && x < rect.left + rect.width / 2) return i;
    } else if (x < rect.left + rect.width / 2) {
      return i;
    }
  }
  return siblings.length;
}

function scheduleDwell(tab) {
  if (tab.classList.contains('active')) {
    clearDwell();
    return;
  }
  if (dwellTab === tab) return;
  clearDwell();
  dwellTab = tab;
  dwellTimer = setTimeout(() => {
    clearDwell();
    if (!drag || !drag.active) return;
    // 切分类只是切 .active 显隐，占位符还留在旧分类里，先撤掉等下次移动再落位
    drag.ph.remove();
    tab.click();
  }, DWELL_MS);
}

function clearDwell() {
  if (dwellTimer) clearTimeout(dwellTimer);
  dwellTimer = null;
  dwellTab = null;
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  clearDwell();

  if (!drag) return;
  const current = drag;
  drag = null;

  if (!current.active) return;   // 没移动，就是一次普通点击

  const ph = current.ph;
  const parent = ph.parentElement;
  const move = buildMove(current, parent);

  ph.remove();
  current.clone.remove();
  current.el.classList.remove('dragging');

  suppressUntil = Date.now() + 350;
  document.addEventListener('click', swallowClick, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallowClick, { capture: true }), 400);

  if (move) reorder(move);
}

function swallowClick(e) {
  e.preventDefault();
  e.stopPropagation();
}

/** 占位符前面有几个同类兄弟，就是落点下标（被拖的那个要排除：
 *  它在数组里会被先删掉，所以这个下标正好就是先删后插的下标） */
function countBefore(ph, selector, exclude) {
  let index = 0;
  for (const node of ph.parentElement.children) {
    if (node === ph) break;
    if (node !== exclude && node.matches(selector)) index += 1;
  }
  return index;
}

function buildMove(current, parent) {
  if (!parent) return null;

  if (current.kind === 'card') {
    if (!parent.classList.contains('grid')) return null;
    const el = current.el;
    return {
      kind: 'card',
      from: {
        cat: el.dataset.cat,
        sec: el.dataset.sec === undefined ? null : Number(el.dataset.sec),
        idx: Number(el.dataset.idx),
      },
      to: {
        cat: parent.dataset.cat,
        sec: parent.dataset.sec === 'flat' ? null : Number(parent.dataset.sec),
        idx: countBefore(current.ph, '.card-wrap', el),
      },
    };
  }

  if (!parent.classList.contains('nav-tabs')) return null;
  const el = current.el;
  return {
    kind: 'tab',
    from: { idx: Number(el.dataset.idx) },
    to: { idx: countBefore(current.ph, '.tab-btn', el) },
  };
}

/** 退出编辑模式/重渲染前调用，丢掉进行中的拖动 */
function cancelDrag() {
  clearDwell();
  if (!drag) return;
  if (drag.ph) drag.ph.remove();
  if (drag.clone) drag.clone.remove();
  drag.el.classList.remove('dragging');
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

export { initDragSort, cancelDrag, isDragClickSuppressed };
