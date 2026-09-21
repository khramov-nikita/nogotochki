import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  checkPasswordLoginAvailable,
  loginClient,
  loginOrLinkExternalProvider,
  logoutClient,
  publicClient,
  registerClient,
} from "../../domain/auth.js";
import { fetchYandexUserProfile } from "../../domain/yandex-oauth.js";
import { getConfig } from "../config.js";
import { clearSessionCookie, setSessionCookie, shouldUseSecureCookies } from "../cookies.js";
import { requireAuth } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rate-limit.js";

const router = express.Router();
const debugLogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../debug-8d4ae2.log");

function sendSession(req, res, status, result) {
  const { sessionDays } = getConfig();
  const secure = shouldUseSecureCookies(req);
  // #region agent log
  const logPayload = {
    sessionId: "8d4ae2",
    runId: "post-fix",
    hypothesisId: "A",
    location: "server/src/http/routes/auth.js:sendSession",
    message: "session cookie secure flag decision",
    data: {
      secure,
      reqSecure: Boolean(req.secure),
      forwardedProto: req.get("x-forwarded-proto") || null,
      status,
    },
    timestamp: Date.now(),
  };
  fetch("http://127.0.0.1:7702/ingest/1d797e59-e505-4948-a96d-1e43e65147f9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8d4ae2" },
    body: JSON.stringify(logPayload),
  }).catch(() => {});
  try {
    fs.appendFileSync(debugLogPath, `${JSON.stringify(logPayload)}\n`);
  } catch {
    // ignore debug log failures
  }
  // #endregion
  setSessionCookie(res, result.session.token, sessionDays * 24 * 60 * 60, secure);
  res.status(status).json({
    client: result.client,
    token: result.session.token,
    expires_at: result.session.expires_at,
  });
}

router.post("/register", authRateLimit("register"), async (req, res) => {
  const result = await registerClient(req.body, getConfig().sessionDays);
  sendSession(req, res, 201, result);
});

router.post("/login", authRateLimit("login"), async (req, res) => {
  const result = await loginClient(req.body, getConfig().sessionDays);
  sendSession(req, res, 200, result);
});

router.post("/yandex", authRateLimit("login"), async (req, res) => {
  const profile = await fetchYandexUserProfile();
  const result = loginOrLinkExternalProvider(profile, req.body, getConfig().sessionDays);
  sendSession(req, res, 200, result);
});

router.post("/password-login-available", authRateLimit("login"), (req, res) => {
  res.json(checkPasswordLoginAvailable(req.body));
});

router.post("/logout", requireAuth, (req, res) => {
  logoutClient(req.sessionToken);
  clearSessionCookie(res, shouldUseSecureCookies(req));
  res.status(200).json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ client: publicClient(req.client) });
});

export default router;
