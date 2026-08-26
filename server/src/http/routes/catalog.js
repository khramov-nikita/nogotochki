import express from "express";
import { findAvailabilityForRequest } from "../../domain/availability.js";
import { listMasters, listServices } from "../../domain/catalog.js";
import { parseId, parseLocalDate, parseOptionalToken, parseServiceIds } from "../../domain/validate.js";

const router = express.Router();

router.get("/services", (_req, res) => {
  res.json({ services: listServices() });
});

router.get("/masters", (req, res) => {
  res.json({ masters: listMasters(req.query.service_ids) });
});

router.get("/masters/:id/availability", (req, res) => {
  const masterId = parseId(req.params.id, "id");
  const localDate = parseLocalDate(req.query.date, "date");
  const serviceIds = parseServiceIds(req.query.service_ids);
  const excludeHoldToken = parseOptionalToken(req.query.exclude_hold_token);
  const excludeAppointmentId = req.query.exclude_appointment_id
    ? parseId(req.query.exclude_appointment_id, "exclude_appointment_id")
    : null;
  const availability = findAvailabilityForRequest(
    { localDate, serviceIds, excludeHoldToken, excludeAppointmentId },
    masterId,
  );
  res.json(availability);
});

export default router;
