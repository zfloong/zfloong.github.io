# Hero Shader 改造计划

## 目标
将当前简单的 fbm + 2 色噪声 shader，升级为 DeepSeek 风格的流体域扭曲 + 旋度场 + 5 色调色盘。

## 核心改动

### 1. 新增 `curlish()` 旋度场函数
- 用 simplex noise 计算梯度
- 梯度旋转 90° 得到旋度
- 让流体产生旋转、卷曲的运动，而不是直线飘动

### 2. 新增 `fluidNoise()` 流体噪声函数
- 3 层 fbm 域扭曲：`fbm(uv + fbm(uv + fbm(uv)))`
- 比当前的 `pattern()` 更有层次感
- 域扭曲量乘系数（0.6 / 0.5）拉开飘带

### 3. 升级为 5 色调色盘
- 当前：2 色（蓝底 + 米灰）
- 改为：5 色（深蓝底 → 亮蓝 → 暗蓝 → 暖金白 → 黑）
- 参考 DeepSeek 默认配色：`['#000000','#1A3870','#204a7e','#eed8aa','#000000']`

### 4. 新增自发光 bloom
- 用 luma 计算亮度
- `smoothstep(threshold-range, threshold+range, luma)` 提取亮区
- 亮区叠加自发光

### 5. 新增虚拟光源
- 暖色核心：`exp(-d²·4.5)` 距离衰减
- 冷色光晕：`exp(-d·1.8)` 距离衰减
- 固定位置（不需要跟随鼠标）

### 6. 新增暗角 vignette
- `smoothstep(0.35, 0.75, length(uv - 0.5))` 边缘压暗
- 让视觉聚焦页面中心

## 不改的部分
- 单 pass 架构（不加 flowmap 双缓冲，因为不需要鼠标交互）
- 30fps 限帧
- DPR 上限 1.5
- WebGL contextlost 兜底
- visibilitychange 暂停
- CSS 兜底渐变

## 配色方案
```
color1: [0.000, 0.000, 0.000]   // #000000 深黑底
color2: [0.102, 0.220, 0.439]   // #1A3870 深蓝
color3: [0.125, 0.290, 0.494]   // #204a7e 亮蓝
color4: [0.933, 0.847, 0.667]   // #eed8aa 暖金白（飘带色）
color5: [0.000, 0.000, 0.000]   // #000000 深黑

glow1: [1.000, 0.969, 0.820]    // #fff7d1 暖白
glow2: [0.325, 0.553, 0.792]    // #538dca 冷蓝
glow3: [0.176, 0.267, 0.545]    // #2d448b 深蓝
```

## 着色逻辑
```glsl
// 域扭曲 + 旋度
vec2 curl = curlish(suv, t * 0.04);
vec2 uvD = suv + curl * 12.0;
float f = fluidNoise(uvD, t);
float swirl = snoise(vec3(uvD * 0.8 + f * 1.5, t * 0.035)) * 0.5 + 0.5;

// 5 色混合
vec3 col = mix(c1, c2, smoothstep(0.2, 0.5, n));
col = mix(col, c3, smoothstep(0.35, 0.65, n + swirl * 0.25));
col = mix(col, c4, smoothstep(0.6, 0.85, swirl) * 0.55);
col = mix(col, c5, smoothstep(0.5, 0.8, n * swirl) * 0.35);

// 自发光 bloom
float luma = dot(col, vec3(0.299, 0.587, 0.114));
float bloom = smoothstep(0.43, 0.79, luma);
col += (col * 0.85 + vec3(0.15, 0.145, 0.13)) * bloom * 0.4;

// 虚拟光源
float ld = length((uv - lightPos) * vec2(aspect, 1.0));
float core = exp(-ld * ld * 4.5);
float halo = exp(-ld * 1.8);
col += vec3(1.0, 0.97, 0.9) * core * 0.14;
col += vec3(0.72, 0.8, 1.0) * halo * 0.2;

// 暗角
float vig = 1.0 - smoothstep(0.35, 0.75, length(uv - 0.5));
col = mix(col * 0.6, col, vig);
```

## 性能影响
- 新增 snoise 3D（比当前 hash noise 开销略高）
- 新增 curlish（2 次 snoise）
- 新增 fluidNoise（3 层 fbm，每层 1 次 snoise）
- 总计约增加 8-10 次 snoise 调用
- 仍在 30fps 限帧下，GPU 开销可控