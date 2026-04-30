from fastapi import FastAPI

from app.auth import router as auth_router
from app.realtime import router as realtime_router

app = FastAPI(title="Messenger API", version="0.1.0")
app.include_router(auth_router)
app.include_router(realtime_router)

@app.get("/health", tags=["system"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
