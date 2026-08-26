import express from "express";
import {
  cancelOwnAppointment,
  createAppointment,
  getOwnAppointment,
  listOwnAppointments,
  rescheduleOwnAppointment,
} from "../../domain/appointments.js";
import { parseId } from "../../domain/validate.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.post("/", (req, res) => {
  const appointment = createAppointment(req.body, req.client.id, req.client.email);
  res.status(201).json({ appointment });
});

router.get("/", (req, res) => {
  const scope = req.query.scope ? String(req.query.scope) : null;
  res.json({ appointments: listOwnAppointments(req.client.id, scope) });
});

router.get("/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ appointment: getOwnAppointment(id, req.client.id) });
});

router.post("/:id/cancel", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ appointment: cancelOwnAppointment(id, req.client.id) });
});

router.post("/:id/reschedule", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ appointment: rescheduleOwnAppointment(id, req.client.id, req.body, req.client.email) });
});

export default router;
