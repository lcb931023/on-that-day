# On That Day — Go Backend + React Frontend

工程化 Go 后端 + React 前端，替代原 Python 生成的静态 JSON，将日记数据持久化到 SQLite 并通过 HTTP API 提供。支持 Docker 一键部署。

## 目录结构

```
.
├── cmd/
│   ├── server/          # Go HTTP API + 静态文件服务
│   └── dbsync/          # 数据库初始化/同步工具
├── internal/            # Go 业务分层
├── frontend/            # React + Vite 前端
├── data/source/         # 原始 authors.json + days/*.json + voyages/*.json
├── Dockerfile           # 构建后端 + 前端单一镜像
├── docker-compose.yml   # 一键部署
├── entrypoint.sh        # 容器启动：首次同步数据并启动服务
├── Makefile
└── README.md
```

## 依赖

- Go 1.24+
- Node.js 18+
- Docker & Docker Compose（可选，用于一键部署）

## 开发模式

### 1. 安装依赖

```bash
make deps
```

### 2. 同步数据（生成 `on-that-day.db`）

```bash
make sync
```

### 3. 启动后端

```bash
make server
# 默认监听 :8080
```

### 4. 启动前端

```bash
cd frontend
npm run dev
# 默认 http://localhost:5173/
```

前端开发服务器会代理 `/api/*` 与 `/data/*` 到 `http://localhost:8080`。

## Docker 一键部署

```bash
# 构建并启动
make docker-up

# 或手动
docker compose up -d --build
```

访问：

```text
http://localhost:8080/
```

数据会持久化在 Docker volume `app_data` 中。

## 本地生产构建验证

```bash
cd frontend
npm run build
cd ..
SITE_DIR=frontend/dist go run ./cmd/server
```

浏览器访问 `http://localhost:8080/`。

## API

- `GET /healthz` — 健康检查
- `GET /api/authors` — 与 `authors.json` 同构
- `GET /api/days/MM-DD` — 与 `days/MM-DD.json` 同构
- `GET /api/days/MM/DD` — 同上
- `GET /api/voyage/{key}` — 返回指定航海作者的完整航线

前端页面也会使用原始路径：

- `GET /data/authors.json`
- `GET /data/days/MM-DD.json`

## 航海日志（Voyage）支持

项目新增对航海日志的支持，以 Captain Cook 的第一次环球航行为例：

- 原始文本放在 `resources/Captain Cook's Journal During His First Vo - James Cook.txt`。
- 已解析 JSON 放在 `data/source/voyages/cook.json`，后续路线操作优先基于该 JSON。
- `ingestvoyage` 可从 JSON 导入，也可在需要刷新时解析原文并写出 JSON，当前 Cook 路线为 456 个航点。
- 作者类型为 `voyage`，前端会为其绘制航线（Polyline）与船只标记。
- 日期条支持编辑与播放/暂停：播放时船只沿航线移动。

相关命令：

```bash
# 本地导入 Cook 航海日志
make sync                 # 先同步原日记数据
go run ./cmd/ingestvoyage # 再从 data/source/voyages/cook.json 导入航线

# 如需从原始文本重新生成航线 JSON
go run ./cmd/ingestvoyage --write-json --json data/source/voyages/cook.json

# API
GET /api/authors          # 返回作者列表，voyage 作者带 "type": "voyage"
GET /api/voyage/cook      # 返回 Cook 整条航线的 456 个航点
```

## 数据说明

- `data/source/` 下存放从原项目导入的 `authors.json` 与 `days/*.json`。
- `data/source/voyages/` 下存放已解析航线 JSON，避免后续操作反复读取原著全文。
- `dbsync` 幂等地将这些 JSON 写入 SQLite。
- 每日 shard 由 service 根据 `entries` 动态计算，复刻原 Python 的 10 天环绕 fallback 逻辑。

## 配置

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

关键环境变量：

- `SQLITE_DSN` — SQLite 文件路径
- `SERVER_ADDR` — 服务监听地址
- `SITE_DIR` — 静态文件目录（默认 `frontend/dist`）
- `DATA_DIR` — dbsync 读取的 JSON 源目录
