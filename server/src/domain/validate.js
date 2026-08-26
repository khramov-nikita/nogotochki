import { HttpError } from "../http/errors.js";
import { isHm, isUtcIso, isYmd } from "./time.js";

export function requireBodyObject(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Ожидается JSON-объект");
  }
  return body;
}

export function parseEmail(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", "Укажите email");
  }
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, "VALIDATION_ERROR", "Некорректный email");
  }
  return email;
}

export function parsePassword(value, field = "password") {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    throw new HttpError(400, "VALIDATION_ERROR", `Поле ${field}: пароль от 8 до 200 символов`);
  }
  return value;
}

export function parseOptionalName(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", "Некорректное имя");
  }
  const name = value.trim();
  if (name.length > 120) {
    throw new HttpError(400, "VALIDATION_ERROR", "Имя слишком длинное");
  }
  return name || null;
}

export function parseId(value, field = "id") {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new HttpError(400, "VALIDATION_ERROR", `Некорректный ${field}`);
  }
  return number;
}

export function parseServiceIds(value) {
  let raw = value;
  if (typeof raw === "string") {
    raw = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "Укажите service_ids");
  }
  const ids = raw.map((item) => parseId(item, "service_ids"));
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "service_ids не должны повторяться");
  }
  return ids;
}

export function parseUtcInstant(value, field = "starts_at") {
  if (!isUtcIso(value)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} должен быть ISO 8601 UTC, например 2026-08-26T07:00:00Z`,
    );
  }
  return value;
}

export function parseLocalDate(value, field = "date") {
  if (!isYmd(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} должен быть YYYY-MM-DD`);
  }
  return value;
}

export function parseHm(value, field = "start_time") {
  if (!isHm(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} должен быть HH:MM`);
  }
  return value;
}

export function parseBooleanFlag(value, field) {
  if (value === true || value === 1 || value === "1") {
    return 1;
  }
  if (value === false || value === 0 || value === "0") {
    return 0;
  }
  throw new HttpError(400, "VALIDATION_ERROR", `${field} должен быть 0 или 1`);
}

export function parseInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (value == null || value === "") {
    if (optional) {
      return null;
    }
    throw new HttpError(400, "VALIDATION_ERROR", `Укажите ${field}`);
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `Некорректное значение ${field}`);
  }
  return number;
}

export function parseOptionalToken(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Некорректный hold_token");
  }
  return value;
}
