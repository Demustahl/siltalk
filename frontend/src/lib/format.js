export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function getDialogReceiver(dialog, currentUsername) {
  return dialog.members.find((member) => member !== currentUsername) || "";
}

export function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString();
}

export function getDateKey(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

export function formatMessageDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatMessageTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function messageStatusLabel(status) {
  const labels = {
    sending: "отправляется",
    sent: "отправлено",
    delivered: "доставлено",
    read: "прочитано",
  };

  return labels[status] || status || "";
}
