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
import { confirmAppointment, listAllAppointments } from "../../domain/appointments.js";
import { parseId, requireBodyObject } from "../../domain/validate.js";
import { HttpError } from "../errors.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAdmin);

router.get("/appointments", (req, res) => {
  const scope = req.query.scope ? String(req.query.scope) : null;
  res.json({ appointments: listAllAppointments(scope) });
});

router.patch("/appointments/:id", (req, res) => {
  const id = parseId(req.params.id, "id");
  const body = requireBodyObject(req.body);
  if (body.status !== "confirmed") {
    throw new HttpError(400, "VALIDATION_ERROR", "Можно выставить только status=confirmed");
  }
  res.json({ appointment: confirmAppointment(id) });
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
  deleteService(id);
  res.json({ ok: true });
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
  deleteMaster(id);
  res.json({ ok: true });
});

export default router;
