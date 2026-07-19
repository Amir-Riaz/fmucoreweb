import {
  auth,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "./firebase-config.js";
import {
  friendlyAuthError,
  showAlert,
  hideAlert,
  setButtonLoading,
} from "./helpers.js";

const form = document.getElementById("resetForm");
const alertBox = document.getElementById("alertBox");
const submitBtn = document.getElementById("submitBtn");
const emailLabel = document.getElementById("resetEmailLabel");

const params = new URLSearchParams(window.location.search);
const oobCode = params.get("oobCode");
const mode = params.get("mode");

function setFieldError(fieldName, message) {
  const el = form.querySelector(`.field-error[data-for="${fieldName}"]`);
  const input = document.getElementById(fieldName);
  if (el) {
    el.textContent = message;
    el.classList.toggle("hidden", !message);
  }
  if (input) {
    input.classList.toggle("border-red-400", !!message);
  }
}

function disableForm() {
  form.classList.add("hidden");
}

async function init() {
  if (!oobCode || mode !== "resetPassword") {
    showAlert(alertBox, "Invalid or missing reset link. Please request a new one.", "error");
    if (emailLabel) emailLabel.textContent = "";
    disableForm();
    return;
  }

  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    if (emailLabel) emailLabel.textContent = `Resetting password for ${email}`;
  } catch (error) {
    console.error(error);
    showAlert(alertBox, friendlyAuthError(error), "error");
    if (emailLabel) emailLabel.textContent = "";
    disableForm();
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert(alertBox);
  setFieldError("password", "");
  setFieldError("confirmPassword", "");

  const password = form.password.value;
  const confirmPassword = form.confirmPassword.value;

  let valid = true;
  if (!password || password.length < 6) {
    setFieldError("password", "Password must be at least 6 characters.");
    valid = false;
  }
  if (password !== confirmPassword) {
    setFieldError("confirmPassword", "Passwords do not match.");
    valid = false;
  }
  if (!valid) return;

  setButtonLoading(submitBtn, true, "Resetting...");

  try {
    await confirmPasswordReset(auth, oobCode, password);
    showAlert(alertBox, "Password reset successfully. Redirecting to login...", "success");
    disableForm();
    setTimeout(() => {
      window.location.href = "login.html?reset=1";
    }, 1500);
  } catch (error) {
    console.error(error);
    showAlert(alertBox, friendlyAuthError(error), "error");
    setButtonLoading(submitBtn, false);
  }
});

init();
