/**
 * 背景网格模块
 *
 * 一层 Canvas：
 *   网格层 — 交互式线条网格，鼠标附近顶点会弹开
 *
 * 这里只管「网格」。首屏那层流动光带由 hero-shader.js（WebGL）负责。
 * 历史上还有「模糊光斑层」和「粒子连线层」，都已移除：
 *   光斑层观感发灰、像雾；粒子层用户明确不要。相关代码不要在恢复。
 */
//
// 注意：下面这些值只是「默认值/兜底」。真正生效的是 CSS 变量
// （见 css/main.css 的 :root），由 readCssTuning() 在启动时读取。
// 改背景观感请改 CSS，不要改这里。
const CONFIG = {
  grid: {
    cellSize: 100,
    lineOpacity: 0.166,
    dotRadius: 1.2,
    dotOpacity: 0.15,
    mouseRadius: 150,
    pushStrength: 8,
    returnSpeed: 0.009,
    highlightColor: { r: 120, g: 150, b: 255 },
  },
};

// 可从 CSS 覆盖的项 -> CSS 变量名
const TUNING_VARS = {
  'grid.cellSize': '--bg-grid-cell',
  'grid.lineOpacity': '--bg-grid-line',
  'grid.dotRadius': '--bg-grid-dot-r',
  'grid.dotOpacity': '--bg-grid-dot',
  'grid.highlightColor': '--bg-grid-highlight',
};

/**
 * 把 CSS 变量里的观感参数读进 CONFIG（取不到或非法就保持原值）
 */
function readCssTuning() {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return;
  const cs = getComputedStyle(document.documentElement);
  Object.keys(TUNING_VARS).forEach(path => {
    const raw = cs.getPropertyValue(TUNING_VARS[path]).trim();
    if (raw === '') return;
    const val = parseFloat(raw);
    if (!isFinite(val)) return;
    const parts = path.split('.');
    // 颜色用 "r,g,b" 字符串，其它是数值
    if (path === 'grid.highlightColor') {
      if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(raw)) CONFIG.grid.highlightColor = raw;
      return;
    }
    CONFIG[parts[0]][parts[1]] = val;
  });
}

/** 重新读取参数；网格尺寸变了要重建顶点 */
function refreshTuning() {
  const prevCell = CONFIG.grid.cellSize;
  readCssTuning();
  if (CONFIG.grid.cellSize !== prevCell && container) {
    initGridVertices();
  }
}

// ── 状态 ──────────────────────────────────────────
let animId = null;
let gridVertices = [];  // {x, y, ox, oy, dx, dy}

// 监听 <html> 的 class 变化（切档位时同步画布参数）
let tuningObserver = null;

let canvasGrid = null;
let ctxGrid = null;

let container = null;
let containerW = 0;
let containerH = 0;
let initialized = false;
let mouse = { x: -9999, y: -9999 }; // 鼠标位置

// 说明：这里刻意不按 prefers-reduced-motion 冻结背景。
// Windows 的「显示动画」开关会把该偏好置为 reduce 且全局生效，
// 一旦据此停掉 canvas，背景流动和网格互动会整片消失。
// 只保留「标签页切到后台暂停渲染」这一条纯省电优化。
let paused = false;

// ── 交互式网格 ───────────────────────────────────

function initGridVertices() {
  const { cellSize } = CONFIG.grid;
  const cols = Math.ceil(containerW / cellSize) + 1;
  const rows = Math.ceil(containerH / cellSize) + 1;
  gridVertices = [];

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const ox = col * cellSize;
      const oy = row * cellSize;
      gridVertices.push({ x: ox, y: oy, ox, oy, dx: 0, dy: 0 });
    }
  }
}

function updateGridVertices() {
  const { mouseRadius, pushStrength, returnSpeed } = CONFIG.grid;
  const mouseRadiusSq = mouseRadius * mouseRadius;

  for (const v of gridVertices) {
    // 鼠标排斥力
    const mx = v.x - mouse.x;
    const my = v.y - mouse.y;
    const distSq = mx * mx + my * my;

    if (distSq < mouseRadiusSq && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const force = (1 - dist / mouseRadius) * pushStrength;
      v.dx += (mx / dist) * force * 0.03;
      v.dy += (my / dist) * force * 0.03;
    }

    // 回弹到原位
    v.dx += (v.ox - v.x) * returnSpeed;
    v.dy += (v.oy - v.y) * returnSpeed;

    // 阻尼
    v.dx *= 0.8;
    v.dy *= 0.8;

    v.x += v.dx;
    v.y += v.dy;
  }
}

