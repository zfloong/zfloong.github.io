/**
 * 主题管理模块
 * 手动切换黑夜/日间模式，默认跟随系统
 */

const THEME_KEY = 'userPreference_theme';

/**
 * 获取用户保存的主题偏好
 * @returns {string|null} 'dark', 'light', 或 null
 */
function getSavedTheme() {
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val === 'dark' || val === 'light') return val;
    return null;
  } catch { return null; }
}

/**
 * 保存主题偏好
 * @param {string} theme - 'dark' 或 'light'
 */
function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

/**
 * 应用主题到 html 元素
 * @param {string} theme - 'dark' 或 'light'
 */
function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // 更新按钮图标
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.innerHTML = theme === 'dark'
      ? '<i class="ri-sun-line"></i>'
      : '<i class="ri-moon-line"></i>';
  }
}

/**
 * 初始化主题
 */
function initTheme() {
  const saved = getSavedTheme();
  if (saved) {
    applyTheme(saved);
  } else {
    // 跟随系统
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
}

/**
 * 切换主题
 */
function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const newTheme = isDark ? 'light' : 'dark';
  applyTheme(newTheme);
  saveTheme(newTheme);
}

/**
 * 绑定切换按钮事件
 */
function bindThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', toggleTheme);

  // 监听系统主题变化（用户未手动保存时跟随）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!getSavedTheme()) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });
}

export { initTheme, bindThemeToggle, toggleTheme };
