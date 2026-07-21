import { guardPage } from "./auth-guard.js";
import { db, doc, getDoc, updateDoc, serverTimestamp, ABSTRACTS_COLLECTION } from "./firebase-config.js";
import { showAlert, hideAlert, setButtonLoading } from "./helpers.js";

const TRACK_LABEL = { poster: "Poster", oral: "Oral", observer: "Observer" };

const PRESENTER_CATEGORIES = [
  { id: "ug_standard_presenter", label: "Undergraduate — Standard Presenter", fee: 1500 },
  { id: "ug_premium_presenter", label: "Undergraduate — Premium Presenter", fee: 3000 },
  { id: "pg_presenter", label: "Postgraduate Presenter", fee: 4000 },
];


const state = { paymentAccount: null, selectedCategoryId: null };
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
       renderCategories();
 document.getElementById("formState").classList.remove("hidden");
    document.getElementById("submitFeeBtn").addEventListener("click", () => onSubmit(user));
  },
});
function renderCategories() {
  const list = document.getElementById("categoryList");
  list.innerHTML = "";
  PRESENTER_CATEGORIES.forEach((cat) => {
    const card = document.createElement("label");
    card.className = "flex items-start gap-3 border border-slate-200 rounded-xl p-3.5 cursor-pointer hover:border-brand-300 transition has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50";
    card.innerHTML = `
      <input type="radio" name="presenterCategory" value="${cat.id}" class="mt-1 accent-brand-600" />
      <div class="flex-1 flex items-center justify-between gap-2">
        <span class="font-semibold text-sm text-slate-900">${cat.label}</span>
        <span class="font-bold text-sm text-brand-700">PKR ${cat.fee.toLocaleString()}</span>
      </div>`;
    card.querySelector("input").addEventListener("change", () => {
      state.selectedCategoryId = cat.id;
      document.getElementById("categoryError").classList.add("hidden");
    });
    list.appendChild(card);
  });
}

function getSelectedCategory() {
  return PRESENTER_CATEGORIES.find((c) => c.id === state.selectedCategoryId) || null;
}
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
  const categoryError = document.getElementById("categoryError");
  const trxId = trxInput.value.trim();
  const cat = getSelectedCategory();

  let valid = true;
  if (!cat) {
    categoryError.classList.remove("hidden");
    valid = false;
  } else {
    categoryError.classList.add("hidden");
  }
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
      presentationCategory: cat.id,
      presentationCategoryLabel: cat.label,
      presentationFee: cat.fee,
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