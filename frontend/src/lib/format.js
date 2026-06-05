export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function getDialogReceiver(dialog, currentUsername) {
  const receiverProfile = getDialogReceiverProfile(dialog, currentUsername);

  return (
    receiverProfile?.username ||
    dialog.members.find((member) => member !== currentUsername) ||
    ""
  );
}

export function getDialogReceiverProfile(dialog, currentUsername) {
  return (
    (dialog.member_profiles || []).find(
      (member) => member.username !== currentUsername,
    ) || null
  );
}

function getDialogMemberProfile(dialog, username) {
  return (
    (dialog.member_profiles || []).find(
      (member) => member.username === username,
    ) || null
  );
}

export function getUserDisplayName(user) {
  return user?.display_name || user?.username || "";
}

export function isGroupDialog(dialog) {
  return dialog?.dialog_type === "group";
}

export function getDialogDisplayName(dialog, currentUsername) {
  if (!dialog) {
    return "";
  }
  if (isGroupDialog(dialog)) {
    return dialog.title || dialog.members.join(", ");
  }

  const receiverProfile = getDialogReceiverProfile(dialog, currentUsername);
  const receiver = getDialogReceiver(dialog, currentUsername);

  return getUserDisplayName(receiverProfile) || receiver || dialog.members.join(", ");
}

export function getDialogSubtitle(dialog, currentUsername) {
  if (!dialog) {
    return "";
  }
  if (!isGroupDialog(dialog)) {
    return "E2EE диалог";
  }

  const memberCount = dialog.members.length;
  return `${memberCount} участников`;
}

function getAttachmentPreview(attachments = []) {
  if (attachments.length === 0) {
    return "";
  }
  if (attachments.length === 1) {
    return attachments[0]?.name ? `Файл: ${attachments[0].name}` : "Файл";
  }

  return `Файлы: ${attachments.length}`;
}

export function getDialogPreview(dialog, currentUsername) {
  const lastMessage = dialog?.last_message;
  if (!lastMessage) {
    return getDialogSubtitle(dialog, currentUsername);
  }

  const content =
    lastMessage.text?.trim() || getAttachmentPreview(lastMessage.attachments);
  if (!content) {
    return "Зашифрованное сообщение";
  }

  if (lastMessage.sender_username === currentUsername) {
    return `Вы: ${content}`;
  }
  if (isGroupDialog(dialog)) {
    const senderProfile = getDialogMemberProfile(dialog, lastMessage.sender_username);
    const senderName = getUserDisplayName(senderProfile) || lastMessage.sender_username;

    return `${senderName}: ${content}`;
  }

  return content;
}

export function formatDateTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString();
}

export function formatDialogDateTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
