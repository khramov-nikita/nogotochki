import { loginWithYandex, register } from "./api.js";
import { loadDraft, postAuthDestination, preserveNextOnLinks } from "./store.js";
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
const yandexButton = document.getElementById("yandex-login");

bindPasswordToggles(form);
preserveNextOnLinks();

async function completeYandexLogin() {
  clearFormErrors(form, alertEl);
  try {
    const payload = {};
    const holdToken = loadDraft().holdToken;
    if (holdToken) {
      payload.hold_token = holdToken;
    }
    const body = await loginWithYandex(payload);
    window.location.href = postAuthDestination(location.search, body?.client);
  } catch (error) {
    applyServerError(form, alertEl, error);
  }
}

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
    const body = await register(payload);
    window.location.href = postAuthDestination(location.search, body?.client);
  } catch (error) {
    applyServerError(form, alertEl, error);
  }
});

yandexButton?.addEventListener("click", () => {
  void completeYandexLogin();
});
