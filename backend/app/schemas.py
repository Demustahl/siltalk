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
    avatar_id: str | None
    avatar_data_url: str | None
    created_at: datetime


class UserProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    avatar_id: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_data_url: str | None = Field(default=None, max_length=300_000)


class UserPublicRead(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    avatar_id: str | None
    avatar_data_url: str | None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PublicKeyPublish(BaseModel):
    public_key: str = Field(min_length=20, max_length=200)
    device_name: str | None = Field(default="browser", max_length=120)


class PublicKeyRead(BaseModel):
    username: str
    device_id: uuid.UUID
    public_key: str
    updated_at: datetime


class DialogLastMessageRead(BaseModel):
    id: uuid.UUID
    sender_username: str
    ciphertext: str
    created_at: datetime


class DialogRead(BaseModel):
    id: uuid.UUID
    dialog_type: str
    title: str | None
    members: list[str]
    member_profiles: list[UserPublicRead]
    unread_count: int
    last_message: DialogLastMessageRead | None
    created_at: datetime


class GroupDialogCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    member_usernames: list[str] = Field(min_length=1, max_length=20)


class MessageRead(BaseModel):
    id: uuid.UUID
    dialog_id: uuid.UUID
    sender_user_id: uuid.UUID
    sender_username: str
    ciphertext: str
    status: str
    created_at: datetime


class AttachmentRead(BaseModel):
    id: uuid.UUID
    encrypted_size: int
    created_at: datetime


class DialogReadMark(BaseModel):
    dialog_id: uuid.UUID
    marked_read_count: int


class UserSearchRead(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    avatar_id: str | None
    avatar_data_url: str | None
    has_public_key: bool
