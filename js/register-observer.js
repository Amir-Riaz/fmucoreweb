import { guardPage } from "./auth-guard.js";
import {
  db,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  USERS_COLLECTION,
  OBSERVER_REGISTRATIONS_COLLECTION,
} from "./firebase-config.js";
import { verifyAmbassadorCode } from "./ambassador.js";
import { uploadToCloudinary } from "./cloudinary-service.js";
import { showAlert, hideAlert, setButtonLoading } from "./helpers.js";

const MAX_FILE_MB = 5;

const CATEGORIES = [
  { id: "ug_uo", label: "Undergraduate — Underprivileged Observer", regularFee: 800, ambassadorFee: 600, presenter: false, certType: "E-Certificate (CME Accredited)" },
  { id: "ug_up", label: "Undergraduate — Underprivileged Presenter", regularFee: 1500, ambassadorFee: null, presenter: true, certType: "Physical Certificate (CME Accredited)" },
  { id: "ug_po", label: "Undergraduate — Premium Observer", regularFee: 2000, ambassadorFee: 1800, presenter: false, certType: "E-Certificate (CME Accredited)" },
  { id: "ug_pp", label: "Undergraduate — Premium Presenter", regularFee: 3000, ambassadorFee: 2700, presenter: true, certType: "Physical Certificate (CME Accredited)" },
  { id: "pg_o", label: "Postgraduate Observer", regularFee: 3300, ambassadorFee: null, presenter: false, certType: "E-Certificate (CME Accredited)" },
  { id: "pg_p", label: "Postgraduate Presenter", regularFee: 4000, ambassadorFee: null, presenter: true, certType: "Physical Certificate (CME Accredited)" },
];

const state = {
  selectedCategoryId: null,
  ambassador: { code: null, valid: false, fullName: null, institute: null },
  paymentAccount: null,
  files: {},          // { admitCard: File }
  fileUploads: {},     // { admitCard: { status, url, promise } }
  uploadSessionId: crypto.randomUUID(),
};

const alertBox = document.getElementById("alertBox");

guardPage({
  requireAdmin: false,
  onReady: (user, profile) => {
    renderCategories();
    wireAdmitCardDropzone();
    wirePaymentAccounts();

    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");

    document.getElementById("verifyCodeBtn").addEventListener("click", onVerifyCode);
    document.getElementById("submitRegBtn").addEventListener("click", () => onSubmit(user, profile));
  },
});

// ---------------------------------------------------------------
// Category cards
// ---------------------------------------------------------------
function renderCategories() {
  const list = document.getElementById("categoryList");
  list.innerHTML = "";
  CATEGORIES.forEach((cat) => {
    const card = document.createElement("label");
    card.className = "flex items-start gap-3 border border-slate-200 rounded-xl p-3.5 cursor-pointer hover:border-brand-300 transition";
    card.innerHTML = `
      <input type="radio" name="category" value="${cat.id}" class="mt-1 accent-brand-600" />
      <div class="flex-1">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-sm text-slate-900">${cat.label}</span>
          <span class="font-bold text-sm text-brand-700">PKR ${cat.regularFee.toLocaleString()}</span>
        </div>
        <p class="text-xs text-slate-500 mt-0.5">${cat.certType}${cat.ambassadorFee ? ` · Ambassador price PKR ${cat.ambassadorFee.toLocaleString()}` : ""}</p>
      </div>`;
    card.querySelector("input").addEventListener("change", () => {
      state.selectedCategoryId = cat.id;
      updateFeeSummary();
    });
    list.appendChild(card);
  });
}

function getSelectedCategory() {
  return CATEGORIES.find((c) => c.id === state.selectedCategoryId) || null;
}

