# 方案 B — 精简克制 · 风格规范文档

> 本文档是方案 B 的完整视觉风格规范，用于指导实际代码的样式改进。
> 遵循本文档中的所有规则，可还原与 Demo 一致的视觉风格。

---

## 一、整体设计理念

**核心定位**：效率优先、信息密度高、干净无噪音。面向长时间使用的内部工具场景，设计上参考 Linear、Notion 等现代协作工具的审美——大量留白、边框极简、颜色克制，用户注意力聚焦于内容本身。

**设计关键词**：克制 / 高效 / 现代 / 专注 / 无装饰

---

## 二、色彩系统

### 主色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--blue` | `#2563EB` | 唯一强调色：激活状态、主按钮、选中高亮、进度条 |
| `--blue-hover` | `#1D4ED8` | 主色 Hover |
| `--blue-soft` | `#EFF6FF` | 主色浅底：选中行背景、角标背景、来源标签 |
| `--blue-mid` | `#DBEAFE` | 来源角标边框、来源卡片 Hover 边框 |

### 背景色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg` | `#FAFAFA` | 页面底色（近乎纯白的浅灰）|
| `--bg-card` | `#FFFFFF` | 卡片、面板、编辑内容区背景 |

> 侧边栏与主内容区**背景色相同（--bg-card）**，无明显区分，只靠边框和激活态区分层级。

### 边框色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--border` | `#E5E7EB` | 所有边框、分割线 |
| `--border-focus` | `#93C5FD` | 输入框聚焦边框 |

### 文字色（四级灰阶）
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--text-1` | `#111827` | 主标题、重要信息 |
| `--text-2` | `#374151` | 正文、次级标题 |
| `--text-3` | `#6B7280` | 说明文字、描述、文件名 |
| `--text-4` | `#9CA3AF` | 占位符、Meta、时间戳、弱化信息 |

### 语义色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--green` / `--green-soft` | `#059669` / `#ECFDF5` | 成功、已完成、已引用 |
| `--amber` / `--amber-soft` | `#D97706` / `#FFFBEB` | 警告、待补充 |
| `--red` / `--red-soft` | `#DC2626` / `#FEF2F2` | 错误、删除 |
| `--indigo` / `--indigo-soft` | `#4F46E5` / `#EEF2FF` | Pipeline、运行中 |
| `--purple` / `--purple-soft` | `#7C3AED` / `#F5F3FF` | AI 助手专属色 |

---

## 三、字体系统

### 字体族
只使用**两种字体**，且均为无衬线字体，确保界面的现代感与一致性：
- **主字体**：`'Inter', 'Noto Sans SC', sans-serif`
- Inter 负责拉丁字符、数字、英文标点（现代感强，字重支持丰富）
- Noto Sans SC 负责中文字符

> 方案 B **不使用任何衬线字体**，标题与正文使用同一字体族，靠字重和字号区分层级。

### 字号规范
| 用途 | 字号 | 字重 |
|------|------|------|
| 卡片名称 / 章节标题 | `13–14px` | `600` |
| 页面小标题 | `14px` | `600` |
| 正文内容 | `13px` | `400` |
| 按钮文字 | `12px` | `500` |
| 徽章 / Meta / 标签 | `11px` | `400–500` |
| 极小辅助信息 | `10px` | `400` |

### 行高
- 编辑区正文：`line-height: 1.9`（充裕的行间距，改善长文阅读体验）
- 普通 UI：`line-height: 1.5`
- 紧凑元素：`line-height: 1.4`

---

## 四、圆角系统

