import asyncio

import httpx
from app.main import app


async def get_healthcheck() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/health")


def test_healthcheck() -> None:
    response = asyncio.run(get_healthcheck())

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
