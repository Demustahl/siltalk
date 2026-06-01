import {
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";

import { formatDateTime, getDialogReceiver } from "../lib/format.js";

export function AppLayout({
  me,
  dialogs,
  activeDialogId,
  socketStatus,
  onLogout,
  onRefreshDialogs,
  navigate,
  children,
}) {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="user-block">
            <p className="eyebrow">Пользователь</p>
            <h1>{me.username}</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            title="Выйти"
            onClick={onLogout}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </header>

        <nav className="sidebar-actions" aria-label="Основные страницы">
          <button type="button" onClick={() => navigate("/dialogs")}>
            <MessageCircle size={18} aria-hidden="true" />
            Диалоги
          </button>
          <button type="button" onClick={() => navigate("/new")}>
            <Search size={18} aria-hidden="true" />
            Поиск
          </button>
        </nav>

        <div className="section-title">
          <span>Диалоги</span>
          <button
            className="ghost-button"
            type="button"
            title="Обновить диалоги"
            onClick={onRefreshDialogs}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="dialogs-list">
          {dialogs.length === 0 ? (
            <div className="empty-state compact">
              <Plus size={18} aria-hidden="true" />
              <span>Пока пусто</span>
            </div>
          ) : (
            dialogs.map((dialog) => {
              const receiver = getDialogReceiver(dialog, me.username);
              const isActive = dialog.id === activeDialogId;

              return (
                <button
                  className={`dialog-button${isActive ? " active" : ""}`}
                  key={dialog.id}
                  type="button"
                  onClick={() => navigate(`/dialogs/${dialog.id}`)}
                >
                  <span className="dialog-row">
                    <span className="dialog-members">
                      {receiver || dialog.members.join(", ")}
                    </span>
                    {dialog.unread_count > 0 ? (
                      <span className="unread-badge">{dialog.unread_count}</span>
                    ) : null}
                  </span>
                  <span className="dialog-meta">
                    {formatDateTime(dialog.created_at)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <footer className="socket-line">
          <span className={`socket-dot ${socketStatus}`} />
          <span>{socketStatus}</span>
        </footer>
      </aside>

      <section className="workspace">{children}</section>
    </main>
  );
}
