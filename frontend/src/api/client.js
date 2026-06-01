export function cleanApiUrl(apiUrl) {
  return apiUrl.trim().replace(/\/$/, "");
}

export function createApiClient(apiUrl, token) {
  const baseUrl = cleanApiUrl(apiUrl);

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error("Backend недоступен или база данных не запущена");
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const message = data?.detail || "Ошибка запроса";
      throw new Error(Array.isArray(message) ? "Проверь поля формы" : message);
    }

    return data;
  }

  return {
    apiUrl: baseUrl,

    register(userData) {
      return request("/auth/register", {
        method: "POST",
        body: JSON.stringify(userData),
      });
    },

    login(username, password) {
      return request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    },

    me() {
      return request("/me");
    },

    updateProfile(profileData) {
      return request("/me/profile", {
        method: "PUT",
        body: JSON.stringify(profileData),
      });
    },

    publishPublicKey(publicKey) {
      return request("/me/keys", {
        method: "PUT",
        body: JSON.stringify({
          public_key: publicKey,
          device_name: navigator.userAgent.slice(0, 120),
        }),
      });
    },

    readUserPublicKey(username) {
      return request(`/users/${encodeURIComponent(username)}/keys`);
    },

    searchUsers(username) {
      return request(`/users/search?username=${encodeURIComponent(username)}`);
    },

    readDialogs() {
      return request("/dialogs");
    },

    readMessages(dialogId) {
      return request(`/dialogs/${dialogId}/messages`);
    },

    markDialogRead(dialogId) {
      return request(`/dialogs/${dialogId}/read`, { method: "POST" });
    },
  };
}

export function buildWebSocketUrl(apiUrl, token) {
  const url = new URL(cleanApiUrl(apiUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = `?token=${encodeURIComponent(token)}`;

  return url.toString();
}
