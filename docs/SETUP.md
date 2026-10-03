# 安装与运行

当前可复现路径是 **macOS Apple Silicon 源码运行**。Windows／Linux 和签名安装包尚未验收。命令中的目录都是相对于仓库，不依赖维护者电脑上的私人路径。

## 环境

- Git（用于获取源码）。
- Node.js 22.13+ 或 24；当前本机验证使用 22.23.2。
- Bun 1.3.9。
- uv 0.12.9 与 Python 3.12（uv 可准备 Python）。
- 首次安装需要网络和足够的本地磁盘空间。

从相应工具的官方安装说明准备环境，不将模型密钥写进脚本或提交到 Git。可使用 `ORIGIN_NODE`、`ORIGIN_BUN`、`ORIGIN_UV` 指定已有可执行文件。

## 安装、构建、启动

```sh
git clone https://github.com/wzy11p/origin-workbench.git
cd origin-workbench
./scripts/setup.sh --check
./scripts/setup.sh
./scripts/build.sh
./scripts/verify.sh
./启动原点工作台.command
```

`setup.sh --check` 只检查前置条件。完整安装会按 `desktop/bun.lock` 安装依赖、准备 Electron 44.4.5 并验证内置 SQLite 读写、创建轻量文档解析环境、下载并校验 AionCore v0.2.2。安装不会打开应用窗口。

解析器安装 `docling-slim==2.129.0` 的轻量组件，版本与文件哈希由 `workers/requirements.txt` 固定。它使用本机 OCR，不安装 Torch 或大型模型权重。首次安装的网络下载速度取决于访问源站的情况。

双击 `启动原点工作台.command` 也能启动。构建或依赖缺失时按提示先运行安装和构建，不要把启动失败误认为数据已丢失。

## 本机目录

| 目录 | 内容 | 是否提交 Git |
|---|---|---|
| `desktop/`、`vendor/`、`workers/` | 应用、集成组件与解析适配器源码 | 是 |
| `desktop/node_modules/` | JavaScript 依赖与 Electron | 否 |
| `runtime/` | 文档解析 Python 环境与后端 | 否 |
| `desktop/out/` | 生产构建输出 | 否 |
| `data/` | 项目资料、原件、日志与备份 | 否 |

`ORIGIN_DATA_DIR` 可指定新的项目数据目录；更换目录不会自动迁移旧资料。请先导出项目包，需要时再导入为新项目。底层会话与模型配置使用本项目独立的本地配置目录，不读取旧工作台的配置别名。项目包不等于所有设置备份。

## 开发与验证

`scripts/verify.sh` 按正常、对抗顺序执行安装脚本、产品服务、React 编辑流程、基础回归与资料解析测试。测试使用临时目录和合成资料。不会用你的日常项目做破坏性测试，也不需要弹出桌面测试窗口。

```sh
cd desktop
bun run test -- --maxWorkers=2
bun run test:coverage -- --maxWorkers=2
bun run lint -- --quiet
bun run format:check
```

新界面文案放在对应 locale 资源中，随后运行 `bun run i18n:types` 和 `node scripts/check-i18n.js`。完整推送入口是 `just push`，需要单独安装命令工具 just。

## 常见情况

- **找不到 node／bun／uv**：确认版本与 PATH，或通过 `ORIGIN_*` 指定。脚本不会无提示使用另一套版本。
- **后端校验失败**：本次下载不会替换原有有效后端，检查网络后重试。
- **画布依赖无法解析**：重新执行安装；画布组件通过安装脚本建立的相对依赖链接使用同一套锁定依赖。
- **PDF 只有部分文字**：查看解析状态与原件；空白页、扫描质量和复杂排版需要人工核对。
- **缺少模型配置**：先使用蓝图、需求与文档流程；需要评审时再配置自己的服务。
- **报错反馈**：通过仓库 Issues 自行提交脱敏描述，应用不会自动把日志、资料和截图上传到问题页。

公开仓库提供源码，不提供随时更新的在线服务。用户选择调用模型后，相应内容会离开本机并由所选服务处理。
