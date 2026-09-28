/**
 * 主题管理
 *
 * 三套主题（夜间 / 白天 / 流光）都用 <html data-theme="…"> 驱动：
 * main.css 里每套主题是一个 `:root[data-theme="…"]` 变量覆写块，
 * 这里只负责「选哪一套」和「记住哪一套」，不碰任何配色值。
 *
 * 首帧防闪在 index.html 的内联脚本里做 —— 那段必须在 CSS 生效前同步跑完，
 * 不能写成模块。所以存储键在那边是硬编码的，两边必须保持一致。
 *
 * 特效（WebGL 光带 / 动态网格）不归这里管：调用方监听 themechange 后自行启停。
 */

const STORAGE_KEY = 'flyloong_theme';
const DEFAULT_THEME = 'night';

/** 三套主题的元信息，供切换入口渲染用 */
export const THEMES = [
  { id: 'night', label: '夜间', hint: '深色 · 轻量' },
  { id: 'day',   label: '白天', hint: '冷白 · 轻量' },
  { id: 'flow',  label: '流光', hint: '深色 · 动态背景' },
];

const IDS = THEMES.map((t) => t.id);

function normalize(id) {
  return IDS.includes(id) ? id : DEFAULT_THEME;
}

/** 当前主题。以 DOM 上的 data-theme 为准 —— 它由首帧脚本写入，是唯一真相 */
export function getTheme() {
  return normalize(document.documentElement.getAttribute('data-theme'));
}

/** 切主题：写 DOM、存本地、广播 themechange */
export function setTheme(id) {
  const next = normalize(id);
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (e) {
    // 隐私模式 / 存储被禁：本次会话内仍然生效，只是记不住
  }
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  return next;
}