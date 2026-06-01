import {
  ArrowLeft,
  Mic,
  MoreHorizontal,
  Paperclip,
  Send,
  ShieldCheck,
  Smile,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "../components/Avatar.jsx";
import { decryptEnvelope } from "../lib/e2ee.js";
import {
  formatMessageDate,
  formatMessageTime,
  getDateKey,
  getDialogReceiver,
  getDialogReceiverProfile,
  getUserDisplayName,
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

export function DialogPage({
  api,
  dialogId,
  dialogs,
  me,
  e2ee,
  realtimeMessage,
  deliveryStatus,
  onSendMessage,
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
  const receiverName = getUserDisplayName(receiverProfile) || receiver;
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef(null);

  const loadMessages = useCallback(async () => {
    setError("");
    setIsLoading(true);

    try {
      const rawMessages = await api.readMessages(dialogId);
      const decodedMessages = await Promise.all(
        rawMessages.map(async (message) => ({
          ...message,
          text: await decryptEnvelope(
            message.ciphertext,
            me.username,
            e2ee.keyPair,
          ),
        })),
      );

      setMessages(decodedMessages);

      try {
        await api.markDialogRead(dialogId);
        await onRefreshDialogs();
      } catch {
        // Старый backend мог еще не поддерживать read-ручку
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

  async function handleSend(event) {
    event.preventDefault();
    const text = messageText.trim();
    if (!receiver || !text) {
      setError("Нужен получатель и текст сообщения");
      return;
    }

    setError("");
    setStatusText("Шифрую и отправляю");
    setIsSending(true);

    try {
      const delivery = await onSendMessage(receiver, text);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: delivery.message_id,
          dialog_id: delivery.dialog_id,
          sender_username: me.username,
          text,
          status: delivery.status,
          created_at: delivery.created_at,
        },
      ]);
      setMessageText("");
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
          username={receiver || dialog.members[0]}
          size="large"
          avatarId={receiverProfile?.avatar_id}
          avatarDataUrl={receiverProfile?.avatar_data_url}
        />
        <div className="conversation-title">
          <h2>{receiverName || dialog.members.join(", ")}</h2>
          <p>
            <span className="online-dot" />
            Защищенный диалог
          </p>
        </div>
        <div className="conversation-actions">
          <button className="icon-button glass-button" type="button" title="Меню">
            <MoreHorizontal size={19} aria-hidden="true" />
          </button>
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

          return (
            <div className="message-row" key={message.id}>
              {showDateDivider ? (
                <div className="date-divider">
                  <span>{formatMessageDate(message.created_at)}</span>
                </div>
              ) : null}

              <article className={`message${isOwn ? " own" : ""}`}>
                <p className="message-text">{message.text}</p>
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
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <form className="message-form" onSubmit={handleSend}>
        <button className="icon-button glass-button" type="button" title="Вложение">
          <Paperclip size={20} aria-hidden="true" />
        </button>
        <input
          type="text"
          placeholder="Сообщение"
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
        />
        <button className="icon-button glass-button" type="button" title="Эмодзи">
          <Smile size={20} aria-hidden="true" />
        </button>
        <button className="icon-button glass-button" type="button" title="Голос">
          <Mic size={20} aria-hidden="true" />
        </button>
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
