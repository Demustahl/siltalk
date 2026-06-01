import { ArrowLeft, KeyRound, Search, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "../components/Avatar.jsx";
import { normalizeUsername } from "../lib/format.js";

export function NewDialogPage({
  api,
  initialUsername,
  onSendMessage,
  onRefreshDialogs,
  navigate,
}) {
  const [query, setQuery] = useState(initialUsername || "");
  const [selectedUsername, setSelectedUsername] = useState(initialUsername || "");
  const [results, setResults] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setQuery(initialUsername || "");
    setSelectedUsername(initialUsername || "");
  }, [initialUsername]);

  async function handleSearch(event) {
    event.preventDefault();
    const username = normalizeUsername(query);
    if (!username) {
      return;
    }

    setError("");
    setIsSearching(true);

    try {
      const foundUsers = await api.searchUsers(username);
      setResults(foundUsers);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    const receiver = normalizeUsername(selectedUsername);
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
      setMessageText("");
      setStatusText("");
      await onRefreshDialogs();
      navigate(`/dialogs/${delivery.dialog_id}`);
    } catch (caughtError) {
      setError(caughtError.message);
      setStatusText("");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="page-surface">
      <header className="page-header">
        <button
          className="icon-button header-back"
          type="button"
          title="Назад"
          onClick={() => navigate("/dialogs")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">Новый диалог</p>
          <h2>Поиск пользователя</h2>
        </div>
      </header>

      <form className="search-form" onSubmit={handleSearch}>
        <label>
          Username
          <input
            type="text"
            minLength={1}
            maxLength={64}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isSearching}>
          <Search size={18} aria-hidden="true" />
          {isSearching ? "Ищу" : "Найти"}
        </button>
      </form>

      <div className="search-results">
        {results.map((user) => (
          <button
            className="user-result"
            key={user.id}
            type="button"
            disabled={!user.has_public_key}
            onClick={() => setSelectedUsername(user.username)}
          >
            <Avatar username={user.username} size="small" />
            <span>
              <strong>{user.username}</strong>
              {user.display_name ? <small>{user.display_name}</small> : null}
            </span>
            <span className={user.has_public_key ? "key-ok" : "key-missing"}>
              <KeyRound size={15} aria-hidden="true" />
              {user.has_public_key ? "ключ есть" : "нет ключа"}
            </span>
          </button>
        ))}
      </div>

      <form className="compose-panel" onSubmit={handleSend}>
        <div className="compose-heading">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Сообщение будет зашифровано перед отправкой</span>
        </div>
        <label>
          Получатель
          <input
            type="text"
            minLength={3}
            maxLength={64}
            value={selectedUsername}
            onChange={(event) => setSelectedUsername(event.target.value)}
          />
        </label>
        <label>
          Сообщение
          <textarea
            rows={4}
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isSending}>
          <Send size={18} aria-hidden="true" />
          {isSending ? "Отправляю" : "Отправить"}
        </button>
      </form>

      {statusText ? <p className="status-line">{statusText}</p> : null}
      {error ? <p className="status-line error">{error}</p> : null}
    </div>
  );
}
