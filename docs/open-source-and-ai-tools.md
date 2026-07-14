# 开源与 AI 工具说明

## 开源底座

ForgeNote 基于 [Open Notebook](https://github.com/lfnovo/open-notebook) 开源项目开发。原项目提供成熟的 AI notebook 能力，包括资料管理、笔记、RAG 问答、模型配置、SurrealDB 数据层和 Next.js/FastAPI 工程结构。

本项目保留 MIT License，并保留 LICENSE 中的原版权声明。参赛团队在此基础上完成了面向赛题的二次开发：

- 学习画像
- 多智能体学习编排
- 资源搜索与确认
- 多类型学习资产生成
- 学习路径与评估反馈
- 安全质检角色
- 模型用途化配置、图片模型配置与多协议 spec
- 任务进度浮窗与日志可视化
- 对话框选引用追问与推荐下一句问题
- 错题本、学习曲线和资产导出规则
- 参赛文档与演示材料

## 主要开源依赖

| 类别 | 依赖 | 用途 |
| --- | --- | --- |
| 后端 Web | FastAPI | REST API 与 SSE 接口 |
| 数据库 | SurrealDB | notebook、source、note、model、credential、job 存储 |
| 后台任务 | surreal-commands | 长任务提交、状态追踪、日志 |
| LLM 编排 | LangGraph / LangChain 相关依赖 | 图式/链式 AI 工作流基础能力 |
| 模型调用 | esperanto、langchain-openai | 多供应商模型调用 |
| 前端 | Next.js、React | Web 工作台 |
| UI | Radix UI、lucide-react、Tailwind CSS | 组件、图标与布局 |
| 数据请求 | TanStack Query、axios | 前端数据缓存与 API 请求 |
| Markdown | react-markdown、remark-gfm、KaTeX | 学习资产渲染 |
| 测试 | pytest、Vitest、Testing Library | 后端与前端测试 |

具体版本以 `pyproject.toml`、`uv.lock`、`frontend/package.json` 和 `frontend/package-lock.json` 为准。

## 协议与合规

- Open Notebook 底座：MIT License。
- 本仓库保留 MIT License 文件及原版权声明。
- 新增代码作为比赛项目改造部分提交。
- 生成内容依赖用户配置的第三方模型服务，需遵守对应平台 API 使用条款。
- 文档中明确说明基于开源项目开发，不隐瞒底座来源。

## AI Coding 工具使用说明

开发过程中使用了 AI Coding 工具辅助：

- 代码阅读与重构建议
- 文档草拟与结构整理
- 测试命令执行与错误分析
- 前端交互和多智能体流程实现辅助

AI 工具不替代最终工程判断。关键修改均在本地代码库中落地，并通过测试、lint、build 或手工运行验证。

## 前沿 AI 技术融合

| 技术点 | 项目落地 |
| --- | --- |
| 大模型自然语言理解 | 从学生描述中抽取学习画像、目标和薄弱点 |
| RAG | 基于课程资料和已接受来源回答问题 |
| 多智能体 | 多角色协同完成画像、搜索、生成、练习、路径、安全 |
| 多模态生成 | 文档、导图、题库、代码实验、播客音频、图片生成等资源 |
| 语义检索 | 轻量 semantic index 支撑资源筛选和上下文组织 |
| 实时/后台任务 | SSE stage 与 command job 追踪生成进度 |
| 多协议模型适配 | OpenAI-compatible、DashScope、Azure/OpenAI 等模型协议统一 |

## 自主开发边界

自主开发重点集中在赛题相关能力，而不是重复造 notebook 基础设施：

- 多智能体学习业务逻辑为新增。
- 学习画像与学习事件接口为新增。
- Studio 学习资产入口和预览为新增。
- 模型用途化默认配置、图片模型适配和 TTS protocol spec 为新增。
- 对话引用追问、推荐下一句问题、错题本入口和资产导出规则为新增。
- 任务浮窗、失败日志、结果摘要增强为新增。
- README 与比赛文档为新增。

运行时标识已经统一为项目自有的 `forgenote` Python 包、`FORGENOTE_*` 环境变量和 `forgenote` 数据库命名空间。
