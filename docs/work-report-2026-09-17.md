# 工作报告：zfloong.github.io 代码审查与优化

> 日期：2026-09-17
> 项目：https://github.com/zfloong/zfloong.github.io

---

## 一、今天遇到的坑

### 1. 磨砂层（frost）与网格互相干扰
- **现象**：frost 层的 `backdrop-filter: blur(14px)` 会把下方的网格彻底抹平
- **原因**：z-index 层级不对时，frost 盖在网格上面，14px 模糊把 0.3 不透明度的 1px 网格线完全消除
- **解决**：严格控制 z-index（-3 → -2 → -1），后来发现 DeepSeek 根本不用磨砂层，直接去掉了

### 2. 入场动画时序冲突
- **现象**：bootFade（0.72s）还没结束，网格 canvas 才刚创建（~1650ms），导致网格"突然出现"
- **原因**：页面级 bootFade 从加载起算，但网格是数据加载完才创建的
- **解决**：去掉 gridRise 动画，统一入场方案

### 3. 卡片切换时网格透出
- **现象**：切换标签时，卡片做 fadeIn 动画期间，网格从卡片背后透出来
- **原因**：`transition: all 0.3s` 让 `backdrop-filter` 也被过渡，磨砂效果延迟生效
- **解决**：把 `transition: all` 改为只过渡 `transform`、`background`、`border-color`、`box-shadow`

### 4. 流体速度过快
- **现象**：升级 shader 后飘带流动速度极快
- **原因**：时间公式写成了 `dt * 0.001 * speed`（speed=28），而 dsh-plugin-backdrop 用的是 `dt * 0.001 * (speed / 100)`，实际倍率差 100 倍
- **解决**：修正为 `dt * 0.001 * (CONFIG.speed / 100)`

### 5. Chromium 不重新光栅化 @property 动画
- **现象**：用 `@property` 注册自定义属性做 conic-gradient 旋转动画时，Changles 在变但画面定格
- **原因**：Chromium 的 bug，计算值变化但不重新光栅化
- **解决**：卡片流光已删除；搜索框 shimmer 已替换为 box-shadow

### 6. 背景只显示上半部分
- **现象**：流体背景只在页面上半部分显示，下半部分是纯色
- **原因**：`#hero-shader` 的高度被限制为 `clamp(380px, 68vh, 660px)`，只占顶部 68%
- **解决**：改为 `height: 100%` 覆盖整页，靠 CSS mask 做渐隐（与 dsh-plugin-backdrop 一致）

---

## 二、修改的参数

### CSS 变量（:root）
| 参数 | 修改前 | 修改后 | 来源 |
|------|--------|--------|------|
| --bg-grid-cell | 72 | 90 | dsh-plugin-backdrop |
| --bg-grid-line | 0.3 | 0.06 | dsh-plugin-backdrop |
| --bg-grid-dot-r | 1.7 | 1.8 | dsh-plugin-backdrop |
| --bg-grid-dot | 0.34 | 0.12 | dsh-plugin-backdrop |
| --bg-grid-highlight | 120,150,255 | 255,255,255 | dsh-plugin-backdrop |

### 深色背景（deep-bg.js CONFIG）
| 参数 | 修改前 | 修改后 |
|------|--------|--------|
| cellSize | 100 | 90 |
| lineOpacity | 0.166 | 0.06 |
| dotRadius | 1.2 | 1.8 |
| dotOpacity | 0.15 | 0.12 |
| mouseRadius | 150 | 140 |
| highlightColor | 蓝白 | 纯白 |

### 流体 Shader（hero-shader.js）
| 参数 | 修改前 | 修改后 | 来源 |
|------|--------|--------|------|
| scale | 0.6 | 1.77 | dsh-plugin-backdrop |
| speed | 0.42 | 28（实际 0.28/秒） | dsh-plugin-backdrop |
| grain | 0.004 | 0.005 | dsh-plugin-backdrop |
| color1 | #172F59 | #000000 | dsh-plugin-backdrop |
| color2 | #1A3C66 | #1A3870 | dsh-plugin-backdrop |
| color3 | #264A66 | #204a7e | dsh-plugin-backdrop |
| color4 | #A3A399 | #eed8aa | dsh-plugin-backdrop |
| 色盘 | 2 色 | 5 色 | dsh-plugin-backdrop |
| 旋度场 | ❌ 无 | ✅ curlish() | dsh-plugin-backdrop |
| 流体噪声 | pattern() | fluidNoise() | dsh-plugin-backdrop |
| fbm 迭代 | 4 次 | 1 次 | dsh-plugin-backdrop |
| bloom | 微弱 | 0.4 强度 | dsh-plugin-backdrop |
| 虚拟光源 | ❌ 无 | ✅ 暖核+冷晕 | dsh-plugin-backdrop |
| 暗角 | ❌ 无 | ✅ 0.38 | dsh-plugin-backdrop |
| offset | 无 | (-1.24, -0.48) | dsh-plugin-backdrop |

