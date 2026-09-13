# 员工照片与工牌 / 座位牌工具

[![在线使用](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f)](https://banna-skech.github.io/photo-agent/)
[![GitHub Pages 部署](https://github.com/Banna-skech/photo-agent/actions/workflows/deploy.yml/badge.svg)](https://github.com/Banna-skech/photo-agent/actions/workflows/deploy.yml)

一个面向企业日常制证工作的浏览器端工具集：把员工照片处理和员工名册整理放到同一个入口中完成。照片抠图、标准化排版、Excel 字段识别和结果导出都在当前浏览器内执行，不需要业务后端，也不会把用户文件上传到服务器。

## 在线使用

打开 [photo-agent 在线版](https://banna-skech.github.io/photo-agent/)，在页面顶部选择对应功能：

- [照片批量处理](https://banna-skech.github.io/photo-agent/)：生成厂家可用的工牌照和座位牌图片。
- [Excel 工牌 / 座位牌](https://banna-skech.github.io/photo-agent/excel.html)：把系统导出的员工表整理成标准工作簿。

首次使用照片功能时，浏览器需要从 CDN 加载 AI 模型。模型准备完成后，页面会显示“AI 抠图引擎已就绪”。

## 解决的问题

传统流程通常要在多个工具之间来回切换：人工抠图和裁剪照片、整理姓名与工号、按不同模板制作工牌和座位牌，最后再逐个检查文件。这个项目将这些步骤收敛为两个相互独立、入口统一的本地工作流：

| 工作流 | 输入 | 处理 | 输出 |
| --- | --- | --- | --- |
| 照片批量处理 | JPG、PNG、WebP、HEIC（取决于浏览器解码能力） | 抠图、纯白背景、轻度美化、构图和元数据写入 | 工牌照、座位牌、ZIP |
| Excel 工牌 / 座位牌 | <code>.xlsx</code> 员工名册 | 表头识别、字段归一化、姓名拼音、排序和工作表生成 | 标准 <code>.xlsx</code> 工作簿 |

## 工作流

~~~mermaid
flowchart LR
    A[照片或 Excel 文件] --> B{选择功能}
    B --> C[照片处理]
    C --> C1[浏览器端 AI 抠图]
    C1 --> C2[白底合成与标准构图]
    C2 --> C3[单文件或 ZIP 下载]
    B --> D[Excel 处理]
    D --> D1[读取并识别表头]
    D1 --> D2[字段清洗与姓名规范化]
    D2 --> D3[生成工牌 / 座位牌工作表]
    D3 --> D4[下载 XLSX]
~~~

除页面依赖、ExcelJS 和 AI 模型需要从 CDN 加载外，用户文件不离开当前浏览器。

## 功能说明

### 照片批量处理

- 支持点击选择、拖拽和多文件上传。
- 使用 <code>@imgly/background-removal</code> 在浏览器中完成 AI 抠图。
- 合成 RGB 纯白背景 <code>#FFFFFF</code>，支持磨皮强度、美白提亮、工牌照上边距和座位牌上边距调整。
- 生成工牌照、座位牌两类成品，显示每张照片的处理进度和结果预览。
- 支持单独下载，也支持生成包含“工牌照”和“座位牌”目录的 ZIP 文件。

### Excel 工牌 / 座位牌

- 支持拖拽、点击选择和 <code>Ctrl+V</code> 粘贴 <code>.xlsx</code> / <code>.xls</code> 文件。
- 自动寻找员工表头，兼容常见字段别名，例如姓名、员工姓名、工号、员工编号、职位名称等。
- 规范化英文名大小写，按中文姓氏生成座位牌姓名，并处理常见复姓。
- 生成“工牌”和“座位牌”两个工作表；座位牌工作表会根据源表是否包含工作地点决定列结构。
- 生成前提供工牌 / 座位牌数据预览，下载文件名包含处理日期。

## 输出规格

### 图片

| 成品 | 格式 | 尺寸 | 色彩与元数据 | 构图规则 |
| --- | --- | --- | --- | --- |
| 工牌照 | JPEG | <code>1080 × 1440</code> | RGB、144 DPI、JFIF 密度信息 | 人像约占画面高度 88%，底部贴边，裁到下腰 / 胯部 |
| 座位牌 | PNG | 高 <code>900 px</code>，宽通常 <code>700–800 px</code> | RGB、纯白背景、144 DPI、无透明通道 | 保留连续人体区域，人物居中，左右等量留白 |

### Excel

- 工作簿包含“工牌”和“座位牌”工作表。
- 工牌表按工号排序，包含姓名、英文名 / 姓名拼音和工号。
- 座位牌表按二级部门排序，可包含二级部门、详细职位名称和工作地点。

## 使用方式

### 在线使用

1. 打开 [在线版](https://banna-skech.github.io/photo-agent/)。
2. 选择“照片批量处理”或“Excel 工牌 / 座位牌”。
3. 等待照片页显示 AI 引擎就绪；Excel 页无需等待模型。
4. 上传文件，按页面提示完成处理并下载结果。

照片页的高级参数已经按参考成品校准。除非有明确的版式要求，否则可以直接使用默认值。

### 本地运行

项目是静态网页，没有构建步骤，也不需要安装项目依赖。建议通过本地静态服务器访问，以避免浏览器对模块和跨源资源的限制：

~~~bash
git clone https://github.com/Banna-skech/photo-agent.git
cd photo-agent

# 任选一种静态服务器
python -m http.server 8080
# 或
npx serve .
~~~

然后打开 <http://localhost:8080/>。Excel 工具地址为 <http://localhost:8080/excel.html>。

## 技术实现

### 照片处理链路

1. 读取用户选择的图片并解码为浏览器可处理的图像对象。
2. 调用 <code>@imgly/background-removal</code> 生成前景结果。
3. 在 Canvas 中完成纯白背景合成、轻度磨皮和提亮。
4. 按工牌照 / 座位牌规则裁剪和排版。
5. 写入 JPEG JFIF 密度或 PNG <code>pHYs</code> 信息，生成 Blob。
6. 通过浏览器下载单文件，或使用 JSZip 打包全部结果。

### Excel 处理链路

1. 使用 ExcelJS 读取第一个工作表。
2. 在前 20 行中匹配必需列和可选列，允许字段名称存在别名。
3. 清洗姓名、英文名、工号、部门、职位和工作地点。
4. 应用工号 / 部门排序规则，计算座位牌显示姓名。
5. 使用 ExcelJS 生成新的“工牌”和“座位牌”工作表并导出 Blob。

### 部署

- GitHub Actions 监听 <code>master</code> 分支。
- 每次推送后，将仓库根目录作为 Pages artifact 发布。
- 运行时依赖通过 CDN 加载；仓库本身不包含模型文件。

## 隐私与安全边界

- 员工照片和 Excel 内容只在当前浏览器内存中处理，不发送到业务服务器。
- 项目没有账号系统、数据库、后端 API 或用户文件持久化。
- 页面依赖、ExcelJS 和 AI 模型仍需要网络访问；这不等于用户文件会被上传。
- 处理包含个人信息的文件时，建议使用可信设备和受控网络，并在关闭页面后清理下载目录中的成品。

## 兼容性与已知限制

- 推荐使用最新版 Chrome、Microsoft Edge 或其他 Chromium 内核浏览器。
- AI 抠图会占用浏览器内存；一次处理大量高分辨率图片时，建议拆分批次。
- HEIC 能否读取取决于浏览器本身的图片解码支持，无法读取时请先转换为 JPG 或 PNG。
- Excel 页面选择器允许 <code>.xlsx</code> / <code>.xls</code>，处理链以 ExcelJS 的 OOXML <code>.xlsx</code> 为主。旧版二进制 <code>.xls</code> 如果读取失败，请先另存为 <code>.xlsx</code>。
- 首次加载模型需要网络；如果公司网络拦截 CDN，照片处理页可能停留在模型加载状态。

## 项目结构

~~~text
photo-agent/
├── index.html                 # 照片批量处理入口
├── excel.html                 # Excel 工牌 / 座位牌入口
├── app.js                     # 照片处理流程与界面状态
├── style.css                  # 照片页样式与统一导航
├── .github/workflows/
│   └── deploy.yml             # GitHub Pages 自动部署
├── README.md
└── CLAUDE.md
~~~

## 开发约定

- 修改照片输出规格时，同步更新界面默认值、实现逻辑和本 README 的规格表。
- 不要在日志、错误提示或 Issue 中提交真实员工照片、身份证明或完整员工名册。
- 新增处理规则时，优先保持两个页面的 DOM 和状态隔离，避免同名 ID 或全局选择器互相影响。
- 涉及图片编码、DPI 或座位牌尺寸的改动，应使用真实样例做回归检查。

## 后续方向

以下方向需要结合实际使用反馈再决定：

- 增加带样例文件的浏览器回归测试，覆盖上传、预览和下载链路。
- 将常用输出模板抽象为可配置版本，便于不同厂家切换规格。
- 在浏览器支持的前提下增加模型和静态资源缓存，减少重复下载。

## License

当前仓库尚未声明开源许可证。如果要向外部用户分发或接受第三方贡献，请先补充合适的 <code>LICENSE</code> 文件。
