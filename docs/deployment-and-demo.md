# 部署与演示指南

## 环境要求

- 普通 Windows 用户：只需要安装ForgeNote安装包
- 从源码开发或构建安装包时：
  - Python 3.12
  - Node.js 22+
  - SurrealDB v2 或 Docker Desktop
- 至少一个可用大模型 API key
- 可选：DashScope TTS key，用于播客/音频讲解
- 可选：DashScope/Qwen 图片模型额度，用于 `qwen-image` 图片生成测试

## 环境变量

完整配置步骤见 [配置指南](configuration-guide.md)。最小环境变量参考 `.env.example`：

```bash
FORGENOTE_ENCRYPTION_KEY=change-me-to-a-secret-string
SURREAL_URL=ws://localhost:8000/rpc
SURREAL_USER=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=forgenote
SURREAL_DATABASE=forgenote
```

模型 key 可通过前端“模型/API 配置”页面录入，也可通过环境变量提供。

模型/API 配置页建议先设置基础默认项：

- 通用文本模型
- Embedding 模型
- 图片模型，例如 DashScope/Qwen `qwen-image`
- TTS 模型
- STT 模型

只有某个功能需要独立模型时，再进入高级设置覆盖对应 Studio 功能。

## 浏览器部署（Docker，推荐）

这是 ForgeNote 的主要部署方式：用户只需要浏览器，Docker 负责运行数据库、API、后台 command worker 和 Next.js Web 前端。单机、局域网和公网都使用同一套镜像；差别只在浏览器访问地址和反向代理配置。

### 1. 准备主机与代码

- Windows：安装 Docker Desktop，并确认使用 Linux containers；Linux：安装 Docker Engine 与 Compose plugin。
- 浏览器：推荐最新版 Chrome 或 Edge；移动端浏览器也可以访问，但窄屏会自动切换为标签页布局。
- 默认端口：Web `8502`、API `5055`、SurrealDB `8000`。公网部署通常只需要反向代理公开 `443`，不要把 `8000` 暴露到公网。

```powershell
git clone https://github.com/kylin0421/ForgeNote.git
cd ForgeNote
Copy-Item .env.example .env
```

### 2. 配置 `.env`

打开 `.env`，至少修改以下值：

```dotenv
FORGENOTE_ENCRYPTION_KEY=请替换为长期保存的随机字符串
SURREAL_USER=forgenote
SURREAL_PASSWORD=请替换为数据库密码
SURREAL_URL=ws://surrealdb:8000/rpc
SURREAL_NAMESPACE=forgenote
SURREAL_DATABASE=forgenote
```

`FORGENOTE_ENCRYPTION_KEY` 会用于加密数据库中的模型凭据。模型 key 保存后不能随意更换它，否则旧凭据无法解密。可以用 PowerShell 生成 32 字节随机值，再复制到 `.env`：

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

浏览器直连本机或局域网时，`API_URL` 和 `INTERNAL_API_URL` 留空即可，页面会根据访问地址自动发现 API。不要把 Docker 内部地址 `ws://surrealdb:8000/rpc` 改成 `localhost`；这是容器之间通信使用的地址。

如果使用 HTTPS 反向代理，将下面两项加入 `.env`：

```dotenv
API_URL=https://forgenote.example.com
INTERNAL_API_URL=http://localhost:5055
```

`API_URL` 必须是浏览器能访问的 Web origin，不要附加 `/api`；`INTERNAL_API_URL` 只由 Next.js 服务端使用。API key 可以在前端“模型/API 配置”页面录入，`.env` 不要提交到 Git。

### 3. 启动与首次访问

```powershell
docker compose up -d --build
docker compose ps
```

`forgenote` 容器内部会自动启动 API、worker 和 Web 前端；不需要再单独开 worker。确认状态后可以做两次连通性检查：

```powershell
Invoke-WebRequest http://localhost:8502 -UseBasicParsing
Invoke-WebRequest http://localhost:5055/api/health -UseBasicParsing
```

