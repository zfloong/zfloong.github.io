/**
 * 主题切换按钮（导航栏右上角）
 *
 * 单击按「夜间 → 白天 → 夜间」循环两套主题，图标随当前主题变化。
 * 持久化与配色都在 theme.js，这里只管「点一下换下一套」。
 */

import { getTheme, setTheme } from './theme.js';

/** 点击顺序：默认（夜间）→ 白天 → 回夜间 */
const CYCLE = ['night', 'day'];

const ICONS = {
  night: 'ri-moon-line',
  day: 'ri-sun-line',
};

function applyIcon(btn) {
  const icon = btn.querySelector('i');
  if (icon) icon.className = ICONS[getTheme()] || ICONS.night;
}

export function initThemeSwitcher() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  applyIcon(btn);

  btn.addEventListener('click', () => {
    const idx = CYCLE.indexOf(getTheme());
    setTheme(CYCLE[(idx + 1) % CYCLE.length]);
    applyIcon(btn);
  });
}