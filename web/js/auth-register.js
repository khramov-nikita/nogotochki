import { register } from "./api.js";
import { loadDraft, preserveNextOnLinks, safeNextPage } from "./store.js";
import {
  applyServerError,
  bindPasswordToggles,
  clearFormErrors,
  formValues,
  setAlert,
  setFieldError,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from "./form.js";

const form = document.getElementById("register-form");
const alertEl = document.getElementById("form-alert");

bindPasswordToggles(form);
preserveNextOnLinks();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormErrors(form, alertEl);

  const values = formValues(form);
  const emailError = validateEmail(values.email);
  const passwordError = validatePassword(values.password, "password");
  const confirmationError = validatePassword(values.password_confirmation, "password_confirmation");
  const matchError = validatePasswordMatch(values.password, values.password_confirmation);
  let blocked = false;

  if (emailError) {
    setFieldError(form, "email", emailError);
    blocked = true;
  }
  if (passwordError) {
    setFieldError(form, "password", passwordError);
    blocked = true;
  }
  if (confirmationError) {
    setFieldError(form, "password_confirmation", confirmationError);
    blocked = true;
  } else if (matchError) {
    setFieldError(form, "password", matchError);
    setFieldError(form, "password_confirmation", matchError);
    setAlert(alertEl, matchError);
    blocked = true;
  }
  if (blocked) {
    return;
  }

  try {
    const payload = {
      email: values.email.trim(),
      password: values.password,
      password_confirmation: values.password_confirmation,
    };
    const holdToken = loadDraft().holdToken;
    if (holdToken) {
      payload.hold_token = holdToken;
    }
    await register(payload);
    window.location.href = safeNextPage();
  } catch (error) {
    applyServerError(form, alertEl, error);
  }
});
