import {
  ChevronDown,
  LogOut,
  PenLine,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";

import { Avatar } from "./Avatar.jsx";
import { formatDateTime, getDialogReceiver } from "../lib/format.js";

export function AppLayout({
  me,
  dialogs,
  activeDialogId,
  currentRoute,
  onLogout,
  onRefreshDialogs,
  navigate,
  children,
}) {
  const [dialogFilter, setDialogFilter] = useState("all");
  const unreadTotal = dialogs.reduce(
    (total, dialog) => total + dialog.unread_count,
    0,
  );
  const visibleDialogs =
    dialogFilter === "unread"
      ? dialogs.filter((dialog) => dialog.unread_count > 0)
      : dialogs;

  return (
    <main className={`app-shell route-${currentRoute}`}>
      <aside className="sidebar">
        <header className="brand-panel">
          <div className="brand-mark">
            <ShieldCheck size={28} aria-hidden="true" />
          </div>
          <div className="brand-copy">
            <h1>SilTalk</h1>
            <p>Безопасно. Конфиденциально. Всегда.</p>
          </div>
          <button
            className="icon-button glass-button"
            type="button"
            title="Новый диалог"
            onClick={() => navigate("/new")}
          >
            <PenLine size={19} aria-hidden="true" />
          </button>
        </header>

        <button
          className="search-trigger"
          type="button"
          onClick={() => navigate("/new")}
        >
          <Search size={19} aria-hidden="true" />
          <span>Поиск пользователя</span>
          <SlidersHorizontal size={18} aria-hidden="true" />
        </button>

        <nav className="chat-tabs" aria-label="Фильтры диалогов">
          <button
            className={dialogFilter === "all" ? "active" : ""}
            type="button"
            onClick={() => {
              setDialogFilter("all");
              navigate("/dialogs");
            }}
          >
            Все чаты
            <span>{dialogs.length}</span>
          </button>
          <button
            className={dialogFilter === "unread" ? "active" : ""}
            type="button"
            onClick={() => {
              setDialogFilter("unread");
              navigate("/dialogs");
            }}
          >
            Непрочитанные
            <span>{unreadTotal}</span>
          </button>
        </nav>

        <div className="section-title">
          <span>Диалоги</span>
          <button
            className="icon-button subtle-button"
            type="button"
            title="Обновить диалоги"
            onClick={onRefreshDialogs}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="dialogs-list">
          {visibleDialogs.length === 0 ? (
            <div className="empty-state compact">
              <MessageCircle size={18} aria-hidden="true" />
              <span>
                {dialogFilter === "unread" ? "Непрочитанных нет" : "Пока пусто"}
              </span>
            </div>
          ) : (
            visibleDialogs.map((dialog) => {
              const receiver = getDialogReceiver(dialog, me.username);
              const isActive = dialog.id === activeDialogId;

              return (
                <button
                  className={`dialog-button${isActive ? " active" : ""}`}
                  key={dialog.id}
                  type="button"
                  onClick={() => navigate(`/dialogs/${dialog.id}`)}
                >
                  <Avatar username={receiver || dialog.members[0]} size="small" />
                  <span className="dialog-main">
                    <span className="dialog-row">
                      <span className="dialog-members">
                        {receiver || dialog.members.join(", ")}
                      </span>
                      <span className="dialog-time">
                        {formatDateTime(dialog.created_at)}
                      </span>
                    </span>
                    <span className="dialog-preview">
                      <ShieldCheck size={13} aria-hidden="true" />
                      E2EE диалог
                    </span>
                  </span>
                  {dialog.unread_count > 0 ? (
                    <span className="unread-badge">{dialog.unread_count}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <section className="security-card">
          <ShieldCheck size={34} aria-hidden="true" />
          <div>
            <h2>E2EE включено</h2>
            <p>Сообщения шифруются на вашем устройстве.</p>
          </div>
        </section>

        <footer className="account-strip">
          <Avatar username={me.username} size="tiny" online />
          <span>{me.username}</span>
          <button className="icon-link" type="button" title="Выйти" onClick={onLogout}>
            <LogOut size={17} aria-hidden="true" />
          </button>
          <ChevronDown size={17} aria-hidden="true" />
        </footer>
      </aside>

      <section className="workspace">{children}</section>
    </main>
  );
}
