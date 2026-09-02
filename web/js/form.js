const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export function bindPasswordToggles(root = document) {
  root.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const field = button.closest(".input-password");
    const input = field?.querySelector("input");
    const icon = button.querySelector(".icon");
    if (!input || !icon) {
      return;
    }

    button.addEventListener("click", () => {
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      icon.classList.toggle("icon--eye-off", !hidden);
      icon.classList.toggle("icon--eye", hidden);
      button.setAttribute("aria-label", hidden ? "Скрыть пароль" : "Показать пароль");
    });
  });
}

export function clearFormErrors(form, alertEl) {
  form.querySelectorAll(".field").forEach((field) => {
    field.classList.remove("field--error");
  });
  form.querySelectorAll(".field-error").forEach((node) => {
    node.textContent = "";
  });
  setAlert(alertEl, "");
}

export function setFieldError(form, name, message) {
  const field = form.querySelector(`[data-field="${name}"]`);
  const errorNode = form.querySelector(`[data-error-for="${name}"]`);
  if (field) {
    field.classList.add("field--error");
  }
  if (errorNode) {
    errorNode.textContent = message;
  }
}

export function setAlert(alertEl, message) {
  if (!alertEl) {
    return;
  }
  const text = alertEl.querySelector("p") || alertEl;
  if (text !== alertEl) {
    text.textContent = message;
  } else {
    alertEl.textContent = message;
  }
  alertEl.classList.toggle("is-visible", Boolean(message));
}

export function validateEmail(value) {
  const email = String(value || "").trim();
  if (!email) {
    return "Укажите почту";
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return "Некорректный email";
  }
  return "";
}

export function validatePassword(value, label = "пароль") {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Поле ${label}: пароль от 8 до 200 символов`;
  }
  return "";
}

export function validatePasswordMatch(password, confirmation) {
  if (password !== confirmation) {
    return "Пароли не совпадают";
  }
  return "";
}

export function fieldsFromApiError(error) {
  if (error?.code === "UNAUTHORIZED") {
    return [];
  }

  const explicit = error?.body?.field || error?.body?.error?.field;
  if (typeof explicit === "string" && explicit) {
    return [explicit];
  }

  if (error?.code === "EMAIL_TAKEN") {
    return ["email"];
  }

  const message = error?.message || "";
  if (/Пароли не совпадают/i.test(message)) {
    return ["password", "password_confirmation"];
  }

  const fields = [];
  if (/password_confirmation/i.test(message)) {
    fields.push("password_confirmation");
  } else if (/Поле password:/i.test(message)) {
    fields.push("password");
  }
  if (/email/i.test(message) || /почт/i.test(message)) {
    fields.push("email");
  }
  return fields;
}

export function applyServerError(form, alertEl, error) {
  const message = error?.message || "Не удалось отправить форму";
  setAlert(alertEl, message);
  fieldsFromApiError(error).forEach((name) => {
    setFieldError(form, name, message);
  });
}

export function formValues(form) {
  const data = new FormData(form);
  const values = {};
  data.forEach((value, key) => {
    values[key] = String(value ?? "");
  });
  return values;
}
