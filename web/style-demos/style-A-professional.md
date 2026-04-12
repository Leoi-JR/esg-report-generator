# 方案 A — 商务沉稳 · 风格规范文档

> 本文档是方案 A 的完整视觉风格规范，用于指导实际代码的样式改进。
> 遵循本文档中的所有规则，可还原与 Demo 一致的视觉风格。

---

## 一、整体设计理念

**核心定位**：专业、可信、沉稳。面向对外汇报、客户展示等正式场景，强调信息层级清晰、视觉权威感强。整体色调偏冷，以深海蓝为主色锚点，冷灰为背景基底，白色卡片承载内容。

**设计关键词**：制度感 / 层级清晰 / 专业可信 / 克制优雅

---

## 二、色彩系统

### 主色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--navy` | `#1E3A5F` | 主色：Logo 背景、强调按钮、选中状态、标题 |
| `--navy-light` | `#2B5080` | 主色 Hover 态 |
| `--navy-muted` | `#E8EEF5` | 主色浅底：选中背景、Tag 背景 |
| `--blue-accent` | `#2E6DB4` | 辅助蓝：进度条、角标背景 |
| `--blue-light` | `#D6E4F5` | 辅助蓝浅底 |

### 背景色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg-page` | `#F0F4F8` | 页面底色（冷灰蓝）|
| `--bg-card` | `#FFFFFF` | 卡片、面板、编辑区背景 |
| `--bg-sidebar` | `#FFFFFF` | 左侧边栏背景 |

### 边框色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--border` | `#D9E2EC` | 标准边框 |
| `--border-light` | `#EBF1F7` | 轻量分割线、内部分隔 |

### 文字色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--text-primary` | `#1A2733` | 主文字 |
| `--text-secondary` | `#4A6278` | 次级文字、描述 |
| `--text-muted` | `#7A94A8` | 弱化文字、占位符、Meta 信息 |
| `--text-inverse` | `#FFFFFF` | 反色文字（用于深色背景） |

### 语义色
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--green` / `--green-bg` | `#1A7A4A` / `#E6F4ED` | 成功、已生成、已完成 |
| `--amber` / `--amber-bg` | `#B45C0A` / `#FEF0E0` | 警告、未上传、待完善 |
| `--red` / `--red-bg` | `#B91C1C` / `#FEE2E2` | 危险、错误、删除 |
| `--indigo` / `--indigo-bg` | `#3730A3` / `#E0E7FF` | Pipeline、运行中状态 |

---

## 三、字体系统

### 字体族
- **标题字体**：`'LXGW WenKai', 'Noto Sans SC', sans-serif`
  - LXGW WenKai 带有楷体韵味，赋予标题人文感与专业感
  - 用于：页面大标题、卡片名称、章节标题、侧边栏分组标题、表头
- **正文字体**：`'Noto Sans SC', sans-serif`
  - 用于：正文内容、按钮、标签、Meta 信息、表格内容

### 字号规范
| 用途 | 字号 | 字重 |
|------|------|------|
| 页面主标题 | `17px` | `700`（标题字体）|
| 卡片名称 / 章节标题 | `15px` | `700`（标题字体）|
| 导航栏品牌名 | `15px` | `700`（标题字体）|
| 正文内容 | `13px` | `400` |
| 按钮文字 | `12px` | `500` |
| 徽章 / Meta / 标签 | `11px` | `400–500` |
| 极小辅助信息 | `10px` | `400` |

### 行高
- 编辑区正文：`line-height: 1.8`
- 普通 UI 文字：`line-height: 1.6`
- 紧凑布局（按钮、标签）：`line-height: 1.4`

---

## 四、圆角系统

