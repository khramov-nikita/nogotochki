const DRAFT_KEY = "nogotochki_booking_draft";

export function loadDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveDraft(patch) {
  const next = { ...loadDraft(), ...patch };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

export function clearDraft() {
  sessionStorage.removeItem(DRAFT_KEY);
}

const APPOINTMENT_KEY = "nogotochki_last_appointment_id";

export function saveAppointmentId(id) {
  sessionStorage.setItem(APPOINTMENT_KEY, String(id));
}

export function loadAppointmentId() {
  const raw = Number(sessionStorage.getItem(APPOINTMENT_KEY));
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

export function hasAdministratorRole(client) {
  return Array.isArray(client?.roles) && client.roles.includes("administrator");
}

export function isAdminPath(pathname = location.pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function normalizeAdminPath(pathname) {
  const trimmed = String(pathname || "").replace(/\/$/, "");
  return trimmed || "/admin";
}

function isSafeAdminNext(next) {
  return /^\/admin(?:\/(?:services|masters))?\/?$/.test(next);
}

export function safeNextPage(search = location.search, fallback = "cabinet.html") {
  const next = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("next") || "";
  if (/^[A-Za-z0-9._-]+\.html(?:\?[A-Za-z0-9._=&-]+)?$/.test(next)) {
    return next;
  }
  if (isSafeAdminNext(next)) {
    return normalizeAdminPath(next);
  }
  return fallback;
}

export function postAuthDestination(search = location.search, client = null) {
  const next = safeNextPage(search, "");
  const isAdmin = hasAdministratorRole(client);
  if (next) {
    if (isSafeAdminNext(next) && !isAdmin) {
      return "cabinet.html";
    }
    return next;
  }
  if (loadDraft().holdToken) {
    return "booking-review.html";
  }
  if (isAdmin) {
    return "/admin";
  }
  return "cabinet.html";
}

export function currentPageForNext() {
  if (isAdminPath()) {
    return normalizeAdminPath(location.pathname);
  }
  const page = location.pathname.split("/").pop() || "cabinet.html";
  if (!/^[A-Za-z0-9._-]+\.html$/.test(page)) {
    return "cabinet.html";
  }
  const params = new URLSearchParams(location.search);
  const allowed = new URLSearchParams();
  ["id", "tab", "cancel"].forEach((key) => {
    const value = params.get(key);
    if (value && /^[A-Za-z0-9._-]+$/.test(value)) {
      allowed.set(key, value);
    }
  });
  const query = allowed.toString();
  return query ? `${page}?${query}` : page;
}

export function preserveNextOnLinks(root = document) {
  const next = safeNextPage(location.search, "");
  if (!next) {
    return;
  }
  root.querySelectorAll('a[href="auth.html"], a[href="register.html"]').forEach((link) => {
    const href = link.getAttribute("href");
    link.setAttribute("href", `${href}?next=${encodeURIComponent(next)}`);
  });
}

export function parseQuerySelection(search = location.search) {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const serviceIds = (query.get("service_ids") || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  const masterRaw = Number(query.get("master_id"));
  const masterId = Number.isInteger(masterRaw) && masterRaw > 0 ? masterRaw : null;
  return { serviceIds, masterId };
}
