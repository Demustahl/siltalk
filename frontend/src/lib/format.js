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

export function messageStatusLabel(status) {
  const labels = {
    sending: "отправляется",
    sent: "отправлено",
    delivered: "доставлено",
    read: "прочитано",
  };

  return labels[status] || status || "";
}
