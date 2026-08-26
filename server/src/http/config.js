export function getConfig() {
  const adminEmails = (process.env.ADMIN_EMAILS || "admin@nogotochki.test")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const sessionDays = Number(process.env.SESSION_DAYS);
  const port = Number(process.env.PORT);

  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    corsOrigin: process.env.CORS_ORIGIN?.trim() || "",
    sessionDays: Number.isInteger(sessionDays) && sessionDays > 0 ? sessionDays : 30,
    adminEmails,
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

export function isAdminEmail(email) {
  if (!email) {
    return false;
  }
  return getConfig().adminEmails.includes(String(email).toLowerCase());
}

export function overlapRequested(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function resolveOverlapOverride(email, requested) {
  return isAdminEmail(email) && overlapRequested(requested) ? 1 : 0;
}
