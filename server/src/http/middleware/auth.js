import { findSessionClient } from "../../domain/auth.js";
import { HttpError } from "../errors.js";
import { readSessionToken } from "../cookies.js";
import { isAdminEmail } from "../config.js";

export function optionalAuth(req, _res, next) {
  req.sessionToken = readSessionToken(req);
  req.client = findSessionClient(req.sessionToken);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.client) {
    next(new HttpError(401, "UNAUTHORIZED", "Нужна авторизация"));
    return;
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.client) {
    next(new HttpError(401, "UNAUTHORIZED", "Нужна авторизация"));
    return;
  }
  if (!isAdminEmail(req.client.email)) {
    next(new HttpError(403, "FORBIDDEN", "Недостаточно прав"));
    return;
  }
  next();
}
