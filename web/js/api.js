export class ApiError extends Error {
  constructor(status, body) {
    const message = body?.error?.message || `Ошибка ${status}`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code || null;
    this.body = body || null;
  }
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body != null && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(path, {
      method: options.method || "GET",
      headers,
      credentials: "same-origin",
      body: options.body == null || typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, {
      error: { code: "NETWORK_ERROR", message: "Нет связи с API. Запущен ли сервер на порту 3000?" },
    });
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: { code: "PARSE_ERROR", message: text || `Ошибка ${response.status}` } };
  }

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body;
}

export async function getServices() {
  const body = await api("/api/services");
  return body.services || [];
}

export async function getMasters() {
  const body = await api("/api/masters");
  return body.masters || [];
}

export function login(credentials) {
  return api("/api/auth/login", {
    method: "POST",
    body: {
      email: credentials.email,
      password: credentials.password,
    },
  });
}

export function register(credentials) {
  return api("/api/auth/register", {
    method: "POST",
    body: {
      email: credentials.email,
      password: credentials.password,
      password_confirmation: credentials.password_confirmation,
    },
  });
}

export function getMe() {
  return api("/api/auth/me");
}

export function logout() {
  return api("/api/auth/logout", { method: "POST" });
}
