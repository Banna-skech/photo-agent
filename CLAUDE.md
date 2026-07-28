# photo-agent-web — 员工照片批量处理工具

> GitHub: https://github.com/Banna-skech/photo-agent

## 项目简介
纯浏览器端照片处理工具：上传原图 → AI 抠图 → 美白磨皮 → 输出工牌照 + 座位牌。

## 技术栈
- **纯前端**：HTML + CSS + vanilla JS（无框架）
- **AI 抠图**：`@imgly/background-removal`（通过 ES import map 从 CDN 加载）
- **打包下载**：`JSZip`（通过 CDN script 标签加载）
- **无构建工具**：直接用浏览器打开 `index.html` 即可运行
- **无 npm / node_modules**：所有依赖在线加载

## 文件结构
```
photo-agent-web/
├── index.html    — 页面结构 + import map + CDN 引用
├── style.css     — 全部样式
├── app.js        — 核心逻辑：上传、AI抠图、Alpha净化、合成、导出ZIP
└── README.md
```

## 已完成功能
1. 拖拽/点击上传多张照片（JPG/PNG/WebP/HEIC）
2. AI 抠图（IMG.LY background-removal，medium 模型）
3. Alpha 遮罩净化（de-pre-multiply + 孤点清洗）
4. 人像边界检测 → 按宽度优先等比缩放合成到 1080×1440 画布
5. 磨皮美白（可调参数）
6. 同时生成工牌照 + 座位牌
7. 预览 + 逐张下载 + 全部打包 ZIP（含"工牌照""座位牌"两个文件夹）

## 画布参数
- 输出尺寸：1080×1440
- 工牌照：bodyCrop=0.85, topMargin=180px, lrMargin=200px
- 座位牌：bodyCrop=0.95, topMargin=90px, lrMargin=180px

## 已知问题 / 待优化
- （在此记录你的优化需求）

## 对话历史
- 2026-07-28：初始搭建完成，实现完整 Pipeline（上传→抠图→净化→合成→导出）
