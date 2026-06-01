import { ArrowLeft, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatDateTime,
  getDialogReceiver,
  messageStatusLabel,
} from "../lib/format.js";
import { decryptEnvelope } from "../lib/e2ee.js";

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
  const receiver = dialog ? getDialogReceiver(dialog, me.username) : "";
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

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === deliveryStatus.message_id
          ? { ...message, status: deliveryStatus.status }
          : message,
      ),
    );
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
          className="ghost-button text-icon"
          type="button"
          onClick={() => navigate("/dialogs")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Назад
        </button>
        <div>
          <p className="eyebrow">Диалог</p>
          <h2>{receiver || dialog.members.join(", ")}</h2>
        </div>
      </header>

      <div className="messages-list">
        {isLoading ? <div className="empty-state">Загружаю</div> : null}
        {!isLoading && messages.length === 0 ? (
          <div className="empty-state">История пустая</div>
        ) : null}

        {messages.map((message) => {
          const isOwn = message.sender_username === me.username;

          return (
            <article className={`message${isOwn ? " own" : ""}`} key={message.id}>
              <p className="message-meta">
                <span>{message.sender_username}</span>
                <span>{formatDateTime(message.created_at)}</span>
              </p>
              <p className="message-text">{message.text}</p>
              {isOwn ? (
                <p className="message-status">
                  {messageStatusLabel(message.status)}
                </p>
              ) : null}
            </article>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <form className="message-form" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="Сообщение"
          value={messageText}
          onChange={(event) => setMessageText(event.target.value)}
        />
        <button type="submit" disabled={isSending}>
          <Send size={18} aria-hidden="true" />
          {isSending ? "Отправляю" : "Отправить"}
        </button>
      </form>

      <div className="conversation-status">
        {statusText ? <p className="status-line">{statusText}</p> : null}
        {error ? <p className="status-line error">{error}</p> : null}
      </div>
    </div>
  );
}
