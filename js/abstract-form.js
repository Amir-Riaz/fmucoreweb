import { guardPage, attachLogout } from "./auth-guard.js";
import { renderTopbar } from "./topbar.js";
import { uploadToCloudinary } from "./cloudinary-service.js";

import {
  INSTITUTES, FIELDS_OF_STUDY, YEARS_OF_STUDY, PROVINCES, CITIES_BY_PROVINCE,
  SPECIALTIES, ABSTRACT_TYPES, AUTHOR_RANKS, AUTHOR_STATUSES,
  TYPE_OF_STUDY, ABSTRACT_CATEGORIES, COUNTRIES
} from "./abstract-data.js";
import { db, collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, ABSTRACTS_COLLECTION } from "./firebase-config.js";
import { syncAbstractReviewView } from "./abstract-review-sync.js";


const WORD_LIMIT = 300;
const CHALLENGES_WORD_LIMIT = 100;
const MAX_FILE_MB = 5;
const COUNTED_FIELDS = ["introduction", "objectives", "methodology", "results", "conclusion"];
const TOTAL_STEPS = 5;

const state = {
  currentStep: 1,
  completedSteps: new Set(),
  erroredSteps: new Set(),
  values: {},        // flat field values, keyed by data-field / data-radio-field
  files: {},         // { resultCard, figure1, figure2 } -> File
  keywords: [],
  authors: [],        // { id, firstName, lastName, email, affiliation, status, rank }
  editingAuthorId: null,
  abstractId: null,   // set once the abstract doc is created (after step 4)
  reviewKey: null,

fileUploads: {},                       // { resultCard: {status,url}, figure1:{...}, figure2:{...} }
uploadSessionId: crypto.randomUUID(),  // just for organizing Cloudinary folders pre-submit

};

// ---------------------------------------------------------------
// Autofill from the user's existing Firestore profile (users/{uid})
// so they don't retype what we already know about them.
// ---------------------------------------------------------------
function prefillFromProfile(user, profile) {
  const setValue = (name, value) => {
    if (!value) return;
    const el = document.querySelector(`[data-field="${name}"]`);
    if (!el) return;
    el.value = value;
    state.values[name] = value;
  };

  const [firstName, ...rest] = (profile.fullName || "").trim().split(/\s+/);
  if (firstName) setValue("firstName", firstName);
  if (rest.length) setValue("lastName", rest.join(" "));

  setValue("email", profile.email || user.email || "");
  setValue("phone", profile.phone || profile.whatsapp || "");

  // Institute: only prefill if it's an exact match in our list, otherwise
  // fall back to "Others" + the free-text field so nothing is silently lost.
  if (profile.organization) {
    if (INSTITUTES.includes(profile.organization)) {
      setValue("institute", profile.organization);
    } else {
      setValue("institute", "Others");
      document.querySelector('[data-field-wrap="instituteOther"]').classList.remove("hidden");
      setValue("instituteOther", profile.organization);
    }
  }

  if (profile.province) {
    setValue("province", profile.province);
    const citySelect = document.querySelector('[data-field="city"]');
    const cities = CITIES_BY_PROVINCE[profile.province] || [];
    citySelect.disabled = cities.length === 0;
    fillSelect(citySelect, cities, cities.length ? "Select your city" : "Select a province first");
    if (profile.city) setValue("city", profile.city);
  }
}

function fillSelect(select, options, placeholder) {
  select.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  select.appendChild(opt0);
  options.forEach((label) => {
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    select.appendChild(opt);
  });
}

