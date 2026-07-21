import { guardPage, attachLogout } from "./auth-guard.js";
import { renderTopbar } from "./topbar.js";
import { renderImageGallery } from "./image-lightbox.js";
import {
  db, doc, getDoc, updateDoc, serverTimestamp,
  ABSTRACT_REVIEWS_COLLECTION,
} from "./firebase-config.js";

const DECISION_LABEL = { accepted: "Accept", rejected: "Reject" };

let currentUser = null;
let currentProfile = null;
let currentReview = null;
let reviewId = null;

guardPage({
  requireAdmin: false,
  onReady: async (user, profile) => {
    const isFacultyReviewer = profile.facrwr === true || profile.role === "admin";
    if (!isFacultyReviewer) {
      document.getElementById("loadingState").classList.add("hidden");
      document.getElementById("forbiddenState").classList.remove("hidden");
      return;
    }

    currentUser = user;
    currentProfile = profile;
    renderTopbar("faculty-review-abstracts", { isAdmin: profile.role === "admin" });
    attachLogout("logoutBtn");

    reviewId = new URLSearchParams(window.location.search).get("id");
    if (!reviewId) {
      showNotFound();
      return;
    }

    await loadReview();
  },
});

async function loadReview() {
  try {
    const snap = await getDoc(doc(db, ABSTRACT_REVIEWS_COLLECTION, reviewId));
    if (!snap.exists()) {
      showNotFound();
      return;
    }
    currentReview = { id: snap.id, ...snap.data() };

    // Faculty may only open abstracts assigned to them; admins can open any (QA).
  // Faculty may only open abstracts assigned to them, and only once the
// student review committee has accepted it; admins can open any (QA).
const isAdmin = currentProfile.role === "admin";
if (!isAdmin) {
  if (currentReview.assignedFacultyReviewerUid !== currentUser.uid) {
    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("forbiddenState").classList.remove("hidden");
    return;
  }
  if (currentReview.studentReviewDecision !== "accepted") {
    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("forbiddenState").classList.remove("hidden");
    return;
  }
}

    render(currentReview);
    wireControls();
    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");
  } catch (err) {
    console.error("Failed to load review", err);
    showNotFound();
  }
}

function showNotFound() {
  document.getElementById("loadingState").classList.add("hidden");
  document.getElementById("notFoundState").classList.remove("hidden");
}

function render(r) {
  const t = r.abstractType || {};
  const ab = r.abstract || {};

  document.getElementById("reviewKey").textContent = r.reviewKey || r.id;
  document.getElementById("title").textContent = ab.title || "Untitled abstract";

  document.getElementById("speciality").textContent = t.speciality || "—";
  document.getElementById("subSpeciality").textContent = t.subSpeciality || "—";
  document.getElementById("abstractType").textContent = t.abstractType || "—";

  document.getElementById("abstractType").textContent = t.abstractType || "—";
document.getElementById("typeOfStudy").textContent = t.typeOfStudy || "—";

const categoriesEl = document.getElementById("abstractCategories");
categoriesEl.innerHTML = "";
(t.abstractCategories || []).forEach((c) => {
  const chip = document.createElement("span");
  chip.className = "inline-block bg-brand-50 text-brand-700 text-xs font-bold px-2.5 py-1 rounded-full";
  chip.textContent = c;
  categoriesEl.appendChild(chip);
});
if (!(t.abstractCategories || []).length) categoriesEl.textContent = "—";


  document.getElementById("introduction").textContent = ab.introduction || "—";
  document.getElementById("objectives").textContent = ab.objectives || "—";
  document.getElementById("methodology").textContent = ab.methodology || "—";
  document.getElementById("results").textContent = ab.results || "—";
  document.getElementById("conclusion").textContent = ab.conclusion || "—";

  const keywordsEl = document.getElementById("keywords");
  keywordsEl.innerHTML = "";
  (ab.keywords || []).forEach((kw) => {
    const chip = document.createElement("span");
    chip.className = "inline-block bg-brand-50 text-brand-700 text-xs font-bold px-2.5 py-1 rounded-full";
    chip.textContent = kw;
    keywordsEl.appendChild(chip);
  });
  if (!(ab.keywords || []).length) keywordsEl.textContent = "—";

  const rd = r.researchDetails || {};
document.getElementById("facultyMentor").textContent = rd.facultyMentor || "—";
document.getElementById("publishedInJournal").textContent = rd.publishedInJournal || "—";
document.getElementById("modeOfPresentation").textContent = rd.modeOfPresentation || "—";
document.getElementById("followUpInterviews").textContent = rd.followUpInterviews || "—";
document.getElementById("biggestChallenges").textContent = ab.biggestChallenges || "—";

  document.getElementById("recommendationSelect").value = r.facultyReviewDecision || "";
  document.getElementById("trackSelect").value = r.facultyReviewTrack || "";
renderImageGallery(document.getElementById("imagesGallery"), [
  { url: ab.figure1Url, label: "Figure 1" },
  { url: ab.figure2Url, label: "Figure 2" },
]);
  

const alreadyReviewed = !!r.facultyReviewDecision;
document.getElementById("recommendationSelect").disabled = alreadyReviewed;
document.getElementById("trackSelect").disabled = alreadyReviewed;
const saveBtn = document.getElementById("saveRecommendationBtn");
saveBtn.disabled = alreadyReviewed;
saveBtn.textContent = alreadyReviewed ? "Already reviewed" : "Save recommendation";


}

function wireControls() {
  document.getElementById("saveRecommendationBtn").addEventListener("click", saveRecommendation);
}

async function saveRecommendation() {
  const decision = document.getElementById("recommendationSelect").value || null;
  const track = document.getElementById("trackSelect").value || null;

  const updates = {
    facultyReviewDecision: decision,
    facultyReviewTrack: track,
    facultyReviewedByUid: decision ? (currentUser?.uid || null) : null,
    facultyReviewedByName: decision ? (currentProfile?.fullName || currentUser?.email || null) : null,
    facultyReviewedAt: decision ? serverTimestamp() : null,
  };

  const btn = document.getElementById("saveRecommendationBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    // Faculty reviewers only ever write to the anonymized review view —
    // never to `abstracts`, which is where submitter identity lives.
    // Final status is set by the admin only (see abstracts-admin.js) and
    // is never exposed on this reviewer-facing page.
    await updateDoc(doc(db, ABSTRACT_REVIEWS_COLLECTION, reviewId), updates);
    Object.assign(currentReview, updates);
    render(currentReview);
    showToast(decision ? `Recommendation saved: ${DECISION_LABEL[decision]}.` : "Recommendation cleared.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to save your recommendation. Please try again.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 z-50 max-w-xs px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
    type === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"
  }`;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3000);
}
