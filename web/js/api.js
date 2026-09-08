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
      cache: "no-store",
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

export async function getMasters(serviceIds) {
  const ids = Array.isArray(serviceIds)
    ? serviceIds.filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const path = ids.length ? `/api/masters?service_ids=${ids.join(",")}` : "/api/masters";
  const body = await api(path);
  return body.masters || [];
}

function positiveIds(ids) {
  return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id) && id > 0) : [];
}

export async function getAvailability(masterId, { date, serviceIds, excludeHoldToken, excludeAppointmentId } = {}) {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }
  const ids = positiveIds(serviceIds);
  if (ids.length) {
    params.set("service_ids", ids.join(","));
  }
  if (excludeHoldToken) {
    params.set("exclude_hold_token", excludeHoldToken);
  }
  if (excludeAppointmentId) {
    params.set("exclude_appointment_id", String(excludeAppointmentId));
  }
  return api(`/api/masters/${masterId}/availability?${params}`);
}

export function createHold(payload) {
  return api("/api/holds", { method: "POST", body: payload });
}

export function getHold(token) {
  return api(`/api/holds/${encodeURIComponent(token)}`);
}

export function deleteHold(token) {
  return api(`/api/holds/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export function login(credentials) {
  const body = {
    email: credentials.email,
    password: credentials.password,
  };
  if (credentials.hold_token) {
    body.hold_token = credentials.hold_token;
  }
  return api("/api/auth/login", { method: "POST", body });
}

export function register(credentials) {
  const body = {
    email: credentials.email,
    password: credentials.password,
    password_confirmation: credentials.password_confirmation,
  };
  if (credentials.hold_token) {
    body.hold_token = credentials.hold_token;
  }
  return api("/api/auth/register", { method: "POST", body });
}

export function createAppointment(holdToken) {
  return api("/api/appointments", {
    method: "POST",
    body: { hold_token: holdToken },
  });
}

export function getAppointment(id) {
  return api(`/api/appointments/${id}`);
}

export async function listAppointments(scope) {
  const params = new URLSearchParams();
  if (scope) {
    params.set("scope", scope);
  }
  const query = params.toString();
  const body = await api(query ? `/api/appointments?${query}` : "/api/appointments");
  return body.appointments || [];
}

export function cancelAppointment(id) {
  return api(`/api/appointments/${id}/cancel`, { method: "POST" });
}

export function rescheduleAppointment(id, payload) {
  return api(`/api/appointments/${id}/reschedule`, {
    method: "POST",
    body: payload,
  });
}

export function getMe() {
  return api("/api/auth/me");
}

export function logout() {
  return api("/api/auth/logout", { method: "POST" });
}

export function listNotifications() {
  return api("/api/notifications");
}

export function markNotificationRead(id) {
  return api(`/api/notifications/${id}/read`, { method: "POST" });
}

export async function adminListServices() {
  const body = await api("/api/admin/services");
  return body.services || [];
}

export function adminCreateService(payload) {
  return api("/api/admin/services", { method: "POST", body: payload });
}

export function adminUpdateService(id, payload) {
  return api(`/api/admin/services/${id}`, { method: "PATCH", body: payload });
}

export function adminDeleteService(id) {
  return api(`/api/admin/services/${id}`, { method: "DELETE" });
}

export async function adminListMasters() {
  const body = await api("/api/admin/masters");
  return body.masters || [];
}

export function adminCreateMaster(payload) {
  return api("/api/admin/masters", { method: "POST", body: payload });
}

export function adminUpdateMaster(id, payload) {
  return api(`/api/admin/masters/${id}`, { method: "PATCH", body: payload });
}

export function adminDeleteMaster(id) {
  return api(`/api/admin/masters/${id}`, { method: "DELETE" });
}

export function adminListAppointments({ date, masterId, scope } = {}) {
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }
  if (masterId) {
    params.set("master_id", String(masterId));
  }
  if (scope) {
    params.set("scope", scope);
  }
  const query = params.toString();
  return api(query ? `/api/admin/appointments?${query}` : "/api/admin/appointments");
}

export function adminConfirmAppointment(id) {
  return api(`/api/admin/appointments/${id}`, {
    method: "PATCH",
    body: { status: "confirmed" },
  });
}

export function adminCreateAppointment(payload) {
  return api("/api/admin/appointments", { method: "POST", body: payload });
}

export function adminCancelAppointment(id, reason) {
  return api(`/api/admin/appointments/${id}/cancel`, {
    method: "POST",
    body: { reason },
  });
}

export function adminRescheduleAppointment(id, payload) {
  return api(`/api/admin/appointments/${id}/reschedule`, {
    method: "POST",
    body: payload,
  });
}

export function adminCreateTimeBlock(payload) {
  return api("/api/admin/time-blocks", { method: "POST", body: payload });
}

export function adminDeleteTimeBlock(id) {
  return api(`/api/admin/time-blocks/${id}`, { method: "DELETE" });
}