然后在浏览器打开 [http://localhost:8502](http://localhost:8502)。首次使用建议按以下顺序完成：

1. 进入“模型/API 配置”，添加供应商凭据并确认能发现模型。
2. 进入“设置”，分配通用文本、Embedding、图片、TTS、STT 及学习资产模型。
3. 新建一个普通学习记录，上传一份小型 PDF 或网页，确认解析和来源卡片正常。
4. 再打开 `ai学习` 演示 notebook；演示内容与普通 notebook 共用正式页面，耗时结果使用预缓存数据。

常用检查命令：

```powershell
docker compose logs -f forgenote
docker compose logs --tail=200 surrealdb
docker compose restart forgenote
```

### 4. 从其他设备访问

#### 局域网直连

在部署主机上查到局域网 IP，例如 `192.168.1.20`，其他设备打开：

```text
http://192.168.1.20:8502
```

直连模式下浏览器会自动把 API 解析为同一主机的 `5055` 端口，因此防火墙需要只向可信局域网放行 TCP `8502` 和 `5055`；不要放行 `8000`。若浏览器无法加载，优先检查主机防火墙和 `docker compose ps`，不要把 `API_URL` 填成客户端自己的 `localhost`。

#### 公网或域名访问

公网建议使用 Nginx、Caddy 或云负载均衡终止 TLS，只把 Web 端口 `8502` 代理到 HTTPS。Next.js 会在容器内部把 `/api/*` 转发到 `INTERNAL_API_URL`，所以反向代理不需要再单独暴露 `5055`：

```nginx
server {
    listen 443 ssl;
    server_name forgenote.example.com;

    location / {
        proxy_pass http://127.0.0.1:8502;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600;
        proxy_buffering off;
    }
}
```

配置证书后重启容器，浏览器访问 `https://forgenote.example.com`。如果使用其他代理，至少要保留 `Host`、`X-Forwarded-Proto`，并关闭长任务/SSE 的过短读取超时；否则任务状态和流式回答可能看起来一直停在等待。

### 5. 数据持久化、备份与更新

Docker 部署把数据保存在项目目录：

- `notebook_data/`：上传文件、应用数据和生成资产。
- `surreal_data/`：SurrealDB 数据库。
- `.env`：数据库凭据、加密 key 和部署地址。

升级或重启不会删除这些目录。备份前先停服务，避免复制到一半：

```powershell
docker compose stop
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Compress-Archive -Path notebook_data, surreal_data, .env -DestinationPath "forgenote-backup-$stamp.zip"
docker compose start
```

从 Git 更新时，先确认本地没有未提交改动，再重建应用：

```powershell
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
```

普通的 `docker compose down` 只会停止并移除容器，不会删除上述数据目录。除非明确要清空实例，不要使用 `docker compose down -v`，也不要手动删除 `notebook_data/` 或 `surreal_data/`。

### 6. 浏览器部署故障排查

| 现象 | 优先检查 |
| --- | --- |
| 浏览器打不开 | `docker compose ps`、8502 端口、防火墙和 `docker compose logs forgenote` |
| 页面能开但提示 API 不可用 | `http://服务器:5055/api/health`、直连模式是否放行 5055、`.env` 中是否误填客户端 `localhost` |
| 公网页面能开但登录/请求失败 | `API_URL` 是否为完整 HTTPS origin、反向代理是否保留 Host/X-Forwarded-Proto、是否误暴露或改写了 `/api` |
| 解析/生成一直等待 | `docker compose logs --tail=200 forgenote`，确认同一容器中的 worker 正常启动；再检查模型凭据和额度 |
| 模型配置突然无法解密 | 是否更换了 `FORGENOTE_ENCRYPTION_KEY`；恢复原 key 后重启容器 |
| 更新后页面仍是旧版本 | `docker compose up -d --build` 后浏览器执行硬刷新，确认 `docker compose ps` 中容器已重建 |

## Windows 安装包（桌面模式）

运行 `ForgeNote-Setup-0.1.5.exe` 后，通过桌面或开始菜单的“ForgeNote”快捷方式启动。安装包会在后台依次启动本地数据库、API、任务 worker 和界面服务，并把现有 Next.js 前端加载到独立的 Windows WebView2 应用窗口中，不再启动外部浏览器。

桌面窗口使用系统的 Microsoft Edge WebView2 Runtime。Windows 11 和安装了新版 Edge 的 Windows 10 通常已自带；极少数精简系统如果缺失，启动器会给出明确提示。

运行数据不会放进安装目录：

- 配置：`%LOCALAPPDATA%\ForgeNote\config.env`
- 上传内容与应用数据：`%LOCALAPPDATA%\ForgeNote\data`
- 数据库：`%LOCALAPPDATA%\ForgeNote\surrealdb`
- 日志：`%LOCALAPPDATA%\ForgeNote\logs`

因此应用升级和卸载不会自动删除用户数据。构建方法与故障排查见 [`desktop/windows/README.md`](../desktop/windows/README.md)。

## 本地运行

后端：

```bash
uv run python run_api.py
```

前端：

```bash
cd frontend
npm install
npm run dev
```

访问：

- 开发前端：`http://localhost:3000`
- API：`http://localhost:5055`

源码模式还需要单独启动 command worker；完整的三终端命令见项目根目录 [`README.md`](../README.md#源码运行浏览器开发)。`8502` 是 Docker 与 Windows 桌面安装包使用的生产前端端口。

## Docker 运行

```bash
docker compose up -d --build
```

只重建应用容器时可使用：

```bash
docker compose up -d --build --no-deps forgenote
```

服务：

- `surrealdb`：数据库
- `forgenote`：前端 + API

注意：当前 Dockerfile 已加入 apt retry，但如果遇到 Debian 源 502，可稍后重试或替换为更稳定的软件源。

新环境会通过数据库迁移创建播客 episode 的 `notebook_id` 字段，使生成成功的播客能在所属学习记录的 Studio 区显示。

## 演示数据建议

建议准备一门完整课程资料，例如：

- 人工智能导论
- 机器学习基础
- 深度学习
- 操作系统
- 数据结构

资料可以包括：

- 课程 PDF
- 教材章节
- 论文
- 实验说明
- 课堂笔记
- 公开网页

## 7 分钟演示脚本

### 1. 开场：项目定位

说明ForgeNote是在 AI notebook 底座上改造的主动式多智能体学习系统，不是通用资料问答工具。

重点展示：

- 学习记录列表
- 课程资料集中管理
- notebook 底座带来的资料、笔记、引用能力

### 2. 学习画像

进入一个课程学习记录，在左侧展示“学习画像”。

说明画像来源：

- 学生自然语言输入
- 学习目标
- 课程资料
- 练习和资源反馈

强调画像不少于 6 个维度，并且可随学随新。

### 3. 资源搜索智能体

在“按目标搜集资料”输入学习目标，例如：

```text
我想系统理解监督学习中的泛化误差、正则化和模型选择。
```

说明资源搜索智能体会收集候选资料，学生确认后再进入学习上下文，避免无约束抓取。

### 4. 多类型资产生成

在右侧 Studio 展示：

- 课程学习讲解
- 测验
- 闪卡
- 思维导图
- 拓展阅读
- 代码实验室
- 播客

说明不同资产由不同角色智能体协作完成，并受画像、课程资料和安全检查约束。

补充说明编辑和导出边界：

- 可编辑：思维导图、代码实验室中的 notebook 代码。
- 可导出：课程学习讲解、测验错题本、思维导图 Markdown/图片、代码实验室 Jupyter Notebook、播客 WAV。
- 不导出：拓展阅读、闪卡。

### 5. 智能辅导

在中间对话区提问，展示：

- 来源感知回答
- 引用
- 上下文 token 信息
- 可框选回答片段并引用继续追问
- 推荐下一句可问的问题

### 6. 进度追踪

打开右下角任务浮窗，展示：

- 排队/运行/失败任务
- 日志查看
- 结果摘要

说明长任务不会白屏等待，符合赛题“进度追踪或流式呈现”要求。

### 7. 模型与安全

进入模型/API 配置页，说明：

- 基础默认模型覆盖通用文本、Embedding、图片、TTS、STT
- 高级设置按学习用途覆盖
- 支持多 API 协议
- TTS/ASR/Embedding/图片/文本模型分离
- 安全智能体和来源约束降低幻觉

## 截图清单

- `docs/assets/screenshot-notebooks.png`：学习记录列表。
- `docs/assets/screenshot-learning-workspace.png`：课程学习工作台。
- `docs/assets/screenshot-model-settings.png`：模型/API 配置。
- `docs/assets/screenshot-search-agent.png`：问询与搜索入口。

## 补充：学习曲线演示

进入任意学习记录详情页后，点击页面顶部的“学习曲线”入口。演示时重点说明：

- 柱状图表示近期学习量，折线表示学习质量。
- 面板汇总近 7 天学习量、活跃天数、学习质量和测验正确率。
- 系统会根据最近学习状态给出下一步建议，例如补弱、恢复学习节奏或进入综合应用。
- 该功能与学习画像共享学习事件，但以更直观的图形和建议面板呈现，适合面向学生展示学习进展。

错题本同样位于学习记录顶部入口。演示测验后可打开错题本查看错题、答案和解析，并导出错题本用于复盘。
