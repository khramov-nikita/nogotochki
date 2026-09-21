import { loginWithYandex } from "./api.js";
import { loadDraft, postAuthDestination } from "./store.js";

const INCOMPLETE_MESSAGE =
  "Вход через Яндекс не завершён. Можно попробовать снова или войти по паролю";

function toAbsoluteAppPath(path) {
  const value = String(path || "").trim();
  if (!value) {
    return "/cabinet.html";
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
    return value;
  }
  return `/${value}`;
}

function redirectToLoginIncomplete() {
  const url = new URL("/auth.html", window.location.origin);
  url.searchParams.set("yandex", "incomplete");
  window.location.replace(url.pathname + url.search);
}

async function completeYandexCallback() {
  const params = new URLSearchParams(window.location.search);
  const error = String(params.get("error") || "").trim();
  const code = String(params.get("code") || "").trim();

  if (error || !code) {
    redirectToLoginIncomplete();
    return;
  }

  try {
    const payload = { code };
    const holdToken = loadDraft().holdToken;
    if (holdToken) {
      payload.hold_token = holdToken;
    }
    const body = await loginWithYandex(payload);
    window.location.replace(toAbsoluteAppPath(postAuthDestination("", body?.client)));
  } catch {
    redirectToLoginIncomplete();
  }
}

void completeYandexCallback();
