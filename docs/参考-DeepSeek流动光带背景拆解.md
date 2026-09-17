# DeepSeek Harness 落地页「流动光带」背景 — 源码级拆解

来源：`https://www.deepseek.com/harness/`
抓取物：页面 CSS `_next/static/css/6f322bb0cffe2c36.css` + 页面 chunk `_next/static/chunks/app/[locale]/page-f752721b763e9f77.js`
结论：那层流动的蓝白飘带**不是 CSS、不是图片、也不是 canvas 2D，而是 WebGL fragment shader 实时算出来的**。

> 说明：下面的 GLSL 是**从对方线上 JS 里抓出来的第三方代码原文**，仅作技术参考。
> 不要把它当成我们的代码直接提交 —— 那是别人的实现。我们的版本要自己写。

---

## 一、整体结构：4 段 shader + 1 个交互缓冲

| # | 类型 | 作用 |
|---|---|---|
| 0 | 顶点着色器 | 只做 `vUv = a_position` 直接透传，无变换 |
| 1 | 片元（累积缓冲） | **鼠标交互层**：读上一帧、按 `u_decay` 衰减、把鼠标位置/速度"画"进去，输出 r=强度、gb=方向 |
| 2 | 片元（主渲染） | 5 色调色板混合 + 噪声底 |
| 3 | 片元（流体层） | **核心**：域扭曲流体噪声 + 旋度场 + glow 叠加 |

交互设计值得注意：鼠标不是"直接改画面"，而是**累积到一张 flowmap 纹理里**（第 1 段），主渲染再采样这张图去做 UV 扭曲和旋涡。所以鼠标划过之后，那个扰动会在画面上**留下痕迹并慢慢衰减**，像在水里划了一下 —— 而不是跟着光标跑。

## 二、核心算法：域扭曲（domain warping）＋ 旋度（curl）

那层"飘带/拉丝"质感的唯一来源就是 `uv + w1 + w2` 这种**用噪声的结果去偏移噪声的采样坐标、套两层**：

```glsl
float fluidNoise(vec2 uv, float t){
  float n1 = fbm(vec3(uv*.6,        t*.06      ));
  float n2 = fbm(vec3(uv*.6+5.2,    t*.06+1.3  ));
  vec2  w1 = vec2(n1, n2) * .6;                              // 第一次扭曲
  float n3 = fbm(vec3((uv+w1)*.7+1.7, t*.05+3.1));
  float n4 = fbm(vec3((uv+w1)*.7+9.2, t*.05+5.7));
  vec2  w2 = vec2(n3, n4) * .5;                              // 第二次扭曲
  return fbm(vec3((uv+w1+w2)*.5, t*.04));                    // 在扭曲后的坐标上再采样
}

// 旋度场：让流体朝"卷"的方向走，而不是直线平移
vec2 curlish(vec2 uv, float t){
  float eps = .02;
  float n  = snoise(vec3(uv*.8, t));
  float nx = snoise(vec3((uv+vec2(eps,0.))*.8, t));
  float ny = snoise(vec3((uv+vec2(0.,eps))*.8, t));
  return vec2(-(ny-n)/eps, (nx-n)/eps) * .003;               // 数值微分求梯度 → 旋转 90° 即旋度
}
```

主渲染里再把它和前两样叠加：

```glsl
vec2 curl = curlish(suv, t*.04);
vec2 uvD  = suv + curl*12.;            // 旋度位移，决定"卷曲程度"
float f   = fluidNoise(uvD, t);
float swirl = snoise(vec3(uvD*.8 + f*1.5, t*.035)) * .5 + .5;   // 再叠一层，做出光晕层次
vec3 col = mix(u_c1, u_c2, smoothstep(.2, .5, n));              // 多色平滑过渡
```

`fbm`（分形叠加）、`snoise`（3D simplex 噪声）、`hash` 都是标准实现，照抄思路即可。

## 三、五色调色板 + glow

主 shader 声明了 `u_c1…u_c5` 五个颜色、`u_colorCount`、以及三个 `u_glowColor*` + `u_glowIntensity`。**注意：这些具体色值不在这份 JS 里** —— 它是运行时由组件 props 传进去的，所以抓不到确切数字。从截图看是「深蓝底 + 青白飘带 + 冷灰过渡」。

另一个 shader（#2）里还有一套 `blend_multi()`，用 `smoothstep` 把 5 个颜色按 `u_colorCount` 均分区间依次混合 —— 如果想做"多色渐变流动"可以借鉴这个混色结构。

## 四、这张页面的**完整**背景其实是三样东西叠加

大多数人只会注意到飘带，但它是分层的：

1. **WebGL 流体 shader**（`<canvas>`，页面 HTML 位置 26254）→ 飘带 / 光晕
2. **`.ds-grid-bg`**（纯 CSS）→ 那张 90×90 的网格，仅 2.5% 黑，双轴渐变遮罩求交集（`mask-composite: intersect`）
3. **色块**：`bg-[#101113]`、`bg-[rgba(35,61,104,0.46)]` 等 Tailwind 任意值 → 给 shader 打底/压暗

也就是说：**shader 提供"流动"，CSS 网格提供"秩序"，两者叠在一起才不显得脏。** 这解释了我们之前反复调 CSS 渐变却始终不像的原因 —— 缺的是"流动"，而不是色号。

## 五、要给我们的页面用，需要注意的现实问题

| 问题 | 说明 |
|---|---|
| **性能** | 全屏 fragment shader 每帧要跑 fbm×5 + snoise×4（还有循环），在 117 张卡片 + `backdrop-filter` 的页面上可能明显掉帧。对方的做法是把它限制在**首屏 hero 区域**，不是整页铺满 |
| **移动端** | 移动端 GPU 更弱，通常需要降 `u_pixelRatio` 或干脆退回静态图 |
| **可访问性** | 需要 `prefers-reduced-motion` 时停掉时间推进（冻结在某一帧） |
| **省电** | `document.hidden` 时必须停 rAF |
| **降级** | WebGL 不可用时要有静态兜底（一张预渲染图或纯 CSS 渐变） |

## 六、我的实现建议（三档，按代价从小到大）

1. **静态预渲染**：把 shader 渲一帧导出成 PNG，当背景图用。零运行时开销、观感 80% 接近，但没有流动和鼠标交互。
2. **Hero 区动态 shader**（推荐）：只在页面顶部首屏铺一块 shader canvas，往下滚就是纯 CSS 网格背景；鼠标交互只在 hero 内生效。观感最接近原版，性能风险可控。
3. **整页动态 shader**：最像原版，但和 117 张卡片 + `backdrop-filter` 叠加，需要实测帧率再决定，可能要降分辨率或降到 30fps 上限。

如果要走 2 或 3，我会**自己写一份 shader**（同样的域扭曲思路，代码自己组织、颜色按我们的配色体系给），并带上 `prefers-reduced-motion` 冻结、`document.hidden` 暂停、DPR 上限、WebGL 缺失时的静态兜底。
