import { getConfig } from "../config.js";

export function corsMiddleware(req, res, next) {
  const { corsOrigin } = getConfig();
  const origin = corsOrigin || req.get("origin") || "*";
  res.setHeader("Access-Control-Allow-Origin", corsOrigin ? corsOrigin : origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
