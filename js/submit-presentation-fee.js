import { guardPage } from "./auth-guard.js";
import { db, doc, getDoc, updateDoc, serverTimestamp, ABSTRACTS_COLLECTION } from "./firebase-config.js";
import { showAlert, hideAlert, setButtonLoading } from "./helpers.js";

const TRACK_LABEL = { poster: "Poster", oral: "Oral", observer: "Observer" };

const state = { paymentAccount: null };
let abstractId = null;
const alertBox = document.getElementById("alertBox");

guardPage({
  requireAdmin: false,
  onReady: async (user, profile) => {
    const params = new URLSearchParams(window.location.search);
    abstractId = params.get("id");

    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");

    if (!abstractId) return showIneligible("Missing abstract reference.");

    let snap;
    try {
      snap = await getDoc(doc(db, ABSTRACTS_COLLECTION, abstractId));
    } catch (err) {
      console.error(err);
      return showIneligible("Couldn't load this abstract. Please try again.");
    }

    if (!snap.exists()) return showIneligible("Abstract not found.");
    const a = snap.data();

    if (a.submittedBy?.uid !== user.uid) return showIneligible("This abstract doesn't belong to your account.");
    if (a.status !== "accepted" || !a.track) return showIneligible("This abstract isn't accepted with a presentation track yet.");

    document.getElementById("abstractSubtitle").textContent = `${a.abstract?.title || "Untitled abstract"} — ${TRACK_LABEL[a.track] || a.track}`;

    if (a.presentationTrackTrxId && a.presentationFeeStatus !== "rejected") {
      document.getElementById("submittedTrxId").textContent = a.presentationTrackTrxId;
      document.getElementById("submittedState").classList.remove("hidden");
      return;
    }

    wirePaymentAccounts();
    document.getElementById("formState").classList.remove("hidden");
    document.getElementById("submitFeeBtn").addEventListener("click", () => onSubmit(user));
  },
});

function wirePaymentAccounts() {
  document.querySelectorAll("input[data-payment-account-radio]").forEach((radio) => {
    radio.addEventListener("change", () => {
      state.paymentAccount = {
        id: radio.value,
        name: radio.dataset.accountName,
        title: radio.dataset.accountTitle,
        accountNumber: radio.dataset.accountNumber,
      };
      document.getElementById("paymentAccountError").classList.add("hidden");
    });
  });
}

async function onSubmit(user) {
  hideAlert(alertBox);
  const trxInput = document.getElementById("presTrxId");
  const trxError = document.getElementById("trxError");
  const accountError = document.getElementById("paymentAccountError");
  const trxId = trxInput.value.trim();

  let valid = true;
  if (!state.paymentAccount) {
    accountError.classList.remove("hidden");
    valid = false;
  } else {
    accountError.classList.add("hidden");
  }
  if (!trxId) {
    trxError.textContent = "Please enter your transaction / reference ID.";
    trxError.classList.remove("hidden");
    valid = false;
  } else {
    trxError.classList.add("hidden");
  }
  if (!valid) return;

  const btn = document.getElementById("submitFeeBtn");
  setButtonLoading(btn, true, "Submitting...");

  try {
    await updateDoc(doc(db, ABSTRACTS_COLLECTION, abstractId), {
      presentationTrackTrxId: trxId,
      presentationPaymentAccount: state.paymentAccount,
      presentationFeeStatus: "pending",
      presentationFeeSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    showAlert(alertBox, "Something went wrong while saving your submission. Please try again.", "error");
    setButtonLoading(btn, false);
  }
}

function showIneligible(msg) {
  document.getElementById("ineligibleMsg").textContent = msg;
  document.getElementById("ineligibleState").classList.remove("hidden");
}