function wordCount(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
// File inputs live inside a `data-dropzone` box; their error message lives
// in the OUTER wrapper (a sibling of the dropzone), not inside it.
function findFieldWrapper(fieldEl) {
  const dropzone = fieldEl.closest("[data-dropzone]");
  if (dropzone) return dropzone.parentElement;
  return fieldEl.closest("div");
}


function setError(fieldEl, show) {
  const wrap = findFieldWrapper(fieldEl);
  const msg = wrap ? wrap.querySelector(".field-error-msg") : null;
  fieldEl.classList.toggle("field-error", show);
  if (msg) msg.classList.toggle("show", show);
}

// Returns the human-readable text already sitting in a field's
// `.field-error-msg` element, so the summary box and the inline
// per-field message always say exactly the same thing.
function getFieldErrorMsg(fieldEl) {
  const wrap = findFieldWrapper(fieldEl);
    const msg = wrap ? wrap.querySelector(".field-error-msg") : null;
  return msg ? msg.textContent.trim() : null;
}

// Renders (or hides) the red "Please fix the following" box that sits
// directly under each step's heading/instructions.
function renderStepSummary(step, messages) {
  const panel = document.querySelector(`[data-panel-step="${step}"]`);
  if (!panel) return;
  const summary = panel.querySelector("[data-step-summary]");
  const list = panel.querySelector("[data-step-summary-list]");
  if (!summary || !list) return;

  if (messages.length === 0) {
    summary.classList.add("hidden");
    list.innerHTML = "";
    return;
  }

  list.innerHTML = messages.map((m) => `<li>${m}</li>`).join("");
  summary.classList.remove("hidden");
}

// ---------------------------------------------------------------
// Step grid + panel switching
// ---------------------------------------------------------------
function refreshStepGrid() {
  document.querySelectorAll(".step-tile").forEach((tile) => {
    const step = Number(tile.dataset.step);
    const isActive = step === state.currentStep;
    const isComplete = state.completedSteps.has(step);
    const hasError = state.erroredSteps.has(step);
    tile.dataset.state = hasError ? "error" : isComplete ? "complete" : isActive ? "active" : "upcoming";

    const numEl = tile.querySelector(".step-num");
    const flagEl = tile.querySelector(".step-tile-flag");
    tile.classList.remove(
      "border-brand-500", "bg-brand-50", "border-emerald-300", "bg-emerald-50",
      "border-slate-200", "border-red-300", "bg-red-50"
    );
    numEl.classList.remove("bg-brand-600", "text-white", "bg-emerald-500", "bg-slate-100", "text-slate-500", "bg-red-500");

    if (hasError) {
      tile.classList.add("border-red-300", "bg-red-50");
      numEl.classList.add("bg-red-500", "text-white");
    } else if (isComplete) {
      tile.classList.add("border-emerald-300", "bg-emerald-50");
      numEl.classList.add("bg-emerald-500", "text-white");
    } else if (isActive) {
      tile.classList.add("border-brand-500", "bg-brand-50");
      numEl.classList.add("bg-brand-600", "text-white");
    } else {
      tile.classList.add("border-slate-200");
      numEl.classList.add("bg-slate-100", "text-slate-500");
    }

    if (flagEl) flagEl.classList.toggle("hidden", !hasError);
  });
}

// Jumps to the first field with a visible error inside a panel, scrolls it
// into view, and focuses it so the person can fix it in one tap/click.
function scrollToFirstInvalid(step) {
  const panel = document.querySelector(`[data-panel-step="${step}"]`);
  if (!panel) return;
  // Prefer scrolling to the summary box itself so the person sees the full
  // list of what's wrong before landing on any one field.
  const summary = panel.querySelector("[data-step-summary]:not(.hidden)");
  if (summary) {
    summary.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const firstInvalid = panel.querySelector(".field-error, [data-keywords-box].field-error");
  if (!firstInvalid) return;
  firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof firstInvalid.focus === "function") firstInvalid.focus({ preventScroll: true });
}

function goToStep(step) {
  state.currentStep = step;
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.panelStep) === step);
  });
  refreshStepGrid();
  document.getElementById("content").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------
// Radio / checkbox group rendering + wiring
// (used for Type of Study, Abstract Category, and the simple
// Yes/No/Other questions added to Step 2)
// ---------------------------------------------------------------
function renderRadioGroup(container, options, fieldName) {
  if (!container) return;
  container.innerHTML = "";
  options.forEach((label) => {
    const wrap = document.createElement("label");
    wrap.className = "flex items-center gap-2 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer transition hover:border-brand-300";
    wrap.innerHTML = `<input type="radio" name="${fieldName}" value="${label}" data-radio-field="${fieldName}" class="text-brand-600 focus:ring-brand-500"> <span>${label}</span>`;
    container.appendChild(wrap);
  });
  if (options.includes("Other")) {
    const otherWrap = document.createElement("div");
    otherWrap.className = "sm:col-span-2 w-full mt-1 hidden";
    otherWrap.dataset.otherWrapFor = fieldName;
    otherWrap.innerHTML = `<input type="text" data-other-field="${fieldName}" class="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Please specify" />`;
    container.appendChild(otherWrap);
  }
}

function renderCheckboxGroup(container, options, fieldName) {
  if (!container) return;
  container.innerHTML = "";
  options.forEach((label) => {
    const wrap = document.createElement("label");
    wrap.className = "flex items-center gap-2 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer transition hover:border-brand-300";
    wrap.innerHTML = `<input type="checkbox" value="${label}" data-checkbox-field="${fieldName}" class="rounded text-brand-600 focus:ring-brand-500"> <span>${label}</span>`;
    container.appendChild(wrap);
  });
  if (options.includes("Other")) {
    const otherWrap = document.createElement("div");
    otherWrap.className = "sm:col-span-2 w-full mt-1 hidden";
    otherWrap.dataset.otherWrapFor = fieldName;
    otherWrap.innerHTML = `<input type="text" data-other-field="${fieldName}" class="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" placeholder="Please specify" />`;
    container.appendChild(otherWrap);
  }
}

