import { HttpError } from "../http/errors.js";

export function getStudioSettings(db) {
  const row = db.prepare("SELECT * FROM studio_settings WHERE id = 1").get();
  if (!row) {
    throw new HttpError(500, "SERVER_ERROR", "Не заданы настройки студии");
  }
  return row;
}
