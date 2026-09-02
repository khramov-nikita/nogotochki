import { ApiError, getMe, logout } from "./api.js";
import { escapeHtml } from "./format.js";

function clientLabel(client) {
  const name = client?.display_name?.trim();
  return name || client?.email?.trim() || "";
}

function clientInitials(client) {
  const name = client?.display_name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const email = client?.email?.trim() || "";
  return email.slice(0, 1).toUpperCase();
}

function navMarkup() {
  return `<a class="logo" href="index.html">Ноготочки</a>
      <nav class="nav" aria-label="Разделы сайта">
        <a href="catalog.html">Услуги</a>
        <a href="index.html#masters">Мастера</a>
        <a href="booking.html">Записаться</a>
      </nav>`;
}

function guestAccountMarkup() {
  return `<div class="header-account">
        <a class="header-login" href="auth.html">Войти</a>
        <a class="header-login" href="register.html">Регистрация</a>
      </div>`;
}

function loggedInAccountMarkup(client) {
  const label = clientLabel(client);
  const initials = clientInitials(client);
  return `<div class="header-account">
        <a class="header-user" href="cabinet.html">
          <span class="header-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
          <span class="header-user-name">${escapeHtml(label)}</span>
        </a>
        <button type="button" class="header-login header-logout">Выйти</button>
      </div>`;
}

function bindLogout(root) {
  const button = root.querySelector(".header-logout");
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await logout();
      window.location.href = "index.html";
    } catch (error) {
      button.disabled = false;
      const message = error instanceof ApiError ? error.message : "Не удалось выйти";
      let note = root.querySelector(".header-error");
      if (!note) {
        note = document.createElement("p");
        note.className = "header-error";
        root.querySelector(".header-account")?.append(note);
      }
      note.textContent = message;
    }
  });
}

export async function mountHeader(root) {
  if (!root) {
    return;
  }

  const header = document.createElement("header");
  header.className = "header";
  header.innerHTML = `${navMarkup()}<div class="header-account"></div>`;
  root.replaceWith(header);

  let account = guestAccountMarkup();
  try {
    const body = await getMe();
    if (body?.client) {
      account = loggedInAccountMarkup(body.client);
    }
  } catch {
    account = guestAccountMarkup();
  }

  const slot = header.querySelector(".header-account");
  if (slot) {
    slot.outerHTML = account;
  }

  bindLogout(header);
}

const placeholder = document.getElementById("site-header");
if (placeholder) {
  mountHeader(placeholder);
}
