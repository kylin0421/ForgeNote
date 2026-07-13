# Windows 安装包

该目录用于生成无需 Docker、Python 或 Node.js 的 Windows x64 发行版。最终安装包中包含：

- `ZhiXue.exe`：图形启动器、FastAPI 和任务 worker
- pywebview 桌面壳，通过系统 Edge WebView2 显示现有 Next.js 界面
- Next.js standalone 前端和 Node.js 22
- SurrealDB 2.6.5
- FFmpeg 8.1.2
- 离线 tiktoken 编码缓存

## 用户启动流程

双击“智学工坊”后会直接出现独立应用窗口。窗口先显示启动状态，依次检查端口并启动数据库、API、worker 和前端；全部健康后在同一个 WebView2 窗口内加载界面，不会打开外部浏览器。关闭应用窗口会同时关闭这些本地子进程。

WebView2 Runtime 是 Windows 11 和新版 Edge 的系统组件，未重复打入安装包。极少数精简版 Windows 如果缺失，需要先安装 Microsoft Edge WebView2 Runtime；启动器会显示明确错误，而不是抛出 Python 异常窗口。

配置和用户数据保存在 `%LOCALAPPDATA%\ZhiXue`，不写入安装目录：

```text
config.env       稳定的凭据加密密钥和数据库配置
data/            上传文件、SQLite 检查点和应用数据
surrealdb/       SurrealDB 数据库
logs/            各组件启动与运行日志
```

首次启动会自动生成 `config.env`。保存 API key 后不要删除或更换其中的 `OPEN_NOTEBOOK_ENCRYPTION_KEY`。

## 构建

构建机需要 Windows x64、Python 3.12、uv、Node.js 22/npm，以及用于生成 Setup.exe 的 Inno Setup 6。

```powershell
winget install JRSoftware.InnoSetup
powershell -ExecutionPolicy Bypass -File .\desktop\windows\build.ps1 -Version 0.1.1
```

构建脚本会按锁文件构建前端、冻结 Python 运行时、下载并校验固定版本的外部二进制，然后生成：

```text
dist/windows/ZhiXue/                 可直接运行的目录版
dist/windows/ZhiXue-Setup-0.1.1.exe  Windows 安装包
```

开发时已有 `node_modules` 可使用 `-SkipDependencyInstall`。如需额外生成便携 ZIP，可传入 `-PortableZip`；Windows 自带压缩器处理大量小文件时会比较慢。
如果外部运行时下载或安装器编译失败，而 PyInstaller 冻结已经完成，可修复问题后传入 `-ResumeAfterFreeze` 从组装阶段继续。

## 自动验证

构建后可在临时数据目录执行完整启动烟雾测试：

```powershell
$process = Start-Process `
  -FilePath .\dist\windows\ZhiXue\ZhiXue.exe `
  -ArgumentList '--smoke-test', '--data-dir', '.\.build\smoke-data' `
  -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Smoke test failed" }
```

如果启动失败，优先查看指定数据目录下的 `logs` 文件夹。固定端口 `8000`、`5055`、`8502` 被其他程序占用时，启动器会直接提示冲突。
