const authView = document.querySelector("#authView");
const chatView = document.querySelector("#chatView");
const authForm = document.querySelector("#authForm");
const authStatus = document.querySelector("#authStatus");
const apiUrlInput = document.querySelector("#apiUrlInput");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const displayNameInput = document.querySelector("#displayNameInput");
const currentUserName = document.querySelector("#currentUserName");
const logoutButton = document.querySelector("#logoutButton");
const receiverInput = document.querySelector("#receiverInput");
const newChatForm = document.querySelector("#newChatForm");
const refreshDialogsButton = document.querySelector("#refreshDialogsButton");
const dialogsList = document.querySelector("#dialogsList");
const chatTitle = document.querySelector("#chatTitle");
const socketStatus = document.querySelector("#socketStatus");
const messagesList = document.querySelector("#messagesList");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const chatStatus = document.querySelector("#chatStatus");

const state = {
  apiUrl: localStorage.getItem("apiUrl") || "http://localhost:8000",
  token: localStorage.getItem("accessToken") || "",
  me: null,
  socket: null,
  dialogs: [],
  activeDialogId: "",
  activeReceiver: "",
  keyPair: null,
  publicKey: "",
};

let sodium = null;

apiUrlInput.value = state.apiUrl;

function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
}

async function ensureSodium() {
  if (sodium) {
    return sodium;
  }

  const sodiumModule = await import("https://cdn.skypack.dev/libsodium-wrappers-sumo");
  sodium = sodiumModule.default || sodiumModule;
  await sodium.ready;

  return sodium;
}

function encodeBytes(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function decodeBytes(base64Text) {
  return sodium.from_base64(base64Text, sodium.base64_variants.ORIGINAL);
}

function keyStorageName(username) {
  return `e2ee-keypair:${username}`;
}

function readSavedKeyPair(username) {
  const saved = localStorage.getItem(keyStorageName(username));
  if (!saved) {
    return null;
  }

  try {
    const data = JSON.parse(saved);
    if (!data.publicKey || !data.privateKey) {
      return null;
    }

    return {
      publicKey: decodeBytes(data.publicKey),
      privateKey: decodeBytes(data.privateKey),
    };
  } catch {
    return null;
  }
}

function saveKeyPair(username, keyPair) {
  localStorage.setItem(
    keyStorageName(username),
    JSON.stringify({
      publicKey: encodeBytes(keyPair.publicKey),
      privateKey: encodeBytes(keyPair.privateKey),
    }),
  );
}

async function ensureLocalKeyPair() {
  await ensureSodium();

  let keyPair = readSavedKeyPair(state.me.username);
  if (!keyPair) {
    keyPair = sodium.crypto_box_keypair();
    saveKeyPair(state.me.username, keyPair);
  }

  state.keyPair = keyPair;
  state.publicKey = encodeBytes(keyPair.publicKey);
}

async function publishPublicKey() {
  await request("/me/keys", {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      public_key: state.publicKey,
      device_name: navigator.userAgent.slice(0, 120),
    }),
  });
}

async function ensureE2eeReady() {
  setStatus(chatStatus, "Готовлю ключи");
  await ensureLocalKeyPair();
  await publishPublicKey();
  setStatus(chatStatus, "");
}

async function loadPublicKey(username) {
  return request(`/users/${encodeURIComponent(username)}/keys`, {
    headers: authHeaders(),
  });
}

function encryptForPublicKey(text, publicKey) {
  const plaintext = sodium.from_string(text);
  const publicKeyBytes = decodeBytes(publicKey);
  const ciphertextBytes = sodium.crypto_box_seal(plaintext, publicKeyBytes);

  return encodeBytes(ciphertextBytes);
}

async function encryptMessage(receiver, text) {
  await ensureLocalKeyPair();

  const receiverKey = await loadPublicKey(receiver);
  const recipients = {
    [receiver]: encryptForPublicKey(text, receiverKey.public_key),
    [state.me.username]: encryptForPublicKey(text, state.publicKey),
  };

  return JSON.stringify({
    version: 1,
    algorithm: "libsodium.crypto_box_seal",
    recipients,
  });
}

function decryptMessage(ciphertext) {
  if (!state.keyPair) {
    return "Ключ для расшифровки не загружен";
  }

  try {
    const envelope = JSON.parse(ciphertext);
    const encryptedForMe = envelope.recipients?.[state.me.username];
    if (!encryptedForMe) {
      return "Сообщение зашифровано не для этого ключа";
    }

    const decryptedBytes = sodium.crypto_box_seal_open(
      decodeBytes(encryptedForMe),
      state.keyPair.publicKey,
      state.keyPair.privateKey,
    );

    return sodium.to_string(decryptedBytes);
  } catch {
    return "Не удалось расшифровать сообщение";
  }
}

