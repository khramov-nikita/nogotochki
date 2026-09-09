import { getConfig } from "../http/config.js";
import { HttpError } from "../http/errors.js";

/**
 * Единственное место обмена с Яндексом.
 * После публикации сервиса и регистрации приложения замените заглушку
 * на обмен code → token → профиль; остальная логика входа не меняется.
 * Токен Яндекса сюда не возвращайте и нигде не сохраняйте.
 */
export async function fetchYandexUserProfile(_params = {}) {
  const config = getConfig();
  if (config.yandexOAuthStub) {
    const email = String(config.yandexStubEmail || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) {
      throw new HttpError(
        500,
        "YANDEX_STUB_MISCONFIGURED",
        "Заглушка Яндекса включена, но YANDEX_STUB_EMAIL не задан",
      );
    }
    return {
      provider: "yandex",
      provider_id: String(config.yandexStubProviderId || "yandex-stub-1"),
      email,
      display_name: config.yandexStubName || null,
    };
  }

  throw new HttpError(
    501,
    "YANDEX_NOT_CONFIGURED",
    "Вход через Яндекс пока не настроен. Для локальной проверки включите YANDEX_OAUTH_STUB в .env",
  );
}