**统一圆角原则**：全局只使用 `8px` 作为标准圆角，小元素使用 `6px`，行内元素使用 `4px`。

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--radius` | `8px` | 卡片、按钮、输入框、信源卡片 |
| `--radius-sm` | `6px` | 搜索框、筛选按钮、状态徽章 |
| `--radius-xs` | `4px` | 角标、行内标签、表格内标签、来源角标 |
| 圆形 | `99px` | Pill 形状徽章、过滤按钮 |

> **严格执行**：卡片一律 `8px`，按钮一律 `8px` 或 `6px`，绝不出现 `10px / 12px` 等中间值。

---

## 五、阴影系统

阴影极为克制，仅用两档：

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--shadow` | `0 1px 2px rgba(0,0,0,0.05)` | 卡片默认态（几乎不可见）|
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)` | 卡片 Hover 态、浮层 |

> **设计原则**：卡片默认态几乎不显示阴影，依赖 `border: 1px solid --border` 划定边界；Hover 时才浮现轻阴影，形成交互反馈。

---

## 六、导航栏规范

### 结构原则
**所有页面使用完全相同的 Header 结构**，高度固定 `48px`（极简窄型），白色背景，底部 `1px` 标准边框。

### 面包屑导航（Breadcrumb）
方案 B 使用面包屑替代传统导航链接，所有页面结构统一为：

```
[ 首页 > 上级页面 > 当前页面 ]               [ 右侧辅助操作 ]
```

面包屑各级样式：
- **首页（可点击）**：`color: --text-3`，Hover 时 `background: --border; color: --text-2`，`padding: 3px 6px; border-radius: --radius-xs`
- **分隔符 `/`**：`color: --border; padding: 0 2px; font-size: 14px`
- **当前页（不可点击）**：`color: --text-1; font-weight: 500; padding: 3px 6px`，带对应小图标

### 各页面面包屑
| 页面 | 面包屑路径 |
|------|-----------|
| 首页 | `◾ ESG 报告编辑平台`（只有当前，无上级）|
| 编辑器 | `⌂ 首页 / ↻ Pipeline / ≡ 艾森股份 2025 ESG 报告` |
| Pipeline Dashboard | `⌂ 首页 / ↻ 艾森股份 2025 — Pipeline` |
| 分块浏览 | `⌂ 首页 / Pipeline / 分块浏览` |
| 段落浏览 | `⌂ 首页 / Pipeline / 段落浏览` |

### Header 右侧
- 首页：只有「新建项目」主按钮
- 编辑器：撤销/重做图标按钮 + AI助手（紫色软按钮）+ 历史图标 + 保存幽灵按钮 + 导出主按钮
- Pipeline 类页面：「编辑器」幽灵按钮

---

## 七、按钮规范

### 主按钮（btn-primary）
```css
background: --blue; color: #fff;
border-radius: --radius; padding: 5px 12px;
font-size: 12px; font-weight: 500;
```
Hover：`background: --blue-hover`

### 幽灵按钮（btn-ghost）
```css
background: transparent; color: --text-2;
border: 1px solid --border;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --bg`

### 软色按钮（btn-soft）
```css
background: --blue-soft; color: --blue;
border: none;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --blue-mid`

### AI 助手按钮（特殊）
```css
background: --purple-soft; color: --purple;
border: none;
border-radius: --radius; padding: 5px 12px;
```

### 危险按钮（btn-danger）
```css
background: transparent; color: --red;
border: 1px solid #FECACA;
border-radius: --radius;
```
Hover：`background: --red-soft`

### 图标按钮（btn-icon）
```css
padding: 5px; background: transparent;
color: --text-3; border: none;
```
Hover：`background: --border; color: --text-1; border-radius: --radius-xs`

---

## 八、状态徽章与指示器

### 原则：禁止使用 Emoji
所有状态改用**彩色小方块（7×7px）+ 文字**的 Pill 形式。

### 状态小方块（status-dot）
```css
width: 7px; height: 7px;
border-radius: 2px;           /* 方形，非圆形 */
flex-shrink: 0;
display: inline-block;
```

> **方案 B 特点**：使用 `border-radius: 2px` 的**小方块**而非圆点，与方案 A 的圆点形成差异。

### 各状态配色（小方块颜色）
| 状态 | 方块色 | Pill 背景 | Pill 文字 |
|------|--------|-----------|-----------|
| 已生成初稿 | `--green` | `--green-soft` | `--green` |
| 已上传文件 | `--blue` | `--blue-soft` | `--blue` |
| 未上传资料 | `--amber` | `--amber-soft` | `--amber` |
| 运行中 | `--indigo` | `--indigo-soft` | `--indigo` |
| 已完成 | `--green` | `--green-soft` | `--green` |
| 失败 | `--red` | `--red-soft` | `--red` |
| 待审核 | `--blue` | `--blue-soft` | `--blue` |
| 已跳过 | `--text-4` | `--bg`（带边框）| `--text-3` |

### 侧边栏进度统计
```
■ 103 已生成   （蓝色方块）
■ 12 已跳过    （灰色方块）
■ 4 已审核     （绿色方块）
```

---

## 九、进度条规范

### 样式
```css
height: 2px;                         /* 方案 B 更细：2px */
background: --border;
border-radius: 99px;
overflow: hidden;
```
填充色：`background: --blue`（纯蓝，无渐变）

### 图例
```
■ 103 已生成   ■ 12 已跳过   ■ 4 错误
```
（小方块图例，`8px × 8px`，`border-radius: 2px`）

---

## 十、信源卡片规范

### 整体风格
方案 B 的信源卡片无左侧彩色竖条，依赖**边框颜色变化**和**不透明度**区分引用状态。

### 已引用卡片
```css
border: 1px solid --border;
border-radius: --radius;
/* Hover 时边框变蓝 */
transition: border-color 0.15s;
```
Hover：`border-color: --blue`

### 未引用卡片
```css
border: 1px solid --border;
border-radius: --radius;
opacity: 0.75;
transition: opacity 0.15s;
```
Hover：`opacity: 1`（显现，引导用户查看）

### 相关度进度条
- 高度：`2px`（比方案 A 更细）
- 已引用：`background: --blue`
- 未引用：`background: --text-4`

### 标签
- 已引用：`badge-green`（Pill 形）
- 未引用：`badge-gray`（带边框 Pill，`background: --bg; border: 1px solid --border`）

---

## 十一、编辑器区域规范

### 正文样式
```css
font-family: 'Inter', 'Noto Sans SC', sans-serif;
font-size: 13px;
line-height: 1.9;                    /* 方案 B 最宽松的行高 */
color: --text-1;
padding: 22px 28px;                  /* 更宽的内边距 */
background: --bg-card;
```

### 章节标题（H2）
```css
font-size: 14px;
font-weight: 600;
color: --text-1;
margin-bottom: 10px;
/* 无特殊字体，与正文同族 */
```

### 来源角标
```css
display: inline-flex; align-items: center; justify-content: center;
min-width: 16px; height: 15px; padding: 0 3px;
font-size: 10px; font-weight: 600;
color: --blue; background: --blue-soft;
border: 1px solid --blue-mid;
border-radius: --radius-xs;          /* 4px */
cursor: pointer;
vertical-align: super; line-height: 1;
margin: 0 1px;
```

### 待补充块
```css
background: --amber-soft;
border-left: 2px solid --amber;      /* 方案 B：更细的 2px 竖线 */
padding: 9px 14px; margin: 14px 0;
border-radius: 0 --radius-xs --radius-xs 0;
font-size: 12px; color: --amber;
```

### 格式工具栏
背景色 `--bg`（页面色），高度约 `30px`，按钮为 `btn-icon` 风格。

### 底部状态栏
```css
height: 26px;                        /* 方案 B 最矮 */
background: --bg-card;
border-top: 1px solid --border;
font-size: 11px; color: --text-4;
/* 用 · 而非 | 作分隔符 */
```

---

## 十二、左侧目录侧边栏规范

### 背景
`background: --bg-card`，与主内容区**完全相同的背景色**，只靠 `border-right` 区分。

### 激活项
方案 B 侧边栏激活项**无明显背景色**，只用浅色 `background: --blue-soft` + 字色变化区分：
```css
/* 选中叶节点 */
background: --blue-soft;
padding: 4px 8px;
border-radius: --radius-xs;
color: --blue; font-weight: 500;
/* 无左侧竖条 */
```

### 状态指示（小方块）
叶节点左侧用 `7×7px` 方块（`border-radius: 2px`）替代圆点：
- 已生成：`background: --green`
- 已跳过：`background: --text-4; opacity: 0.5`
- 当前激活：`background: --blue`

### 分组标题
```css
font-size: 12px; font-weight: 600; color: --text-2;
/* 无特殊字体 */
padding: 4px 6px;
```

### 筛选按钮
```css
font-size: 11px; padding: 2px 9px;
border-radius: 99px; font-weight: 500;
```
选中：`background: --blue; color: #fff; border: none`
未选中：`border: 1px solid --border; background: transparent; color: --text-3`

