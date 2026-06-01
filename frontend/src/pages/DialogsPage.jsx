import { MessageCircle, Search, ShieldCheck } from "lucide-react";

import { Avatar } from "../components/Avatar.jsx";
import {
  formatDateTime,
  getDialogReceiver,
  getDialogReceiverProfile,
  getUserDisplayName,
} from "../lib/format.js";

export function DialogsPage({ dialogs, me, navigate }) {
  return (
    <div className="page-surface">
      <header className="page-header">
        <div>
          <p className="eyebrow">SilTalk</p>
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
            const receiverProfile = getDialogReceiverProfile(dialog, me.username);
            const receiver = getDialogReceiver(dialog, me.username);
            const receiverName = getUserDisplayName(receiverProfile) || receiver;

            return (
              <button
                className="dialog-card"
                key={dialog.id}
                type="button"
                onClick={() => navigate(`/dialogs/${dialog.id}`)}
              >
                <Avatar
                  username={receiver || dialog.members[0]}
                  size="medium"
                  avatarId={receiverProfile?.avatar_id}
                  avatarDataUrl={receiverProfile?.avatar_data_url}
                />
                <span className="dialog-card-body">
                  <span className="dialog-row">
                    <span className="dialog-card-title">
                      {receiverName || dialog.members.join(", ")}
                    </span>
                    {dialog.unread_count > 0 ? (
                      <span className="unread-badge">{dialog.unread_count}</span>
                    ) : null}
                  </span>
                  <span className="dialog-meta">
                    <ShieldCheck size={13} aria-hidden="true" />
                    {dialog.dialog_type} · {formatDateTime(dialog.created_at)}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