### 入场动画
| 动画 | 修改前 | 修改后 |
|------|--------|--------|
| bootFade | 0.72s ease-out | 1.5s ease-in-out |
| pageEnter | 0.8s（navbar/search/content） | 已删除 |
| fadeIn | 0.5s（板块切换） | 已删除 |
| scroll-reveal | 0.32s | 已删除 |
| gridRise | 1.9s | 已删除 |
| cardContentEnter | 0.26s stagger | 改为 cardSlideIn 0.2s（只位移） |
| shimmerSpin | 36 帧 | 已删除，改为 box-shadow |

---

## 三、完成的优化

### 特效减法（CSS 781 → 528 行，减少 32%）
1. ✅ 移除 `.deep-bg-glow`（光晕层）
2. ✅ 移除 `#frost`（磨砂层）
3. ✅ 移除 `pageEnter` 动画
4. ✅ 移除 `fadeIn` 动画
5. ✅ 移除 `scroll-reveal` 样式
6. ✅ 移除 `gridRise` 动画
7. ✅ 移除 `cardContentEnter` + 20 个 stagger delay
8. ✅ 移除卡片 `::after` 流光边框 + `cardBeamSpin` 36 帧
9. ✅ 移除搜索框 shimmer `::before` + `shimmerSpin` 36 帧 + `--beam-stops`
10. ✅ 移除 `hero-effects.js` 文件
11. ✅ 流体高度从 `clamp(380px, 68vh, 660px)` 改为 `100%` 覆盖整页

### 功能优化
1. ✅ 卡片 `transition: all` 改为指定属性（解决切换标签时网格透出）
2. ✅ 搜索框聚焦改为蓝白色 box-shadow 光晕
3. ✅ 入场动画统一为 bootFade + 卡片位移

### Shader 升级
1. ✅ 流体从简单 fbm 噪声升级为域扭曲 + 旋度场
2. ✅ 2 色调色盘升级为 5 色
3. ✅ 新增自发光 bloom
4. ✅ 新增虚拟光源（暖核 + 冷晕）
5. ✅ 新增暗角 vignette
6. ✅ 颗粒跟随流体偏移
7. ✅ 新增 u_offset 偏移参数

### 网格对齐 dsh-plugin-backdrop
1. ✅ 格距 72 → 90px
2. ✅ 线条/顶点不透明度大幅降低（0.3→0.06, 0.34→0.12）
3. ✅ 高亮色改为纯白
4. ✅ mask 从双轴交集改为单轴渐隐
5. ✅ 流体 mask 对齐项目参数

---

## 四、逆向参考

### 项目地址
https://github.com/huguangyu666/dsh-plugin-backdrop

### 项目性质
**逆向分析 + 开源复刻**，不是 DeepSeek 官方源码。
该项目从 deepseek.com/harness 官网的 JS chunk 中提取 GLSL shader，
独立重建了流体背景、鲸鱼动画、发光鱼群、点线网格四层效果。

### 从中学习到的东西

1. **旋度场（curlish）是流体"生命力"的来源**
   - 梯度旋转 90° 得到旋度方向
   - 让流体产生旋转、卷曲的运动，而不是直线飘动
   - 这是 DeepSeek 飘带看起来像"水在流"而不是"雾在飘"的关键

2. **流体噪声用 3 层域扭曲**
   - `fbm(uv + fbm(uv + fbm(uv)))` 经典三级域扭曲
   - 扭曲量乘系数（0.6/0.5）拉开飘带
   - 比简单的 fbm 更有层次感

3. **磨砂质感不需要 backdrop-filter**
   - DeepSeek 通过流体噪声 + CSS mask 渐隐 + 低对比度组合出视觉上的"磨砂感"
   - 不需要单独的 blur 层

4. **网格设计哲学**
   - 纯白、极低不透明度（0.06/0.12）
   - 不与流体抢视觉
   - 用 CSS mask 做柔和渐隐

5. **时间公式要注意单位**
   - dsh-plugin-backdrop 用 `speed / 100` 作为倍率
   - 直接用 `speed` 会快 100 倍

6. **fbm 迭代次数影响性能和观感**
   - dsh-plugin-backdrop 只用 1 次迭代（简化版，性能优先）
   - 4 次与 6 次观感差别很小，但省约 1/3 开销

---

## 五、最终文件状态

| 文件 | 行数 | 说明 |
|------|------|------|
| css/main.css | 528 | 从 781 行减少 32% |
| js/modules/hero-shader.js | 380 | 从 312 行增加（新增旋度场/流体/bloom/光源/暗角） |
| js/modules/deep-bg.js | 383 | 不变 |
| js/modules/hero-effects.js | 已删除 | scroll-reveal 逻辑 |
| index.html | 51 | 去掉 frost/glow div，bootFade 改为 1.5s |

### 背景层级（最终）
```
body 渐变
 └─ #hero-shader (z:-3)   流体（WebGL shader）
 └─ #deep-bg (z:-1)       网格（Canvas 2D）
```

无磨砂层，无光晕层，与 dsh-plugin-backdrop 一致。