function wireRadioAndCheckboxGroups() {
  document.querySelectorAll("input[data-radio-field]").forEach((radio) => {
    radio.addEventListener("change", () => {
      const name = radio.dataset.radioField;
      state.values[name] = radio.value;
      document.querySelector(`[data-error-for="${name}"]`)?.classList.remove("show");
      const otherWrap = document.querySelector(`[data-other-wrap-for="${name}"]`);
      if (otherWrap) otherWrap.classList.toggle("hidden", radio.value !== "Other");
    });
  });

  document.querySelectorAll("input[data-checkbox-field]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const name = cb.dataset.checkboxField;
      if (!Array.isArray(state.values[name])) state.values[name] = [];
      if (cb.checked) {
        if (!state.values[name].includes(cb.value)) state.values[name].push(cb.value);
      } else {
        state.values[name] = state.values[name].filter((v) => v !== cb.value);
      }
      document.querySelector(`[data-error-for="${name}"]`)?.classList.remove("show");
      const otherWrap = document.querySelector(`[data-other-wrap-for="${name}"]`);
      if (otherWrap) otherWrap.classList.toggle("hidden", !state.values[name].includes("Other"));
    });
  });

  document.querySelectorAll("input[data-other-field]").forEach((input) => {
    input.addEventListener("input", () => {
      state.values[`${input.dataset.otherField}Other`] = input.value;
    });
  });
}

// ---------------------------------------------------------------
// Validation per step
// ---------------------------------------------------------------
function validateStep(step) {
  let valid = true;
  const messages = [];
  const panel = document.querySelector(`[data-panel-step="${step}"]`);

  const requiredFields = Array.from(panel.querySelectorAll("[data-field]")).filter((el) => {
    // Skip fields hidden inside a collapsed wrapper (e.g. institute "Others" free text)
    const wrap = el.closest("[data-field-wrap]");
    if (wrap && wrap.classList.contains("hidden")) return false;
    if (el.disabled) return false;
    return true;
  });

  requiredFields.forEach((el) => {
    const name = el.dataset.field;
    const label = el.closest("div").querySelector("label");
    const isOptional = label && !label.querySelector(".text-red-500");
    if (isOptional) return;

    let empty;
    if (el.type === "file") {
      empty = !state.files[name];
    } else {
      empty = !el.value || !el.value.trim();
    }

    if (name === "email" && !empty) {
      empty = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim());
    }
    if (name === "phone" && !empty) {
      empty = !/^[0-9+\-\s]{7,15}$/.test(el.value.trim());
    }

    setError(el, empty);
    if (empty) {
      valid = false;
      const msg = getFieldErrorMsg(el);
      if (msg && !messages.includes(msg)) messages.push(msg);
    }
  });

  // File type/size checks (already validated on change, but re-check for safety)
  panel.querySelectorAll('input[type="file"][data-field]').forEach((input) => {
    const name = input.dataset.field;
    const file = state.files[name];
    if (!file) return;
    const isTiff = /\.(tif|tiff)$/i.test(file.name);
    const isResultCard = name === "resultCard";
    const sizeOk = file.size <= MAX_FILE_MB * 1024 * 1024;
    const typeOk = isResultCard ? /\.(jpg|jpeg|png|pdf)$/i.test(file.name) : isTiff;
    if (!sizeOk || !typeOk) {
      setError(input, true);
      valid = false;
      const msg = getFieldErrorMsg(input);
      if (msg && !messages.includes(msg)) messages.push(msg);
    }
  });

  if (step === 2) {
    const checkRadio = (name, message) => {
      const errEl = document.querySelector(`[data-error-for="${name}"]`);
      if (!state.values[name]) {
        valid = false;
        messages.push(message);
        errEl?.classList.add("show");
      } else {
        errEl?.classList.remove("show");
      }
    };

    checkRadio("typeOfStudy", "Please specify the type of study you are submitting.");
    checkRadio("facultyMentor", "Please indicate whether this project was supervised by a faculty mentor.");
    checkRadio("publishedInJournal", "Please indicate whether your project has already been published.");
    checkRadio("modeOfPresentation", "Please select a mode of presentation.");
    checkRadio("followUpInterviews", "Please indicate if you're open to follow-up interviews.");

    const categoriesErrEl = document.querySelector('[data-error-for="abstractCategories"]');
    if (!state.values.abstractCategories || state.values.abstractCategories.length === 0) {
      valid = false;
      messages.push("Please select at least one abstract category.");
      categoriesErrEl?.classList.add("show");
    } else {
      categoriesErrEl?.classList.remove("show");
    }

    if (state.values.typeOfStudy === "Other" && !(state.values.typeOfStudyOther || "").trim()) {
      valid = false;
      messages.push("Please specify your type of study.");
    }
    if (state.values.facultyMentor === "Other" && !(state.values.facultyMentorOther || "").trim()) {
      valid = false;
      messages.push("Please specify the faculty mentor details.");
    }
    if ((state.values.abstractCategories || []).includes("Other") && !(state.values.abstractCategoriesOther || "").trim()) {
      valid = false;
      messages.push("Please specify your abstract category.");
    }

    if (state.values.biggestChallenges && wordCount(state.values.biggestChallenges) > CHALLENGES_WORD_LIMIT) {
      valid = false;
      messages.push(`Please shorten "biggest challenges" to ${CHALLENGES_WORD_LIMIT} words or fewer.`);
    }
  }

  if (step === 3) {
    const totalWords = COUNTED_FIELDS.reduce((sum, f) => sum + wordCount(state.values[f]), 0);
    const wordLimitMsgEl = document.querySelector("[data-word-limit-msg]");

    if (totalWords > WORD_LIMIT) {
      valid = false;
      if (wordLimitMsgEl) wordLimitMsgEl.classList.remove("hidden");
      messages.push(`Your abstract is ${totalWords} words — please shorten it to ${WORD_LIMIT} words or fewer.`);
    } else if (wordLimitMsgEl) {
      wordLimitMsgEl.classList.add("hidden");
    }

    if (state.keywords.length === 0) {
      const box = document.querySelector("[data-keywords-box]");
      const msg = box.parentElement.querySelector(".field-error-msg");
      msg.classList.add("show");
      box.classList.add("field-error");
      valid = false;
      messages.push("Add at least one keyword.");
    } else {
      const box = document.querySelector("[data-keywords-box]");
      box.classList.remove("field-error");
      box.parentElement.querySelector(".field-error-msg").classList.remove("show");
    }
  }

  renderStepSummary(step, messages);

  return valid;
}

