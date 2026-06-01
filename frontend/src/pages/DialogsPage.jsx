import { MessageCircle, Search } from "lucide-react";

import { formatDateTime, getDialogReceiver } from "../lib/format.js";

export function DialogsPage({ dialogs, me, navigate }) {
  return (
    <div className="page-surface">
      <header className="page-header">
        <div>
          <p className="eyebrow">Сообщения</p>
          <h2>Диалоги</h2>
        </div>
        <button type="button" onClick={() => navigate("/new")}>
          <Search size={18} aria-hidden="true" />
          Найти пользователя
        </button>
      </header>

      <div className="dialog-grid">
        {dialogs.length === 0 ? (
          <div className="empty-state">
            <MessageCircle size={24} aria-hidden="true" />
            <span>Диалогов пока нет</span>
          </div>
        ) : (
          dialogs.map((dialog) => {
            const receiver = getDialogReceiver(dialog, me.username);

            return (
              <button
                className="dialog-card"
                key={dialog.id}
                type="button"
                onClick={() => navigate(`/dialogs/${dialog.id}`)}
              >
                <span className="dialog-row">
                  <span className="dialog-card-title">
                    {receiver || dialog.members.join(", ")}
                  </span>
                  {dialog.unread_count > 0 ? (
                    <span className="unread-badge">{dialog.unread_count}</span>
                  ) : null}
                </span>
                <span className="dialog-meta">
                  {dialog.dialog_type} · {formatDateTime(dialog.created_at)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
