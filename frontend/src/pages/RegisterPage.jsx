import { Eye, EyeOff, UserPlus } from "lucide-react";
import { useState } from "react";

export function RegisterPage({ onRegister, navigate }) {
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
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
        <div className="auth-brand auth-brand-centered">
          <p className="auth-product-name">SilTalk</p>
          <span className="auth-divider" aria-hidden="true" />
          <h1>Регистрация</h1>
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
              autoComplete="new-password"
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

        <label>
          Отображаемое имя
          <input
            name="displayName"
            type="text"
            maxLength={120}
            placeholder="Введите отображаемое имя"
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