// ---------------------------------------------------------------
// Field wiring (text/select inputs -> state.values)
// ---------------------------------------------------------------
function wireGenericFields() {
  document.querySelectorAll("[data-field]").forEach((el) => {
    if (el.type === "file") return;
    el.addEventListener("input", () => {
      state.values[el.dataset.field] = el.value;
      setError(el, false);
      if (el.dataset.counted !== undefined) updateWordCount();
      if (el.dataset.challengesCounter !== undefined) updateChallengesCount();
    });
  });

  // Institute "Others" reveal
  const instituteSelect = document.querySelector('[data-field="institute"]');
  const instituteOtherWrap = document.querySelector('[data-field-wrap="instituteOther"]');
  instituteSelect.addEventListener("change", () => {
    const isOther = instituteSelect.value === "Others";
    instituteOtherWrap.classList.toggle("hidden", !isOther);
  });

  // Province -> City
  const provinceSelect = document.querySelector('[data-field="province"]');
  const citySelect = document.querySelector('[data-field="city"]');
  provinceSelect.addEventListener("change", () => {
    const cities = CITIES_BY_PROVINCE[provinceSelect.value] || [];
    citySelect.disabled = cities.length === 0;
    fillSelect(citySelect, cities, cities.length ? "Select your city" : "Select a province first");
    state.values.city = "";
  });

  // Speciality -> Sub-speciality
  const specialitySelect = document.querySelector('[data-field="speciality"]');
  const subSelect = document.querySelector('[data-field="subSpeciality"]');
  specialitySelect.addEventListener("change", () => {
    const entry = SPECIALTIES.find((s) => s.specialty === specialitySelect.value);
    const subs = entry ? entry.subspecialties : [];
    subSelect.disabled = subs.length === 0;
    fillSelect(subSelect, subs, subs.length ? "Select a sub speciality" : "No sub specialities for this field");
    state.values.subSpeciality = "";
  });
}

function updateWordCount() {
  const total = COUNTED_FIELDS.reduce((sum, f) => sum + wordCount(state.values[f]), 0);
  const el = document.querySelector("[data-word-count]");
  el.textContent = total;
  el.classList.toggle("text-red-600", total > WORD_LIMIT);
  el.classList.toggle("text-brand-600", total <= WORD_LIMIT);

  // Hide the dedicated word-limit warning as soon as they're back under the
  // limit, without waiting for them to click Continue again.
  const wordLimitMsgEl = document.querySelector("[data-word-limit-msg]");
  if (wordLimitMsgEl && total <= WORD_LIMIT) wordLimitMsgEl.classList.add("hidden");
}

function updateChallengesCount() {
  const total = wordCount(state.values.biggestChallenges);
  const el = document.querySelector("[data-challenges-count]");
  if (!el) return;
  el.textContent = total;
  el.classList.toggle("text-red-600", total > CHALLENGES_WORD_LIMIT);
}

// ---------------------------------------------------------------
// File dropzones
// ---------------------------------------------------------------

