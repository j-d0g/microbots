"""Optional: runtime log drain — exposes a local HTTP endpoint via ngrok.

Render can be configured to POST each log line to a public URL; this
module stands up the matching receiver. ``pyngrok`` is imported lazily
so the rest of the SDK doesn't require it.
"""

from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Optional

logger = logging.getLogger("render_sdk")


def _make_handler(callback: Callable[[str], None]) -> type[BaseHTTPRequestHandler]:
    """Return a handler class bound to ``callback`` via closure.

    Using a closure keeps per-instance state out of class-level attributes
    and avoids cross-talk between two simultaneously-running drains.
    """

    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 — required by BaseHTTPRequestHandler
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8", errors="replace")
            for line in body.splitlines():
                if line.strip():
                    callback(f"[app log] {line}")
            self.send_response(200)
            self.end_headers()

        # Silence the default noisy access logging.
        def log_message(self, *args, **kwargs) -> None:  # noqa: D401
            return

    return _Handler


class LocalLogDrain:
    """Start a local HTTP server to receive log drain POSTs from Render.

    Requires ``ngrok`` to expose the local port publicly.

    Usage::

        drain = LocalLogDrain(callback=print)
        public_url = drain.start()
        # Configure Render's log-stream to POST to ``public_url``.
        ...
        drain.stop()
    """

    def __init__(self, callback: Callable[[str], None] = print, port: int = 0):
        self.callback = callback
        self.port = port  # 0 -> OS picks a free port
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self.public_url: Optional[str] = None

    def start(self) -> str:
        """Start the local drain and open an ngrok tunnel.

        Returns the public HTTPS URL Render should POST to.
        """
        try:
            from pyngrok import ngrok  # type: ignore[import-not-found]
        except ImportError as e:
            raise ImportError(
                "pyngrok is required for runtime log drain. "
                "Install it: pip install pyngrok"
            ) from e

        handler_cls = _make_handler(self.callback)
        self._server = HTTPServer(("0.0.0.0", self.port), handler_cls)
        self.port = self._server.server_address[1]  # Resolve OS-assigned port.

        self._thread = threading.Thread(
            target=self._server.serve_forever, daemon=True
        )
        self._thread.start()

        tunnel = ngrok.connect(self.port, "http")
        self.public_url = tunnel.public_url.replace("http://", "https://")
        logger.info(
            "[log_drain] Listening on port %d, public URL: %s",
            self.port, self.public_url,
        )
        return self.public_url

    def stop(self) -> None:
        """Shut down the local server and close the ngrok tunnel."""
        if self.public_url:
            try:
                from pyngrok import ngrok  # type: ignore[import-not-found]
                ngrok.disconnect(self.public_url)
            except Exception:  # noqa: BLE001 — best effort on teardown
                pass
        if self._server:
            self._server.shutdown()
            self._server = None
        logger.info("[log_drain] Stopped.")
