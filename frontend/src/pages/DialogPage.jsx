import {
  ArrowLeft,
  Download,
  Paperclip,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "../components/Avatar.jsx";
import {
  filterAttachmentFiles,
  formatFileSize,
  prepareEncryptedAttachments,
} from "../lib/attachments.js";
import { decryptAttachmentBlob, decryptMessageEnvelope } from "../lib/e2ee.js";
import {
  formatMessageDate,
  formatMessageTime,
  getDateKey,
  getDialogDisplayName,
  getDialogReceiver,
  getDialogReceiverProfile,
  getDialogSubtitle,
  getUserDisplayName,
  isGroupDialog,
  messageStatusLabel,
} from "../lib/format.js";

const MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

function shouldShowDateDivider(message, previousMessage) {
  if (!previousMessage) {
    return true;
  }

  return getDateKey(message.created_at) !== getDateKey(previousMessage.created_at);
}

function shouldShowMessageFooter(message, nextMessage) {
  if (!nextMessage) {
    return true;
  }
  if (message.sender_username !== nextMessage.sender_username) {
    return true;
  }
  if (getDateKey(message.created_at) !== getDateKey(nextMessage.created_at)) {
    return true;
  }

  const messageTime = new Date(message.created_at).getTime();
  const nextMessageTime = new Date(nextMessage.created_at).getTime();

  return nextMessageTime - messageTime > MESSAGE_GROUP_GAP_MS;
}

function getMessageSenderProfile(dialog, message, currentUser) {
  if (message.sender_username === currentUser.username) {
    return currentUser;
  }

  return (
    (dialog.member_profiles || []).find(
      (member) => member.username === message.sender_username,
    ) || {
      username: message.sender_username,
    }
  );
}

export function DialogPage({
  api,
  dialogId,
  dialogs,
  me,
  e2ee,
  realtimeMessage,
  deliveryStatus,
  onSendMessage,
  onSendDialogMessage,
  onRefreshDialogs,
  navigate,
}) {
  const dialog = useMemo(
    () => dialogs.find((item) => item.id === dialogId),
    [dialogs, dialogId],
  );
  const receiverProfile = dialog
    ? getDialogReceiverProfile(dialog, me.username)
    : null;
  const receiver = dialog ? getDialogReceiver(dialog, me.username) : "";
  const dialogName = dialog ? getDialogDisplayName(dialog, me.username) : "";
  const dialogSubtitle = dialog ? getDialogSubtitle(dialog, me.username) : "";
  const isGroup = isGroupDialog(dialog);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const loadMessages = useCallback(async () => {
    setError("");
    setIsLoading(true);

    try {
      const rawMessages = await api.readMessages(dialogId);
      const decodedMessages = await Promise.all(
        rawMessages.map(async (message) => {
          const decryptedMessage = await decryptMessageEnvelope(
            message.ciphertext,
            me.username,
            e2ee.keyPair,
          );

          return {
            ...message,
            ...decryptedMessage,
          };
        }),
      );

      setMessages(decodedMessages);

      try {
        await api.markDialogRead(dialogId);
        await onRefreshDialogs();
      } catch {
        // Старый backend мог еще не поддерживать read-ручку.
      }
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsLoading(false);
    }
  }, [api, dialogId, e2ee.keyPair, me.username, onRefreshDialogs]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!realtimeMessage || realtimeMessage.dialog_id !== dialogId) {
      return;
    }

    setMessages((currentMessages) => {
      if (currentMessages.some((message) => message.id === realtimeMessage.id)) {
        return currentMessages;
      }

      return [...currentMessages, realtimeMessage];
    });

    api
      .markDialogRead(dialogId)
      .then(onRefreshDialogs)
      .catch(() => undefined);
  }, [api, dialogId, onRefreshDialogs, realtimeMessage]);

  useEffect(() => {
    if (!deliveryStatus || deliveryStatus.dialog_id !== dialogId) {
      return;
    }

    setMessages((currentMessages) => {
      const readMessageIds = new Set(deliveryStatus.message_ids || []);
      let hasChanges = false;

      const nextMessages = currentMessages.map((message) => {
        const isStatusTarget =
          message.id === deliveryStatus.message_id || readMessageIds.has(message.id);
        if (!isStatusTarget || message.status === deliveryStatus.status) {
          return message;
        }

        hasChanges = true;
        return { ...message, status: deliveryStatus.status };
      });

      return hasChanges ? nextMessages : currentMessages;
    });
  }, [deliveryStatus, dialogId]);

  function handleFileSelect(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    setError("");
    setSelectedFiles((currentFiles) => {
      const nextFiles = filterAttachmentFiles(currentFiles, files);
      if (nextFiles.length < currentFiles.length + files.length) {
        setError("Часть файлов пропущена: максимум 5 файлов до 10 МБ каждый");
      }

      return nextFiles;
    });
  }

  async function handleDownloadAttachment(attachment) {
    setError("");
    setStatusText("Скачиваю и расшифровываю файл");

    try {
      const encryptedBuffer = await api.downloadAttachment(attachment.id);
      const blob = await decryptAttachmentBlob(encryptedBuffer, attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name || "attachment";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatusText("");
    } catch (caughtError) {
      setStatusText("");
      setError(caughtError.message);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    const text = messageText.trim();
    if (!dialog || (!isGroup && !receiver)) {
      setError("Диалог не найден");
      return;
    }
    if (!text && selectedFiles.length === 0) {
      setError("Нужен получатель и текст или файл");
      return;
    }

    setError("");
    setStatusText(
      selectedFiles.length > 0
        ? "Шифрую вложения и отправляю"
        : "Шифрую и отправляю",
    );
    setIsSending(true);

    try {
      const attachments = await prepareEncryptedAttachments(api, selectedFiles);
      const delivery = isGroup
        ? await onSendDialogMessage(dialog, text, attachments)
        : await onSendMessage(receiver, text, attachments);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: delivery.message_id,
          dialog_id: delivery.dialog_id,
          sender_username: me.username,
          text,
          attachments,
          status: delivery.status,
          created_at: delivery.created_at,
        },
      ]);
      setMessageText("");
      setSelectedFiles([]);
      setStatusText("");
      await onRefreshDialogs();
    } catch (caughtError) {
      setError(caughtError.message);
      setStatusText("");
    } finally {
      setIsSending(false);
    }
  }

  if (!dialog) {
    return (
      <div className="page-surface">
        <header className="page-header">
          <button
            className="ghost-button text-icon"
            type="button"
            onClick={() => navigate("/dialogs")}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Назад
          </button>
        </header>
        <div className="empty-state">Диалог не найден</div>
      </div>
    );
  }

  return (
    <div className="conversation-page">
      <header className="conversation-header">
        <button
          className="icon-button header-back"
          type="button"
          title="Назад"
          onClick={() => navigate("/dialogs")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <Avatar
          username={isGroup ? dialogName : receiver}
          size="large"
          avatarId={isGroup ? null : receiverProfile?.avatar_id}
          avatarDataUrl={isGroup ? null : receiverProfile?.avatar_data_url}
        />
        <div className="conversation-title">
          <h2>{dialogName || dialog.members.join(", ")}</h2>
          <p>
            <span className="online-dot" />
            {dialogSubtitle}
          </p>
        </div>
      </header>

      <div className="messages-list">
        <div className="encryption-banner">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>E2EE включено</span>
          <p>Только вы и собеседник видите эти сообщения.</p>
        </div>

        {isLoading ? <div className="empty-state">Загружаю</div> : null}
        {!isLoading && messages.length === 0 ? (
          <div className="empty-state">История пустая</div>
        ) : null}

        {messages.map((message, index) => {
          const previousMessage = messages[index - 1];
          const nextMessage = messages[index + 1];
          const isOwn = message.sender_username === me.username;
          const showDateDivider = shouldShowDateDivider(message, previousMessage);
          const showFooter = shouldShowMessageFooter(message, nextMessage);
          const senderProfile = getMessageSenderProfile(dialog, message, me);
          const senderName = getUserDisplayName(senderProfile);

          return (
            <div className="message-row" key={message.id}>
              {showDateDivider ? (
                <div className="date-divider">
                  <span>{formatMessageDate(message.created_at)}</span>
                </div>
              ) : null}

              <div className={`message-line${isOwn ? " own" : ""}`}>
                {!isOwn ? (
                  <Avatar
                    username={senderName || message.sender_username}
                    size="tiny"
                    avatarId={senderProfile.avatar_id}
                    avatarDataUrl={senderProfile.avatar_data_url}
                  />
                ) : null}

                <article className={`message${isOwn ? " own" : ""}`}>
                  {isGroup && !isOwn ? (
                    <p className="message-sender">{senderName}</p>
                  ) : null}
                  {message.text ? (
                    <p className="message-text">{message.text}</p>
                  ) : null}
                  {message.attachments?.length > 0 ? (
                    <div className="message-attachments">
                      {message.attachments.map((attachment) => (
                        <button
                          className="attachment-chip"
                          key={attachment.id}
                          type="button"
                          onClick={() => handleDownloadAttachment(attachment)}
                        >
                          <Download size={16} aria-hidden="true" />
                          <span>
                            <strong>{attachment.name || "Файл"}</strong>
                            <small>{formatFileSize(attachment.size)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {showFooter ? (
                    <p className="message-footer">
                      <span>{formatMessageTime(message.created_at)}</span>
                      {isOwn ? (
                        <span>{messageStatusLabel(message.status)}</span>
                      ) : null}
                    </p>
                  ) : null}
                </article>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <form className="message-form" onSubmit={handleSend}>
        {selectedFiles.length > 0 ? (
          <div className="selected-attachments">
            {selectedFiles.map((file, index) => (
              <span className="selected-attachment" key={`${file.name}-${index}`}>
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)}</small>
                </span>
                <button
                  className="icon-link"
                  type="button"
                  title="Убрать файл"
                  onClick={() => {
                    setSelectedFiles((currentFiles) =>
                      currentFiles.filter((_, fileIndex) => fileIndex !== index),
                    );
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          multiple
          onChange={handleFileSelect}
        />
        <button
          className="icon-button glass-button"
          type="button"
          title="Прикрепить файл"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={20} aria-hidden="true" />
        </button>
        <input
          type="text"
          placeholder="Сообщение"
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
        />
        <button className="send-button" type="submit" disabled={isSending}>
          <Send size={18} aria-hidden="true" />
          <span>{isSending ? "..." : "Отправить"}</span>
        </button>
      </form>

      <div className="conversation-status">
        {statusText ? <p className="status-line">{statusText}</p> : null}
        {error ? <p className="status-line error">{error}</p> : null}
      </div>
    </div>
  );
}
