import { UserPlus } from "lucide-react";
import { useState } from "react";

export function RegisterPage({ apiUrl, onRegister, navigate }) {
  const [form, setForm] = useState({
    apiUrl,
    username: "",
    password: "",
    displayName: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await onRegister(form);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">SilTalk</p>
          <h1>Регистрация</h1>
        </div>

        <label>
          Backend URL
          <input
            name="apiUrl"
            type="url"
            value={form.apiUrl}
            onChange={updateField}
            required
          />
        </label>

        <label>
          Username
          <input
            name="username"
            type="text"
            minLength={3}
            maxLength={64}
            autoComplete="username"
            value={form.username}
            onChange={updateField}
            required
          />
        </label>

        <label>
          Пароль
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={form.password}
            onChange={updateField}
            required
          />
        </label>

        <label>
          Отображаемое имя
          <input
            name="displayName"
            type="text"
            maxLength={120}
            value={form.displayName}
            onChange={updateField}
          />
        </label>

        <button type="submit" disabled={isSubmitting}>
          <UserPlus size={18} aria-hidden="true" />
          {isSubmitting ? "Создаю" : "Создать аккаунт"}
        </button>

        <button
          className="plain-button"
          type="button"
          onClick={() => navigate("/login")}
        >
          Уже есть аккаунт
        </button>

        {error ? <p className="status-line error">{error}</p> : null}
      </form>
    </main>
  );
}