function wsUrl() {
  const url = new URL(state.apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = `?token=${encodeURIComponent(state.token)}`;
  return url.toString();
}

async function request(path, options = {}) {
  const response = await fetch(`${state.apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let data = null;
  const text = await response.text();
  if (text) {
    data = JSON.parse(text);
  }

  if (!response.ok) {
    const message = data?.detail || "Ошибка запроса";
    throw new Error(Array.isArray(message) ? "Проверь поля формы" : message);
  }

  return data;
}

async function login(username, password) {
  const data = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  state.token = data.access_token;
  localStorage.setItem("accessToken", state.token);
}

async function loadMe() {
  state.me = await request("/me", { headers: authHeaders() });
  currentUserName.textContent = state.me.username;
}

async function loadDialogs() {
  state.dialogs = await request("/dialogs", { headers: authHeaders() });
  renderDialogs();
}

async function loadMessages(dialogId) {
  const messages = await request(`/dialogs/${dialogId}/messages`, {
    headers: authHeaders(),
  });
  renderMessages(messages);
}

function renderDialogs() {
  dialogsList.innerHTML = "";

  if (state.dialogs.length === 0) {
    dialogsList.innerHTML = '<p class="empty-state">Диалогов пока нет</p>';
    return;
  }

  for (const dialog of state.dialogs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dialog-button";
    button.classList.toggle("active", dialog.id === state.activeDialogId);
    button.dataset.dialogId = dialog.id;

    const receiver = getDialogReceiver(dialog);
    button.innerHTML = `
      <span class="dialog-members">${dialog.members.join(", ")}</span>
      <span class="dialog-meta">${new Date(dialog.created_at).toLocaleString()}</span>
    `;
    button.addEventListener("click", () => selectDialog(dialog.id, receiver));
    dialogsList.appendChild(button);
  }
}

function renderMessages(messages) {
  messagesList.innerHTML = "";

  if (messages.length === 0) {
    messagesList.innerHTML = '<p class="empty-state">История пустая</p>';
    return;
  }

  for (const message of messages) {
    appendMessage({
      from: message.sender_username,
      text: decryptMessage(message.ciphertext),
    });
  }
}

function appendMessage(message) {
  const item = document.createElement("article");
  const isOwn = state.me && message.from === state.me.username;
  item.className = `message${isOwn ? " own" : ""}`;
  item.innerHTML = `
    <p class="message-meta">${message.from}</p>
    <p class="message-text"></p>
  `;
  item.querySelector(".message-text").textContent = message.text;
  messagesList.appendChild(item);
  messagesList.scrollTop = messagesList.scrollHeight;
}

function getDialogReceiver(dialog) {
  return dialog.members.find((member) => member !== state.me.username) || "";
}

async function selectDialog(dialogId, receiver) {
  state.activeDialogId = dialogId;
  state.activeReceiver = receiver;
  receiverInput.value = receiver;
  chatTitle.textContent = receiver || "Диалог";
  renderDialogs();
  await loadMessages(dialogId);
}

function openSocket() {
  closeSocket();
  state.socket = new WebSocket(wsUrl());
  socketStatus.textContent = "connecting";
  socketStatus.classList.remove("online");

  state.socket.addEventListener("open", () => {
    socketStatus.textContent = "online";
    socketStatus.classList.add("online");
  });

  state.socket.addEventListener("message", async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "error") {
      setStatus(chatStatus, data.text, true);
      return;
    }

    if (data.type === "message") {
      if (data.from === state.activeReceiver) {
        appendMessage({
          from: data.from,
          text: decryptMessage(data.ciphertext),
        });
      }
      await loadDialogs();
    }
  });

  state.socket.addEventListener("close", () => {
    socketStatus.textContent = "offline";
    socketStatus.classList.remove("online");
  });
}

function closeSocket() {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
}

async function showChat() {
  authView.hidden = true;
  chatView.hidden = false;
  await loadMe();
  await ensureE2eeReady();
  await loadDialogs();
  openSocket();
}

function showAuth() {
  closeSocket();
  state.token = "";
  state.me = null;
  state.keyPair = null;
  state.publicKey = "";
  localStorage.removeItem("accessToken");
  authView.hidden = false;
  chatView.hidden = true;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = event.submitter?.dataset.authAction || "login";
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const displayName = displayNameInput.value.trim() || null;

  state.apiUrl = apiUrlInput.value.replace(/\/$/, "");
  localStorage.setItem("apiUrl", state.apiUrl);
  setStatus(authStatus, "Отправляю запрос");

  try {
    if (action === "register") {
      await request("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, display_name: displayName }),
      });
    }

    await login(username, password);
    setStatus(authStatus, "");
    await showChat();
  } catch (error) {
    setStatus(authStatus, error.message, true);
  }
});

logoutButton.addEventListener("click", () => {
  showAuth();
});

refreshDialogsButton.addEventListener("click", async () => {
  await loadDialogs();
});

newChatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const receiver = receiverInput.value.trim().toLowerCase();
  state.activeDialogId = "";
  state.activeReceiver = receiver;
  chatTitle.textContent = receiver || "Диалог";
  messagesList.innerHTML = '<p class="empty-state">Новый диалог</p>';
  setStatus(chatStatus, "");
  renderDialogs();
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  const receiver = receiverInput.value.trim().toLowerCase();

  if (!text || !receiver || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    setStatus(chatStatus, "Нужен получатель, текст и активный WebSocket", true);
    return;
  }

  state.activeReceiver = receiver;
  setStatus(chatStatus, "Шифрую сообщение");

  try {
    const ciphertext = await encryptMessage(receiver, text);
    state.socket.send(JSON.stringify({ type: "message", to: receiver, ciphertext }));
    appendMessage({ from: state.me.username, text });
    messageInput.value = "";
    setStatus(chatStatus, "");

    setTimeout(async () => {
      await loadDialogs();
      const dialog = state.dialogs.find((item) => item.members.includes(receiver));
      if (dialog) {
        state.activeDialogId = dialog.id;
        renderDialogs();
      }
    }, 250);
  } catch (error) {
    setStatus(chatStatus, error.message, true);
  }
});

if (state.token) {
  showChat().catch(() => showAuth());
} else {
  showAuth();
}
