import { login } from "./api.js";
import { loadDraft, postAuthDestination, preserveNextOnLinks } from "./store.js";
import {
  applyServerError,
  bindPasswordToggles,
  clearFormErrors,
  formValues,
  setFieldError,
  validateEmail,
  validatePassword,
} from "./form.js";

const form = document.getElementById("login-form");
const alertEl = document.getElementById("form-alert");

bindPasswordToggles(form);
preserveNextOnLinks();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormErrors(form, alertEl);

  const values = formValues(form);
  const emailError = validateEmail(values.email);
  const passwordError = validatePassword(values.password, "password");
  let blocked = false;

  if (emailError) {
    setFieldError(form, "email", emailError);
    blocked = true;
  }
  if (passwordError) {
    setFieldError(form, "password", passwordError);
    blocked = true;
  }
  if (blocked) {
    return;
  }

  try {
    const payload = {
      email: values.email.trim(),
      password: values.password,
    };
    const holdToken = loadDraft().holdToken;
    if (holdToken) {
      payload.hold_token = holdToken;
    }
    const body = await login(payload);
    window.location.href = postAuthDestination(location.search, body?.client);
  } catch (error) {
    applyServerError(form, alertEl, error);
  }
});