function wireDropzones() {
  document.querySelectorAll("[data-dropzone]").forEach((zone) => {
    const name = zone.dataset.dropzone;
    const input = zone.querySelector('input[type="file"]');
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

      const isResultCard = name === "resultCard";
      const sizeOk = file.size <= MAX_FILE_MB * 1024 * 1024;
      const typeOk = isResultCard ? /\.(jpg|jpeg|png|pdf)$/i.test(file.name) : /\.(tif|tiff)$/i.test(file.name);

      if (!sizeOk || !typeOk) {
        setError(input, true);
        state.files[name] = null;
        state.fileUploads[name] = null;
        label.textContent = defaultText;
        bar.classList.add("hidden");
        statusEl.classList.add("hidden");
        return;
      }

      setError(input, false);
      state.files[name] = file;
      label.textContent = file.name;
      zone.classList.add("border-emerald-400");

      // Upload immediately so it's already done by the time Continue is clicked
      state.fileUploads[name] = { status: "uploading", url: null };
      bar.classList.remove("hidden");
      barFill.style.width = "0%";
      statusEl.classList.remove("hidden");
      statusEl.className = "text-xs mt-1 text-slate-500";
      statusEl.textContent = "Uploading…";

      const folder = `fmucore-abstracts/${state.uploadSessionId}/${name}`;
      state.fileUploads[name].promise = uploadToCloudinary(file, {
        folder,
        onProgress: (pct) => { barFill.style.width = `${pct}%`; },
      })
        .then(({ secureUrl }) => {
          state.fileUploads[name] = { status: "done", url: secureUrl };
          statusEl.className = "text-xs mt-1 text-emerald-600 font-semibold";
          statusEl.textContent = "Uploaded ✓";
          bar.classList.add("hidden");
        })
        .catch((err) => {
          console.error(`Cloudinary upload failed for ${name}`, err);
          state.fileUploads[name] = { status: "error", url: null };
          statusEl.className = "text-xs mt-1 text-red-600 font-semibold";
          statusEl.textContent = "Upload failed — reselect the file to retry.";
          bar.classList.add("hidden");
        });
    });
  });
}
async function waitForUploads(names) {
  const pending = names.map((n) => state.fileUploads[n]).filter((u) => u?.status === "uploading" && u.promise);
  if (pending.length) await Promise.allSettled(pending.map((u) => u.promise));
  return names.every((n) => {
    const u = state.fileUploads[n];
    if (n !== "resultCard") return !state.files[n] || u?.status === "done"; // figures optional
    return u?.status === "done";
  });
}
// ---------------------------------------------------------------
// Keywords chip input
// ---------------------------------------------------------------
function wireKeywords() {
  const box = document.querySelector("[data-keywords-box]");
  const input = document.querySelector("[data-keywords-input]");

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (state.keywords.length >= 3) return;
    if (state.keywords.includes(value)) { input.value = ""; return; }

    state.keywords.push(value);
    renderKeywordChip(value);
    input.value = "";
    if (state.keywords.length >= 3) input.disabled = true;

    box.classList.remove("field-error");
    box.parentElement.querySelector(".field-error-msg").classList.remove("show");
  });

  function renderKeywordChip(value) {
    const chip = document.createElement("span");
    chip.className = "chip-in inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 text-xs font-bold px-2.5 py-1 rounded-full";
    chip.textContent = value;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-brand-400 hover:text-brand-700";
    remove.innerHTML = "&times;";
    remove.addEventListener("click", () => {
      state.keywords = state.keywords.filter((k) => k !== value);
      chip.remove();
      input.disabled = false;
    });
    chip.appendChild(remove);
    box.insertBefore(chip, input);
  }
}


async function tryResumeFromQuery(user) {
  const resumeId = new URLSearchParams(location.search).get("resume");
  if (!resumeId) return false;
  try {
    const snap = await getDoc(doc(db, ABSTRACTS_COLLECTION, resumeId));
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.submittedBy?.uid !== user.uid || data.paymentInfo) return false; // not theirs, or already paid

    state.abstractId = resumeId;
    state.reviewKey = data.reviewKey;
    [1, 2, 3, 4].forEach((s) => state.completedSteps.add(s));
    document.querySelector("[data-payment-review-key]").textContent = state.reviewKey;
    refreshStepGrid();
    goToStep(5);
    return true;
  } catch (err) {
    console.error("Failed to resume submission", err);
    return false;
  }
}

// ---------------------------------------------------------------
// Author modal
// ---------------------------------------------------------------
let openAuthorModal = () => {};

