# BOTC Bench Storyteller Workspace

一个本地运行的《血染钟楼》说书人局面编辑器与推理 benchmark。前端使用 React + TypeScript，后端使用 FastAPI + SQLite；“Codex 辅助”按钮通过后端受控调用本机 `codex exec`，只在只读沙箱中分析当前局面。

## 功能

- 在三大官方基础剧本间切换：Trouble Brewing / 暗流涌动、Bad Moon Rising / 黯月初升、Sects & Violets / 梦殒春宵。
- 创建 5–20 人局面，维护角色配比、座次、玩家名、真实角色、阵营、生死与多种状态标记。
- 将草稿保存到本机 SQLite，刷新后继续编辑。
- 把当前局面和问题交给本机 Codex 做配比检查、矛盾分析或说书人辅助；Codex 无权直接修改局面。
- 官方英文角色文本与 TPI 官方简体中文文本并列保留；剧本、规则、FAQ 的原始链接集中存放在相邻 `reference/` 目录。

## 本地运行

需要 Python 3.9+、[uv](https://docs.astral.sh/uv/)、Node.js 22.12+ 和已经登录的 Codex CLI。

```bash
uv sync --dev
cd frontend && npm install
```

分别启动后端与前端：

```bash
uv run uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 会将 `/api` 代理到 FastAPI。生产构建后，FastAPI 也会自动托管 `frontend/dist`。

默认启用本地 Codex harness；可通过环境变量关闭或调整超时：

```bash
CODEX_HARNESS_ENABLED=false
CODEX_HARNESS_TIMEOUT_SECONDS=120
CODEX_MODEL=gpt-5.6-terra
```

调用固定使用一次性的 `codex exec --ephemeral --sandbox read-only`，不接受来自浏览器的命令、模型或目录参数。后端只读取当前剧本的四份白名单资料并把正文内联到提示词；Codex 在空临时目录中启动、忽略用户配置，并关闭 shell、插件、Apps、浏览器、计算机控制、图像、技能搜索与网页搜索能力。进程只继承登录和网络连接所需的最小环境变量，继续使用正常 Codex 凭据存储以支持令牌刷新；同一时间最多运行一个本地 Codex 进程。

## 数据与来源

- 官方双语角色表由 `backend/tools/sync_official_data.py` 生成。
- 更新来源索引：`python3 tools/update_reference_links.py`。
- 仓库级维护规则见 [AGENTS.md](AGENTS.md)，规则来源见 [reference/README.md](reference/README.md)，各剧本来源见对应 `scripts/script-*/reference/README.md`。

## 测试

```bash
uv run pytest
uv run ruff check backend
cd frontend && npm test && npm run build
```

## 使用范围

这是本地、个人用途的开发工具，不应公开部署或作为公开数字版游戏分发。TPI 的数字工具与素材使用限制见其[官方 Legal & Terms of Use](https://bloodontheclocktower.com/pages/terms-of-use)。本项目与 The Pandemonium Institute 无隶属或背书关系。
