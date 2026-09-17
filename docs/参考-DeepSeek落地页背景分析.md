# DeepSeek Harness 落地页背景分析

来源：`https://www.deepseek.com/harness/`
分析方式：抓取该页面的 Next.js 样式表 `_next/static/css/6f322bb0cffe2c36.css`（44,670 字节）逐条读原文。
说明：本文件是**抓来的第三方代码片段**，仅供你自己参考对比，不要直接当成"我们的代码"提交。

结论先说：**它没有任何 canvas / JS 动画。整个背景是纯 CSS。**
而你这套是「4 层 canvas（模糊光斑 + 粒子连线 + 交互网格）+ CSS 流光」。
两者的差别不在技巧高低，而在**设计哲学**，见文末对比。

---

## 1. 它的背景：一个静态 CSS 网格

```css
.ds-grid-bg {
  background-image:
    linear-gradient(90deg,  rgba(0,0,0,.025) 1px, transparent 0),
    linear-gradient(180deg, rgba(0,0,0,.025) 1px, transparent 0);
  background-size: 90px 90px;
  background-position: 0 -12px;
  -webkit-mask-image:
    linear-gradient(90deg, transparent 0, #000 15%, #000 85%, transparent),
    linear-gradient(180deg, transparent 0, #000 15%, #000 85%, transparent);
  -webkit-mask-composite: destination-in;
  mask-image: (同上两条);
  -webkit-mask-composite: source-in, xor;
  mask-composite: intersect;
}
```

### 三个值得偷的点

| 手法 | 作用 | 你现在的做法 |
|---|---|---|
| **两条 linear-gradient 画线**（90deg 画竖线、180deg 画横线，`1px` 线宽 + `transparent 0` 收边） | 不用图片、不用 SVG，两行搞定一张网格；`background-size: 90px 90px` 控制格距 | 你用 canvas 逐条 stroke + 顶点圆点 |
| **`background-position: 0 -12px`** | 把网格整体上移 12px，让首行的横线不贴在容器顶边上（避免出现"半条线"） | 你没处理这个细节 |
| **双轴渐变遮罩 + `mask-composite: intersect`** | 网格在水平、垂直两个方向都从 15% 处才开始显现、85% 处又淡出 → 视觉上只有**中间区域**有网格，四周自然消失，**没有硬边** | 你用 `linear-gradient(to bottom, …)` 单轴遮罩，只做了上下淡出，左右是硬边 |

**最值得学的是第三条**：用「两个方向的渐变遮罩求交集」得到一个柔和的中心光斑式网格，比单轴淡出自然得多，而且是纯 CSS。

### 它的颜色克制到极致

```css
--ds-color-bg-page: #f9f8f8;        /* 暖白，不是纯白 */
rgba(0,0,0,.025)                     /* 网格线只有 2.5% 黑 —— 几乎要看不见 */
--ds-color-brand: #4d6bfe;           /* 品牌蓝只用在文字链接/按钮上 */
--ds-color-bg-dark: #1a1615;         /* 深色块是暖黑（红比蓝略高），不是冷黑 */
--ds-btn-primary-bg: #1a1615;        /* 主按钮直接上暖黑 */
```

注意两点：
1. **底色不是纯黑也不是纯白**：`#f9f8f8` 带一点点暖，`#1a1615` 是**暖黑**（R>G>B）。你说的"太AI味"，很多"AI味"其实就是纯灰蓝 + 纯黑大量堆叠；它这里一律避开纯值。
2. **没有「氛围光」**：全站没有大面积的模糊光斑、没有辉光、没有粒子。视觉重量全靠**网格 + 精确遮罩 + 留白**撑。

### 它也没有日夜切换

全文件搜不到 `prefers-color-scheme`、也搜不到 `.dark` 选择器 —— 它只做一套（暖浅色），深色只作为"块"出现（`--ds-color-bg-dark`），不做整页主题切换。**这恰好印证了我们之前的判断：一套做到底比两套都做得平庸更好。**

---

## 2. 但它有一个和你**一模一样的**技巧：conic 流光边框

```css
.ds-hero-cta-block::before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  padding: 2px;
  background: conic-gradient(
    from var(--border-angle),
    rgba(58,101,194,.15) 0,
    rgba(120,170,255,.7) 25%,
    rgba(58,101,194,.15) 50%,
    rgba(120,170,255,.7) 75%,
    rgba(58,101,194,.15) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  /* …mask-composite 挖空中心，与你的写法相同… */
}
@keyframes rotating-border {
  0%  { --border-angle: 0deg }
  to  { --border-angle: 360deg }
}
```

**和你卡片流光的结构完全相同**：`::before` + `inset: -2px` + `padding: 2px` + `conic-gradient(from var(--角度))` + `mask-composite` 挖空。

两个差别值得注意：

| | 它 | 你 |
|---|---|---|
| 渐变分布 | **两段对称**（0/50/100 暗、25/75 亮）→ 两条光在边框上对称转 | 单段（7%~27% 一条亮带）|
| 用在哪 | 只用在**一个 CTA 按钮**这种小元素上 | 用在**117 张卡片**上，还带 `backdrop-filter` |
| 驱动方式 | `@keyframes { to { --border-angle: 360deg } }` ← **和你原来那份一样** | 我们最后改成了「36 帧步进动 `background-image`」|

**最后一行是重点**：DeepSeek 自己也是用「动画自定义属性」。也就是说，这个写法在**大多数环境是正常的** —— 我们遇到的不重绘问题是你那台机器/那个组合（卡片 `backdrop-filter` + 大面积）触发的边缘情况，不是写法本身错。你可以把我们那 36 帧的写法留着（它已验证在你机器上能跑），但**不必认为原来的写法是错的**。

---

## 3. 可以移植到我们这边的三点（按性价比排序）

1. **网格遮罩改成双轴交集**（纯 CSS，零风险）：
   把你 `.deep-bg-grid` 里那条单轴 `mask` 换成上面那种「横+竖两个渐变 + `intersect`」，网格就会从中心向外柔和消失，而不是只在上下淡出、左右硬切。**这一步不管你有没有 canvas 都能做，而且立刻能看出效果。**

2. **颜色去"纯"**：把 `--bg: #151a24` 这类偏冷的蓝灰，往**暖中性**挪一点（比如 R 略高于 B），会明显减少"AI 味"。参考它的暖黑 `#1a1615` 和暖白 `#f9f8f8`。

3. **考虑砍掉一层氛围**：它证明了一件事 —— **不用模糊光斑和粒子，靠网格 + 遮罩 + 留白也能撑住一个高端页面**。如果你的「网格」档（方案二）看着还不够干净，下一步就是把 canvas 的模糊层（`deep-bg-blur`）整个去掉，只留网格，观感会立刻向它靠拢。这一步要你看了「网格」档之后再决定。
