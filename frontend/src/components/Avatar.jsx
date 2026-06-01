import { getPresetAvatarSrc } from "../lib/avatars.js";

function getInitial(username) {
  return (username || "?").trim().slice(0, 1).toUpperCase();
}

function getAvatarHue(username) {
  let hash = 0;
  for (const letter of username || "") {
    hash = (hash * 31 + letter.charCodeAt(0)) % 360;
  }

  return hash;
}

export function Avatar({
  username,
  size = "medium",
  online = false,
  avatarId = "",
  avatarDataUrl = "",
}) {
  const avatarSrc = avatarDataUrl || getPresetAvatarSrc(avatarId);

  return (
    <span
      className={`avatar avatar-${size}${online ? " online" : ""}`}
      style={{ "--avatar-hue": getAvatarHue(username) }}
    >
      {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{getInitial(username)}</span>}
    </span>
  );
}
