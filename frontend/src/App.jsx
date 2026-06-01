import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createApiClient, buildWebSocketUrl, cleanApiUrl } from "./api/client.js";
import { AppLayout } from "./components/AppLayout.jsx";
import {
  createEncryptedEnvelope,
  decryptEnvelope,
  ensureLocalKeyPair,
} from "./lib/e2ee.js";
import { normalizeUsername } from "./lib/format.js";
import { DialogPage } from "./pages/DialogPage.jsx";
import { DialogsPage } from "./pages/DialogsPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { NewDialogPage } from "./pages/NewDialogPage.jsx";
import { RegisterPage } from "./pages/RegisterPage.jsx";

const DEFAULT_API_URL = "http://localhost:8000";

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
  if (parts[0] === "dialogs" && parts[1]) {
    return { name: "dialog", dialogId: parts[1] };
  }

  return { name: "dialogs" };
}

export function App() {
  const [route, setRoute] = useState(readRoute);
  const [apiUrl, setApiUrl] = useState(
    localStorage.getItem("apiUrl") || DEFAULT_API_URL,
  );
  const [token, setToken] = useState(localStorage.getItem("accessToken") || "");
  const [me, setMe] = useState(null);
  const [e2ee, setE2ee] = useState(null);
  const [dialogs, setDialogs] = useState([]);
  const [socketStatus, setSocketStatus] = useState("offline");
  const [startupError, setStartupError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [realtimeMessage, setRealtimeMessage] = useState(null);
  const [deliveryStatus, setDeliveryStatus] = useState(null);
  const socketRef = useRef(null);
  const pendingStatusesRef = useRef([]);

  const api = useMemo(() => createApiClient(apiUrl, token), [apiUrl, token]);

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
    setSocketStatus("offline");
  }, []);

  const logout = useCallback(() => {
    clearSession();
    navigate("/login");
  }, [clearSession, navigate]);

  const loadDialogs = useCallback(async () => {
    if (!token) {
      setDialogs([]);
      return [];
    }

    const nextDialogs = await api.readDialogs();
    setDialogs(nextDialogs);
    return nextDialogs;
  }, [api, token]);

  const finishLogin = useCallback(
    async (nextApiUrl, nextToken) => {
      const cleanedApiUrl = cleanApiUrl(nextApiUrl);
      localStorage.setItem("apiUrl", cleanedApiUrl);
      localStorage.setItem("accessToken", nextToken);
      setApiUrl(cleanedApiUrl);
      setToken(nextToken);
      navigate("/dialogs");
    },
    [navigate],
  );

  const handleLogin = useCallback(
    async ({ apiUrl: nextApiUrl, username, password }) => {
      const loginApi = createApiClient(nextApiUrl, "");
      const tokenData = await loginApi.login(
        normalizeUsername(username),
        password,
      );
      await finishLogin(nextApiUrl, tokenData.access_token);
    },
    [finishLogin],
  );

  const handleRegister = useCallback(
    async ({ apiUrl: nextApiUrl, username, password, displayName }) => {
      const registerApi = createApiClient(nextApiUrl, "");
      const normalizedUsername = normalizeUsername(username);

      await registerApi.register({
        username: normalizedUsername,
        password,
        display_name: displayName.trim() || null,
      });

      const tokenData = await registerApi.login(normalizedUsername, password);
      await finishLogin(nextApiUrl, tokenData.access_token);
    },
    [finishLogin],
  );

  const rejectPendingStatuses = useCallback((message) => {
    pendingStatusesRef.current.forEach((item) => {
      clearTimeout(item.timeoutId);
      item.reject(new Error(message));
    });
    pendingStatusesRef.current = [];
  }, []);

  const resolvePendingStatus = useCallback((statusMessage) => {
    const statusIndex = pendingStatusesRef.current.findIndex(
      (item) => item.to === statusMessage.to,
    );
    if (statusIndex === -1) {
      return;
    }

    const [pendingStatus] = pendingStatusesRef.current.splice(statusIndex, 1);
    clearTimeout(pendingStatus.timeoutId);
    pendingStatus.resolve(statusMessage);
  }, []);

  const waitForDeliveryStatus = useCallback((receiverUsername) => {
    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingStatusesRef.current = pendingStatusesRef.current.filter(
          (item) => item.timeoutId !== timeoutId,
        );
        reject(new Error("Backend не подтвердил отправку"));
      }, 8000);

      pendingStatusesRef.current.push({
        to: receiverUsername,
        resolve,
        reject,
        timeoutId,
      });
    });
  }, []);

  const sendEncryptedMessage = useCallback(
    async (receiverUsername, text) => {
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
        senderUsername: me.username,
        senderPublicKey: e2ee.publicKey,
        receiverUsername: receiver,
        receiverPublicKey: receiverKey.public_key,
      });
      const deliveryPromise = waitForDeliveryStatus(receiver);

      socketRef.current.send(
        JSON.stringify({
          type: "message",
          to: receiver,
          ciphertext,
        }),
      );

      return deliveryPromise;
    },
    [api, e2ee, me, waitForDeliveryStatus],
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
        const keys = await ensureLocalKeyPair(currentUser.username);
        await api.publishPublicKey(keys.publicKey);
        const nextDialogs = await api.readDialogs();

        if (!isCancelled) {
          setMe(currentUser);
          setE2ee(keys);
          setDialogs(nextDialogs);
        }
      } catch (caughtError) {
        if (!isCancelled) {
          setStartupError(caughtError.message);
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

    const websocket = new WebSocket(buildWebSocketUrl(apiUrl, token));
    socketRef.current = websocket;
    setSocketStatus("connecting");

    websocket.addEventListener("open", () => {
      setSocketStatus("online");
    });

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

      if (data.type === "message") {
        const text = await decryptEnvelope(data.ciphertext, me.username, e2ee.keyPair);
        setRealtimeMessage({
          ...data,
          text,
        });
        loadDialogs().catch(() => undefined);
      }
    });

    websocket.addEventListener("close", () => {
      setSocketStatus("offline");
    });

    websocket.addEventListener("error", () => {
      setSocketStatus("offline");
    });

    return () => {
      websocket.close();
      if (socketRef.current === websocket) {
        socketRef.current = null;
      }
    };
  }, [
    apiUrl,
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
          apiUrl={apiUrl}
          onRegister={handleRegister}
          navigate={navigate}
        />
      );
    }

    return (
      <LoginPage apiUrl={apiUrl} onLogin={handleLogin} navigate={navigate} />
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
      socketStatus={socketStatus}
      onLogout={logout}
      onRefreshDialogs={loadDialogs}
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
    </AppLayout>
  );
}
