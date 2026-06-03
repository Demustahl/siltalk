import { Search } from "lucide-react";

import homeEmptyImage from "../assets/icons/message1.png";

export function DialogsPage({ navigate }) {
  return (
    <div className="home-page">
      <section className="home-empty-state">
        <img
          className="home-empty-image"
          src={homeEmptyImage}
          alt=""
          aria-hidden="true"
        />

        <div className="home-empty-copy">
          <h2>Выберите, кому написать</h2>
          <p>Выберите существующий чат слева или найдите нового пользователя.</p>
        </div>

        <button className="home-cta" type="button" onClick={() => navigate("/new")}>
          <Search size={20} aria-hidden="true" />
          Найти пользователя
        </button>
      </section>
    </div>
  );
}
