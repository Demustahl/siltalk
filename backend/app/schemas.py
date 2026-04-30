import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)


class UserLogin(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DialogRead(BaseModel):
    id: uuid.UUID
    dialog_type: str
    title: str | None
    members: list[str]
    created_at: datetime


class MessageRead(BaseModel):
    id: uuid.UUID
    dialog_id: uuid.UUID
    sender_user_id: uuid.UUID
    sender_username: str
    ciphertext: str
    created_at: datetime