function drawGrid(ctx) {
  const { cellSize, lineOpacity, dotRadius, dotOpacity, highlightColor } = CONFIG.grid;
  const cols = Math.ceil(containerW / cellSize) + 1;
  const rows = Math.ceil(containerH / cellSize) + 1;
  // 颜色支持 "r,g,b" 三元组（便于用 CSS 变量按档位覆盖，如浅色档换成深蓝线）
  const [r, g, b] = typeof highlightColor === 'string'
    ? highlightColor.split(',').map(n => parseInt(n.trim(), 10))
    : [highlightColor.r, highlightColor.g, highlightColor.b];
  const mouseRadiusSq = CONFIG.grid.mouseRadius * CONFIG.grid.mouseRadius;

  ctx.clearRect(0, 0, containerW, containerH);

  // 把所有线段按 alpha 分组，最后每组只 stroke 一次，
  // 避免每画一条线就 beginPath/stroke（网格有上千条线时的主要开销）。
  const lineGroups = new Map();
  const addLine = (v1, v2) => {
    const midX = (v1.x + v2.x) / 2;
    const midY = (v1.y + v2.y) / 2;
    const dmSq = (midX - mouse.x) ** 2 + (midY - mouse.y) ** 2;
    const proximity = dmSq < mouseRadiusSq ? (1 - Math.sqrt(dmSq) / CONFIG.grid.mouseRadius) : 0;
    const alpha = Math.round((lineOpacity + proximity * 0.2) * 1000) / 1000;
    const width = Math.round((0.5 + proximity * 0.5) * 100) / 100;
    const key = alpha + '|' + width;
    let group = lineGroups.get(key);
    if (!group) {
      group = { alpha, width, segs: [] };
      lineGroups.set(key, group);
    }
    group.segs.push(v1.x, v1.y, v2.x, v2.y);
  };

  // 横线
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const i1 = col * rows + row;
      const i2 = (col + 1) * rows + row;
      if (i1 >= gridVertices.length || i2 >= gridVertices.length) continue;
      addLine(gridVertices[i1], gridVertices[i2]);
    }
  }
  // 竖线
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows - 1; row++) {
      const i1 = col * rows + row;
      const i2 = col * rows + row + 1;
      if (i1 >= gridVertices.length || i2 >= gridVertices.length) continue;
      addLine(gridVertices[i1], gridVertices[i2]);
    }
  }

  lineGroups.forEach(group => {
    ctx.strokeStyle = `rgba(${r},${g},${b},${group.alpha})`;
    ctx.lineWidth = group.width;
    ctx.beginPath();
    const segs = group.segs;
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(segs[i], segs[i + 1]);
      ctx.lineTo(segs[i + 2], segs[i + 3]);
    }
    ctx.stroke();
  });

  // 顶点：同样按半径/透明度分组，批量填充
  const dotGroups = new Map();
  for (const v of gridVertices) {
    const dmSq = (v.x - mouse.x) ** 2 + (v.y - mouse.y) ** 2;
    const proximity = dmSq < mouseRadiusSq ? (1 - Math.sqrt(dmSq) / CONFIG.grid.mouseRadius) : 0;
    const alpha = Math.round((dotOpacity + proximity * 0.5) * 1000) / 1000;
    const radius = Math.round((dotRadius + proximity * 1.5) * 100) / 100;
    const key = alpha + '|' + radius;
    let group = dotGroups.get(key);
    if (!group) {
      group = { alpha, radius, pts: [] };
      dotGroups.set(key, group);
    }
    group.pts.push(v.x, v.y);
  }

  dotGroups.forEach(group => {
    ctx.fillStyle = `rgba(${r},${g},${b},${group.alpha})`;
    ctx.beginPath();
    const pts = group.pts;
    for (let i = 0; i < pts.length; i += 2) {
      ctx.moveTo(pts[i] + group.radius, pts[i + 1]);
      ctx.arc(pts[i], pts[i + 1], group.radius, 0, Math.PI * 2);
    }
    ctx.fill();
  });
}

