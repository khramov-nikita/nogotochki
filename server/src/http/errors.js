export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isUniqueConstraint(error) {
  return /UNIQUE constraint failed/i.test(error?.message ?? "");
}

export function isForeignKeyConstraint(error) {
  return /FOREIGN KEY constraint failed/i.test(error?.message ?? "");
}

export function isAppointmentOverlap(error) {
  return /APPOINTMENT_OVERLAP/i.test(error?.message ?? "");
}

function isSqliteError(error) {
  const message = error?.message ?? "";
  const code = String(error?.code ?? "");
  return (
    code.startsWith("SQLITE") ||
    /SQLITE|constraint failed|database disk|database is locked|no such table|no such column/i.test(
      message,
    )
  );
}

function looksInternal(value) {
  return /SQLITE|constraint failed|\\Users\\|\/home\/|\/var\/|node_modules|at\s+\S+\s+\(/i.test(
    String(value ?? ""),
  );
}

export function notFoundHandler(_req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Маршрут не найден" },
  });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    const payload = {
      error: { code: err.code, message: err.message },
    };
    if (err.details && typeof err.details === "object" && !looksInternal(JSON.stringify(err.details))) {
      Object.assign(payload, err.details);
    }
    res.status(err.status).json(payload);
    return;
  }

  if (isAppointmentOverlap(err)) {
    res.status(409).json({
      error: { code: "SLOT_TAKEN", message: "Это время уже занято" },
    });
    return;
  }

  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Некорректный JSON" },
    });
    return;
  }

  if (isSqliteError(err) || looksInternal(err?.message) || looksInternal(err?.stack)) {
    console.error(err);
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Внутренняя ошибка сервера" },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: "SERVER_ERROR", message: "Внутренняя ошибка сервера" },
  });
}
