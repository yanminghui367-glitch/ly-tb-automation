"""Command-line entry point for the local application service."""

from __future__ import annotations

import uvicorn
from dotenv import load_dotenv

from .config import Settings


def run() -> None:
    """Load local configuration and start Uvicorn with matching bind settings."""

    load_dotenv()
    settings = Settings.from_env()
    uvicorn.run(
        "ly_tb_automation.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
    )


if __name__ == "__main__":
    run()
