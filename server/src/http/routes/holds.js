import express from "express";
import { createHold, deleteHold, getHold } from "../../domain/holds.js";

const router = express.Router();

router.post("/", (req, res) => {
  const clientId = req.client?.id ?? null;
  const hold = createHold(req.body, clientId, req.client?.email);
  res.status(201).json({ hold });
});

router.get("/:token", (req, res) => {
  res.json({ hold: getHold(req.params.token) });
});

router.delete("/:token", (req, res) => {
  deleteHold(req.params.token);
  res.json({ ok: true });
});

export default router;
