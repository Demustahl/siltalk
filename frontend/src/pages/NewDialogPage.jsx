import {
  ArrowLeft,
  Check,
  KeyRound,
  Search,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "../components/Avatar.jsx";
import { getUserDisplayName, normalizeUsername } from "../lib/format.js";

function isSelectedUser(selectedUsers, username) {
  return selectedUsers.some((user) => user.username === username);
}

export function NewDialogPage({
  api,
  initialUsername,
  onSendMessage,
  onRefreshDialogs,
  navigate,
}) {
  const [mode, setMode] = useState("direct");
  const [query, setQuery] = useState(initialUsername || "");
  const [selectedUsername, setSelectedUsername] = useState(initialUsername || "");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [results, setResults] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setMode("direct");
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
    setHasSearched(true);
    setIsSearching(true);

    try {
      const foundUsers = await api.searchUsers(username);
      setResults(foundUsers.filter((user) => user.has_public_key));
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSearching(false);
    }
  }

  function toggleGroupUser(user) {
    setError("");
    setSelectedUsers((currentUsers) => {
      if (isSelectedUser(currentUsers, user.username)) {
        return currentUsers.filter((item) => item.username !== user.username);
      }

      return [...currentUsers, user];
    });
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

  async function handleCreateGroup(event) {
    event.preventDefault();
    const title = groupTitle.trim();
    const memberUsernames = selectedUsers.map((user) => user.username);

    if (!title || memberUsernames.length === 0) {
      setError("Нужно название группы и хотя бы один участник");
      return;
    }

    setError("");
    setStatusText("Создаю групповой диалог");
    setIsSending(true);

    try {
      const dialog = await api.createGroupDialog({
        title,
        member_usernames: memberUsernames,
      });
      setGroupTitle("");
      setSelectedUsers([]);
      setStatusText("");
      await onRefreshDialogs();
      navigate(`/dialogs/${dialog.id}`);
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
          <h2>{mode === "group" ? "Создание группы" : "Поиск пользователя"}</h2>
        </div>
      </header>

      <div className="mode-switch" role="tablist" aria-label="Тип диалога">
        <button
          className={mode === "direct" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("direct");
            setError("");
          }}
        >
          <Send size={17} aria-hidden="true" />
          Личный диалог
        </button>
        <button
          className={mode === "group" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("group");
            setError("");
          }}
        >
          <Users size={18} aria-hidden="true" />
          Группа
        </button>
      </div>

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
        {hasSearched && !isSearching && results.length === 0 ? (
          <div className="empty-state compact">
            Пользователей с доступным защищенным чатом не найдено
          </div>
        ) : null}

        {results.map((user) => {
          const isSelected = isSelectedUser(selectedUsers, user.username);

          return (
            <button
              className={`user-result${isSelected ? " selected" : ""}`}
              key={user.id}
              type="button"
              onClick={() => {
                if (mode === "group") {
                  toggleGroupUser(user);
                  return;
                }

                setSelectedUsername(user.username);
              }}
            >
              <Avatar
                username={user.username}
                size="small"
                avatarId={user.avatar_id}
                avatarDataUrl={user.avatar_data_url}
              />
              <span>
                <strong>{getUserDisplayName(user)}</strong>
                <small>@{user.username}</small>
              </span>
              <span className="key-ok">
                {mode === "group" && isSelected ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <KeyRound size={15} aria-hidden="true" />
                )}
                {mode === "group" && isSelected ? "Выбран" : "защищенный чат"}
              </span>
            </button>
          );
        })}
      </div>

      {mode === "direct" ? (
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
      ) : (
        <form className="compose-panel" onSubmit={handleCreateGroup}>
          <div className="compose-heading">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>В группе будут только участники с опубликованным ключом</span>
          </div>
          <label>
            Название группы
            <input
              type="text"
              minLength={1}
              maxLength={120}
              value={groupTitle}
              onChange={(event) => setGroupTitle(event.target.value)}
            />
          </label>
          <div className="selected-users">
            {selectedUsers.length === 0 ? (
              <p className="status-line">Выберите участников из результатов поиска</p>
            ) : null}

            {selectedUsers.map((user) => (
              <span className="selected-user" key={user.id}>
                <Avatar
                  username={user.username}
                  size="tiny"
                  avatarId={user.avatar_id}
                  avatarDataUrl={user.avatar_data_url}
                />
                <span>
                  <strong>{getUserDisplayName(user)}</strong>
                  <small>@{user.username}</small>
                </span>
                <button
                  className="icon-link"
                  type="button"
                  title="Убрать участника"
                  onClick={() => toggleGroupUser(user)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <button type="submit" disabled={isSending}>
            <Users size={18} aria-hidden="true" />
            {isSending ? "Создаю" : "Создать группу"}
          </button>
        </form>
      )}

      {statusText ? <p className="status-line">{statusText}</p> : null}
      {error ? <p className="status-line error">{error}</p> : null}
    </div>
  );
}
