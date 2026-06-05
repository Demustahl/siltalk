import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createApiClient, buildWebSocketUrl, cleanApiUrl } from "./api/client.js";
import { AppLayout } from "./components/AppLayout.jsx";
import {
  createEncryptedEnvelope,
  decryptMessageEnvelope,
  ensureLocalKeyPair,
  readLocalKeyPair,
} from "./lib/e2ee.js";
import { normalizeUsername } from "./lib/format.js";
import { DialogPage } from "./pages/DialogPage.jsx";
import { DialogsPage } from "./pages/DialogsPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { NewDialogPage } from "./pages/NewDialogPage.jsx";
import { RegisterPage } from "./pages/RegisterPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";

const DEFAULT_API_URL = "http://127.0.0.1:8000";
const API_URL = cleanApiUrl(import.meta.env.VITE_API_URL || DEFAULT_API_URL);
const E2EE_KEY_ON_ANOTHER_DEVICE_MESSAGE =
  "У этого пользователя приватный ключ находится в другом браузере или на другом устройстве.";
const E2EE_KEY_MISMATCH_MESSAGE =
  "Локальный приватный ключ не подходит к этому аккаунту. Войдите там, где был создан ключ.";

function readRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);

  if (parts[0] === "register") {
    return { name: "register" };
  }
  if (parts[0] === "login") {
    return { name: "login" };
  }
  if (parts[0] === "new") {
    return { name: "new", username: parts[1] || "" };
  }
  if (parts[0] === "settings") {
    return { name: "settings" };
  }
  if (parts[0] === "dialogs" && parts[1]) {
    return { name: "dialog", dialogId: parts[1] };
  }

  return { name: "dialogs" };
}

async function decryptDialogPreviews(rawDialogs, currentUser, e2eeData) {
  if (!currentUser || !e2eeData) {
    return rawDialogs;
  }

  return Promise.all(
    rawDialogs.map(async (dialog) => {
      if (!dialog.last_message?.ciphertext) {
        return dialog;
      }

      const decryptedMessage = await decryptMessageEnvelope(
        dialog.last_message.ciphertext,
        currentUser.username,
        e2eeData.keyPair,
      );

      return {
        ...dialog,
        last_message: {
          ...dialog.last_message,
          ...decryptedMessage,
        },
      };
    }),
  );
}

async function prepareE2eeSession(api, currentUser) {
  const localKeys = await readLocalKeyPair(currentUser.username);
  const publishedKey = await api.readUserPublicKeyOrNull(currentUser.username);

  if (publishedKey && !localKeys) {
    throw new Error(E2EE_KEY_ON_ANOTHER_DEVICE_MESSAGE);
  }

  if (publishedKey) {
    if (publishedKey.public_key !== localKeys.publicKey) {
      throw new Error(E2EE_KEY_MISMATCH_MESSAGE);
    }

    return localKeys;
  }

  const keys = localKeys || (await ensureLocalKeyPair(currentUser.username));
  await api.publishPublicKey(keys.publicKey);

  return keys;
}