### 底部统计
```css
padding: 10px 12px;
/* 无特殊背景色 */
```
进度条高度：`2px`，纯蓝填充

---

## 十三、Pipeline 页面规范

### Tab 导航
- 激活：`color: --blue; border-bottom: 2px solid --blue; font-weight: 600`
- 非激活：`color: --text-3; border-bottom: 2px solid transparent`
- Hover：`color: --text-1`

### 内容区
`background: --bg; padding: 20px; display: grid; grid-template-columns: 1fr 2fr; gap: 14px`

### 卡片
```css
background: --bg-card;
border: 1px solid --border;
border-radius: --radius;             /* 8px */
padding: 14px–16px;
box-shadow: --shadow;
```
卡片标题：`font-size: 11px; font-weight: 600; color: --text-3; text-transform: uppercase; letter-spacing: 0.08em`

### 步骤勾选项（Controls）
选中步骤背景：`background: --blue-soft; border-radius: --radius-sm`
未选中步骤：`border: 1px solid --border; border-radius: --radius-sm`

### 步骤时间线
- 已完成：`background: --green-soft`，绿色圆形勾选图标 + 白色背景
- 运行中：`background: --indigo-soft; border: 1px solid #C7D2FE`，旋转动画图标
- 等待中：无背景色（透明），灰色空心圆
- 连接线：`width: 1px; height: 8px; background: --border; margin-left: 17px`

