# 方案 C — 暖白务实 · 风格规范文档

> 本文档是方案 C 的完整视觉风格规范，用于指导实际代码的样式改进。
> 遵循本文档中的所有规则，可还原与 Demo 一致的视觉风格。

---

## 一、整体设计理念

**核心定位**：温暖、务实、以文档为中心。面向长时间编辑 ESG 报告正文的使用场景，减少冷硬感，强调正文阅读舒适度。整体带有纸张质感——米白背景、衬线标题、略带纹理的暖灰界面，像一份真实的文件编辑系统。

**设计关键词**：温暖 / 文档感 / 务实 / 可读性强 / 纸张质感

---

## 二、色彩系统

### 主色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--green` | `#2D6A4F` | 主色：主按钮、激活状态、进度条、已引用标记 |
| `--green-hover` | `#245C44` | 主色 Hover |
| `--green-soft` | `#EAF4EE` | 主色浅底：选中背景、step 勾选背景 |
| `--green-mid` | `#C8E6D4` | 主色中间调：边框、标签边框 |
| `--green-line` | `#95D5B2` | 进度条填充辅助 |

> **重要**：主色为**墨绿**（`#2D6A4F`），而非蓝色。这是方案 C 区别于其他方案的核心色彩决策。

### Pipeline 专属色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--indigo` | `#3D3D99` | Pipeline 专属：Pipeline 相关 Logo、Tab 激活、运行中状态 |
| `--indigo-soft` | `#EDEDF8` | Pipeline 相关浅底 |

> Pipeline 页面使用靛蓝色系，与主编辑器的墨绿色系形成语义区分。

### 背景色（暖色调）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg` | `#F7F5F0` | 页面底色（暖米白，带轻微黄调）|
| `--bg-warm` | `#F0EDE6` | 偏暖的辅助背景：侧边栏、格式工具栏、表格表头、pagination |
| `--bg-card` | `#FFFFFF` | 卡片、编辑器正文内容区 |
| `--bg-sidebar` | `#F3F0EA` | 左侧目录侧边栏（比页面色略深一档）|

> **核心区别**：方案 C 有多档暖色背景，`--bg`、`--bg-warm`、`--bg-sidebar` 三档形成层次感，营造纸张质感。

### 边框色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--border` | `#DDD9D0` | 标准边框（带暖灰色调，非冷灰）|
| `--border-light` | `#E8E4DC` | 轻量分割线 |

### 文字色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--text-1` | `#1C1C1A` | 主文字（略带暖调，非纯黑）|
| `--text-2` | `#3D3D39` | 正文 |
| `--text-3` | `#6B6860` | 说明文字 |
| `--text-4` | `#9C9890` | Meta 信息、占位符 |

> **注意**：所有文字色均带有微弱的暖调（偏黄），而非纯灰，与暖色背景和谐。

### 语义色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--amber` / `--amber-soft` / `--amber-line` | `#B45C0A` / `#FEF3E2` / `#F0A44A` | 待补充块、警告 |
| `--red` / `--red-soft` | `#9B2020` / `#FDEAEA` | 错误、删除（偏暗红）|
| `--blue` / `--blue-soft` / `--blue-mid` | `#1A5C96` / `#E8F0F8` / `#C5D9EE` | 来源角标、待审核状态 |

---

## 三、字体系统

### 字体族
方案 C 使用**衬线与无衬线的混搭**，营造文档编辑的仪式感：
- **标题字体**：`'Noto Serif SC', serif`
  - 宋/明体风格，用于所有标题、卡片名称、侧边栏分组、表头
  - 带来文档感与阅读质感
- **正文字体**：`'Noto Sans SC', sans-serif`
  - 用于正文内容、按钮、标签、Meta 信息

> **关键差异**：方案 C 是三个方案中**唯一使用衬线字体**做标题的方案，这是其文档质感的核心来源。

