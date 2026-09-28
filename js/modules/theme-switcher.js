/**
 * 主题切换按钮（导航栏右上角）
 *
 * 预览用：单击按「夜间 → 流光 → 白天 → 夜间」循环三套主题，图标随当前主题变化，
 * 方便一眼比较三套配色。持久化与配色都在 theme.js，这里只管「点一下换下一套」。
 *
 * 注意：特效（WebGL 光带 / 动态网格）当前不随主题启停 —— 那是后续批次的事，
 * 所以切到夜间 / 白天时，背景仍会保留光带与网格。
 */

import { getTheme, setTheme } from './theme.js';

/** 点击顺序：默认（夜间）→ 流光（有特效）→ 白天 → 回夜间 */
const CYCLE = ['night', 'flow', 'day'];

const ICONS = {
  night: 'ri-moon-line',
  day: 'ri-sun-line',
  flow: 'ri-palette-line',
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