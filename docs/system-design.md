# 系统开发说明

## 总体架构

ForgeNote采用前后端分离架构：

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
  ├─ forgenote domain models
  ├─ RAG / semantic index
  ├─ model manager / runtime spec
  ├─ image generation adapter
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
- `frontend/src/app/(dashboard)/notebooks/components/MistakeBookDialog.tsx`
- `forgenote/ai/image_generation.py`
- `forgenote/ai/model_specs.py`
- `forgenote/utils/semantic_index.py`
- `forgenote/podcasts/robust_creator.py`

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

编辑和导出规则按资产类型控制：

- 只有思维导图和代码实验室中的 notebook 代码内容显示编辑入口。
- 课程学习讲解可导出文档。
- 测验通过错题本导出错题。
- 思维导图可导出 Markdown，或在展开全部节点后导出图片。
- 代码实验室可导出 Jupyter Notebook。
- 播客可导出 WAV 音频。
- 拓展阅读和闪卡不提供导出入口。

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
- image
- text_to_speech
- speech_to_text

`forgenote/ai/model_specs.py` 负责把数据库中保存的 provider、model type、model name 解析为运行时 spec：

- 规范化 OpenAI-compatible、Azure、DashScope 等协议。
- 根据模型名识别 DashScope/Qwen 图片模型，并通过 `forgenote/ai/image_generation.py` 调用图片生成接口。
- 根据模型名识别 Qwen/DashScope TTS、ASR。
- 区分 DashScope HTTP TTS、realtime TTS、voice conversion、video dubbing。
- 给不适合普通播客 TTS 的模型返回 warning，避免 quota 和协议误用。

模型配置页在交互上分为基础默认项和高级设置。基础默认项覆盖通用文本、Embedding、图片、TTS、STT；高级设置仅用于某个学习功能需要指定独立模型时覆盖。这样保留供应商接口的灵活性，同时减少每个 Studio 功能都手工选择模型的成本。

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
- 播客 episode 与所属 notebook 的绑定关系

API key 通过加密逻辑写入数据库，避免明文散落在前端或配置文件中。

播客 episode 增加 `notebook_id` 字段，确保音频生成完成后能在对应学习记录的 Studio 区展示。该字段由迁移 `17.surrealql` 创建，并带有 `idx_episode_notebook_id` 索引。

## 前端交互设计

学习页采用三栏布局：

- 左侧：来源、资源搜索、学习画像。
- 中间：与学习记录对话，展示引用和上下文 token；支持框选助手回答后引用继续追问，并给出下一句推荐问题。
- 右侧：Studio 资源生成入口和已有学习资产。

这样能同时呈现“资料输入、智能交互、资源产出”三个核心环节，比原通用 notebook 更贴合学习路径和资源生成赛题。

## 补充：学习分析与反馈面板

学习记录页新增独立的学习曲线面板。该面板复用学习画像事件流、来源创建时间和笔记创建时间，聚合为按日统计的学习量、练习表现、资源使用和生成行为。前端基于这些信号计算近 14 天趋势、近 7 天质量摘要和下一步建议，不额外引入新的数据库表。

设计取舍：

- 学习画像继续作为长期、可编辑的稳定画像来源。
- 学习曲线作为短期状态视图，强调趋势、质量和行动建议。
- 错题本作为独立入口承接测验反馈，不占用左侧资料输入区。
- 二者共享学习事件，避免用户在多个地方重复填写背景或学习记录。