### 字号规范
| 用途 | 字号 | 字重 | 字体 |
|------|------|------|------|
| 页面主标题 | `16px` | `700` | 标题字体（Serif）|
| 卡片名称 / 章节标题 | `14–15px` | `700` | 标题字体（Serif）|
| 导航品牌名 | `14px` | `700` | 标题字体（Serif）|
| 编辑器 H2 章节标题 | `15px` | `700` | 标题字体（Serif）|
| 正文内容 | `13px` | `400` | 正文字体 |
| 按钮文字 | `12px` | `500` | 正文字体 |
| 徽章 / Meta | `11px` | `400–500` | 正文字体 |

### 行高
- 编辑区正文：`line-height: 1.85`
- 普通 UI：`line-height: 1.6`
- 紧凑元素：`line-height: 1.4`

---

## 四、圆角系统

**统一圆角原则**：全局使用 `4px` 作为标准圆角，更小的元素使用 `3px`。这是三个方案中圆角最小的，形成有棱角的文件感，区别于方案 A（6px）和方案 B（8px）。

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--radius` | `4px` | 按钮、输入框、卡片、信源卡片、下拉菜单 |
| `--radius-sm` | `3px` | 搜索框、筛选按钮、标签、角标 |
| 圆形 | `99px` | 仅用于进度条，徽章不使用圆形 |

> **重要**：方案 C 的徽章（Badge）**不使用圆形 Pill**，而是使用 `border-radius: --radius-sm` 的圆角矩形，更有档案标签感。

---

## 五、阴影系统

阴影带有微弱的暖调：

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--shadow-sm` | `0 1px 3px rgba(28,28,26,0.06)` | 卡片默认态、编辑器内容卡片 |
| `--shadow-md` | `0 3px 10px rgba(28,28,26,0.08)` | Hover 态、浮层 |

> 阴影颜色使用 `rgba(28,28,26,…)` 的暖黑色，与纯黑阴影区分。

---

## 六、导航栏规范

### 结构原则
**所有页面使用完全相同的 Header 结构**，高度固定 `52px`（比方案 B 略高），白色背景，底部使用 `2px` 边框（比方案 A/B 的 1px 更有分量感）。

### 左侧结构
所有页面左侧均含品牌标识区：
```
[ Logo方块 ] [ 面包屑导航... ]
```

**Logo 方块**：`22×22px`，无填充色，用 `border: 2px solid` 做描边框（首页/编辑器用墨绿色，Pipeline 页用靛蓝色），内嵌 SVG 图标。

**品牌名**（首页特有）：仅首页 Logo 右侧显示完整品牌名 `ESG 报告编辑平台`，使用标题字体（Serif），`14px`，`700`，位于 Logo 和面包屑之间。

### 面包屑样式
```css
/* 可点击项 */
font-size: 12px; color: --text-3;
padding: 3px 7px; border-radius: --radius-sm;
cursor: pointer;
transition: background 0.15s, color 0.15s;
```
Hover：`background: --bg-warm; color: --text-1`

```css
/* 当前页（不可点击）*/
font-size: 12px; color: --text-1; font-weight: 500;
padding: 3px 7px;
pointer-events: none;
```

分隔符：`color: --border; font-size: 16px; font-weight: 300`（用 `/` 字符）

### 各页面 Logo 与面包屑
| 页面 | Logo 色 | 面包屑路径 |
|------|---------|-----------|
| 首页 | 墨绿 | （无面包屑，只有品牌名）|
| 编辑器 | 墨绿 | `⌂ 首页 / ↻ Pipeline / ≡ 艾森股份 2025 ESG 报告` |
| Pipeline | 靛蓝 | `⌂ 首页 / ↻ 艾森股份 2025 — Pipeline` |
| 分块浏览 | 靛蓝 | `⌂ 首页 / Pipeline / 分块浏览` |

---

## 七、按钮规范

### 主按钮（btn-primary）—— 墨绿色
```css
background: --green; color: #fff;
border-radius: --radius; padding: 5px 12px;
font-size: 12px; font-weight: 500;
```
Hover：`background: --green-hover`

