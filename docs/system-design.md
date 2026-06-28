# 系统开发说明

## 总体架构

知学工坊采用前后端分离架构：

```text
Next.js 前端
  ├─ 学习记录列表
  ├─ 学习工作台
  ├─ Studio 资产入口
  ├─ 模型/API 配置
  └─ 任务进度浮窗

FastAPI 后端
  ├─ notebook / source / note / chat API
  ├─ learning API
  ├─ model defaults API
  ├─ command job API
  └─ credential / settings API

核心能力层
  ├─ open_notebook domain models
  ├─ RAG / semantic index
  ├─ model manager / runtime spec
  ├─ podcast / TTS pipeline
  └─ safety and orchestration helpers

SurrealDB + surreal-commands
  ├─ 学习记录、来源、笔记、资产
  ├─ 模型与凭据配置
  └─ 后台任务状态与日志
```

项目继承了 AI notebook 的资料管理、RAG 和笔记底座，同时新增学习系统相关模块：

- `api/learning_service.py`
- `api/routers/learning.py`
- `commands/learning_commands.py`
- `frontend/src/components/learning/`
- `frontend/src/app/(dashboard)/notebooks/components/LearningAssetGenerateDialog.tsx`
- `open_notebook/ai/model_specs.py`
- `open_notebook/utils/semantic_index.py`
- `open_notebook/podcasts/robust_creator.py`

## 多智能体协作流程

```text
学生目标/资料/画像
        │
        ▼
画像智能体 ──更新画像维度──┐
        │                  │
        ▼                  │
课程智能体 ──拆解知识点────┤
        │                  │
        ▼                  │
资源搜索智能体 ──候选来源──┤
        │                  │
        ▼                  │
学生确认来源 ──纳入上下文──┤
        │                  │
        ▼                  │
资产生成/练习/辅导智能体 ──生成学习资源
        │
        ▼
安全智能体 ──检查来源一致性、敏感内容、幻觉风险
        │
        ▼
路径规划/评估智能体 ──推荐下一步学习任务
```

每次编排围绕一个 `LearningOrchestrationRequest` 运行，包含学习记录 ID、学习目标、学生上下文、已接受来源、请求生成的资产类型等信息。

## 关键接口

| 接口 | 作用 |
| --- | --- |
| `POST /api/learning/orchestrate` | 同步运行学习多智能体编排，返回资源与资产规划。 |
| `POST /api/learning/orchestrate/stream` | 以 SSE 方式返回各智能体 stage，便于前端展示进度。 |
| `POST /api/learning/resource-search/jobs` | 提交资源搜索后台任务。 |
| `POST /api/learning/assets/jobs` | 按资产类型拆分提交后台生成任务。 |
| `GET /api/learning/profile-source/{notebook_id}` | 获取或创建学习画像来源。 |
| `POST /api/learning/profile-event` | 记录学习事件并按需更新画像。 |

后台任务通过 `surreal-commands` 提交和追踪，命令包括：

- `collect_learning_resources`
- `generate_learning_asset`

## 画像设计

画像不是独立表单，而是可被学生查看和编辑的学习资料源。这样有三个好处：

- 与资料、问答、资产生成共享同一 notebook 上下文。
- 可以被 RAG 检索和引用。
- 学生可以随时修正画像，避免模型长期沿用错误假设。

画像字段建议包括：

- `专业背景`
- `课程/学习目标`
- `知识基础`
- `认知风格`
- `薄弱点与易错点`
- `资源偏好`
- `当前进度`
- `近期反馈`

## 资源与资产设计

Studio 区域将生成能力按学习目标组织：

- 课程学习讲解：面向课程知识点的分层讲解。
- 测验：用于快速诊断理解程度。
- 闪卡：用于术语、公式和概念回忆。
- 思维导图：用于知识结构梳理。
- 拓展阅读：结合来源推荐延伸材料。
- 代码实验室：生成可运行或可讨论的实践任务。
- 播客：生成适合听觉复习的讲解脚本和音频。

生成结果以 note/asset 形式进入学习记录，后续可被搜索、问答和路径规划继续使用。

## 模型与协议适配

系统把模型配置从“供应商列表”升级为“学习用途默认模型”：

- chat
- rag
- resource_search
- learning_asset
- study_guide
- quiz
- flashcards
- mind_map
- reading
- code_lab
- podcast
- embedding
- text_to_speech
- speech_to_text

`open_notebook/ai/model_specs.py` 负责把数据库中保存的 provider、model type、model name 解析为运行时 spec：

- 规范化 OpenAI-compatible、Azure、DashScope 等协议。
- 根据模型名识别 Qwen/DashScope TTS、ASR。
- 区分 DashScope HTTP TTS、realtime TTS、voice conversion、video dubbing。
- 给不适合普通播客 TTS 的模型返回 warning，避免 quota 和协议误用。

## 防幻觉与安全设计

防幻觉不是依靠一句提示词，而是组合机制：

- 来源优先：资产生成优先使用已接受来源和 notebook 内容。
- 引用可见：问答结果展示引用来源，学生可追踪依据。
- 语义索引：对来源和资产建立轻量检索索引，减少上下文漂移。
- 安全智能体：检查事实一致性、敏感内容和输出质量。
- 模型用途隔离：不同任务使用不同默认模型，避免把 TTS/Embedding/ASR 模型误用于文本生成。

## 进度追踪

前端有两个层面的进度反馈：

- SSE 流式编排：`/learning/orchestrate/stream` 可推送当前 agent stage。
- 后台任务浮窗：展示 command job 的排队、运行、失败、日志和结果摘要。

这满足赛题要求中“生成进度追踪或流式呈现”的非功能性需求，也方便演示视频说明当前流程到了哪个智能体。

## 数据与存储

系统使用 SurrealDB 保存：

- 学习记录/notebook
- 来源/source
- 笔记与生成资产/note
- 模型配置/default models
- API 凭据/credentials
- 后台任务/job

API key 通过加密逻辑写入数据库，避免明文散落在前端或配置文件中。

## 前端交互设计

学习页采用三栏布局：

- 左侧：来源、资源搜索、学习画像。
- 中间：与学习记录对话，展示引用和上下文 token。
- 右侧：Studio 资源生成入口和已有学习资产。

这样能同时呈现“资料输入、智能交互、资源产出”三个核心环节，比原通用 notebook 更贴合学习路径和资源生成赛题。
