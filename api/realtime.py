import asyncio

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    @property
    def connection_count(self) -> int:
        return len(self._conns)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conns.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._conns.discard(ws)

    async def broadcast(self, data: dict) -> None:
        async with self._lock:
            conns = list(self._conns)

        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._conns.discard(ws)


ws_manager = ConnectionManager()
