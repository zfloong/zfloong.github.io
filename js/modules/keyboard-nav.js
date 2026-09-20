/**
 * 键盘导航（方案1+2组合，无站内过滤）
 *
 *   /            → 聚焦搜索框
 *   任意可打印键  → 聚焦搜索框并带入该字符（IME 合成中除外）
 *   ↑↓←→         → 在当前可见卡片网格中移动光标（跨分组、按行列寻址）
 *   Enter        → 打开光标所在卡片（等同点击，target=_blank）
 *   Esc          → 搜索框：清空并失焦；否则：清除卡片光标
 *   搜索框内 ArrowDown → 进入卡片网格
 *
 * 只读现有 DOM，不修改渲染/搜索/历史逻辑。
 */

let cursorCard = null;

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** 当前可见卡片（活动分类 + 未折叠分组），按文档顺序 */
function visibleCards() {
  return [...document.querySelectorAll('.category-section.active .card')]
    .filter(c => c.offsetParent !== null);
}

function clearCursor() {
  if (cursorCard) {
    cursorCard.classList.remove('kb-cursor');
    cursorCard = null;
  }
}

function setCursor(card) {
  clearCursor();
  cursorCard = card;
  card.classList.add('kb-cursor');
  card.scrollIntoView({ block: 'nearest' });
}

/** 用视口坐标分行（卡片可能分布在不同 grid 父级，offsetTop 不可跨父比较）。
 *  hover / 光标的 translateY 会让同排卡片 top 相差几 px，所以按容差聚排，不能精确相等 */
const ROW_TOL = 8;

function rowTop(card) {
  return Math.round(card.getBoundingClientRect().top);
}

function rowsOf(cards) {
  const sorted = [...cards].sort((a, b) => rowTop(a) - rowTop(b));
  const rows = [];
  for (const c of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(rowTop(c) - row.top) <= ROW_TOL) row.cards.push(c);
    else rows.push({ top: rowTop(c), cards: [c] });
  }
  return rows;
}

function moveHorizontal(cards, idx, dir) {
  const next = idx + dir;
  return next >= 0 && next < cards.length ? next : idx;
}

function moveVertical(cards, idx, dir) {
  const rows = rowsOf(cards);
  const ri = rows.findIndex(r => r.cards.includes(cards[idx]));
  const target = rows[ri + dir];
  if (!target) return idx;
  const colLeft = cards[idx].getBoundingClientRect().left;
  // 找目标排中水平位置最接近的一张
  let best = target.cards[0], bestDist = Infinity;
  target.cards.forEach(c => {
    const d = Math.abs(c.getBoundingClientRect().left - colLeft);
    if (d < bestDist) { bestDist = d; best = c; }
  });
  return cards.indexOf(best);
}

function onKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // 编辑模式/面板打开时键盘交给编辑：否则 ↓↓→ 会驱动卡片光标、
  // 字母键会把焦点抢到搜索框（edit-mode / edit-open 由 editor.js 维护）
  if (document.body.classList.contains('edit-mode') || document.body.classList.contains('edit-open')) return;
  const typing = isTypingTarget(document.activeElement);
  const inSearch = document.activeElement && document.activeElement.classList.contains('search-input');

  if (e.key === 'Escape') {
    if (inSearch) {
      document.activeElement.value = '';
      document.activeElement.blur();
    }
    clearCursor();
    return;
  }

  if (e.key === 'Enter' && cursorCard && !typing) {
    e.preventDefault();
    cursorCard.click();
    return;
  }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (inSearch) {
      // 搜索框内按 ↓ 进入网格；其余方向键留给光标
      if (e.key === 'ArrowDown') {
        const cards = visibleCards();
        if (cards.length) {
          e.preventDefault();
          document.activeElement.blur();
          setCursor(cards[0]);
        }
      }
      return;
    }
    if (typing) return;
    const cards = visibleCards();
    if (!cards.length) return;
    e.preventDefault();
    if (!cursorCard || !cards.includes(cursorCard)) {
      setCursor(cards[e.key === 'ArrowUp' ? cards.length - 1 : 0]);
      return;
    }
    const idx = cards.indexOf(cursorCard);
    const next = (e.key === 'ArrowLeft') ? moveHorizontal(cards, idx, -1)
      : (e.key === 'ArrowRight') ? moveHorizontal(cards, idx, 1)
      : (e.key === 'ArrowUp') ? moveVertical(cards, idx, -1)
      : moveVertical(cards, idx, 1);
    setCursor(cards[next]);
    return;
  }

  // / 或任意可打印字符 → 聚焦搜索框（字符由默认行为带入）
  if (!typing && !e.isComposing && (e.key === '/' || (e.key.length === 1 && /\S/.test(e.key)))) {
    const input = document.querySelector('.search-input');
    if (input) {
      if (e.key === '/') e.preventDefault();
      clearCursor();
      input.focus();
    }
  }
}

function initKeyboardNav() {
  document.addEventListener('keydown', onKeydown);
  // 鼠标一动就退出键盘光标，避免双光标混淆
  document.addEventListener('mousemove', clearCursor);
  // 切分类/折叠分组后卡片集合变化，清掉旧光标
  document.addEventListener('click', (e) => {
    if (e.target.closest('.tab-btn, .section-group-title')) clearCursor();
  });
}

export { initKeyboardNav };
