import {
  bindPasswordToggles,
  clearFormErrors,
  formValues,
  setAlert,
  setFieldError,
  validatePassword,
  validatePasswordMatch,
} from "./form.js";

const form = document.getElementById("new-password-form");
const alertEl = document.getElementById("form-alert");

bindPasswordToggles(form);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearFormErrors(form, alertEl);

  const values = formValues(form);
  const passwordError = validatePassword(values.password, "password");
  const confirmationError = validatePassword(values.password_confirmation, "password_confirmation");
  const matchError = validatePasswordMatch(values.password, values.password_confirmation);
  let blocked = false;

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

  window.location.href = "auth-password-changed.html";
});