// ---------------------------------------------------------------
// Admit / result card upload — same pattern as abstract-form.js
// ---------------------------------------------------------------
function wireAdmitCardDropzone() {
  const zone = document.querySelector('[data-dropzone="admitCard"]');
  const input = document.getElementById("admitCardInput");
  const label = zone.querySelector("[data-dropzone-label]");
  const defaultText = label.textContent;

  const bar = document.createElement("div");
  bar.className = "mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden hidden";
  bar.innerHTML = `<div class="h-full bg-brand-500 transition-all" style="width:0%"></div>`;
  zone.appendChild(bar);
  const barFill = bar.querySelector("div");

  const statusEl = document.createElement("p");
  statusEl.className = "text-xs mt-1 hidden";
  zone.appendChild(statusEl);

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;

    const sizeOk = file.size <= MAX_FILE_MB * 1024 * 1024;
    const typeOk = /\.(jpg|jpeg|png|pdf)$/i.test(file.name);

    if (!sizeOk || !typeOk) {
      state.files.admitCard = null;
      state.fileUploads.admitCard = null;
      statusEl.className = "text-xs mt-1 text-red-600 font-semibold";
      statusEl.textContent = "File must be JPG, PNG, or PDF, under 5 MB.";
      statusEl.classList.remove("hidden");
      return;
    }

    state.files.admitCard = file;
    label.textContent = file.name;
    zone.classList.add("border-emerald-400");

    state.fileUploads.admitCard = { status: "uploading", url: null };
    bar.classList.remove("hidden");
    barFill.style.width = "0%";
    statusEl.classList.remove("hidden");
    statusEl.className = "text-xs mt-1 text-slate-500";
    statusEl.textContent = "Uploading…";

    const folder = `fmucore-observer/${state.uploadSessionId}/admitCard`;
    state.fileUploads.admitCard.promise = uploadToCloudinary(file, {
      folder,
      onProgress: (pct) => { barFill.style.width = `${pct}%`; },
    })
      .then(({ secureUrl }) => {
        state.fileUploads.admitCard = { status: "done", url: secureUrl };
        statusEl.className = "text-xs mt-1 text-emerald-600 font-semibold";
        statusEl.textContent = "Uploaded ✓";
        bar.classList.add("hidden");
      })
      .catch((err) => {
        console.error("Cloudinary upload failed for admitCard", err);
        state.fileUploads.admitCard = { status: "error", url: null };
        statusEl.className = "text-xs mt-1 text-red-600 font-semibold";
        statusEl.textContent = "Upload failed — reselect the file to retry.";
        bar.classList.add("hidden");
      });
  });
}

async function waitForAdmitCardUpload() {
  const upload = state.fileUploads.admitCard;
  if (!state.files.admitCard) return true; // optional — nothing selected
  if (upload?.status === "uploading" && upload.promise) await upload.promise;
  return state.fileUploads.admitCard?.status === "done";
}

// ---------------------------------------------------------------
// Payment account selection
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// Ambassador code
// ---------------------------------------------------------------
async function onVerifyCode() {
  const input = document.getElementById("ambassadorCode");
  const msg = document.getElementById("ambassadorMsg");
  const code = input.value.trim();

  if (!code) {
    state.ambassador = { code: null, valid: false, fullName: null, institute: null };
    msg.classList.add("hidden");
    updateFeeSummary();
    return;
  }

  msg.classList.remove("hidden");
  msg.className = "text-xs mt-2 text-slate-500";
  msg.textContent = "Checking code…";

  try {
    const result = await verifyAmbassadorCode(code);
    if (result.valid) {
      state.ambassador = { code: code.toUpperCase(), valid: true, fullName: result.fullName, institute: result.institute };
      msg.className = "text-xs mt-2 text-emerald-600 font-medium";
      msg.textContent = `✔ Valid code — referred by ${result.fullName} (${result.institute})`;
    } else {
      state.ambassador = { code: code.toUpperCase(), valid: false, fullName: null, institute: null };
      msg.className = "text-xs mt-2 text-red-500 font-medium";
      msg.textContent = "This ambassador code was not found.";
    }
  } catch (err) {
    console.error(err);
    state.ambassador = { code: code.toUpperCase(), valid: false, fullName: null, institute: null };
    msg.className = "text-xs mt-2 text-red-500 font-medium";
    msg.textContent = "Could not verify the code right now — please try again.";
  }

  updateFeeSummary();
}