export function App() {
  const [route, setRoute] = useState(readRoute);
  const [token, setToken] = useState(localStorage.getItem("accessToken") || "");
  const [authNotice, setAuthNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [me, setMe] = useState(null);
  const [e2ee, setE2ee] = useState(null);
  const [dialogs, setDialogs] = useState([]);
  const [startupError, setStartupError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [realtimeMessage, setRealtimeMessage] = useState(null);
  const [deliveryStatus, setDeliveryStatus] = useState(null);
  const socketRef = useRef(null);
  const pendingStatusesRef = useRef([]);

  const api = useMemo(() => createApiClient(API_URL, token), [token]);

  const navigate = useCallback((path) => {
    window.location.hash = path;
  }, []);

  const clearSession = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    pendingStatusesRef.current.forEach((item) => {
      clearTimeout(item.timeoutId);
      item.reject(new Error("Сессия завершена"));
    });
    pendingStatusesRef.current = [];
    localStorage.removeItem("accessToken");
    setToken("");
    setMe(null);
    setE2ee(null);
    setDialogs([]);
  }, []);

  const logout = useCallback(() => {
    setAuthError("");
    clearSession();
    navigate("/login");
  }, [clearSession, navigate]);

  const loadDialogs = useCallback(async () => {
    if (!token) {
      setDialogs([]);
      return [];
    }

    const rawDialogs = await api.readDialogs();
    const nextDialogs = await decryptDialogPreviews(rawDialogs, me, e2ee);
    setDialogs(nextDialogs);
    return nextDialogs;
  }, [api, e2ee, me, token]);

  const finishLogin = useCallback(
    async (nextToken) => {
      localStorage.setItem("accessToken", nextToken);
      setToken(nextToken);
      navigate("/dialogs");
    },
    [navigate],
  );

  const handleLogin = useCallback(
    async ({ username, password }) => {
      const loginApi = createApiClient(API_URL, "");
      setAuthError("");
      const tokenData = await loginApi.login(
        normalizeUsername(username),
        password,
      );
      const sessionApi = createApiClient(API_URL, tokenData.access_token);
      const currentUser = await sessionApi.me();

      await prepareE2eeSession(sessionApi, currentUser);
      setAuthNotice("");
      await finishLogin(tokenData.access_token);
    },
    [finishLogin],
  );

  const handleRegister = useCallback(
    async ({ username, password, displayName }) => {
      const registerApi = createApiClient(API_URL, "");
      const normalizedUsername = normalizeUsername(username);

      await registerApi.register({
        username: normalizedUsername,
        password,
        display_name: displayName.trim() || null,
      });

      setAuthError("");
      setAuthNotice("Аккаунт создан. Теперь войдите.");
      navigate("/login");
    },
    [navigate],
  );

  const rejectPendingStatuses = useCallback((message) => {
    pendingStatusesRef.current.forEach((item) => {
      clearTimeout(item.timeoutId);
      item.reject(new Error(message));
    });
    pendingStatusesRef.current = [];
  }, []);

  const resolvePendingStatus = useCallback((statusMessage) => {
    const statusIndex = pendingStatusesRef.current.findIndex((item) => {
      if (item.dialogId) {
        return item.dialogId === statusMessage.dialog_id && !statusMessage.to;
      }

      return item.to === statusMessage.to;
    });
    if (statusIndex === -1) {
      return;
    }

    const [pendingStatus] = pendingStatusesRef.current.splice(statusIndex, 1);
    clearTimeout(pendingStatus.timeoutId);
    pendingStatus.resolve(statusMessage);
  }, []);

  const waitForDeliveryStatus = useCallback((target) => {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingStatusesRef.current = pendingStatusesRef.current.filter(
          (item) => item.timeoutId !== timeoutId,
        );
        reject(new Error("Backend не подтвердил отправку"));
      }, 8000);

      pendingStatusesRef.current.push({
        to: target.to || "",
        dialogId: target.dialogId || "",
        resolve,
        reject,
        timeoutId,
      });
    });
  }, []);

  const sendEncryptedMessage = useCallback(
    async (receiverUsername, text, attachments = []) => {
      const receiver = normalizeUsername(receiverUsername);
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket не подключен");
      }
      if (!me || !e2ee) {
        throw new Error("Ключи еще не готовы");
      }

      const receiverKey = await api.readUserPublicKey(receiver);
      const ciphertext = await createEncryptedEnvelope({
        text,
        attachments,
        senderUsername: me.username,
        senderPublicKey: e2ee.publicKey,
        receiverUsername: receiver,
        receiverPublicKey: receiverKey.public_key,
      });
      const deliveryPromise = waitForDeliveryStatus({ to: receiver });

      socketRef.current.send(
        JSON.stringify({
          type: "message",
          to: receiver,
          ciphertext,
          attachment_ids: attachments.map((attachment) => attachment.id),
        }),
      );

      return deliveryPromise;
    },
    [api, e2ee, me, waitForDeliveryStatus],
  );

  const sendEncryptedDialogMessage = useCallback(
    async (dialog, text, attachments = []) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket не подключен");
      }
      if (!me || !e2ee) {
        throw new Error("Ключи еще не готовы");
      }

      const dialogKeys = await api.readDialogPublicKeys(dialog.id);
      const recipients = dialogKeys.map((keyData) => ({
        username: keyData.username,
        publicKey: keyData.public_key,
      }));
      const ciphertext = await createEncryptedEnvelope({
        text,
        attachments,
        recipients,
      });
      const deliveryPromise = waitForDeliveryStatus({ dialogId: dialog.id });

      socketRef.current.send(
        JSON.stringify({
          type: "message",
          dialog_id: dialog.id,
          ciphertext,
          attachment_ids: attachments.map((attachment) => attachment.id),
        }),
      );

      return deliveryPromise;
    },
    [api, e2ee, me, waitForDeliveryStatus],
  );

  const updateProfile = useCallback(
    async (profileData) => {
      const updatedUser = await api.updateProfile(profileData);
      setMe(updatedUser);
      await loadDialogs();

      return updatedUser;
    },
    [api, loadDialogs],
  );

  useEffect(() => {
    function handleHashChange() {
      setRoute(readRoute());
    }

    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash) {
      navigate(token ? "/dialogs" : "/login");
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [navigate, token]);

  useEffect(() => {
    if (token && (route.name === "login" || route.name === "register")) {
      navigate("/dialogs");
    }
  }, [navigate, route.name, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isCancelled = false;

    async function startSession() {
      setIsStarting(true);
      setStartupError("");

      try {
        const currentUser = await api.me();
        const keys = await prepareE2eeSession(api, currentUser);
        const rawDialogs = await api.readDialogs();
        const nextDialogs = await decryptDialogPreviews(
          rawDialogs,
          currentUser,
          keys,
        );

        if (!isCancelled) {
          setMe(currentUser);
          setE2ee(keys);
          setDialogs(nextDialogs);
        }
      } catch (caughtError) {
        if (!isCancelled) {
          setStartupError(caughtError.message);
          setAuthError(caughtError.message);
          clearSession();
          navigate("/login");
        }
      } finally {
        if (!isCancelled) {
          setIsStarting(false);
        }
      }
    }

    startSession();

    return () => {
      isCancelled = true;
    };
  }, [api, clearSession, navigate, token]);

  useEffect(() => {
    if (!token || !me || !e2ee) {
      return undefined;
    }

    const websocket = new WebSocket(buildWebSocketUrl(API_URL, token));
    socketRef.current = websocket;

    websocket.addEventListener("message", async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "error") {
        rejectPendingStatuses(data.text || "Ошибка WebSocket");
        setStartupError(data.text || "Ошибка WebSocket");
        return;
      }

      if (data.type === "message_status") {
        setDeliveryStatus(data);
        resolvePendingStatus(data);
        loadDialogs().catch(() => undefined);
        return;
      }

      if (data.type === "messages_read") {
        setDeliveryStatus(data);
        loadDialogs().catch(() => undefined);
        return;
      }

      if (data.type === "message") {
        const decryptedMessage = await decryptMessageEnvelope(
          data.ciphertext,
          me.username,
          e2ee.keyPair,
        );
        setRealtimeMessage({
          ...data,
          sender_username: data.from,
          ...decryptedMessage,
        });
        loadDialogs().catch(() => undefined);
      }
    });

    return () => {
      websocket.close();
      if (socketRef.current === websocket) {
        socketRef.current = null;
      }
    };
  }, [
    e2ee,
    loadDialogs,
    me,
    rejectPendingStatuses,
    resolvePendingStatus,
    token,
  ]);

  if (!token) {
    if (route.name === "register") {
      return (
        <RegisterPage
          onRegister={handleRegister}
          navigate={navigate}
        />
      );
    }

    return (
      <LoginPage
        notice={authNotice}
        sessionError={authError}
        onLogin={handleLogin}
        navigate={navigate}
      />
    );
  }

  if (isStarting || !me || !e2ee) {
    return (
      <main className="loading-page">
        <div>
          <p className="eyebrow">SilTalk</p>
          <h1>Загружаю</h1>
          {startupError ? <p className="status-line error">{startupError}</p> : null}
        </div>
      </main>
    );
  }

  const activeDialogId = route.name === "dialog" ? route.dialogId : "";

  return (
    <AppLayout
      me={me}
      dialogs={dialogs}
      activeDialogId={activeDialogId}
      currentRoute={route.name}
      onLogout={logout}
      navigate={navigate}
    >
      {route.name === "dialog" ? (
        <DialogPage
          api={api}
          dialogId={route.dialogId}
          dialogs={dialogs}
          me={me}
          e2ee={e2ee}
          realtimeMessage={realtimeMessage}
          deliveryStatus={deliveryStatus}
          onSendMessage={sendEncryptedMessage}
          onSendDialogMessage={sendEncryptedDialogMessage}
          onRefreshDialogs={loadDialogs}
          navigate={navigate}
        />
      ) : null}

      {route.name === "new" ? (
        <NewDialogPage
          api={api}
          initialUsername={route.username}
          onSendMessage={sendEncryptedMessage}
          onRefreshDialogs={loadDialogs}
          navigate={navigate}
        />
      ) : null}

      {route.name === "dialogs" ? (
        <DialogsPage dialogs={dialogs} me={me} navigate={navigate} />
      ) : null}

      {route.name === "settings" ? (
        <SettingsPage
          me={me}
          onUpdateProfile={updateProfile}
          navigate={navigate}
        />
      ) : null}
    </AppLayout>
  );
}
