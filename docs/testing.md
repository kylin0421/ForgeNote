# 测试说明

## 测试目标

测试重点覆盖：

- 凭据与模型配置不会破坏原 notebook 能力。
- 学习画像、资源编排、资产生成接口能够正常返回。
- 语义索引和命令任务对新学习系统可用。
- 前端能够通过 lint 和 production build。
- 清理后的项目仍可运行，不依赖已删除的旧文档、旧 logo 和旧 CI 文件。

## 后端测试

执行命令：

```bash
.venv\Scripts\python.exe -m pytest tests/test_credentials_api.py tests/test_models_api.py tests/test_learning_api.py tests/test_learning_service.py tests/test_semantic_index.py tests/test_command_service.py -q
```

最近一次结果：

```text
55 passed, 2 warnings
```

覆盖范围：

- `tests/test_credentials_api.py`：API key/凭据配置。
- `tests/test_models_api.py`：模型列表、默认模型与 model spec。
- `tests/test_learning_api.py`：学习系统 API。
- `tests/test_learning_service.py`：多智能体学习编排服务。
- `tests/test_semantic_index.py`：语义索引与检索辅助。
- `tests/test_command_service.py`：后台命令与任务状态。

## 前端测试

执行命令：

```bash
cd frontend
npm run lint
npm run build
```

最近一次结果：

- `npm run lint`：0 errors，保留少量既有 warning。
- `npm run build`：通过。

前端重点检查：

- 学习工作台页面可渲染。
- Studio 资产入口可见。
- 模型设置页可配置 API key 和默认模型。
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

## Docker 构建说明

执行命令：

```bash
docker compose build zhixue
```

当前环境中 Docker 构建失败在 Debian apt 包下载阶段，错误为上游 `deb.debian.org` 返回 `502 Bad Gateway`。Dockerfile 已加入 `Acquire::Retries=5`，但外部包源在测试时仍不稳定。

该失败发生在系统依赖下载阶段，尚未进入应用代码构建，不代表前后端代码编译失败。前端 production build 和 Python 测试均已通过。

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

截图见 `docs/assets/`。

## 已知风险

- 多模态视频/动画暂未接入昂贵的视频生成模型，当前以讲解文档、导图、题库、代码实验和播客音频为主要多模态资源。
- Docker 构建依赖外部 apt 与 npm 源，弱网络环境可能需要镜像源。
- 语音模型市场中部分模型名称相近，系统已增加 TTS protocol spec 与 warning，但仍建议在演示前确认默认 TTS 模型。