### 幽灵按钮（btn-ghost）
```css
background: transparent; color: --text-2;
border: 1px solid --border;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --bg-warm`

### 软色按钮（btn-soft）—— 墨绿软色
```css
background: --green-soft; color: --green;
border: 1px solid --green-mid;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --green-mid`

### Pipeline 主按钮（btn-indigo）
```css
background: --indigo; color: #fff;
border-radius: --radius; padding: 5px 12px;
```
Hover：`opacity: 0.9`

### 危险按钮（btn-danger）
```css
background: transparent; color: --red;
border: 1px solid #F5C0C0;
border-radius: --radius;
```
Hover：`background: --red-soft`

> **所有按钮**：`font-family: --font-body`（Noto Sans SC），`font-size: 12px`，`font-weight: 500`，`line-height: 1.4`。

---

## 八、状态徽章与指示器

### 原则：禁止使用 Emoji
方案 C 用**彩色竖向细条（pip）**作为状态指示器，区别于方案 A 的圆点和方案 B 的方块。

### 竖向色条（stat-pip）
```css
width: 3px;
height: 14px;              /* 随文字高度调整 */
border-radius: 99px;
flex-shrink: 0;
display: inline-block;
```

| 变量类 | 颜色 | 用途 |
|--------|------|------|
| `pip-green` | `--green` | 已生成、已完成、已引用 |
| `pip-amber` | `--amber-line` | 警告、待处理 |
| `pip-blue` | `--blue` | 待审核 |
| `pip-red` | `--red` | 错误 |
| `pip-gray` | `--text-4` | 已跳过、未引用 |
| `pip-indigo` | `--indigo` | 运行中 |

### 徽章（Badge）—— 圆角矩形，非 Pill
```css
display: inline-flex; align-items: center; gap: 5px;
font-size: 11px; font-weight: 500;
padding: 2px 8px;
border-radius: --radius-sm;          /* 3px，非 99px */
border: 1px solid transparent;
```

| 状态 | 背景 | 文字 | 边框 |
|------|------|------|------|
| 已生成 | `--green-soft` | `--green` | `--green-mid` |
| 待审核 | `--blue-soft` | `--blue` | `--blue-mid` |
| 未上传 | `--amber-soft` | `--amber` | `#F5C897` |
| 运行中 | `--indigo-soft` | `--indigo` | `#C5C5EE` |
| 失败 | `--red-soft` | `--red` | `#F5C0C0` |
| 已跳过 | `--bg-warm` | `--text-3` | `--border` |

### 侧边栏进度统计
```
｜ 103 已生成   （绿色竖条）
｜ 12 已跳过    （灰色竖条）
｜ 4 已审核     （蓝色竖条）
```

---

## 九、进度条规范

### 样式
```css
height: 4px;
background: --border;
border-radius: 99px;
overflow: hidden;
```
填充色：`background: --green`（墨绿，单色无渐变）

### 图例
```
● 103 已生成   ● 12 已跳过   ● 4 错误
```
（圆点，`6px`，颜色对应各状态）

---

## 十、信源卡片规范

### 核心设计：左侧竖条区分引用状态
方案 C 信源卡片的引用状态通过**左侧 3px 竖条**表达，是三个方案中最直观的区分方式。

### 已引用卡片
```css
border: 1px solid --border-light;
border-left: 3px solid --green;      /* 绿色竖条 */
border-radius: --radius;
background: --bg-card;
transition: border-left-color 0.2s;
```
Hover：`border-left-color: --green-hover`

### 未引用卡片
```css
border: 1px solid --border-light;
border-left: 3px solid --border;     /* 灰色竖条 */
border-radius: --radius;
opacity: 0.8;
transition: opacity 0.15s;
```
Hover：`opacity: 1`

### 相关度进度条
- 高度：`3px`（介于方案 A 的 3px 和方案 B 的 2px 之间）
- 已引用：`background: --green`
- 未引用：`background: --text-4`

