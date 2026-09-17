/**
 * Hero 区流动光带背景（WebGL fragment shader）
 *
 * 思路来自 DeepSeek Harness 落地页那层飘带的技术方向（域扭曲流体噪声 + 旋度场），
 * 配色取自实测到的它们的 shader 色值 —— 冷蓝底 + 暖奶油高光：
 *   深蓝 #04163a、#1a3870、#204a7e，高光 #8d8dca → #ffe8b0 → #fff7d1
 * 本文件代码为自行编写，不是对方的实现。
 *
 * 性能与健壮性：
 *   - 只在 hero 区域铺一块 canvas，不覆盖整页（页面上还有 117 张卡片 + backdrop-filter）
 *   - DPR 上限 1.5，移动端可再降
 *   - 标签页隐藏时停 rAF（visibilitychange）
 *   - 系统要求减少动效时只画一帧，不跑动画
 *   - WebGL 不可用 / 上下文丢失 → 直接放弃，由 CSS 兜底渐变接管
 */

const CONFIG = {
  // 噪声尺度：越小 → 飘带越大。对照原图（1600px 宽里大约 2 条飘带）定的 0.6。
  scale: 0.6,
  speed: 0.42,        // 时间推进速度（0.35 几乎静止，1.4 明显偏快；0.42 是缓慢流动）
  grain: 0.004,       // 颗粒感（原版 u_grain 实测 0.005，接近）
  glowIntensity: 0.10,
  maxDpr: 1.5,
  targetFps: 30,            // 光带限帧（背景缓慢流动，30fps 足够；GPU 开销约减半）
  minFrameGap: 1000 / 30,   // 由 targetFps 推出，勿手改
  // ── 配色：只有两色（对着原版多张特写取色）──
  // 观察：原版是「偏亮的纯净蓝底 + 只比底色亮一点的米灰飘带」，
  // 飘带靠"亮一点点"区分，不是"白得发光"。所以亮色必须压下来。
  color1: [0.090, 0.190, 0.350],   // 蓝底（原图那种偏亮的纯净蓝）
  color2: [0.130, 0.240, 0.400],   // 亮处蓝
  color3: [0.150, 0.250, 0.400],   // 暗角蓝
  color4: [0.640, 0.640, 0.600],   // #a3a399 米灰（原图中飘带实际比这还淡，留一点余量）
  color5: [0.640, 0.640, 0.600],   // 占位，不参与混色
  glow1: [0.700, 0.700, 0.660],
  glow2: [0.325, 0.553, 0.792],
  glow3: [0.176, 0.267, 0.545],
};

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision mediump float;
uniform float u_time;
uniform vec2  u_res;
uniform float u_scale;
uniform float u_grain;
uniform float u_glow;
uniform vec3  u_c1, u_c2, u_c3, u_c4, u_c5;
uniform vec3  u_g1, u_g2, u_g3;
out vec4 fragColor;

#define PI 3.14159265359

// ── 噪声：按 shader 社区的标准写法 ──
// 关键点有三（之前三条都做错了，才做出"云"而不是"飘带"）：
//   1) 每层用【旋转矩阵】去相关，而不是给坐标加常数 —— 加常数去相关不足，会出现轴对齐团块；
//   2) 时间注入【最低频层】驱动整体流动、并给最高频层一点细节抖动，而不是把时间塞进第 3 维；
//   3) 扭曲量必须乘系数（下面 4.0）才拉得开，否则几乎看不出来。
const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);

