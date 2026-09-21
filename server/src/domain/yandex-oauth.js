import { getConfig } from "../http/config.js";
import { HttpError } from "../http/errors.js";

const TOKEN_URL = "https://oauth.yandex.ru/token";
const INFO_URL = "https://login.yandex.ru/info?format=json";
const AUTHORIZE_URL = "https://oauth.yandex.ru/authorize";
const OAUTH_SCOPE = "login:email,login:info";

function requireYandexConfig() {
  const config = getConfig();
  const clientId = config.yandexClientId;
  const clientSecret = config.yandexClientSecret;
  const redirectUri = config.yandexRedirectUri;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(
      501,
      "YANDEX_NOT_CONFIGURED",
      "Вход через Яндекс не настроен. Задайте YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET и YANDEX_REDIRECT_URI",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function buildDisplayName(info) {
  const parts = [info?.first_name, info?.last_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Единственное место обмена с Яндексом.
 * Обмен code → token → профиль; остальная логика входа не меняется.
 * Токен Яндекса сюда не возвращайте и нигде не сохраняйте.
 */
export async function fetchYandexUserProfile(params = {}) {
  const code = String(params?.code || "").trim();
  if (!code) {
    throw new HttpError(400, "VALIDATION_ERROR", "Не передан код авторизации Яндекса");
  }

  const { clientId, clientSecret, redirectUri } = requireYandexConfig();

  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  let tokenResponse;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
  } catch {
    throw new HttpError(502, "YANDEX_UNAVAILABLE", "Не удалось связаться с Яндексом. Попробуйте ещё раз");
  }

  const tokenPayload = await readJsonResponse(tokenResponse);
  const accessToken = String(tokenPayload?.access_token || "").trim();
  if (!tokenResponse.ok || !accessToken) {
    throw new HttpError(
      400,
      "YANDEX_OAUTH_FAILED",
      "Вход через Яндекс не завершён. Можно попробовать снова или войти по паролю",
    );
  }

  let infoResponse;
  try {
    infoResponse = await fetch(INFO_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
  } catch {
    throw new HttpError(502, "YANDEX_UNAVAILABLE", "Не удалось связаться с Яндексом. Попробуйте ещё раз");
  }

  const info = await readJsonResponse(infoResponse);
  const providerId = String(info?.id || "").trim();
  const email = String(info?.default_email || info?.emails?.[0] || "")
    .trim()
    .toLowerCase();

  if (!infoResponse.ok || !providerId || !email || !email.includes("@")) {
    throw new HttpError(
      400,
      "YANDEX_OAUTH_FAILED",
      "Вход через Яндекс не завершён. Можно попробовать снова или войти по паролю",
    );
  }

  return {
    provider: "yandex",
    provider_id: providerId,
    email,
    display_name: buildDisplayName(info),
  };
}

export function buildYandexAuthorizeUrl() {
  const { clientId, redirectUri } = requireYandexConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  return url.toString();
}
