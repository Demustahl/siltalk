import {
  ArrowLeft,
  Check,
  ImagePlus,
  KeyRound,
  Save,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "../components/Avatar.jsx";
import { PRESET_AVATARS } from "../lib/avatars.js";
import { getUserDisplayName } from "../lib/format.js";

const AVATAR_IMAGE_SIZE = 320;
const MAX_AVATAR_DATA_URL_LENGTH = 300_000;
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    image.src = dataUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось открыть файл"));
    reader.readAsDataURL(file);
  });
}

async function fileToAvatarDataUrl(file) {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Поддерживаются PNG, JPEG и WebP");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(sourceDataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Браузер не смог обработать изображение");
  }

  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);

  canvas.width = AVATAR_IMAGE_SIZE;
  canvas.height = AVATAR_IMAGE_SIZE;
  context.fillStyle = "#071014";
  context.fillRect(0, 0, AVATAR_IMAGE_SIZE, AVATAR_IMAGE_SIZE);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_IMAGE_SIZE,
    AVATAR_IMAGE_SIZE,
  );

  for (const quality of [0.86, 0.72, 0.58]) {
    const avatarDataUrl = canvas.toDataURL("image/jpeg", quality);
    if (avatarDataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH) {
      return avatarDataUrl;
    }
  }

  throw new Error("Картинку не удалось достаточно сжать, выберите другой файл");
}

export function SettingsPage({ me, e2ee, onUpdateProfile, navigate }) {
  const [displayName, setDisplayName] = useState(me.display_name || "");
  const [avatarId, setAvatarId] = useState(me.avatar_id || "");
  const [avatarDataUrl, setAvatarDataUrl] = useState(me.avatar_data_url || "");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setDisplayName(me.display_name || "");
    setAvatarId(me.avatar_id || "");
    setAvatarDataUrl(me.avatar_data_url || "");
  }, [me]);

  async function handleImageChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError("");
    setStatusText("");
    setIsProcessingImage(true);

    try {
      const nextAvatarDataUrl = await fileToAvatarDataUrl(file);
      setAvatarDataUrl(nextAvatarDataUrl);
      setAvatarId("");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsProcessingImage(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setError("");
    setStatusText("");
    setIsSaving(true);

    try {
      await onUpdateProfile({
        display_name: displayName.trim() || null,
        avatar_id: avatarDataUrl ? null : avatarId || null,
        avatar_data_url: avatarDataUrl || null,
      });
      setStatusText("Профиль сохранен");
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-surface settings-page">
      <header className="page-header settings-header">
        <button
          className="icon-button header-back"
          type="button"
          title="Назад"
          onClick={() => navigate("/dialogs")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">Личный кабинет</p>
          <h2>Настройки</h2>
        </div>
        <span className="settings-secure-pill">
          <ShieldCheck size={15} aria-hidden="true" />
          E2EE включено
        </span>
      </header>

      <form className="settings-grid" onSubmit={handleSave}>
        <section className="settings-card profile-settings-card">
          <div className="settings-card-heading">
            <span className="settings-icon">
              <UserRound size={20} aria-hidden="true" />
            </span>
            <div>
              <h3>Профиль</h3>
              <p>Имя и аватар видны собеседникам в поиске и диалогах.</p>
            </div>
          </div>

          <div className="profile-editor">
            <Avatar
              username={me.username}
              size="large"
              avatarId={avatarId}
              avatarDataUrl={avatarDataUrl}
            />
            <div className="profile-editor-fields">
              <strong>{getUserDisplayName(me)}</strong>
              <span>@{me.username}</span>
            </div>
          </div>

          <label>
            Отображаемое имя
            <input
              type="text"
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <span className="settings-icon">
              <ImagePlus size={20} aria-hidden="true" />
            </span>
            <div>
              <h3>Аватар</h3>
              <p>Можно выбрать готовую картинку или загрузить свою.</p>
            </div>
          </div>

          <div className="avatar-options">
            {PRESET_AVATARS.map((avatar) => (
              <button
                className={`avatar-choice${
                  avatarId === avatar.id && !avatarDataUrl ? " active" : ""
                }`}
                key={avatar.id}
                type="button"
                title={avatar.label}
                onClick={() => {
                  setAvatarId(avatar.id);
                  setAvatarDataUrl("");
                  setStatusText("");
                  setError("");
                }}
              >
                <img src={avatar.src} alt="" />
                {avatarId === avatar.id && !avatarDataUrl ? (
                  <span>
                    <Check size={14} aria-hidden="true" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="custom-avatar-actions">
            <input
              className="visually-hidden"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageChange}
            />
            <button
              className="glass-button"
              type="button"
              disabled={isProcessingImage}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={18} aria-hidden="true" />
              {isProcessingImage ? "Обрабатываю" : "Загрузить свою"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setAvatarId("");
                setAvatarDataUrl("");
              }}
            >
              <X size={18} aria-hidden="true" />
              Убрать аватар
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <span className="settings-icon">
              <KeyRound size={20} aria-hidden="true" />
            </span>
            <div>
              <h3>Шифрование</h3>
              <p>Приватный ключ остается в браузере и не уходит на backend.</p>
            </div>
          </div>

          <dl className="settings-facts">
            <div>
              <dt>Публичный ключ</dt>
              <dd>{e2ee?.publicKey ? "Опубликован" : "Не готов"}</dd>
            </div>
            <div>
              <dt>Приватный ключ</dt>
              <dd>Хранится локально</dd>
            </div>
            <div>
              <dt>Сообщения</dt>
              <dd>В БД сохраняется только ciphertext</dd>
            </div>
          </dl>
        </section>

        <div className="settings-actions">
          <span className="settings-action-status">
            {statusText ? <span className="status-line success">{statusText}</span> : null}
            {error ? <span className="status-line error">{error}</span> : null}
          </span>
          <button
            className="ghost-button"
            type="button"
            onClick={() => navigate("/dialogs")}
          >
            Отмена
          </button>
          <button type="submit" disabled={isSaving || isProcessingImage}>
            <Save size={18} aria-hidden="true" />
            {isSaving ? "Сохраняю" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}
