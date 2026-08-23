"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import Settings
from .database import database_health, migrate
from .logging import configure_logging

PACKAGE_DIR = Path(__file__).parent


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an isolated application instance for runtime or tests."""

    current_settings = settings or Settings.from_env()
    configure_logging(current_settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> Any:
        current_settings.data_dir.mkdir(parents=True, exist_ok=True)
        migrate(current_settings.database_path)
        yield

    app = FastAPI(
        title="ly-tb-automation",
        version="0.1.0",
        docs_url="/api/docs" if current_settings.environment != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = current_settings
    app.mount("/static", StaticFiles(directory=PACKAGE_DIR / "static"), name="static")
    templates = Jinja2Templates(directory=PACKAGE_DIR / "templates")

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        status = "ok" if database_health(current_settings.database_path) else "error"
        return {"status": status, "database": status}

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def dashboard(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request=request,
            name="dashboard.html",
            context={
                "environment": current_settings.environment,
                "database_ok": database_health(current_settings.database_path),
            },
        )

    return app


app = create_app()
