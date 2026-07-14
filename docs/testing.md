# 测试说明

## 测试目标

测试重点覆盖：

- 凭据与模型配置不会破坏原 notebook 能力。
- 学习画像、资源编排、资产生成接口能够正常返回。
- 语义索引和命令任务对新学习系统可用。
- 前端能够通过单元测试、lint 和 production build。
- Windows 发行版能从空数据目录启动完整服务栈并正常退出。
- 清理后的项目仍可运行，不依赖已删除的旧文档、旧 logo 和旧 CI 文件。

## 后端测试

执行命令：

```powershell
uv run pytest -q
```

最近一次结果：

```text
241 passed, 2 warnings
```

覆盖范围：

- API key、模型列表、默认模型与 model spec。
- 学习系统 API、多智能体学习编排、语义索引与后台命令。
- 数据迁移、音视频路径、文本处理和 Windows 启动器辅助逻辑。

## 前端测试

执行命令：

```bash
cd frontend
npm test -- --run
npm run lint
npm run build
```

最近一次结果：

- `npm test -- --run`：53 passed。
- `npm run lint`：0 errors，6 个既有 warning。
- `npm run build`：通过。

前端重点检查：

- 学习工作台页面可渲染。
- Studio 资产入口可见。
- 模型设置页可配置 API key 和默认模型。
- 模型设置页基础默认项包含通用文本、Embedding、图片、TTS、STT，高级设置可单独覆盖具体功能。
- 任务浮窗可展示后台任务状态。
- 学习资产预览组件有单元测试。

## 格式与敏感信息检查

执行过：

```bash
git diff --cached --check
git grep --cached -n "<token-prefix>"
```

结果：

- staged diff 无 trailing whitespace 或 EOF 格式错误。
- 提交内容未包含 GitHub token。

## Windows 发行版验证

正式构建命令：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build.ps1 -SkipDependencyInstall
```

构建后使用临时数据目录执行 `ForgeNote.exe --smoke-test`。最近一次结果为退出码 `0`，并确认 SurrealDB、17 个数据库迁移、FastAPI、任务 worker 与 Next.js 前端均通过健康检查。worker 日志包含正常的 `✅ Imported: commands` 和 LIVE query 就绪标记，不再触发中文 Windows 的 GBK 编码异常。

默认桌面模式已实际启动验证：Next.js 工作台在无地址栏、无标签页的独立 WebView2 窗口内完整加载；关闭窗口后 `8000`、`5055`、`8502` 均无监听进程。

## Docker 构建说明

执行命令：

```bash
docker compose build forgenote
```

也可只重建应用容器：

```bash
docker compose up -d --build --no-deps forgenote
```

Dockerfile 已加入 `Acquire::Retries=5`；如果 Docker Hub、Debian apt 或 npm 外部源超时，可稍后重试、配置代理或切换镜像源。普通 Windows 用户无需依赖 Docker。

## 手工验证

手工验证流程：

1. 启动数据库与 API。
2. 启动前端。
3. 访问学习记录列表。
4. 进入 `cs229` 学习记录。
5. 查看左侧资源搜索与学习画像。
6. 在右侧 Studio 查看课程讲解、测验、闪卡、思维导图、拓展阅读、代码实验和播客入口。
7. 访问模型/API 配置页，确认模型用途化设置可见。
8. 访问问询与搜索页，确认问答和搜索入口可见。
9. 在对话区框选助手回答片段，确认可以引用选中内容继续追问，并显示推荐下一句问题。
10. 打开学习记录顶部入口，确认学习曲线和错题本都不占用左侧来源栏。
11. 测试导出规则：课程讲解、错题本、思维导图、代码实验室、播客有对应导出；拓展阅读和闪卡不显示导出。
12. 如果配置了 DashScope/Qwen `qwen-image`，在模型设置页测试图片模型连接。

截图见 `docs/assets/`。

## 已知风险

- 多模态视频/动画暂未接入昂贵的视频生成模型，当前以讲解文档、导图、题库、代码实验和播客音频为主要多模态资源。
- Docker 构建依赖外部 apt 与 npm 源，弱网络环境可能需要镜像源。
- 语音模型市场中部分模型名称相近，系统已增加 TTS protocol spec 与 warning，但仍建议在演示前确认默认 TTS 模型。
- 图片模型必须登记为 `image` 类型；OpenAI-compatible 文本测试不能代表 DashScope 图片接口可用。

## 补充：近期交互验证点

除原有接口和构建测试外，当前版本还应手动确认以下学习体验：

1. 学习记录详情页顶部能看到“学习曲线”入口。
2. 学习曲线面板能展示最近 14 天学习量、学习质量、测验正确率、每日明细和近期建议。
3. 左侧来源栏标题下方有清晰的“添加来源”和“搜集资料”两个大按钮。
4. 学习画像弹窗展示的是用户友好的摘要，而不是后台 Prompt、错题日志或最近学习信号原文。
5. 测验完成后只显示正确率总结，全对为绿色，有错为红色，并可生成相似题练习。
6. 播客播放器支持播放队列、倍速、快进/后退和字幕同步。
7. 播客生成成功后能在所属学习记录的 Studio 区显示；新环境依赖迁移 `17.surrealql` 创建 `episode.notebook_id`。

## 补充：最近定向验证

近期围绕模型配置、播客解析和 Studio 交互补充验证：

- `uv run pytest tests/test_podcast_path.py tests/test_utils.py -q`：33 passed。
- 针对对话引用追问、学习资产导出和模型设置页执行过 ESLint 定向检查。
- DashScope/Qwen `qwen-image` 图片模型连接测试已通过，实际请求走 DashScope 原生多模态生成接口。
