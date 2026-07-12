# 配置指南

本文说明智学工坊从“能启动”到“能完整演示多智能体学习资源生成”所需的配置。推荐按顺序完成：基础环境、数据库、后端、前端、模型/API key、默认模型、TTS、学习系统验证。

## 配置目标

最小可运行配置：

- SurrealDB 能连接。
- 后端 API 能启动。
- 前端能访问 API。
- 至少配置一个语言模型和一个 embedding 模型。

完整演示配置：

- 聊天、RAG、资源搜索、学习资产生成都有默认语言模型。
- 讲解、测验、闪卡、思维导图、拓展阅读、代码实验、播客有专项默认模型或 fallback。
- 图片模型可用，用于图片生成、视觉辅助或后续图像类资产。
- TTS 模型可用，用于播客/音频讲解。
- 任务队列和日志可正常展示。

## 1. 准备 `.env`

复制示例配置：

```bash
copy .env.example .env
```

Linux/macOS：

```bash
cp .env.example .env
```

至少需要确认：

```bash
OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string
SURREAL_URL=ws://localhost:8000/rpc
SURREAL_USER=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=open_notebook
SURREAL_DATABASE=open_notebook
```

`OPEN_NOTEBOOK_ENCRYPTION_KEY` 用于加密数据库中的 API key。第一次保存凭据后不要随意修改，否则旧凭据可能无法解密。正式部署时请改成更长的随机字符串。

## 2. 数据库配置

### 本地源码运行

如果后端直接运行在宿主机，推荐：

```bash
SURREAL_URL=ws://localhost:8000/rpc
SURREAL_USER=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=open_notebook
SURREAL_DATABASE=open_notebook
```

启动 SurrealDB：

```bash
docker compose up -d surrealdb
```

### Docker Compose 运行

如果使用 `docker compose up -d --build`，应用容器通过服务名访问数据库：

```bash
SURREAL_URL=ws://surrealdb:8000/rpc
```

`docker-compose.yml` 已经为 `zhixue` 服务配置了这个地址。宿主机访问数据库时仍使用 `localhost:8000`。

### 生产或比赛演示注意

- 不要使用默认 `root/root` 暴露到公网。
- 修改 `SURREAL_USER` 和 `SURREAL_PASSWORD` 后，`surrealdb` 与 `zhixue` 服务需要使用相同值。
- `SURREAL_NAMESPACE` 和 `SURREAL_DATABASE` 保持 `open_notebook` 是兼容层设计，不影响产品名。

## 3. 后端 API 配置

源码运行：

```bash
uv run python run_api.py
```

默认地址：

```text
http://localhost:5055
```

健康检查：

```bash
curl http://localhost:5055/api/health
```

如果健康检查路径不可用，也可以访问：

```bash
curl http://localhost:5055/api/auth/status
```

正常情况下会返回认证是否启用。

## 4. 前端配置

源码运行：

```bash
cd frontend
npm install
npm run dev
```

默认地址：

```text
http://localhost:8502
```

前端访问 API 有两种方式：

- 开发模式：浏览器从运行时配置或默认值获得 `http://localhost:5055`。
- Docker/standalone：Next.js 可以通过 `INTERNAL_API_URL` 代理 `/api/*` 到后端。

常用变量：

```bash
API_URL=http://localhost:5055
INTERNAL_API_URL=http://localhost:5055
NEXT_PUBLIC_API_TIMEOUT_MS=600000
```

`API_URL` 是浏览器侧可访问的 API 地址；`INTERNAL_API_URL` 是 Next.js 服务端代理访问 API 的地址。单机演示时两者通常相同。

## 5. 配置 API key

推荐通过前端配置：

1. 打开“设置”。
2. 进入“模型/API 配置”。
3. 添加供应商凭据。
4. 同步或手动添加模型。
5. 测试模型连接。

