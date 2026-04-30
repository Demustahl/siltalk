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
};

apiUrlInput.value = state.apiUrl;

function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
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
      text: message.ciphertext,
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
        appendMessage(data);
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
  await loadDialogs();
  openSocket();
}

function showAuth() {
  closeSocket();
  state.token = "";
  state.me = null;
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
  state.socket.send(JSON.stringify({ type: "message", to: receiver, text }));
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
});

if (state.token) {
  showChat().catch(() => showAuth());
} else {
  showAuth();
}
