import express from "express";
import { listNotificationsForClient, markNotificationRead } from "../../domain/notifications.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(listNotificationsForClient(req.client.id));
});

router.post("/:id/read", (req, res) => {
  res.json(markNotificationRead(req.params.id, req.client.id));
});

export default router;