### 标签
- 已引用：绿色圆角矩形徽章（`badge-green`）
- 未引用：灰色圆角矩形徽章（`badge-gray`）
- 字号均为 `10px`，`padding: 1px 6px`

---

## 十一、编辑器区域规范

### 编辑内容区（文档卡片）
方案 C 的编辑器正文区域放置在一张白色卡片内，与暖米白页面背景形成层次：
```css
background: --bg-card;
margin: 12px 16px;                   /* 四周有间距，形成卡片感 */
border: 1px solid --border-light;
border-radius: --radius;
box-shadow: --shadow-sm;
padding: 24px 32px;                  /* 宽敞的内边距 */
```

### 正文样式
```css
font-family: 'Noto Sans SC', sans-serif;
font-size: 13px;
line-height: 1.85;
color: --text-1;
```

### 编辑器 H2 章节标题
```css
font-family: 'Noto Serif SC', serif;      /* Serif 标题 */
font-size: 15px; font-weight: 700;
color: --text-1;
margin-bottom: 12px;
padding-bottom: 6px;
border-bottom: 1px solid --border-light;  /* 标题下方有分割线 */
```

### 来源角标
```css
display: inline-flex; align-items: center; justify-content: center;
min-width: 16px; height: 15px; padding: 0 3px;
font-size: 10px; font-weight: 600;
color: --blue; background: --blue-soft;
border: 1px solid --blue-mid;
border-radius: --radius-sm;              /* 3px */
cursor: pointer;
vertical-align: super; line-height: 1;
margin: 0 1px;
```

### 待补充块
```css
background: --amber-soft;
border-left: 3px solid --amber-line;     /* 3px 竖条，与信源卡片一致 */
padding: 10px 14px; margin: 14px 0;
border-radius: 0 --radius-sm --radius-sm 0;
font-size: 12px; color: --amber;
```

### 格式工具栏
```css
background: --bg-warm;                  /* 暖色背景 */
border-bottom: 1px solid --border-light;
padding: 4px 12px; height: ~30px;
```

### 底部状态栏
```css
height: 27px;
background: --bg-warm;                  /* 与工具栏一致 */
border-top: 1px solid --border;
font-size: 11px; color: --text-4;
```

---

## 十二、左侧目录侧边栏规范

### 背景
`background: --bg-sidebar`（`#F3F0EA`），比页面底色 `--bg` 略深一档，形成空间层次。

### 激活项——带左侧绿色竖条
方案 C 侧边栏激活项使用绿色左侧竖条，与信源卡片的竖条设计语言统一：
```css
background: --green-soft;
border-left: 2px solid --green;
padding: 4px 8px;
border-radius: --radius-sm;
color: --green; font-weight: 500;
```

### 状态指示（竖条 pip）
叶节点左侧用 `3×12px` 竖条（`border-radius: 99px`）替代图标：
- 已生成：`background: --green`
- 已跳过：`background: --text-4; opacity: 0.4`
- 待审核：`background: --blue`

### 分组标题
```css
font-family: 'Noto Serif SC', serif;    /* 衬线字体，体现层级 */
font-size: 12px; font-weight: 600;
color: --text-2;
```

### 筛选按钮
```css
font-size: 11px; padding: 2px 9px;
border-radius: --radius-sm; font-weight: 500;
```
选中：`background: --green-soft; color: --green; border: 1px solid --green-mid`
未选中：`border: 1px solid --border; background: transparent; color: --text-3`

### 底部统计区
```css
background: --bg-warm;
border-top: 1px solid --border;
padding: 10px 12px;
```

---

## 十三、Pipeline 页面规范

### Header Logo 色
Pipeline 相关页面 Logo 边框色改为 `--indigo`，图标色改为 `--indigo`，区分于编辑器页的墨绿色。

### Tab 导航
- 激活：`color: --indigo; border-bottom: 2px solid --indigo; font-weight: 600`（注意：靛蓝色，非墨绿）
- 非激活：`color: --text-3; border-bottom: 2px solid transparent`
- 底部边框：`border-bottom: 2px solid --border`（比 Header 同粗，2px）

