import { ApiError, listNotifications, markNotificationRead } from "./api.js";
import { escapeHtml } from "./format.js";
import { requireClient } from "./require-client.js";

function setError(message) {
  const node = document.getElementById("notifications-error");
  if (node) {
    node.textContent = message || "";
  }
}

function emptyMarkup() {
  return `<div class="cabinet-empty">
    <p class="heading-4">Пока нет уведомлений</p>
    <p class="body-medium">Когда студия отменит, перенесёт запись или поставит другую на ваше время — сообщение появится здесь.</p>
  </div>`;
}

function itemMarkup(row) {
  const href = row.href || (row.appointment_id ? `cabinet-appointment.html?id=${row.appointment_id}` : "cabinet.html");
  const unread = row.is_read ? "" : " cabinet-notification--unread";
  return `<a class="cabinet-notification${unread}" href="${escapeHtml(href)}" data-id="${row.id}" data-read="${row.is_read ? "1" : "0"}">
    <p class="body-medium">${escapeHtml(row.body || "")}</p>
    <p class="meta">${row.is_read ? "Прочитано" : "Новое"}</p>
  </a>`;
}

async function openItem(event) {
  const link = event.currentTarget;
  const href = link.getAttribute("href") || "cabinet.html";
  if (link.getAttribute("data-read") === "1") {
    return;
  }
  event.preventDefault();
  const id = Number(link.getAttribute("data-id"));
  if (!Number.isInteger(id) || id <= 0) {
    window.location.href = href;
    return;
  }
  try {
    await markNotificationRead(id);
  } catch {
    // переход всё равно
  }
  window.location.href = href;
}

async function render() {
  const root = document.getElementById("notifications-content");
  setError("");
  root.innerHTML = `<p class="meta" role="status">Загрузка…</p>`;
  try {
    const body = await listNotifications();
    const rows = body.notifications || [];
    if (!rows.length) {
      root.innerHTML = emptyMarkup();
      return;
    }
    root.innerHTML = `<div class="cabinet-notifications">${rows.map(itemMarkup).join("")}</div>`;
    root.querySelectorAll(".cabinet-notification").forEach((link) => {
      link.addEventListener("click", openItem);
    });
  } catch (error) {
    root.innerHTML = "";
    setError(error instanceof ApiError ? error.message : "Не удалось загрузить уведомления");
  }
}

async function init() {
  let client;
  try {
    client = await requireClient();
  } catch (error) {
    setError(error instanceof ApiError ? error.message : "Не удалось проверить вход");
    return;
  }
  if (!client) {
    return;
  }
  await render();
}

init();
