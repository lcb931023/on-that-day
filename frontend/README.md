# On That Day — React Frontend

位于统一仓库的 `frontend/` 目录下，数据来自同仓库的 Go 后端。

## 开发

```bash
# 从仓库根目录安装依赖
make deps

# 启动 Go 后端（端口 8080）
make server

# 启动前端开发服务器
cd frontend
npm run dev
```

浏览器访问 http://localhost:5173/

## 配置

开发时代理目标可通过环境变量设置：

```bash
VITE_API_TARGET=http://localhost:8000 npm run dev
```

默认代理到 `http://localhost:8080`。

## 生产构建

```bash
npm run build
```

产物输出到 `dist/`。Go 后端默认会托管 `frontend/dist`。