### 章节格子
每格 `10×10px; border-radius: 2px`：
- 已完成：`background: --green`
- 运行中：`background: --indigo`
- 等待中：`background: --border`

---

## 十四、分块浏览表格规范

### 表头
```css
background: --bg;
font-size: 11px; font-weight: 600; color: --text-3;
letter-spacing: 0.06em; text-transform: uppercase;
padding: 8px 14px;
```

### 行
- Hover：`background: --bg`
- 正文颜色：`--text-2`，字号 `12px`，行高 `1.6`
- 文件名：`--text-3`，`white-space: nowrap`

### 文件夹标签（EA1 等）
```css
font-size: 11px; font-weight: 500;
padding: 2px 7px; border-radius: --radius-xs;
background: --indigo-soft; color: --indigo;
```
（无边框，纯软色背景）

### 类型标签
- 表格：`background: --blue-soft; color: --blue; border-radius: --radius-xs`
- 文本：`background: --bg; color: --text-4; border: 1px solid --border; border-radius: --radius-xs`

### 分页栏
`background: --bg; border-top: 1px solid --border; padding: 9px 14px`
当前页：`background: --blue; color: #fff; border-color: --blue`

---

## 十五、一致性检查清单

- [ ] 所有页面 Header 高度均为 `48px`，面包屑结构一致
- [ ] 面包屑"首页"链接在每个页面都存在且位置相同
- [ ] 无任何 emoji 用作状态图标
- [ ] 所有圆角只使用 `4px / 6px / 8px / 99px` 四档
- [ ] 编辑区正文字号 `13px`，行高 `1.9`（方案 B 最宽松）
- [ ] 状态指示器为 `7×7px` 方块（`border-radius: 2px`），非圆点
- [ ] 进度条高度 `2px`（比方案 A 细），蓝色单色无渐变
- [ ] 信源卡片无左侧竖条，靠边框色和透明度区分状态
- [ ] 所有卡片圆角统一 `8px`
- [ ] 侧边栏背景与主内容区背景色相同（--bg-card）
- [ ] AI 助手按钮使用紫色系（--purple-soft / --purple）


