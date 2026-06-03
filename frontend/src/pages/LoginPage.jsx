import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";

export function LoginPage({ notice, onLogin, navigate }) {
  const [form, setForm] = useState({
    username: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

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
          <span className="auth-divider" aria-hidden="true" />
          <h1>Вход в аккаунт</h1>
        </div>

        <label>
          Имя пользователя
          <input
            name="username"
            type="text"
            minLength={3}
            maxLength={64}
            autoComplete="username"
            placeholder="Введите имя пользователя"
            value={form.username}
            onChange={updateField}
            required
          />
        </label>

        <label>
          Пароль
          <span className="auth-password-field">
            <input
              name="password"
              type={isPasswordVisible ? "text" : "password"}
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
              placeholder="Введите пароль"
              value={form.password}
              onChange={updateField}
              required
            />
            <button
              className="password-visibility-button"
              type="button"
              title={isPasswordVisible ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
            >
              {isPasswordVisible ? (
                <EyeOff size={17} aria-hidden="true" />
              ) : (
                <Eye size={17} aria-hidden="true" />
              )}
            </button>
          </span>
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
