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
import { clearSessionCookie, setSessionCookie } from "../cookies.js";
import { requireAuth } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rate-limit.js";

const router = express.Router();

function sendSession(req, res, status, result) {
  const { sessionDays, nodeEnv } = getConfig();
  const secure = nodeEnv === "production";
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
  clearSessionCookie(res, getConfig().nodeEnv === "production");
  res.status(200).json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ client: publicClient(req.client) });
});

export default router;