function updateFeeSummary() {
  const cat = getSelectedCategory();
  const regularEl = document.getElementById("regularFeeDisplay");
  const payableEl = document.getElementById("payableFeeDisplay");
  const discountRow = document.getElementById("discountRow");
  const discountAmountEl = document.getElementById("discountAmountDisplay");

  if (!cat) {
    regularEl.textContent = "—";
    payableEl.textContent = "—";
    discountRow.classList.add("hidden");
    return;
  }

  regularEl.textContent = `PKR ${cat.regularFee.toLocaleString()}`;

  const discountApplies = state.ambassador.valid && cat.ambassadorFee !== null;
  if (discountApplies) {
    const discount = cat.regularFee - cat.ambassadorFee;
    discountAmountEl.textContent = `- PKR ${discount.toLocaleString()}`;
    discountRow.classList.remove("hidden");
    payableEl.textContent = `PKR ${cat.ambassadorFee.toLocaleString()}`;
  } else {
    discountRow.classList.add("hidden");
    payableEl.textContent = `PKR ${cat.regularFee.toLocaleString()}`;
  }
}

// ---------------------------------------------------------------
// Submit
// ---------------------------------------------------------------
async function onSubmit(user, profile) {
  hideAlert(alertBox);
  const cat = getSelectedCategory();
  const trxInput = document.getElementById("obstrxid");
  const trxError = document.getElementById("trxError");
  const obstrxid = trxInput.value.trim();
  const accountError = document.getElementById("paymentAccountError");

  let valid = true;
  if (!cat) {
    showAlert(alertBox, "Please select a registration category.", "error");
    valid = false;
  }
  if (!state.paymentAccount) {
    accountError.classList.remove("hidden");
    valid = false;
  } else {
    accountError.classList.add("hidden");
  }
  if (!obstrxid) {
    trxError.textContent = "Please enter your transaction / reference ID.";
    trxError.classList.remove("hidden");
    valid = false;
  } else {
    trxError.classList.add("hidden");
  }
  if (!valid) return;

  const submitBtn = document.getElementById("submitRegBtn");
  setButtonLoading(submitBtn, true, "Uploading files...");

  const uploadOk = await waitForAdmitCardUpload();
  if (!uploadOk) {
    setButtonLoading(submitBtn, false);
    showAlert(alertBox, "Your admit/result card failed to upload. Please reselect the file and try again.", "error");
    return;
  }

  setButtonLoading(submitBtn, true, "Submitting...");

  const discountApplies = state.ambassador.valid && cat.ambassadorFee !== null;
  const payableFee = discountApplies ? cat.ambassadorFee : cat.regularFee;

  try {
    await setDoc(doc(db, OBSERVER_REGISTRATIONS_COLLECTION, user.uid), {
      uid: user.uid,
      fullName: profile.fullName || null,
      email: profile.email || user.email,
      category: cat.id,
      categoryLabel: cat.label,
      regularFee: cat.regularFee,
      discountApplied: discountApplies,
      payableFee,
      ambassadorCode: state.ambassador.code,
      ambassadorValid: state.ambassador.valid,
      ambassadorName: state.ambassador.valid ? state.ambassador.fullName : null,
      ambassadorInstitute: state.ambassador.valid ? state.ambassador.institute : null,
      admitCardUrl: state.fileUploads.admitCard?.url || null,
      paymentAccount: state.paymentAccount,
      obstrxid,
      status: "submitted", // submitted | verified | rejected
      submittedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, USERS_COLLECTION, user.uid), {
      observerRegistered: true,
      observerCategory: cat.id,
      observerStatus: "submitted",
    });

    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    showAlert(alertBox, "Something went wrong while saving your registration. Please try again.", "error");
    setButtonLoading(submitBtn, false);
  }
}