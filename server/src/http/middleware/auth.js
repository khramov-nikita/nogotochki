import { HttpError } from "../errors.js";
import { readSessionToken } from "../cookies.js";
import { findSessionClient } from "../../domain/auth.js";
import { ROLE_ADMINISTRATOR, hasRole } from "../../domain/roles.js";

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

export function requireRole(...slugs) {
  return (req, _res, next) => {
    if (!req.client) {
      next(new HttpError(401, "UNAUTHORIZED", "Нужна авторизация"));
      return;
    }
    if (!slugs.some((slug) => hasRole(req.client, slug))) {
      next(new HttpError(403, "FORBIDDEN", "Недостаточно прав"));
      return;
    }
    next();
  };
}

export function requireAdmin(req, res, next) {
  requireRole(ROLE_ADMINISTRATOR)(req, res, next);
}