function wireAuthorModal() {
  const modal = document.querySelector("[data-author-modal]");
  const affiliationSelect = modal.querySelector('[data-author-field="affiliation"]');
  const statusSelect = modal.querySelector('[data-author-field="status"]');
  const rankSelect = modal.querySelector('[data-author-field="rank"]');

  fillSelect(affiliationSelect, INSTITUTES, "Select institute or organisation");
  fillSelect(statusSelect, AUTHOR_STATUSES, "Select status");
  fillSelect(rankSelect, AUTHOR_RANKS, "Select rank");

  function openModal(editId = null) {
    state.editingAuthorId = editId;
    modal.querySelectorAll("[data-author-field]").forEach((el) => { el.value = ""; setError(el, false); });

    if (editId) {
      const author = state.authors.find((a) => a.id === editId);
      modal.querySelector('[data-author-field="firstName"]').value = author.firstName;
      modal.querySelector('[data-author-field="lastName"]').value = author.lastName;
      modal.querySelector('[data-author-field="email"]').value = author.email;
      modal.querySelector('[data-author-field="affiliation"]').value = author.affiliation;
      modal.querySelector('[data-author-field="status"]').value = author.status;
      modal.querySelector('[data-author-field="rank"]').value = author.rank;
    }
    modal.classList.remove("hidden");
  }
  function closeModal() { modal.classList.add("hidden"); state.editingAuthorId = null; }

  openAuthorModal = openModal;

  document.querySelector("[data-open-author-modal]").addEventListener("click", () => openModal());
  modal.querySelectorAll("[data-close-author-modal]").forEach((btn) => btn.addEventListener("click", closeModal));

  modal.querySelector("[data-save-author]").addEventListener("click", () => {
    const get = (name) => modal.querySelector(`[data-author-field="${name}"]`).value.trim();
    const firstName = get("firstName"), lastName = get("lastName"), email = get("email");
    const affiliation = get("affiliation"), status = get("status"), rank = get("rank");

    let valid = true;
    const checks = [
      ["firstName", firstName], ["lastName", lastName], ["affiliation", affiliation],
      ["status", status], ["rank", rank],
    ];
    checks.forEach(([name, value]) => {
      const el = modal.querySelector(`[data-author-field="${name}"]`);
      setError(el, !value);
      if (!value) valid = false;
    });
    const emailEl = modal.querySelector('[data-author-field="email"]');
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setError(emailEl, !emailValid);
    if (!emailValid) valid = false;

    // Uniqueness: one Co Presenter, unique rank (excluding the author being edited)
    const others = state.authors.filter((a) => a.id !== state.editingAuthorId);
    if (status === "Co Presenter" && others.some((a) => a.status === "Co Presenter")) {
      setError(modal.querySelector('[data-author-field="status"]'), true);
      valid = false;
    }
    if (rank && others.some((a) => a.rank === rank)) {
      setError(modal.querySelector('[data-author-field="rank"]'), true);
      valid = false;
    }

    if (!valid) return;

    if (state.editingAuthorId) {
      const author = state.authors.find((a) => a.id === state.editingAuthorId);
      Object.assign(author, { firstName, lastName, email, affiliation, status, rank });
    } else {
      state.authors.push({ id: crypto.randomUUID(), firstName, lastName, email, affiliation, status, rank });
    }
    renderAuthorList();
    closeModal();
  });
}

function renderAuthorList() {
  const list = document.querySelector("[data-author-list]");
  const empty = document.querySelector("[data-author-empty]");
  list.innerHTML = "";
  empty.classList.toggle("hidden", state.authors.length > 0);

  state.authors.forEach((author) => {
    const li = document.createElement("li");
    li.className = "flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3";
    li.innerHTML = `
      <div class="min-w-0">
        <p class="font-bold text-sm text-slate-900 truncate">${author.firstName} ${author.lastName}
          <span class="ml-2 inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${author.status === "Co Presenter" ? "bg-brand-100 text-brand-700" : "bg-slate-200 text-slate-600"}">${author.status}</span>
        </p>
        <p class="text-xs text-slate-500 truncate">${author.affiliation} · ${author.rank}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button type="button" data-edit-author="${author.id}" class="text-xs font-bold text-brand-600 hover:underline">Edit</button>
        <button type="button" data-remove-author="${author.id}" class="text-xs font-bold text-red-500 hover:underline">Remove</button>
      </div>`;
    list.appendChild(li);
  });

  list.querySelectorAll("[data-edit-author]").forEach((btn) =>
    btn.addEventListener("click", () => openAuthorModal(btn.dataset.editAuthor))
  );
  list.querySelectorAll("[data-remove-author]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.authors = state.authors.filter((a) => a.id !== btn.dataset.removeAuthor);
      renderAuthorList();
    })
  );
}

// ---------------------------------------------------------------
// Submission
// ---------------------------------------------------------------
// Short, unique-enough code shown to the submitter for tracking and to
// reviewers in place of any identifying information.
function generateReviewKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `AB-${code}`;
}

