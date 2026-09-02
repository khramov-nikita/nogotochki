import { login } from "./api.js";
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
    await login({
      email: values.email.trim(),
      password: values.password,
    });
    window.location.href = "cabinet.html";
  } catch (error) {
    applyServerError(form, alertEl, error);
  }
});
