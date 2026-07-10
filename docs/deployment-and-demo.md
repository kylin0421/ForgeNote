# 部署与演示指南

## 环境要求

- Python 3.12
- Node.js 22+
- Docker Desktop（可选）
- SurrealDB v2
- 至少一个可用大模型 API key
- 可选：DashScope TTS key，用于播客/音频讲解

## 环境变量

完整配置步骤见 [配置指南](configuration-guide.md)。最小环境变量参考 `.env.example`：

```bash
OPEN_NOTEBOOK_ENCRYPTION_KEY=change-me-to-a-secret-string
SURREAL_URL=ws://localhost:8000/rpc
SURREAL_USER=root
SURREAL_PASSWORD=root
SURREAL_NAMESPACE=open_notebook
SURREAL_DATABASE=open_notebook
```

模型 key 可通过前端“模型/API 配置”页面录入，也可通过环境变量提供。

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

- 前端：`http://localhost:8502`
- API：`http://localhost:5055`

## Docker 运行

```bash
docker compose up -d --build
```

服务：

- `surrealdb`：数据库
- `zhixue`：前端 + API

注意：当前 Dockerfile 已加入 apt retry，但如果遇到 Debian 源 502，可稍后重试或替换为更稳定的软件源。

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

说明智学工坊是在 AI notebook 底座上改造的主动式多智能体学习系统，不是通用资料问答工具。

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

### 5. 智能辅导

在中间对话区提问，展示：

- 来源感知回答
- 引用
- 上下文 token 信息
- 可继续追问

### 6. 进度追踪

打开右下角任务浮窗，展示：

- 排队/运行/失败任务
- 日志查看
- 结果摘要

说明长任务不会白屏等待，符合赛题“进度追踪或流式呈现”要求。

### 7. 模型与安全

进入模型/API 配置页，说明：

- 模型按学习用途配置
- 支持多 API 协议
- TTS/ASR/Embedding/文本模型分离
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
