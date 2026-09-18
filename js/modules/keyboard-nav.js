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

/** 用视口坐标分行（卡片可能分布在不同 grid 父级，offsetTop 不可跨父比较） */
function rowTop(card) {
  return Math.round(card.getBoundingClientRect().top);
}

function moveHorizontal(cards, idx, dir) {
  const next = idx + dir;
  return next >= 0 && next < cards.length ? next : idx;
}

function moveVertical(cards, idx, dir) {
  const curTop = rowTop(cards[idx]);
  const tops = [...new Set(cards.map(rowTop))].sort((a, b) => a - b);
  const ti = tops.indexOf(curTop) + dir;
  if (ti < 0 || ti >= tops.length) return idx;
  const targetTop = tops[ti];
  const row = cards.filter(c => rowTop(c) === targetTop);
  const colLeft = cards[idx].getBoundingClientRect().left;
  // 找目标行中水平位置最接近的一张
  let best = 0, bestDist = Infinity;
  row.forEach((c, i) => {
    const d = Math.abs(c.getBoundingClientRect().left - colLeft);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return cards.indexOf(row[best]);
}

function onKeydown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
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