**统一圆角原则**：全局使用 `6px` 作为标准圆角，形成统一的视觉语言。

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--radius` | `6px` | 按钮、输入框、信源卡片、下拉菜单 |
| `--radius-sm` | `4px` | 小标签、行内角标、筛选 Tag |
| `--radius-lg` | `8px` | 项目卡片、模态框、Demo 外框 |
| 圆形 | `99px` | 徽章 Pill、进度点、过滤按钮 |

> **禁止混用**：不在同一层级使用差异超过 4px 的圆角值。

---

## 五、阴影系统

| 变量名 | 值 | 适用场景 |
|--------|----|----------|
| `--shadow-sm` | `0 1px 3px rgba(30,58,95,0.08)` | 卡片默认态 |
| `--shadow-md` | `0 4px 12px rgba(30,58,95,0.10)` | 卡片 Hover 态、浮层、模态框 |

> 阴影颜色带有主色（深海蓝）的色调，而非纯黑，使整体更协调。

---

## 六、导航栏规范

### 结构原则
**所有页面使用完全一致的 Header 结构**，高度固定为 `56px`，白色背景，底部 `1px` 标准边框。

### 布局
```
[ Logo方块 + 品牌名 ]                    [ 导航链接 | 按钮 ]
```

- **左侧**：`28px` 深海蓝方块 Logo（内嵌白色 SVG 图标）+ 品牌名（标题字体，15px，700）
- **右侧**：文字导航链接 + 操作按钮，用竖线 `|` 分隔不同类型

### 各页面右侧内容
| 页面 | 右侧内容 |
|------|----------|
| 首页 | `首页（激活）` `｜` `新建项目（主按钮）` |
| 编辑器 | `← 首页（返回胶囊）` + Logo + 项目名 + `Pipeline 标签` + 保存状态 `｜` 工具按钮组 + `保存` + `导出（主按钮）` |
| Pipeline | `首页` `编辑器` |
| Pipeline 子页 | 同 Pipeline |

### 导航链接样式
- 默认：`12px`，`color: --text-secondary`，`padding: 5px 10px`，`border-radius: --radius-sm`
- Hover：`background: --navy-muted`，`color: --navy`
- 激活：同 Hover + `font-weight: 600`

### 编辑器"返回首页"样式
```css
font-size: 11px; font-weight: 500;
color: --text-muted;
padding: 4px 8px;
border-radius: --radius-sm;
border: 1px solid --border-light;
background: --bg-page;
```

---

## 七、按钮规范

### 主按钮（btn-primary）
```css
background: --navy; color: #fff;
border-radius: --radius; padding: 6px 14px;
font-size: 12px; font-weight: 500;
```
Hover：`background: --navy-light`

### 幽灵按钮（btn-ghost）
```css
background: transparent; color: --text-secondary;
border: 1px solid --border;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --bg-page; border-color: --text-muted`

### 危险按钮（btn-danger）
```css
background: transparent; color: --red;
border: 1px solid #FECACA;
border-radius: --radius; padding: 5px 12px;
```
Hover：`background: --red-bg`

> **所有按钮**：`font-size: 12px`，`font-weight: 500`，`transition: 0.15s`，内含图标时图标尺寸 `13px`。

---

## 八、状态徽章与指示器

### 原则：禁止使用 Emoji
所有状态标识改用**彩色小圆点 + 文字**的 Pill 形式，或纯文字 Pill。

### Pill 徽章结构
```
[ ● 状态文字 ]
```
- 圆点：`width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0`
- 容器：`display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 99px`
- 字号：`11px`，字重：`500`

### 各状态配色
| 状态 | 文字色 | 背景色 | 圆点色 |
|------|--------|--------|--------|
| 已生成初稿 | `--green` | `--green-bg` | `--green` |
| 已上传文件 | `--blue-accent` | `--blue-light` | `--blue-accent` |
| 未上传资料 | `--amber` | `--amber-bg` | `--amber` |
| 运行中 | `--indigo` | `--indigo-bg` | `--indigo` |
| 已完成 | `--green` | `--green-bg` | `--green` |
| 失败 | `--red` | `--red-bg` | `--red` |
| 待审核 | `--blue-accent` | `--blue-light` | `--blue-accent` |
| 已跳过 | `--text-muted` | `--border-light` | `--text-muted` |

### 侧边栏进度统计
侧边栏底部进度区改用彩色小圆点替代 emoji：
```
● 103 已生成   （蓝色点）
● 12 已跳过    （灰色点）
● 4 已审核     （绿色点）
```
圆点尺寸：`6px × 6px`，`border-radius: 50%`

---

## 九、进度条规范

### 样式
- 轨道：`height: 4px; background: --border; border-radius: 99px`
- 填充：`background: linear-gradient(90deg, --blue-accent, --navy); border-radius: 99px`
- 过渡：`transition: width 0.4s ease`

### 图例说明
进度条下方用小圆点图例说明，字号 `11px`，颜色 `--text-muted`：
```
● 103 已生成   ● 12 已跳过   ● 4 错误
```

---

## 十、信源卡片规范

### 结构
每张信源卡片由**卡片容器 + 头部 + 正文**三层组成。

### 已引用卡片
```css
border: 1px solid --border;
border-left: 4px solid --blue-accent;   /* 左侧蓝色强调竖条 */
border-radius: --radius;
background: --bg-card;
```

### 未引用卡片
```css
border: 1px solid --border;
border-left: 4px solid --border;        /* 左侧灰色竖条 */
border-radius: --radius;
opacity: 0.85;
```

### 相关度进度条
- 轨道：`height: 3px; background: --border-light`
- 已引用填充色：`--blue-accent`
- 未引用填充色：`--text-muted`

### 标签
- 已引用：`background: --green-bg; color: --green; border-radius: 99px; font-size: 10px`
- 未引用：`background: --border-light; color: --text-muted; border-radius: 99px; font-size: 10px`

---

## 十一、编辑器区域规范

### 正文样式
```css
font-family: 'Noto Sans SC', sans-serif;
font-size: 13px;
line-height: 1.8;
color: --text-primary;
padding: 20px 24px;
```

### 章节标题（H2）
```css
font-family: 'LXGW WenKai', sans-serif;
font-size: 15px;
font-weight: 700;
color: --navy;
margin-bottom: 10px;
```

### 来源角标
```css
display: inline-flex; align-items: center; justify-content: center;
min-width: 16px; height: 16px; padding: 0 3px;
font-size: 10px; font-weight: 600;
color: --blue-accent; background: --blue-light;
border-radius: 3px;
cursor: pointer;
vertical-align: super; line-height: 1;
margin: 0 1px;
```
Hover：`background: #BFDBFE; transform: scale(1.1)`

