from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Messenger API", version="0.1.0")


@app.get("/health", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_echo(websocket: WebSocket) -> None:
    # Принимаем соединение и отправляем клиенту тот же текст обратно.
    await websocket.accept()

    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_text(message)
    except WebSocketDisconnect:
        # Клиент закрыл соединение. Для MVP здесь ничего больше не нужно.
        pass
