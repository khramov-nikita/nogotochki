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
        <a class="header-login header-register" href="register.html">Регистрация</a>
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
  root.querySelectorAll(".header-logout").forEach((button) => {
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
  });
}

function overlayItems(header) {
  const items = [];
  const seen = new Set();
  header.querySelectorAll(".nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const label = link.textContent.trim();
    const key = `${href}|${label}`;
    if (!label || seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({ href, label, kind: "link" });
  });

  if (!items.some((item) => /кабинет/i.test(item.label))) {
    items.push({ href: "cabinet.html", label: "Кабинет", kind: "link" });
  }

  const register = header.querySelector(".header-register, a[href='register.html']");
  if (register && !items.some((item) => item.href === "register.html")) {
    items.push({ href: "register.html", label: register.textContent.trim() || "Регистрация", kind: "link" });
  }

  if (header.querySelector(".header-logout")) {
    items.push({ kind: "logout", label: "Выйти" });
  }

  return items;
}

function overlayMarkup(items) {
  const links = items
    .map((item) => {
      if (item.kind === "logout") {
        return `<button type="button" class="header-login header-logout">${escapeHtml(item.label)}</button>`;
      }
      return `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`;
    })
    .join("");
  return `<div class="header-menu" id="header-menu" hidden>
      <div class="header-menu-panel">
        <button class="header-menu-close" type="button" aria-label="Закрыть меню">
          <span class="icon icon--close" aria-hidden="true"></span>
        </button>
        <nav class="header-menu-nav" aria-label="Мобильное меню">${links}</nav>
      </div>
    </div>`;
}

function setMenuOpen(header, open) {
  const toggle = header.querySelector(".header-menu-toggle");
  const menu = header.querySelector(".header-menu");
  if (!toggle || !menu) {
    return;
  }
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
  document.body.classList.toggle("header-menu-open", open);
}

function bindMobileMenu(header) {
  const toggle = header.querySelector(".header-menu-toggle");
  const menu = header.querySelector(".header-menu");
  if (!toggle || !menu) {
    return;
  }

  const close = () => setMenuOpen(header, false);

  toggle.addEventListener("click", () => {
    setMenuOpen(header, menu.hidden);
  });
  menu.querySelector(".header-menu-close")?.addEventListener("click", close);
  menu.addEventListener("click", (event) => {
    if (event.target === menu) {
      close();
    }
  });
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", close);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      close();
    }
  });
}

export function enhanceHeader(header) {
  if (!header || header.dataset.menuReady === "1") {
    return header;
  }

  const account = header.querySelector(".header-account");
  const login = header.querySelector(":scope > .header-login");
  const end = document.createElement("div");
  end.className = "header-end";

  if (account) {
    account.replaceWith(end);
    end.append(account);
  } else if (login) {
    login.replaceWith(end);
    end.append(login);
  } else {
    header.append(end);
  }

  end.insertAdjacentHTML(
    "beforeend",
    `<button class="header-menu-toggle" type="button" aria-expanded="false" aria-controls="header-menu" aria-label="Открыть меню">
        <span class="header-menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>
      </button>`,
  );
  header.insertAdjacentHTML("beforeend", overlayMarkup(overlayItems(header)));
  header.dataset.menuReady = "1";
  bindMobileMenu(header);
  return header;
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

  enhanceHeader(header);
  bindLogout(header);
}

const placeholder = document.getElementById("site-header");
if (placeholder) {
  mountHeader(placeholder);
} else {
  const staticHeader = document.querySelector("header.header");
  if (staticHeader) {
    enhanceHeader(staticHeader);
  }
}