### 待补充块
```css
display: block;
background: --amber-bg;
border-left: 4px solid --amber;
padding: 10px 14px; margin: 14px 0;
border-radius: 0 --radius-sm --radius-sm 0;
font-size: 12px; color: #92400E;
```

### 格式工具栏
背景色 `--bg-page`，高度约 `32px`，按钮 `btn-ghost` 风格（无边框、hover 时 `--border-light` 背景），`border-radius: --radius-sm`

### 底部状态栏
```css
height: 28px;
background: --bg-card;
border-top: 1px solid --border;
font-size: 11px; color: --text-muted;
padding: 0 16px;
```

---

## 十二、左侧目录侧边栏规范

### 背景
`background: --bg-card`（纯白，不做区分），右侧 `border-right: 1px solid --border`

### 搜索框
- 背景：`--bg-page`（与侧边栏略有区分）
- 边框：`1px solid --border`，`border-radius: --radius-sm`
- 字号：`12px`

### 筛选按钮
圆形 Pill 按钮（`border-radius: 99px`）：
- 选中：`background: --navy; color: #fff`
- 未选中：`background: --bg-page; color: --text-secondary`

### 树节点
- 叶节点默认：`padding: 4px 8px`，左侧 `6px` 彩色圆点
- 叶节点选中：`background: --blue-light; color: --navy; font-weight: 500`
- 分组节点：标题字体，`font-weight: 600`，折叠箭头图标
- 已跳过节点：`opacity: 0.6`，圆点颜色 `--text-muted`
- Hover：`background: --bg-page`

