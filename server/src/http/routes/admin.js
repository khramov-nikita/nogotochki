import express from "express";
import {
  createMaster,
  createService,
  deleteMaster,
  deleteService,
  listAdminMasters,
  listAdminServices,
  updateMaster,
  updateService,
} from "../../domain/admin.js";
import {
  cancelAdminAppointment,
  confirmAppointment,
  createAdminAppointment,
  listAllAppointments,
  rescheduleAdminAppointment,
} from "../../domain/appointments.js";
import { createTimeBlock, deleteTimeBlock } from "../../domain/time-blocks.js";
import { parseId, requireBodyObject } from "../../domain/validate.js";
import { HttpError } from "../errors.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAdmin);

router.get("/appointments", (req, res) => {
  const result = listAllAppointments({
    scope: req.query.scope ? String(req.query.scope) : null,
    date: req.query.date ? String(req.query.date) : null,
    masterId: req.query.master_id || null,
  });
  res.json(result);
});

router.post("/appointments", (req, res) => {
  res.status(201).json({ appointment: createAdminAppointment(req.body, req.client) });
});

router.patch("/appointments/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  const body = requireBodyObject(req.body);
  if (body.status !== "confirmed") {
    throw new HttpError(400, "VALIDATION_ERROR", "Можно выставить только status=confirmed");
  }
  res.json({ appointment: confirmAppointment(id) });
});

router.post("/appointments/:id/cancel", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ appointment: cancelAdminAppointment(id, req.body, req.client) });
});

router.post("/appointments/:id/reschedule", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ appointment: rescheduleAdminAppointment(id, req.body, req.client) });
});

router.post("/time-blocks", (req, res) => {
  res.status(201).json({ time_block: createTimeBlock(req.body) });
});

router.delete("/time-blocks/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json(deleteTimeBlock(id));
});

router.get("/services", (_req, res) => {
  res.json({ services: listAdminServices() });
});

router.post("/services", (req, res) => {
  res.status(201).json({ service: createService(req.body) });
});

router.patch("/services/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ service: updateService(id, req.body) });
});

router.delete("/services/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json(deleteService(id));
});

router.get("/masters", (_req, res) => {
  res.json({ masters: listAdminMasters() });
});

router.post("/masters", (req, res) => {
  res.status(201).json({ master: createMaster(req.body) });
});

router.patch("/masters/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json({ master: updateMaster(id, req.body) });
});

router.delete("/masters/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  res.json(deleteMaster(id));
});

export default router;