也可以通过环境变量配置部分供应商：

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
GROQ_API_KEY=gsk_...
DASHSCOPE_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434
```

不要把真实 key 提交到仓库。`.env` 已被 `.gitignore` 排除，示例文件 `.env.example` 只保留占位符。

## 6. 供应商配置建议

### OpenAI 或 OpenAI-compatible

适合配置：

- 聊天模型
- RAG 模型
- 资源搜索模型
- 学习资产模型
- Embedding 模型

OpenAI-compatible 需要提供：

- `base_url`
- `api_key`
- 模型名
- 模型类型：`language`、`embedding`、`image`、`text_to_speech` 或 `speech_to_text`

### DashScope / Qwen

适合配置：

- Qwen 文本模型：学习资产、资源搜索、RAG。
- Qwen 图片模型：图片生成和视觉辅助，推荐登记 `qwen-image`，模型类型选择 `image`。
- Qwen/DashScope TTS：播客和音频讲解。

系统会根据模型名和 provider 推断运行协议，例如：

- `qwen-image`：DashScope 图片生成接口。
- `qwen3-tts-*`：DashScope TTS。
- 带 `realtime` 的 Qwen TTS：按 realtime TTS 协议处理。
- 带 `-vc` 的模型：语音转换，不建议作为普通播客 TTS。
- 带 `-vd` 的模型：视频配音，不建议作为普通播客 TTS。

对于 DashScope 或阿里云 MaaS 的 OpenAI-compatible 凭据，图片生成会把兼容模式地址归一到 DashScope 原生多模态生成接口，例如 `/api/v1/services/aigc/multimodal-generation/generation`。因此不要把 `qwen-image` 登记成普通语言模型，也不要用文本对话测试来验证图片模型。

### Ollama / 本地模型

适合本地演示和低成本测试：

```bash
OLLAMA_BASE_URL=http://localhost:11434
```

注意本地模型速度和上下文长度可能不足，长文档 RAG 和多资产生成可能明显变慢。

## 7. 默认模型配置

进入“设置 -> 模型/API 配置”，重点配置以下默认模型。

当前页面分为两层：

- 基础默认项：通用文本模型、Embedding、图片、TTS、STT。通用文本模型用于大多数语言生成任务，修改后会同步到聊天、RAG、资源搜索和各类 Studio 文本资产的默认项。
- 高级设置：只在某个功能必须使用不同模型时再单独覆盖，例如播客脚本、代码实验室或测验题。

### 最小必配

| 默认项 | 用途 | 建议 |
| --- | --- | --- |
| `default_chat_model` | 普通对话与兜底生成 | 选择稳定语言模型 |
| `default_rag_model` | 来源约束问答 | 可与 chat 相同 |
| `default_embedding_model` | 资料嵌入与检索 | 选择 embedding 模型 |
| `default_image_model` | 图片生成与视觉辅助 | 选择 `image` 类型模型，例如 `qwen-image` |
| `default_learning_asset_model` | 学习资产通用生成 | 选择长上下文语言模型 |

### 完整演示建议

| 默认项 | 用途 |
| --- | --- |
| `default_resource_search_model` | 资源搜索 query 规划与结果整理 |
| `default_study_guide_model` | 课程学习讲解 |
| `default_quiz_model` | 测验题 |
| `default_flashcards_model` | 闪卡 |
| `default_mind_map_model` | 思维导图 |
| `default_reading_model` | 拓展阅读 |
| `default_code_lab_model` | 代码实验 |
| `default_podcast_model` | 播客脚本 |
| `default_text_to_speech_model` | 播客音频/TTS |
| `default_speech_to_text_model` | 音频资料转写，可选 |

没有配置专项模型时，系统会尽量 fallback 到 `default_learning_asset_model`、`default_transformation_model` 或 `default_chat_model`。为了演示稳定，建议至少配置 chat、rag、learning asset、embedding；如果要测试图片能力，还需要配置 `default_image_model`。

## 8. 学习资源搜索配置

资源搜索智能体包含两层：

- 大模型负责理解学习目标、生成搜索意图、整理候选资源。
- `api/web_search.py` 使用 DuckDuckGo HTML / Yahoo Search 做无 key 公开网页搜索。

因此资源搜索不一定需要额外搜索 API key，但需要：

- 机器能访问外网。
- 至少一个语言模型可用于整理和筛选。
- 学生确认候选来源后再纳入学习上下文。

如果比赛现场网络不稳定，建议提前准备课程 PDF、论文和网页文本作为本地资料。

## 9. TTS 与播客配置

播客生成分为两步：

1. 语言模型生成播客大纲/脚本。
2. TTS 模型生成音频。

建议：

- `default_podcast_model` 选择语言模型。
- `default_text_to_speech_model` 选择真正的 TTS 模型。
- DashScope/Qwen TTS 建议使用 `qwen3-tts-flash`、`qwen3-tts-instruct-flash` 或明确支持文本转语音的模型。

不要把语音克隆、语音转换、视频配音模型当普通 TTS 使用。系统会在 model spec 中给出 warning，但演示前仍应手动确认默认 TTS。

## 10. 学习系统配置检查

完成模型配置后，按下面顺序检查：

1. 创建学习记录。
2. 上传课程资料。
3. 确认资料处理完成。
4. 在学习画像区输入学生背景和学习目标。
5. 使用“按目标搜集资料”测试资源搜索。
6. 在 Studio 里生成一个测验或课程讲解。
7. 打开右下角任务浮窗，确认能看到任务状态和日志。
8. 在对话区围绕资料提问，确认回答带引用。
9. 框选一段助手回答，确认能引用所选内容继续追问，并看到下一句推荐问题。
10. 如果配置了图片模型，在模型/API 配置页单独测试 `image` 类型模型。

如果这些步骤可用，说明比赛演示核心配置已经完成。

## 11. 常见问题

### 页面能打开，但 API 请求失败

检查：

- 后端是否在 `5055`。
- `API_URL` 是否是浏览器可访问地址。
- Docker 中 `INTERNAL_API_URL` 是否指向容器内可访问地址。

### 模型列表为空

检查：

- 是否添加了供应商凭据。
- 是否点击了模型同步。
- OpenAI-compatible 的 `base_url` 是否包含正确版本路径，例如 `/v1`。
- 模型类型是否选错，例如 embedding 模型不要登记为 language。

### 学习资产生成失败

检查：

- 是否配置 `default_learning_asset_model` 或 `default_chat_model`。
- 当前学习记录是否有来源或画像内容。
- 右下角任务浮窗中的失败日志。
- API key quota 是否充足。

### 图片模型测试失败

检查：

- 模型类型是否为 `image`，不要登记为 `language`。
- `default_image_model` 是否选择了该图片模型。
- DashScope/Qwen 图片模型是否使用实际支持的模型名，例如 `qwen-image`。
- 当前凭据是否有图片生成接口权限和额度。
- 如果使用 OpenAI-compatible 形式的阿里云 MaaS 地址，确认 base URL 和 key 属于同一个服务空间。

### 播客生成失败或 quota 不够

检查：

- `default_podcast_model` 是否是语言模型。
- `default_text_to_speech_model` 是否是真正的 TTS 模型。
- 是否误选了 voice conversion、video dubbing 或不可用于普通 TTS 的模型。
- DashScope key 是否有对应模型权限和额度。
- 如果音频已经生成但 Studio 看不到，确认数据库已包含 episode 的 `notebook_id` 字段；新环境会通过迁移 `17.surrealql` 自动创建该字段。

### Docker build 在 apt 阶段失败

如果报错来自 `deb.debian.org` 的 `502 Bad Gateway`，通常是外部 apt 源不稳定。Dockerfile 已加入重试，可稍后重试或替换镜像源。这不是应用代码编译错误。

## 12. 推荐演示配置清单

比赛前建议确认：

- `.env` 中 encryption key 已改成稳定值。
- SurrealDB 用户名密码不是公开默认值。
- 至少有一个可用语言模型。
- 至少有一个可用 embedding 模型。
- 如需图片能力，至少有一个可用 `image` 模型，并已设置 `default_image_model`。
- 默认模型中 chat、rag、learning asset、embedding 已配置。
- TTS 已选择文本转语音模型。
- 准备一门课程资料作为本地输入。
- 右下角任务浮窗能显示任务状态。
- README 中截图和 docs 链接能正常打开。

## 补充：MiMo/Xiaomi TTS

MiMo/Xiaomi TTS 可以作为 `text_to_speech` 模型登记，用于普通播客音频生成。演示前需要确认三点：

- 模型类型选择 `text_to_speech`。
- Base URL 与鉴权信息指向可用的 MiMo/Xiaomi 文本转语音接口。
- `default_text_to_speech_model` 选择该可用 TTS 模型，而不是语音克隆、语音转换或视频配音模型。