### 底部统计区
```css
background: --bg-page;
border-top: 1px solid --border;
padding: 10px 12px;
```
进度条：`height: 3px`，彩色渐变填充

---

## 十三、Pipeline 页面规范

### Tab 导航
位于 Header 正下方，`background: --bg-card`，底部 `1px solid --border`：
- 激活 Tab：`color: --navy; border-bottom: 2px solid --navy; font-weight: 600`
- 非激活：`color: --text-muted; border-bottom: 2px solid transparent`
- 字号：`12px`，`padding: 10px 16px`

### 内容区网格
`display: grid; grid-template-columns: 1fr 2fr; gap: 16px; padding: 20px 24px; background: --bg-page`

### 卡片
- `background: --bg-card; border: 1px solid --border; border-radius: --radius-lg; padding: 16px; box-shadow: --shadow-sm`
- 卡片标题：`font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: --text-muted`

### 步骤时间线
- 已完成步骤：`background: --green-bg`，绿色圆形勾选图标
- 运行中步骤：`background: --indigo-bg; border: 1px solid #C7D2FE`，旋转动画图标
- 等待中步骤：`background: --bg-page`，灰色空心圆图标
- 连接线：`width: 2px; height: 10px; background: --border; margin-left: 18px`

### 章节格子
每格 `10px × 10px; border-radius: 2px`：
- 已完成：`background: --green`
- 运行中：`background: --indigo`
- 等待中：`background: #D1D5DB`

---

## 十四、分块浏览表格规范

### 表格整体
- `border: 1px solid --border; border-radius: --radius-lg; overflow: hidden`
- 无内部横向滚动

### 表头
```css
background: --bg-page;
border-bottom: 1px solid --border;
font-size: 11px; font-weight: 600;
color: --text-muted;
letter-spacing: 0.06em; text-transform: uppercase;
padding: 9px 14px;
```

### 行
- 默认：白色背景
- Hover：`background: --bg-page`
- 行间距：`border-bottom: 1px solid --border-light`
- 正文字号：`12px`，行高 `1.5`，颜色 `--text-secondary`

### 文件夹标签（如 EA1、GA1）
```css
font-size: 11px; padding: 2px 7px;
background: --indigo-bg; color: --indigo;
border-radius: 99px;
```

### 类型标签
- 表格类型：`background: --blue-light; color: --blue-accent`
- 文本类型：`background: --border-light; color: --text-muted`
- 均为 `10px`，`border-radius: 99px`

### 分页栏
```css
background: --bg-page;
border-top: 1px solid --border;
padding: 10px 14px;
font-size: 11px;
```
当前页按钮：`background: --navy; color: #fff; border-color: --navy`

---

## 十五、一致性检查清单

在实施样式时，逐项核对以下一致性要求：

- [ ] 所有页面 Header 高度均为 `56px`，结构一致
- [ ] 所有"首页"入口样式一致（返回胶囊按钮形式）
- [ ] 无任何 emoji（✅ ⏭️ 📊 等）作为状态图标
- [ ] 所有圆角只使用 `4px / 6px / 8px / 99px` 四档
- [ ] 编辑区正文字号固定为 `13px`，行高 `1.8`
- [ ] 侧边栏树节点状态用彩色圆点（非文字、非 emoji）
- [ ] 进度条使用蓝色渐变填充
- [ ] 信源卡片左侧竖条区分已引用（蓝）/ 未引用（灰）
- [ ] 所有按钮字号统一为 `12px`
- [ ] 所有标题统一使用 LXGW WenKai 字体