// Creates the abstract document in Firestore. Runs when the person continues
// past Step 4 (Add an Author). Returns true on success so the caller can
// decide whether to advance to the payment step.
async function submitAbstract(user, profile) {
  const reviewKey = generateReviewKey();
  const docRef = doc(collection(db, ABSTRACTS_COLLECTION)); // auto-generated id
  const abstractId = docRef.id;

  const resolvedTypeOfStudy = state.values.typeOfStudy === "Other"
    ? state.values.typeOfStudyOther : state.values.typeOfStudy;
  const resolvedFacultyMentor = state.values.facultyMentor === "Other"
    ? state.values.facultyMentorOther : state.values.facultyMentor;
  const resolvedCategories = (state.values.abstractCategories || []).map((c) =>
    c === "Other" ? (state.values.abstractCategoriesOther || "Other") : c
  );

  const payload = {
    reviewKey,
    submittedBy: {
      uid: user.uid, email: profile.email || user.email, serial: profile.serial || null,
    },
    personalInfo: {
      firstName: state.values.firstName, lastName: state.values.lastName,
      email: state.values.email, phone: state.values.phone,
      institute: state.values.institute === "Others" ? state.values.instituteOther : state.values.institute,
      fieldOfStudy: state.values.fieldOfStudy, yearOfStudy: state.values.yearOfStudy,
      country: state.values.country, province: state.values.province, city: state.values.city,
      ambassadorCode: state.values.ambassadorCode || null,
    resultCardUrl: state.fileUploads.resultCard?.url || null,
},
    abstractType: {
      speciality: state.values.speciality, subSpeciality: state.values.subSpeciality || null,
      abstractType: state.values.abstractType,
      typeOfStudy: resolvedTypeOfStudy,
      abstractCategories: resolvedCategories,
    },
    abstract: {
      title: state.values.title, introduction: state.values.introduction,
      objectives: state.values.objectives, methodology: state.values.methodology,
      results: state.values.results, conclusion: state.values.conclusion,
      keywords: state.keywords,
      biggestChallenges: state.values.biggestChallenges || null,
    figure1Url: state.fileUploads.figure1?.url || null,
figure2Url: state.fileUploads.figure2?.url || null,
},
    researchDetails: {
      facultyMentor: resolvedFacultyMentor,
      publishedInJournal: state.values.publishedInJournal,
      modeOfPresentation: state.values.modeOfPresentation,
      followUpInterviews: state.values.followUpInterviews,
    },
    authors: state.authors,
    // --- Tracking fields, shown on the dashboard and used by admin/reviewers ---
    status: "submitted",       // submitted | pending_payment_verification | under_review | accepted | rejected
    track: null,               // poster | oral | observer — set by admin once decided
    reviewDecision: null,      // null | accepted | rejected — reviewer's recommendation
    paymentInfo: null,         // set once Step 5 (processing fee) is completed
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // NOTE: file uploads (resultCard, figure1, figure2) live in state.files as
  // File objects. Wire these to Firebase Storage alongside this Firestore
  // write, then attach the resulting URLs to `payload` before saving, e.g.:
  //   payload.personalInfo.resultCardUrl = await uploadAbstractFile(state.files.resultCard, `abstracts/${abstractId}/result-card`);
  //   payload.abstract.figure1Url = await uploadAbstractFile(state.files.figure1, `abstracts/${abstractId}/figure1`);
  try {
    await setDoc(docRef, payload);
    // Mirrors a PII-free copy into a separate collection so reviewers can be
    // granted read access to that collection only — see abstract-review-sync.js.
    await syncAbstractReviewView(abstractId, payload);

    state.abstractId = abstractId;
    state.reviewKey = reviewKey;
    return true;
  } catch (err) {
    console.error(err);
    alert("We couldn't submit your abstract just now. Please check your connection and try again.");
    return false;
  }
}

// Attaches the processing-fee transaction ID to the already-created abstract
// doc, then reveals the success overlay.
async function completePaymentSubmission() {
  const btn = document.querySelector("[data-complete-submission]");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    await updateDoc(doc(db, ABSTRACTS_COLLECTION, state.abstractId), {
      paymentInfo: {
        transactionId: state.values.transactionId,
        submittedAt: serverTimestamp(),
      },
      status: "pending_payment_verification",
      updatedAt: serverTimestamp(),
    });

    document.querySelector("[data-review-key]").textContent = state.reviewKey;
    document.querySelector("[data-success-overlay]").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "COMPLETE SUBMISSION";
    alert("We couldn't record your payment details just now. Please check your connection and try again.");
  }
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
guardPage({
  requireAdmin: false,
  onReady: (user, profile) => {
    renderTopbar("submit-abstract", { isAdmin: profile.role === "admin" });
    attachLogout("logoutBtn");

    // Populate all static dropdowns
    fillSelect(document.querySelector('[data-field="institute"]'), INSTITUTES, "Select your institute");
    fillSelect(document.querySelector('[data-field="fieldOfStudy"]'), FIELDS_OF_STUDY, "Select your field of study");
    fillSelect(document.querySelector('[data-field="yearOfStudy"]'), YEARS_OF_STUDY, "Select your year of study");
    fillSelect(document.querySelector('[data-field="province"]'), PROVINCES, "Select your province");
    fillSelect(document.querySelector('[data-field="speciality"]'), SPECIALTIES.map((s) => s.specialty), "Select the speciality");
    fillSelect(document.querySelector('[data-field="abstractType"]'), ABSTRACT_TYPES, "Select the category that best describes your submission");

    const countrySelect = document.querySelector('[data-field="country"]');
    fillSelect(countrySelect, COUNTRIES, "Select your country");
    countrySelect.value = "Pakistan";
    state.values.country = "Pakistan";

    // Populate the radio/checkbox groups added to Step 2
    renderRadioGroup(document.querySelector('[data-radio-group="typeOfStudy"]'), TYPE_OF_STUDY, "typeOfStudy");
    renderCheckboxGroup(document.querySelector('[data-checkbox-group="abstractCategories"]'), ABSTRACT_CATEGORIES, "abstractCategories");
    renderRadioGroup(document.querySelector('[data-radio-group="facultyMentor"]'), ["Yes", "No", "Other"], "facultyMentor");
    renderRadioGroup(document.querySelector('[data-radio-group="publishedInJournal"]'), ["Yes", "No"], "publishedInJournal");
    renderRadioGroup(document.querySelector('[data-radio-group="modeOfPresentation"]'), ["In-Person", "Online"], "modeOfPresentation");
    renderRadioGroup(document.querySelector('[data-radio-group="followUpInterviews"]'), ["Yes", "No"], "followUpInterviews");

    wireGenericFields();
    wireRadioAndCheckboxGroups();
    wireDropzones();
    wireKeywords();
    wireAuthorModal();
    prefillFromProfile(user, profile);

    // Step grid taps — free navigation, matching "navigate between sections freely"
    document.querySelectorAll(".step-tile").forEach((tile) => {
      tile.addEventListener("click", () => goToStep(Number(tile.dataset.step)));
    });

    // Continue buttons validate before advancing + marking complete/error.
    // Step 4's continue button is special: it validates steps 1-4, creates
    // the abstract document in Firestore, and only then reveals Step 5.
    document.querySelectorAll("[data-continue]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const step = Number(btn.dataset.continue);

        if (step === 4) {
          const results = [1, 2, 3, 4].map((s) => ({ s, valid: validateStep(s) }));
          results.forEach(({ s, valid }) => {
            if (valid) { state.completedSteps.add(s); state.erroredSteps.delete(s); }
            else { state.completedSteps.delete(s); state.erroredSteps.add(s); }
          });
          refreshStepGrid();

          const firstInvalid = results.find((r) => !r.valid);
          if (firstInvalid) {
            goToStep(firstInvalid.s);
            scrollToFirstInvalid(firstInvalid.s);
            return;
          }

        btn.disabled = true;
btn.textContent = "Uploading files…";
const uploadsOk = await waitForUploads(["resultCard", "figure1", "figure2"]);
if (!uploadsOk) {
  btn.disabled = false;
  btn.textContent = "CONTINUE";
  alert("One or more file uploads failed. Please reselect the file and try again.");
  return;
}
btn.textContent = "Submitting…";
const ok = await submitAbstract(user, profile);
        
          btn.disabled = false;
          btn.textContent = "CONTINUE";
          if (!ok) return;

          document.querySelector("[data-payment-review-key]").textContent = state.reviewKey;
          goToStep(5);
          return;
        }

        const valid = validateStep(step);
        if (!valid) {
          state.completedSteps.delete(step);
          state.erroredSteps.add(step);
          refreshStepGrid();
          scrollToFirstInvalid(step);
          return;
        }
        state.completedSteps.add(step);
        state.erroredSteps.delete(step);
        goToStep(Math.min(step + 1, TOTAL_STEPS));
      });
    });
    document.querySelectorAll("[data-back]").forEach((btn) => {
      btn.addEventListener("click", () => goToStep(Math.max(Number(btn.dataset.back) - 1, 1)));
    });

    document.querySelector("[data-complete-submission]").addEventListener("click", () => {
      const valid = validateStep(5);
      if (!valid) {
        state.completedSteps.delete(5);
        state.erroredSteps.add(5);
        refreshStepGrid();
        scrollToFirstInvalid(5);
        return;
      }
      state.completedSteps.add(5);
      state.erroredSteps.delete(5);
      refreshStepGrid();
      completePaymentSubmission();
    });

   tryResumeFromQuery(user).then((resumed) => {
  if (!resumed) goToStep(1);
  document.getElementById("loadingState").classList.add("hidden");
  document.getElementById("content").classList.remove("hidden");
});

},
});
