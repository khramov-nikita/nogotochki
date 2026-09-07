import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROLE_ADMINISTRATOR, hasRole } from "../../domain/roles.js";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../web");

const ADMIN_PAGES = new Map([
  ["/admin", "admin/index.html"],
  ["/admin/", "admin/index.html"],
  ["/admin/services", "admin/services/index.html"],
  ["/admin/services/", "admin/services/index.html"],
  ["/admin/masters", "admin/masters/index.html"],
  ["/admin/masters/", "admin/masters/index.html"],
]);

function guestLoginLocation(reqPath) {
  const next = reqPath.replace(/\/$/, "") || "/admin";
  return `/auth.html?next=${encodeURIComponent(next)}`;
}

export function adminPagesHandler(req, res, next) {
  const relative = ADMIN_PAGES.get(req.path);
  if (!relative) {
    next();
    return;
  }

  if (!req.client) {
    res.redirect(guestLoginLocation(req.path));
    return;
  }

  if (!hasRole(req.client, ROLE_ADMINISTRATOR)) {
    res.status(403).sendFile(path.join(webRoot, "admin", "forbidden.html"));
    return;
  }

  res.sendFile(path.join(webRoot, relative));
}
