/**
 * 【临时】胶囊按钮样式三选一预览
 *
 * 导航标签（.tab-btn.active）和搜索引擎按钮（.engine-btn.active）的"厚度"不好用文字描述，
 * 这里直接把三个候选方案渲染成页面上的真按钮，用户在浏览器里直接看、直接比。
 *
 * 全部样式内联注入（不写进 main.css），所以"撤掉预览" = 删掉本文件 + index.html 里的
 * 那一行 script；main.css 全程不受影响。
 *
 * 三个方向刻意拉开区分度，不是微调参数：
 *   A 柔和玻璃   —— 阴影环当边缘 + 一圈外晕 + 双层投影（最接近现状，稍收敛）
 *   B 实心胶囊   —— 底色压实、边缘一条实线、只留一层浅投影（干净、有分量）
 *   C 细线外发光 —— 一条细实线 + 一圈柔光、几乎不填充（最轻盈、有光感）
 *
 * 三套配方都只用主题变量（--ink-rgb / --shade-rgb / --glass-core），所以切主题看到的
 * 是真实效果。用户选好后，把对应配方搬进 main.css 的 .tab-btn.active / .engine-btn.active，
 * 再删掉本文件与 index.html 里的 script 行。
 */

const CANDIDATES = [
  { key: 'a', name: '方案 A · 柔和玻璃', desc: '阴影环当边缘 + 外晕 + 双层投影，最接近现状' },
  { key: 'b', name: '方案 B · 实心胶囊', desc: '底色压实，边缘一条实线，干净有分量' },
  { key: 'c', name: '方案 C · 细线外发光', desc: '一条细线 + 一圈柔光，最轻盈' },
];

const STYLE = `
#bsp-panel {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 99999;
  max-width: calc(100vw - 24px);
  padding: 12px 16px 14px;
  border-radius: 18px;
  background: var(--history-bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  font-family: inherit;
  color: var(--text);
}
#bsp-panel .bsp-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
#bsp-panel .bsp-title { font-size: 0.78rem; font-weight: 600; }
#bsp-panel .bsp-hint { font-size: 0.68rem; color: var(--text-sub); }
#bsp-panel .bsp-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
}
#bsp-panel .bsp-item {
  width: 176px;              /* 定宽，三颗才会稳定横排（不给宽度时窄视口会竖着叠起来）*/
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 6px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s ease;
}
#bsp-panel .bsp-item:hover { background: rgba(var(--ink-rgb),0.06); }
#bsp-panel .bsp-item.is-picked { background: rgba(var(--ink-rgb),0.1); }
#bsp-panel .bsp-name { font-size: 0.72rem; font-weight: 600; }
#bsp-panel .bsp-desc {
  font-size: 0.64rem;
  color: var(--text-sub);
  max-width: 168px;
  text-align: center;
  line-height: 1.4;
}
#bsp-panel .bsp-close {
  position: absolute;
  top: 6px;
  right: 8px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-sub);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
#bsp-panel .bsp-close:hover { color: var(--text); }

/* 三个候选共用的"胶囊几何"，与 .tab-btn 一致，差别只在下面的分层配方 */
#bsp-panel .bsp-demo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.9rem;
  border-radius: 50px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--ink);
  opacity: 1;
  white-space: nowrap;
  border: 1px solid transparent;
  backdrop-filter: blur(12px) saturate(1.35);
  transition: all 0.25s ease;
}

/* ── 方案 A：柔和玻璃（现状配方）── */
#bsp-panel .bsp-a {
  background: linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08)), var(--glass-core);
  box-shadow:
    0 0 0 1px rgba(var(--ink-rgb),0.2),
    0 0 0 3px rgba(var(--ink-rgb),0.07),
    0 1px 4px rgba(var(--shade-rgb),0.22),
    0 5px 18px rgba(var(--shade-rgb),0.18);
}

/* ── 方案 B：实心胶囊 ──
   底色压到接近实心，边缘改用一条可见的实线，阴影只留一层浅的近投影：
   重量来自"填充"本身，而不是靠外圈晕开，所以轮廓最干脆。 */
#bsp-panel .bsp-b {
  background: linear-gradient(rgba(var(--ink-rgb),0.2), rgba(var(--ink-rgb),0.2)), var(--glass-core);
  border-color: rgba(var(--ink-rgb),0.28);
  box-shadow: 0 2px 8px rgba(var(--shade-rgb),0.28);
}
/* 白天主题的 --ink-rgb 是深墨色，直接叠上去会把胶囊压灰；
   白底上改用白色叠加，保持"亮白实心"的观感。 */
:root[data-theme="day"] #bsp-panel .bsp-b {
  background: linear-gradient(rgba(255,255,255,0.22), rgba(255,255,255,0.22)), var(--glass-core);
}

/* ── 方案 C：细线 + 外发光 ──
   几乎不填充，靠一条细实线定轮廓、一圈柔光把边缘"化开"，
   既不锋利也不厚重，走"轻盈但有光感"。 */
#bsp-panel .bsp-c {
  background: rgba(var(--ink-rgb),0.04);
  border-color: rgba(var(--ink-rgb),0.35);
  box-shadow:
    0 0 12px rgba(var(--ink-rgb),0.18),
    0 0 24px rgba(var(--ink-rgb),0.08);
}
`;

function buildPanel() {
  const panel = document.createElement('div');
  panel.id = 'bsp-panel';

  const items = CANDIDATES.map((c) => `
    <div class="bsp-item" data-key="${c.key}">
      <button type="button" class="bsp-demo bsp-${c.key}">导航标签</button>
      <span class="bsp-name">${c.name}</span>
      <span class="bsp-desc">${c.desc}</span>
    </div>`).join('');

  panel.innerHTML = `
    <button type="button" class="bsp-close" aria-label="关闭预览">✕</button>
    <div class="bsp-head">
      <span class="bsp-title">胶囊按钮 · 三选一</span>
      <span class="bsp-hint">可点右上角月亮切主题对照 · 选好后把编号告诉我</span>
    </div>
    <div class="bsp-row">${items}</div>
  `;

  return panel;
}

export function initButtonStylePreview() {
  if (document.getElementById('bsp-panel')) return;

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = buildPanel();

  panel.addEventListener('click', (e) => {
    if (e.target.closest('.bsp-close')) {
      panel.remove();
      return;
    }
    const item = e.target.closest('.bsp-item');
    if (!item) return;
    panel.querySelectorAll('.bsp-item').forEach((el) => el.classList.toggle('is-picked', el === item));
  });

  document.body.appendChild(panel);
}