// ── 主循环 ────────────────────────────────────────
let lastTime = 0;

/**
 * 绘制一帧
 * @param {number} dt - 距上一帧的毫秒数（0 表示静态帧：只布局不动）
 */
function renderFrame(dt) {
  if (canvasGrid && ctxGrid) {
    updateGridVertices();
    drawGrid(ctxGrid);
  }
}

function animate(time) {
  if (paused) return;

  const dt = Math.min(time - lastTime, 50);
  lastTime = time;

  renderFrame(dt);

  animId = requestAnimationFrame(animate);
}

// ── 暂停 / 恢复 ───────────────────────────────────
function pauseAnimation() {
  if (paused) return;
  paused = true;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

function resumeAnimation() {
  if (!paused || !initialized) return;
  paused = false;
  // 跳过暂停期间累积的时间，避免恢复瞬间粒子瞬移
  lastTime = performance.now();
  animId = requestAnimationFrame(animate);
}

function handleVisibilityChange() {
  // 切到后台就停掉 rAF，省电、避免无意义的重绘
  if (document.hidden) {
    pauseAnimation();
  } else {
    resumeAnimation();
    // 顺便同步一次档位参数：这样即使切换档位时页面在后台、MutationObserver 没触发，
    // 回到前台也能拿到正确的观感参数（设备从休眠唤醒也走这条路径）。
    refreshTuning();
  }
}

// ── 尺寸处理 ──────────────────────────────────────
function handleResize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = container.getBoundingClientRect();
  containerW = rect.width;
  containerH = rect.height;

  if (canvasGrid) {
    // 缓冲区按 DPR 放大，再缩放坐标系，高 DPI 屏上网格线和顶点才不糊。
    canvasGrid.width = containerW * dpr;
    canvasGrid.height = containerH * dpr;
    ctxGrid.setTransform(dpr, 0, 0, dpr, 0, 0);
    initGridVertices();
  }
}

// ── 鼠标监听 ──────────────────────────────────────
function handleMouseMove(e) {
  const rect = container.getBoundingClientRect();
  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;
}

function handleMouseLeave() {
  mouse.x = -9999;
  mouse.y = -9999;
}

// ── 初始化 ────────────────────────────────────────
function initDeepBg() {
  if (initialized) return;

  container = document.getElementById('deep-bg');
  if (!container) return;

  // 网格层
  canvasGrid = document.createElement('canvas');
  canvasGrid.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:transparent';
  container.querySelector('.deep-bg-grid').appendChild(canvasGrid);
  ctxGrid = canvasGrid.getContext('2d');

  handleResize();
  initGridVertices();
  refreshTuning();          // 读取 CSS 里的档位参数（网格线/光斑强度等）
  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 切换背景档位（<html> 上的 bg-* 类变化）时同步刷新参数。
  // 只观察 class，不观察 style，避免 rAF 里改样式导致无限循环。
  if (typeof MutationObserver === 'function') {
    tuningObserver = new MutationObserver(refreshTuning);
    tuningObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  // 鼠标事件（绑定到 document，覆盖整个页面）
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseleave', handleMouseLeave);

  lastTime = performance.now();
  if (document.hidden) {
    paused = true;
  } else {
    animId = requestAnimationFrame(animate);
  }

  initialized = true;
}

// ── 显示/隐藏 ────────────────────────────────────
function showDeepBg() {
  const el = document.getElementById('deep-bg');
  if (el) {
    el.style.display = 'block';
    if (!initialized) {
      requestAnimationFrame(() => initDeepBg());
    }
  }
}

function hideDeepBg() {
  const el = document.getElementById('deep-bg');
  if (el) el.style.display = 'none';
}

// ── 销毁 ──────────────────────────────────────────
function destroyDeepBg() {
  if (animId) cancelAnimationFrame(animId);
  animId = null;
  paused = true;
  window.removeEventListener('resize', handleResize);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseleave', handleMouseLeave);
  // 移除动态创建的 canvas，否则重新初始化会叠加多层
  if (container) {
    container.querySelectorAll('canvas').forEach(cv => cv.remove());
  }
  canvasGrid = null;
  ctxGrid = null;
  initialized = false;
  gridVertices = [];
}

export { initDeepBg, showDeepBg, hideDeepBg, destroyDeepBg };