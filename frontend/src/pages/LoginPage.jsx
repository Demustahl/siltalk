import { LogIn } from "lucide-react";
import { useState } from "react";

export function LoginPage({ notice, onLogin, navigate }) {
  const [form, setForm] = useState({
    username: "",
    password: "",
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
      await onLogin(form);
    } catch (caughtError) {
      setError(caughtError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div className="auth-brand auth-brand-centered">
          <p className="auth-product-name">SilTalk</p>
          <h1>Вход</h1>
        </div>

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
            autoComplete="current-password"
            value={form.password}
            onChange={updateField}
            required
          />
        </label>

        <button type="submit" disabled={isSubmitting}>
          <LogIn size={18} aria-hidden="true" />
          {isSubmitting ? "Вхожу" : "Войти"}
        </button>

        <button
          className="plain-button"
          type="button"
          onClick={() => navigate("/register")}
        >
          Зарегистрироваться
        </button>

        {notice ? <p className="status-line success">{notice}</p> : null}
        {error ? <p className="status-line error">{error}</p> : null}
      </form>
    </main>
  );
}