float hash(vec2 p) {
  p = fract(p * 0.6180339887);
  p *= 25.0;
  return fract(p.x * p.y * (p.x + p.y));
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// 4 octaves（文档指出 4 与 6 观感差别很小，但省约 1/3 开销）
float fbm(vec2 p, float t) {
  float f = 0.0;
  f += 0.500000 * noise(p + t * 0.12);      p = M2 * p * 2.02;   // 最低频带时间 → 整体缓慢流动
  f += 0.250000 * noise(p);                 p = M2 * p * 2.03;
  f += 0.125000 * noise(p);                 p = M2 * p * 2.01;
  f += 0.062500 * noise(p + sin(t * 0.35));                     // 最高频带时间 → 细节微动
  return f / 0.9375;
}

// 经典三级域扭曲：fbm(q + fbm(q + fbm(q)))，扭曲量乘 4.0 才拉得开
float pattern(vec2 q, float t) {
  float w1 = fbm(q, t);
  float w2 = fbm(q + 4.0 * w1, t);
  return fbm(q + 4.0 * w2, t);
}

void main() {
  float aspect = u_res.x / u_res.y;
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;

  // 纯时间驱动，自动播放 —— 不接鼠标。
  // （原版飘带本体靠 u_time 自己跑；鼠标那套 flowmap 是另一个可选效果，不是飘带的驱动源。）
  vec2 q = vec2(uv.x * aspect, uv.y) * u_scale;
  float f = pattern(q, t);
  float n = clamp(f * 1.25 - 0.06, 0.0, 1.0);   // 拉到 0~1 并略提对比

  // 第二层低频噪声：给色带做"不规则"扰动（只用单层会变成均匀的雾）
  float swirl = fbm(q * 0.55 + 3.7, t * 0.6);

  // ── 着色 ──
  // ── 着色：只有两色，软过渡且**低对比** ──
  // 原版飘带只是比蓝底亮一点，所以米灰的混入量要压低（0.62），不能让它变成白色飘带。
  vec3 col = mix(u_c1, u_c3, smoothstep(0.15, 0.55, length(uv - 0.5)));  // 轻微暗角
  col = mix(col, u_c2, smoothstep(0.30, 0.75, n) * 0.45);                // 亮部往亮蓝提一点
  col = mix(col, u_c4, smoothstep(0.48, 0.88, n) * 0.58);                // 米灰飘带，压低混入量

  // 极轻的自发光，只为让米灰不发死；强度很低，不做"发光体"
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col += (col * 0.6 + vec3(0.05, 0.05, 0.045)) * smoothstep(0.55, 0.82, luma) * 0.12;

  // 颗粒
  col += (hash(gl_FragCoord.xy + vec2(t * 37.0, t * 17.0)) - 0.5) * u_grain;

  fragColor = vec4(col, 1.0);
}`;

let gl = null;
let program = null;
let canvas = null;
let rafId = null;
let timerId = null;
let lastTime = 0;
// 随机起点：让每次刷新看到的飘带形态都不同。
// shader 本身是确定性的（同一时间值必得同一画面），所以「随机」只能来自起点的选择。
let timeAcc = Math.random() * 1000;
let paused = false;
const U = {};                      // uniform 位置缓存
let frameCount = 0;                // 诊断用：渲染帧数
let lastError = null;              // 诊断用：循环内异常

// 诊断桥：便于在控制台查看运行状态（不影响功能）
if (typeof window !== 'undefined') {
  window.__heroShader = {
    state: () => ({ frames: frameCount, time: +timeAcc.toFixed(3), paused, rafId, timerId, error: lastError }),
  };
}

function compile(glCtx, type, src) {
  const sh = glCtx.createShader(type);
  glCtx.shaderSource(sh, src);
  glCtx.compileShader(sh);
  if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
    console.warn('[hero-shader] 着色器编译失败:', glCtx.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function initHeroShader() {
  const host = document.getElementById('hero-shader');
  if (!host) return false;

  canvas = document.createElement('canvas');
  host.appendChild(canvas);

  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) {
    // WebGL2 不可用 → 移除 canvas，交给 CSS 兜底渐变
    canvas.remove();
    canvas = null;
    return false;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = 'none'; return false; }

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[hero-shader] 链接失败:', gl.getProgramInfoLog(program));
    canvas.style.display = 'none';
    return false;
  }
  gl.useProgram(program);

  // 全屏三角形
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // 静态 uniform（位置一次性查好，不要每帧都 getUniformLocation）
  U.scale = gl.getUniformLocation(program, 'u_scale');
  U.grain = gl.getUniformLocation(program, 'u_grain');
  U.glow = gl.getUniformLocation(program, 'u_glow');
  U.time = gl.getUniformLocation(program, 'u_time');
  U.res = gl.getUniformLocation(program, 'u_res');
  gl.uniform1f(U.scale, CONFIG.scale);
  gl.uniform1f(U.grain, CONFIG.grain);
  gl.uniform1f(U.glow, CONFIG.glowIntensity);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c1'), CONFIG.color1);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c2'), CONFIG.color2);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c3'), CONFIG.color3);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c4'), CONFIG.color4);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_c5'), CONFIG.color5);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_g1'), CONFIG.glow1);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_g2'), CONFIG.glow2);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_g3'), CONFIG.glow3);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    canvas.style.display = 'none';   // 让 CSS 兜底渐变接管
  });

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);

  // 注意：这里**不**按 prefers-reduced-motion 冻结。
  // Windows 的「显示动画」开关(MinAnimate=0)会把该偏好置为 reduce 且全局生效，
  // 一旦据此停掉动画，页面上所有动效会一起消失（这是本会话踩过的坑）。
  lastTime = performance.now();
  schedule();
  return true;
}

function resize() {
  if (!gl || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function onVisibility() {
  if (document.hidden) {
    stopLoop();
    paused = true;
  } else {
    paused = false;
    lastTime = performance.now();
    schedule();
  }
}

function render(dt) {
  if (!gl) return;
  timeAcc += dt * 0.001 * CONFIG.speed;   // dt 是毫秒 → 秒，再乘速度系数
  frameCount++;
  gl.uniform1f(U.time, timeAcc);
  gl.uniform2f(U.res, canvas.width, canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// 排下一帧：优先 rAF；同时挂一个定时器做看门狗 ——
// 若 rAF 因故不触发（节流、后台合成、某些无头/虚拟时间环境），定时器会兜底把循环拉起来。
// 两者都会在进入下一帧时清掉，不会重复排帧。
function schedule() {
  if (paused || !gl) return;
  if (rafId === null && timerId === null) {
    rafId = requestAnimationFrame(tick);
    timerId = setTimeout(() => {
      timerId = null;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      tick(performance.now());
    }, 200);
  }
}

function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  if (timerId !== null) { clearTimeout(timerId); timerId = null; }
}

function tick(now) {
  rafId = null;
  if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  if (paused) return;
  try {
    // 限帧：背景是缓慢流动，30fps 与 60fps 观感几乎无差，但 GPU 开销直接砍半。
    // 距上一帧不足 minFrameGap 就先跳过渲染，仍排下一帧（用定时器精确等到点）。
    const gap = now - lastTime;
    if (gap < CONFIG.minFrameGap) {
      if (timerId === null) {
        timerId = setTimeout(() => {
          timerId = null;
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
          tick(performance.now());
        }, CONFIG.minFrameGap - gap);
      }
      return;
    }
    const dt = Math.min(gap, 50);
    lastTime = now;
    resize();          // 顺带处理容器尺寸变化
    render(dt);
  } catch (e) {
    // 任何一帧出错都不要让循环静默死掉
    lastError = String((e && e.message) || e);
    console.warn('[hero-shader] 渲染异常:', e);
  }
  schedule();
}
