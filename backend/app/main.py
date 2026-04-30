from fastapi import FastAPI

from app.routes import register_routes

app = FastAPI(title="Messenger API", version="0.1.0")
register_routes(app)
