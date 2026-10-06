"""Einstieg: ``python -m panelstudio``."""

import asyncio
import logging
import os

from .server import run


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s (%(name)s) %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    asyncio.run(run(int(os.environ.get("PMPS_PORT", "8099")), int(os.environ.get("PMPS_PANEL_PORT", "8098"))))


if __name__ == "__main__":
    main()
