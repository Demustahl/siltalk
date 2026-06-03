import {
  LogOut,
  PenLine,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { Avatar } from "./Avatar.jsx";
import {
  formatDialogDateTime,
  getDialogDisplayName,
  getDialogPreview,
  getDialogReceiver,
  getDialogReceiverProfile,
  getUserDisplayName,
  isGroupDialog,
} from "../lib/format.js";

export function AppLayout({
  me,
  dialogs,
  activeDialogId,
  currentRoute,
  onLogout,
  navigate,
  children,
}) {
  const [dialogFilter, setDialogFilter] = useState("all");
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
          </div>
          <button
            className="icon-button glass-button brand-action"
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
          <span>Поиск по чатам</span>
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
          </button>
        </nav>

        <div className={`dialogs-list${visibleDialogs.length === 0 ? " dialogs-list-empty" : ""}`}>
          {visibleDialogs.length === 0 ? (
            <div className="sidebar-empty-state">
              <h2>
                {dialogFilter === "unread" ? "Непрочитанных нет" : "Здесь пока пусто"}
              </h2>
              <p>
                {dialogFilter === "unread"
                  ? "Новые сообщения появятся здесь."
                  : "Начните защищенную переписку — найдите пользователя или создайте новый чат."}
              </p>
            </div>
          ) : (
            visibleDialogs.map((dialog) => {
              const receiverProfile = getDialogReceiverProfile(dialog, me.username);
              const receiver = getDialogReceiver(dialog, me.username);
              const dialogName = getDialogDisplayName(dialog, me.username);
              const dialogPreview = getDialogPreview(dialog, me.username);
              const isGroup = isGroupDialog(dialog);
              const isActive = dialog.id === activeDialogId;

              return (
                <button
                  className={`dialog-button${isActive ? " active" : ""}`}
                  key={dialog.id}
                  type="button"
                  onClick={() => navigate(`/dialogs/${dialog.id}`)}
                >
                  <Avatar
                    username={isGroup ? dialogName : receiver}
                    size="small"
                    avatarId={isGroup ? null : receiverProfile?.avatar_id}
                    avatarDataUrl={isGroup ? null : receiverProfile?.avatar_data_url}
                  />
                  <span className="dialog-main">
                    <span className="dialog-row">
                      <span className="dialog-members">
                        {dialogName || dialog.members.join(", ")}
                      </span>
                      <span className="dialog-time">
                        {formatDialogDateTime(
                          dialog.last_message?.created_at || dialog.created_at,
                        )}
                      </span>
                    </span>
                    <span className="dialog-preview">
                      {dialogPreview}
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

        <footer className="account-strip">
          <Avatar
            username={me.username}
            size="tiny"
            avatarId={me.avatar_id}
            avatarDataUrl={me.avatar_data_url}
          />
          <span className="account-name">{getUserDisplayName(me)}</span>
          <span className="account-actions">
            <button
              className="icon-link"
              type="button"
              title="Настройки"
              onClick={() => navigate("/settings")}
            >
              <SettingsIcon size={17} aria-hidden="true" />
            </button>
            <button className="icon-link" type="button" title="Выйти" onClick={onLogout}>
              <LogOut size={17} aria-hidden="true" />
            </button>
          </span>
        </footer>
      </aside>

      <section className="workspace">{children}</section>
    </main>
  );
}
