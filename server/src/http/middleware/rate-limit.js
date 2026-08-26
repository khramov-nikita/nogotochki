import { HttpError } from "../errors.js";

const buckets = new Map();

const settings = {
  windowMs: 15 * 60 * 1000,
  loginMax: 10,
  registerMax: 8,
  ipMax: 40,
};

export function configureAuthRateLimit(partial = {}) {
  Object.assign(settings, partial);
}

export function resetAuthRateLimits() {
  buckets.clear();
}

function take(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function clientIp(req) {
  const ip = typeof req.ip === "string" ? req.ip.trim() : "";
  return ip || "unknown";
}

function emailKey(req) {
  const email = req.body?.email;
  if (typeof email !== "string") {
    return "";
  }
  return email.trim().toLowerCase().slice(0, 254);
}

export function authRateLimit(kind) {
  return (req, _res, next) => {
    const ip = clientIp(req);
    const email = emailKey(req);
    const windowMs = settings.windowMs;
    const kindMax = kind === "register" ? settings.registerMax : settings.loginMax;
    const ipMax = kind === "register" ? settings.registerMax : settings.ipMax;
    const ipOk = take(`${kind}:ip:${ip}`, ipMax, windowMs);
    const identityOk = email
      ? take(`${kind}:ip:${ip}:email:${email}`, kindMax, windowMs)
      : take(`${kind}:ip:${ip}:anon`, kindMax, windowMs);

    if (!ipOk || !identityOk) {
      next(new HttpError(429, "RATE_LIMITED", "Слишком много попыток, попробуйте позже"));
      return;
    }
    next();
  };
}
