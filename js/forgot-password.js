import { auth, sendPasswordResetEmail } from "./firebase-config.js";
import {
  friendlyAuthError,
  showAlert,
  hideAlert,
  setButtonLoading,
  isValidEmail,
} from "./helpers.js";

const form = document.getElementById("forgotForm");
const alertBox = document.getElementById("alertBox");
const submitBtn = document.getElementById("submitBtn");

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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert(alertBox);
  setFieldError("email", "");

  const email = form.email.value.trim();

  if (!isValidEmail(email)) {
    setFieldError("email", "Please enter a valid email address.");
    return;
  }

  setButtonLoading(submitBtn, true, "Sending link...");

  try {
    await sendPasswordResetEmail(auth, email, {
      url: `${window.location.origin}${window.location.pathname.replace(
        "forgot-password.html",
        "login.html"
      )}`,
    });

    // Don't reveal whether the account exists — same message either way
    showAlert(
      alertBox,
      "If an account exists for this email, a password reset link has been sent. Please check your inbox (and spam folder).",
      "success"
    );
    form.reset();
    setButtonLoading(submitBtn, false);
  } catch (error) {
    console.error(error);

    // auth/user-not-found would leak whether an account exists — mask it
    // the same as a successful send.
    if (error?.code === "auth/user-not-found") {
      showAlert(
        alertBox,
        "If an account exists for this email, a password reset link has been sent. Please check your inbox (and spam folder).",
        "success"
      );
      form.reset();
    } else {
      showAlert(alertBox, friendlyAuthError(error), "error");
    }
    setButtonLoading(submitBtn, false);
  }
});