### 内容区
`background: --bg; padding: 20px 22px; display: grid; grid-template-columns: 1fr 2fr; gap: 14px`

### 卡片
```css
background: --bg-card;
border: 1px solid --border;
border-radius: --radius;             /* 4px */
padding: 14px–16px;
box-shadow: --shadow-sm;
```
卡片标题：`font-family: --font-head; font-size: 12px; font-weight: 700; color: --text-2; letter-spacing: 0.02em`（衬线字体）

### 步骤勾选项（Controls）
选中：`background: --green-soft; border: 1px solid --green-mid`
未选中：`border: 1px solid --border`

### 步骤时间线
- 已完成：`background: --green-soft; border: 1px solid --green-mid`，绿色圆形勾选图标
- 运行中：`background: --indigo-soft; border: 1px solid #C5C5EE`，旋转动画图标
- 等待中：`border: 1px solid --border-light`（轻边框，无背景）
- 连接线：`width: 1px; height: 8px; background: --border; margin-left: 17px`

### 章节格子
每格 `10×10px; border-radius: 2px`：
- 已完成：`background: --green`（墨绿）
- 运行中：`background: --indigo`
- 等待中：`background: --border`（暖灰）

---

## 十四、分块浏览表格规范

### 表头
```css
background: --bg-warm;              /* 暖色表头 */
border-bottom: 1px solid --border;
font-family: --font-head;           /* 衬线字体表头 */
font-size: 11px; font-weight: 600; color: --text-3;
letter-spacing: 0.04em;
padding: 8px 14px;
```

### 行
- Hover：`background: --bg-warm`（暖色）
- 正文颜色：`--text-2`，字号 `12px`，行高 `1.7`
- 文件名：`--text-3`

### 文件夹标签（EA1 等）
```css
font-size: 11px; font-weight: 600;
padding: 2px 7px; border-radius: --radius-sm;
background: --indigo-soft; color: --indigo;
border: 1px solid #C5C5EE;
```

### 类型标签
- 表格：`background: --blue-soft; color: --blue; border: 1px solid --blue-mid`
- 文本：`background: --bg-warm; color: --text-3; border: 1px solid --border`
- 均为 `10px`，`border-radius: --radius-sm`

### 分页栏
```css
background: --bg-warm;
border-top: 1px solid --border-light;
padding: 9px 14px;
font-size: 11px;
```
当前页：`background: --green; color: #fff; border-color: --green-mid`

---

## 十五、一致性检查清单

- [ ] 所有页面 Header 高度均为 `52px`，底部边框 `2px`（方案 C 特征）
- [ ] 首页 Header 左侧显示完整品牌名（Serif 字体），其余页面用面包屑
- [ ] 无任何 emoji 用作状态图标
- [ ] 所有圆角只使用 `3px / 4px / 99px` 三档（方案 C 圆角最小）
- [ ] 编辑区正文字号 `13px`，行高 `1.85`
- [ ] 编辑区内容放在白色卡片中（有 margin、border、shadow），与暖背景形成层次
- [ ] H2 标题使用衬线字体（Noto Serif SC）且有下划分割线
- [ ] 状态指示器为 `3×14px` 竖条（pip），非圆点、非方块
- [ ] 侧边栏背景为 `--bg-sidebar`（暖米色），区别于页面底色
- [ ] 信源卡片用绿色竖条（已引用）/ 灰色竖条（未引用）区分
- [ ] Pipeline Logo 和 Tab 激活色改为靛蓝（`--indigo`），区别于主色墨绿
- [ ] 徽章为圆角矩形（`border-radius: 3px`），非 Pill 形
- [ ] 进度条高度 `4px`，墨绿单色填充
- [ ] 表格表头使用衬线字体（Noto Serif SC）
- [ ] 分页栏当前页按钮为墨绿色


