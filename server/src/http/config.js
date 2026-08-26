export function parseTrustProxy(value = process.env.TRUST_PROXY) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return 1;
  }
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 1) {
    return hops;
  }
  return false;
}

export function getConfig() {
  const sessionDays = Number(process.env.SESSION_DAYS);
  const port = Number(process.env.PORT);

  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    corsOrigin: process.env.CORS_ORIGIN?.trim() || "",
    sessionDays: Number.isInteger(sessionDays) && sessionDays > 0 ? sessionDays : 30,
    nodeEnv: process.env.NODE_ENV || "development",
    trustProxy: parseTrustProxy(),
  };
}
