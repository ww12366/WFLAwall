# WFLAwall (WFLA 贴吧)

一个基于 Cloudflare Workers + D1 的匿名论坛应用。

## 技术栈

- **前端**: React + TypeScript + Vite + Material UI v7
- **后端**: Cloudflare Workers + D1 (SQLite)
- **存储**: Cloudflare R2 对象存储

## 项目结构

```
WFLAwall/
├── frontend/          # 前端应用
│   ├── src/
│   │   ├── App.tsx      # 主组件
│   │   ├── App.css      # 样式
│   │   └── theme.ts    # MUI 主题配置
│   └── wrangler.toml
├── backend/           # 后端应用
│   └── src/index.ts   # Workers 入口
└── wrangler.toml     # 根目录配置
```

## 快速开始

### 前端

```bash
cd frontend
npm install
npm run dev      # 开发模式
npm run build     # 构建
```

### 后端部署

```bash
cd backend
npx wrangler deploy
```

## 部署地址

- 前端: https://wfla-wall.pages.dev
- 后端: https://wfla-backend.r61105507.workers.dev

## 功能

- 匿名发帖/评论
- 图片上传
- 点赞/踩
- 用户搜索
- 帖子搜索
- 管理员功能 (封禁、权限管理)

## 数据库

使用 Cloudflare D1 创建：

```bash
wrangler d1 execute wfla-db --local --command "$(cat schema.sql)"
```