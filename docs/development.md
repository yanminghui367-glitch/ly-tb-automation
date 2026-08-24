# 本地开发与检查

## 环境要求

- Python 3.12 或更高版本
- Windows 为目标运行环境；Linux/macOS 可用于开发和自动化测试

## Windows 一键启动

在 PowerShell 中运行：

```powershell
.\scripts\start-dev.ps1
```

脚本会创建 `.venv`、按照 `requirements-dev.lock` 安装已验证的开发依赖、从 `.env.example` 创建本地 `.env`，然后读取该文件并仅在配置的本机地址启动开发服务。首次启动后应修改 `.env` 中的密钥；不要提交 `.env`。

## 手动启动

```bash
python -m venv .venv
python -m pip install -r requirements-dev.lock
python -m pip install --no-build-isolation --no-deps -e .
python -m ly_tb_automation.cli
```

访问：

- 管理后台：`http://127.0.0.1:8000/`
- 健康检查：`http://127.0.0.1:8000/health`
- 开发 API 文档：`http://127.0.0.1:8000/api/docs`

## 自动化检查

```bash
ruff check .
ruff format --check .
mypy
pytest
```

## 数据目录

默认运行数据写入仓库根目录下的 `data/`，该目录已被 Git 忽略。部署时通过 `LYTB_DATA_DIR` 指向代码仓库之外的受控目录。

SQLite 会在启动时执行只向前迁移。已经应用的 SQL 迁移文件不得修改；需要改变结构时必须新增迁移。

目的地数据的 Excel 字段及错误码见 [目的地 Excel 导入](destination-import.md)。
