# ForgeNote

[English](README.en.md) | **简体中文**

ForgeNote 是一款面向高校专业课学习的本地 AI 桌面应用。它把课程讲义、论文、网页与个人笔记整理为可追溯的知识库，并据此生成讲解、测验、闪卡、思维导图、代码实验、拓展阅读、播客和讲解视频。

![ForgeNote 课程知识库](docs/assets/demo-knowledge-base.jpg)

## 核心能力

- **课程知识库**：导入 PDF、Word、网页、音频和文本，完成解析、分块、检索与来源管理。
- **来源约束问答**：围绕已选资料提问，保留上下文与引用，减少脱离材料的回答。
- **学习资产生成**：按同一课程上下文生成讲解、测验、闪卡、导图、阅读材料、代码实验、图片、播客和讲解视频。
- **个性化学习闭环**：结合学习画像、测验结果、错题和学习事件调整后续内容与学习路径。
- **可观测长任务**：解析、生成与播客任务统一进入悬浮任务球；额度、鉴权或模型错误会明确显示，不会静默回退。
- **本地桌面体验**：Windows 安装包内置后端、前端、数据库与 FFmpeg，在独立 WebView2 窗口中运行。

## `ai学习` 演示

启动 ForgeNote 后进入“学习记录”，打开与普通记录并列的 `ai学习`。每次进入都会从正式“新建学习记录”弹窗开始一份全新的 notebook，并依次展示学习画像、资料检索与收集、来源问答、Agent 监督台，以及博客、测验、播客和视频等学习资产。

演示使用与真实创建 notebook 相同的页面、组件和交互流程。唯一的区别是耗时的模型回答、搜索结果和学习资产已经预缓存，以便录制时即时呈现；页面状态、按钮、博客、音频、视频、Quiz 和来源仍使用正式组件并可操作。

**准备录制请直接查看：[「ai学习」展示视频录制稿](docs/ai-learning-demo-recording-script.md)。**

另有一套可复现的高校课程测试资料，见 [演示数据与生成结果](docs/demo/README.md)。

## 快速开始

### Windows 桌面安装包（推荐）

从 [Releases](../../releases/latest) 获取 `ForgeNote-Setup-0.1.5.exe`，双击安装后从桌面或开始菜单启动 ForgeNote。安装包不要求预装 Docker、Python 或 Node.js；旧版本可以直接覆盖升级。

首次使用时，在“模型”页面添加供应商凭据，再在“设置”页面选择通用文本、Embedding、图片、TTS、STT 及各类学习资产使用的模型。详细步骤见 [配置指南](docs/configuration-guide.md)。

自行构建安装包：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build.ps1
```

输出位于 `dist/windows/ForgeNote-Setup-0.1.5.exe`，打包与数据目录说明见 [Windows 打包文档](desktop/windows/README.md)。

### 浏览器运行（Docker）

Docker 会同时启动数据库、API、后台 worker 和 Web 前端，适合直接在浏览器中使用。

1. 在项目根目录复制配置文件，并修改 `FORGENOTE_ENCRYPTION_KEY`、`SURREAL_USER` 和 `SURREAL_PASSWORD`。投入使用后不要更换这些值。

```powershell
Copy-Item .env.example .env
```

2. 构建并启动：

```powershell
docker compose up -d --build
docker compose ps
```

3. `docker compose ps` 显示服务正常后，打开 [http://localhost:8502](http://localhost:8502)。调试 API 时可访问 [http://localhost:5055/docs](http://localhost:5055/docs)。

常用维护命令：

```powershell
docker compose logs -f forgenote
docker compose down
```

上传内容和应用数据保存在 `notebook_data/` 与 `surreal_data/`；普通的 `docker compose down` 不会删除它们。网络受限的 Windows 环境建议使用桌面安装包。

#### 从其他设备访问

- 局域网：访问 `http://<服务器 IP>:8502`；防火墙只需向可信网络放行 `8502`。
- 公网：使用 HTTPS 反向代理，只公开 `443`；不要直接暴露 API `5055` 或数据库 `8000`。

反向代理、同源地址和安全配置见 [部署与演示](docs/deployment-and-demo.md)，模型与环境变量见 [配置指南](docs/configuration-guide.md)。

### 源码运行（浏览器开发）

源码开发需要分别运行数据库、API、后台 worker 和前端。先准备依赖与数据库：

```powershell
Copy-Item .env.example .env
# 源码运行时将 .env 中的 SURREAL_URL 改为 ws://localhost:8000/rpc
uv sync
docker compose up -d surrealdb
cd frontend
npm ci
cd ..
```

然后分别打开三个终端：

```powershell
# 终端 1：API
uv run --env-file .env python run_api.py

# 终端 2：后台任务 worker
uv run --env-file .env surreal-commands-worker --import-modules commands.worker

# 终端 3：Web 前端
cd frontend
npm run dev
```

开发模式的 Web 界面位于 `http://localhost:3000`，API 位于 `http://localhost:5055`。只启动 API 和前端时，解析、生成、播客等后台任务不会执行，因此不要省略 worker。

## 技术组成

- FastAPI、Next.js、SurrealDB 与后台 command worker
- 来源分块、Embedding、BM25/语义检索和 RAG
- OpenAI、OpenAI-compatible、DashScope、Azure OpenAI 等模型协议适配
- Windows WebView2 桌面壳、PyInstaller、内置 Node.js、SurrealDB 与 FFmpeg

新安装的运行时命名使用 Python 包 `forgenote`、环境变量 `FORGENOTE_*` 和数据库命名空间 `forgenote`；升级安装会继续使用原有数据库命名空间，避免旧数据被隐藏。

## 验证

项目包含后端单元测试、前端组件测试、Lint、生产构建、Windows 安装包构建与正式目录冒烟测试。测试范围及命令见 [测试说明](docs/testing.md)。

## 文档

- [「ai学习」展示视频录制稿](docs/ai-learning-demo-recording-script.md)
- [演示数据与生成结果](docs/demo/README.md)
- [需求分析](docs/requirements-analysis.md)
- [系统设计](docs/system-design.md)
- [配置指南](docs/configuration-guide.md)
- [部署与演示](docs/deployment-and-demo.md)
- [开源与 AI 工具说明](docs/open-source-and-ai-tools.md)

ForgeNote 基于开源项目 [Open Notebook](https://github.com/lfnovo/open-notebook) 开发。
