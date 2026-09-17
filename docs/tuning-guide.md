# FlyLoong Start 调参手册

> 最后更新：2026-09-17
> 本文档列出所有可调参数的位置、含义和调整效果。

---

## 目录

1. [页面入场动画](#1-页面入场动画)
2. [标签页切换](#2-标签页切换)
3. [卡片入场动画](#3-卡片入场动画)
4. [背景流体（"鲸鱼飘带"）](#4-背景流体鲸鱼飘带)
5. [背景网格](#5-背景网格)
6. [搜索框](#6-搜索框)
7. [卡片交互](#7-卡片交互)
8. [全局配色](#8-全局配色)

---

## 1. 页面入场动画

**文件：** `index.html` 第 23 行（内联 `<style>`）

```css
body {
  animation: bootFade 1.5s ease-in-out both;
}
```

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| 时长 | 1.5s | 入场更慢、更柔和 | 入场更快、更干脆 |
| 缓动 | ease-in-out | 慢进慢出，最柔和 | - |
| ease-out | - | 快进慢出，有"展开感" | - |
| linear | - | 匀速，机械感 | - |

**效果：** 控制整个页面从透明到显示的过渡。只影响首次加载，不影响后续交互。

---

## 2. 标签页切换

**文件：** `css/main.css` 第 108 行

```css
.tab-btn.active {
  background: var(--primary);  /* #d4b483 金色 */
}
```

当前标签页切换**没有过渡动画**，板块瞬间出现。如果想加回淡入效果：

```css
.category-section.active {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

> ⚠️ 注意：之前去掉 fadeIn 是因为切换时卡片的 `backdrop-filter` 会延迟渲染，导致网格透出。如果加回，需要确保卡片的 `transition` 不包含 `backdrop-filter`。

---

## 3. 卡片入场动画

**文件：** `css/main.css` 第 437 行

```css
@keyframes cardSlideIn {
  from { transform: translateY(8px); }
  to { transform: none; }
}
.card-wrap {
  animation: cardSlideIn 0.2s ease-out backwards;
}
```

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| translateY | 8px | 卡片从更下方滑入 | 滑入距离更短 |
| 时长 | 0.2s | 滑入更慢 | 滑入更快 |
| ease-out | - | 快起慢停 | - |

**stagger delay（逐张错开）：**
```css
.card-wrap:nth-child(1)  { animation-delay: 0.05s; }
.card-wrap:nth-child(2)  { animation-delay: 0.06s; }
/* ... 每张 +0.01s */
.card-wrap:nth-child(20) { animation-delay: 0.24s; }
```

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| 每张间隔 | 0.01s | 错开更明显，最后几张出现更晚 | 错开更紧凑 |
| 起始延迟 | 0.05s | 整体更晚开始 | 更早开始 |

**⚠️ 重要：** 卡片动画只做 `transform` 位移，**不能做 opacity**。因为卡片有 `backdrop-filter: blur(30px)`，opacity 变化会导致磨砂效果延迟渲染，网格会透出来。

---

## 4. 背景流体（"鲸鱼飘带"）

**文件：** `js/modules/hero-shader.js` 第 16-55 行 CONFIG

你看到的"乳白色一直会动的东西"是 **WebGL 流体 shader** 渲染的飘带效果，不是真正的鲸鱼。它是用域扭曲（domain warping）+ 旋度场（curl noise）模拟的流体运动。

### 4.1 运动参数

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `scale` | 1.77 | 飘带更小、更密（图案缩小） | 飘带更大、更疏（图案放大） |
| `speed` | 28 | 流动更快（实际倍率 = speed/100 = 0.28/秒） | 流动更慢 |
| `grain` | 0.005 | 颗粒感更强（像老电视） | 更干净 |
| `maxDpr` | 1.5 | 更清晰（GPU 开销更大） | 更模糊（省电） |
| `targetFps` | 30 | 更流畅（GPU 开销翻倍） | 更卡但省电 |
| `offsetX` | -124 | 飘带整体右移 | 左移 |
| `offsetY` | -48 | 飘带整体下移 | 上移 |

> **单位说明：** offsetX/Y 的实际值 = 配置值 / 100。所以 -124 → -1.24，-48 → -0.48。

### 4.2 配色参数（5 色调色盘）

流体用 5 个颜色渐进混合，从深到浅：

| 参数 | 当前值 | 色值 | 作用 |
|------|--------|------|------|
| `color1` | [0,0,0] | #000000 | 最深底色（背景） |
| `color2` | [0.102,0.220,0.439] | #1A3870 | 深蓝（中间调） |
| `color3` | [0.125,0.290,0.494] | #204a7e | 亮蓝（高光区） |
| `color4` | [0.933,0.847,0.667] | #eed8aa | 暖金白（飘带色） |
| `color5` | [0,0,0] | #000000 | 最亮回压（防止过曝） |

**调整飘带颜色：** 改 `color4`。当前是暖金白 `#eed8aa`。
- 想要更白的飘带：改 `[0.95, 0.95, 0.95]`
- 想要更蓝的飘带：改 `[0.6, 0.75, 1.0]`
- 想要更暖的飘带：改 `[1.0, 0.9, 0.7]`

**调整底色：** 改 `color1` 和 `color2`。

### 4.3 光源参数

虚拟光源在页面上产生一个暖色光点 + 冷色光晕：

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `lightX` | 0.89 | 光源右移 | 左移 |
| `lightY` | 0.46 | 光源下移 | 上移 |
| `lightCore` | 0.14 | 暖核更亮 | 更暗 |
| `lightHalo` | 0.2 | 冷晕更亮 | 更暗 |

> 单位是 0~1 的比例，(0.89, 0.46) 大约在页面右上区域。

### 4.4 后处理参数

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `vignette` | 0.38 | 边缘更暗（聚焦中心） | 边缘更亮 |
| `bloomThreshold` | 0.61 | 更亮的区域才发光 | 更暗的区域也发光 |
| `bloomRange` | 0.18 | 发光过渡更宽 | 过渡更窄 |
| `bloomStrength` | 0.4 | 自发光更强 | 更弱 |

---

## 5. 背景网格

**文件：** `css/main.css` 第 22-36 行 CSS 变量 + `js/modules/deep-bg.js` 第 16-26 行 CONFIG

### 5.1 网格外观（CSS 变量）

| 变量 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `--bg-grid-cell` | 90 | 格距更大（网格更疏） | 更密 |
| `--bg-grid-line` | 0.06 | 线条更亮 | 更淡 |
| `--bg-grid-dot-r` | 1.8 | 顶点更大 | 更小 |
| `--bg-grid-dot` | 0.12 | 顶点更亮 | 更淡 |
| `--bg-grid-highlight` | 255,255,255 | - | 改颜色（当前纯白） |

### 5.2 鼠标交互（JS CONFIG）

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `mouseRadius` | 140 | 鼠标影响范围更大 | 更小 |
| `pushStrength` | 8 | 顶点被推得更远 | 推力更弱 |
| `returnSpeed` | 0.009 | 回弹更快（弹性强） | 回弹更慢（软绵绵） |

### 5.3 网格渐隐 mask

**文件：** `css/main.css` 第 519 行

```css
.deep-bg-grid {
  mask: linear-gradient(rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.7) 45%, rgba(0,0,0,0.55) 100%);
}
```

| 位置 | 当前值 | 效果 |
|------|--------|------|
| 0%（顶部） | 0.94 | 几乎完全可见 |
| 45%（中部） | 0.7 | 70% 可见 |
| 100%（底部） | 0.55 | 55% 可见 |

调小这些值 → 网格更淡；调大 → 网格更亮。底部值不能太小，否则底部网格消失。

---

## 6. 搜索框

**文件：** `css/main.css`

### 6.1 搜索框样式

```css
.search-input {
  background: rgba(255,255,255,0.04);  /* 背景透明度 */
  border: 1px solid var(--border);      /* 边框 */
  backdrop-filter: blur(16px);          /* 磨砂 */
}
```

### 6.2 搜索框聚焦光晕

```css
.search-box:focus-within {
  box-shadow: 0 0 10px rgba(180,200,255,0.5),
              0 0 25px rgba(150,180,255,0.2),
              inset 0 0 10px rgba(180,200,255,0.12);
}
```

| 参数 | 调大 | 调小 |
|------|------|------|
| 10px（内圈） | 光晕更宽 | 更窄 |
| 0.5（内圈透明度） | 更亮 | 更淡 |
| 25px（外圈） | 外晕更宽 | 更窄 |

### 6.3 搜索框 placeholder

```css
.search-input::placeholder {
  color: #c9a86c;  /* 暖金色，比标签金色 #d4b483 稍淡 */
  opacity: 1;
}
```

| 参数 | 效果 |
|------|------|
| `#c9a86c` | 当前暖金色，与标签金色协调 |
| `#d4b483` | 与标签金色完全一致 |
| `#b8956a` | 更深的金色 |
| `var(--text-sub)` | 灰色（原来的） |

---

## 7. 卡片交互

**文件：** `css/main.css` 第 370 行

```css
.card {
  background: var(--card-bg);           /* rgba(255,255,255,0.05) */
  backdrop-filter: blur(30px);          /* 磨砂 */
  border: 1px solid var(--border);
  transition: transform 0.3s, background 0.3s, border-color 0.3s, box-shadow 0.3s;
}
.card:hover {
  transform: translateY(-4px);          /* 上浮 */
  background: rgba(255,255,255,0.08);   /* 背景变亮 */
  box-shadow: 0 10px 40px rgba(0,0,0,0.5); /* 阴影 */
}
```

| 参数 | 当前值 | 调大 | 调小 |
|------|--------|------|------|
| `blur(30px)` | 30px | 磨砂更模糊 | 更清晰 |
| `translateY(-4px)` | -4px | 上浮更明显 | 更 subtle |
| `rgba(255,255,255,0.05)` | 0.05 | 卡片更亮 | 更透明 |
| `rgba(255,255,255,0.08)` | 0.08 | hover 更亮 | 更暗 |

**⚠️ transition 不能写 `all`！** 必须只过渡 `transform`、`background`、`border-color`、`box-shadow`。如果写 `all`，`backdrop-filter` 也会被过渡，切换标签时网格会透出来。

---

## 8. 全局配色

**文件：** `css/main.css` 第 10-20 行

```css
:root {
  --bg: #151a24;                        /* 页面底色 */
  --nav-bg-top: rgba(17,21,29,0.85);    /* 导航栏顶部 */
  --nav-bg-mid: rgba(17,21,29,0.45);    /* 导航栏底部 */
  --history-bg: rgba(24,30,41,0.88);    /* 搜索历史背景 */
  --card-bg: rgba(255,255,255,0.05);    /* 卡片背景 */
  --text: #e8e8ec;                      /* 主文字 */
  --text-sub: #8a8a9a;                  /* 次要文字 */
  --primary: #d4b483;                   /* 品牌金（标签/按钮/链接） */
  --border: rgba(255,255,255,0.07);     /* 边框 */
  --shadow: 0 8px 32px rgba(0,0,0,0.5); /* 阴影 */
  --glass: blur(30px);                  /* 磨砂强度 */
}
```

**改底色时要注意联动：** `--bg`、`--nav-bg-top`、`--nav-bg-mid`、`--history-bg` 必须同色系，否则导航栏和底色会"分家"。

---

## 附录：文件对应表

| 你想调的东西 | 去哪个文件 |
|-------------|-----------|
| 页面入场速度 | `index.html` 内联 style |
| 标签样式 | `css/main.css` `.tab-btn` |
| 卡片动画 | `css/main.css` `cardSlideIn` |
| 卡片 hover | `css/main.css` `.card:hover` |
| 流体飘带 | `js/modules/hero-shader.js` CONFIG |
| 网格外观 | `css/main.css` `:root` 变量 |
| 网格交互 | `js/modules/deep-bg.js` CONFIG |
| 搜索框 | `css/main.css` `.search-input` / `.search-box` |
| 全局颜色 | `css/main.css` `:root` |