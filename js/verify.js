import { guardPage, attachLogout } from "./auth-guard.js";
import { renderTopbar } from "./topbar.js";
import {
  db, doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp,
  PASSES_COLLECTION, USERS_COLLECTION, ABSTRACTS_COLLECTION,
} from "./firebase-config.js";
import { syncPassDoc } from "./pass-sync.js";
import { logCpackIssuance } from "./cpack-log.js";

const form = document.getElementById("verifyForm");
const input = document.getElementById("serialInput");

const states = {
  idle: document.getElementById("idleState"),
  loading: document.getElementById("loadingState"),
  valid: document.getElementById("validState"),
  invalid: document.getElementById("invalidState"),
  revoked: document.getElementById("revokedState"),
};

// The staff member currently signed in (admin or badge verifier) — recorded
// on cpackIssuedByName/Email exactly like admin.js does.
let currentStaff = { uid: "", name: "", email: "" };

// Full record for whatever pass is currently on screen — set by
// verifySerial(), read by handleIssueCpack(). Cleared between lookups.
let currentUserDoc = null;

guardPage({
  requireAdmin: false,
  onReady: async (user, profile) => {
    // Hard gate: only admins or accounts explicitly flagged as badge
    // verifiers may use this page. Everyone else gets bounced to the
    // dashboard — this is a staff/check-in tool, not a participant page.
    if (profile.role !== "admin" && !profile.badgeverifier) {
      window.location.href = "dashboard.html";
      return;
    }

    currentStaff = { uid: user.uid, name: profile.fullName || "Staff", email: user.email || "" };

    renderTopbar("verify", { isAdmin: profile.role === "admin" });
    attachLogout("logoutBtn");

    document.getElementById("authLoadingState")?.classList.add("hidden");
    document.getElementById("content")?.classList.remove("hidden");

    wireControls();
  },
});

function wireControls() {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    verifySerial(input.value);
  });

  document.getElementById("issueCpackBtn")?.addEventListener("click", handleIssueCpack);

  // Auto-run if a serial was passed in the URL (e.g. from a scanned QR code)
  const params = new URLSearchParams(window.location.search);
  const serialParam = params.get("serial");
  if (serialParam) {
    input.value = serialParam;
    verifySerial(serialParam);
  }
}

function showState(name) {
  Object.values(states).forEach((el) => el.classList.add("hidden"));
  states[name].classList.remove("hidden");
}

function renderCpackBadge(issued) {
  const el = document.getElementById("resultCpack");
  const btn = document.getElementById("issueCpackBtn");
  if (issued) {
    el.textContent = "✔ Issued";
    el.className = "font-bold text-green-700";
    btn?.classList.add("hidden");
  } else {
    el.textContent = "Not Issued";
    el.className = "font-bold text-amber-700";
    btn?.classList.remove("hidden");
  }
}

const ABSTRACT_STATUS_LABEL = {
  pending_payment_verification: "Pending Payment Verification",
  submitted: "Submitted",
  under_review: "Under Review",
  accepted: "Accepted",
  rejected: "Not Accepted",
};

function renderRoleAndAbstract(userData, abstractInfo) {
  const roleEl = document.getElementById("resultRole");
  if (roleEl) {
    // Role is primarily Participant vs Observer — special permission
    // flags (admin/reviewer/etc.) aren't relevant at the check-in desk.
    roleEl.textContent = userData.observerRegistered ? "Observer" : "Participant";
  }

  const absSection = document.getElementById("resultAbstractSection");
  const absTitle = document.getElementById("resultAbstractTitle");
  const absStatus = document.getElementById("resultAbstractStatus");
  if (!absSection) return;

  if (abstractInfo) {
    absSection.classList.remove("hidden");
    if (absTitle) absTitle.textContent = abstractInfo.abstract?.title || "Untitled abstract";
    if (absStatus) absStatus.textContent = ABSTRACT_STATUS_LABEL[abstractInfo.status] || abstractInfo.status || "—";
  } else {
    absSection.classList.add("hidden");
  }
}

async function verifySerial(serial) {
  const clean = serial.trim().toUpperCase();
  if (!clean) return;

  showState("loading");
  currentUserDoc = null;

  try {
    const passSnap = await getDoc(doc(db, PASSES_COLLECTION, clean));

    if (!passSnap.exists()) {
      showState("invalid");
      return;
    }

    const pass = passSnap.data();

    if (pass.status !== "approved") {
      showState("revoked");
      return;
    }

    if (!pass.uid) {
      // Pass doc predates uid being stored, or syncPassDoc isn't writing
      // it — fall back to the minimal fields so the page doesn't break,
      // but full detail + cpack issuance need the uid to work.
      console.error("Pass doc has no `uid` field — cannot load full user record or issue cpack.", clean);
      document.getElementById("resultName").textContent = pass.fullName || "—";
      document.getElementById("resultOrg").textContent = pass.organization || "—";
      document.getElementById("resultSerial").textContent = pass.serial;
      renderCpackBadge(!!pass.cpackIssued);
      renderRoleAndAbstract({}, null);
      document.getElementById("issueCpackBtn")?.classList.add("hidden");
      showState("valid");
      return;
    }

    const userSnap = await getDoc(doc(db, USERS_COLLECTION, pass.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    currentUserDoc = { id: pass.uid, uid: pass.uid, serial: pass.serial, ...userData };

    // Look up whether this participant has a submitted abstract, for
    // display only — badge verifiers never write to /abstracts.
    let abstractInfo = null;
    try {
      const absQ = query(collection(db, ABSTRACTS_COLLECTION), where("submittedBy.uid", "==", pass.uid));
      const absSnap = await getDocs(absQ);
      if (!absSnap.empty) abstractInfo = absSnap.docs[0].data();
    } catch (err) {
      console.error("Failed to load abstract info for pass", err);
    }

    document.getElementById("resultName").textContent = userData.fullName || pass.fullName || "—";
    document.getElementById("resultOrg").textContent = userData.organization || pass.organization || "—";
    document.getElementById("resultSerial").textContent = pass.serial;
    renderCpackBadge(!!userData.cpackIssued);
    renderRoleAndAbstract(userData, abstractInfo);

    showState("valid");
  } catch (err) {
    console.error(err);
    showState("invalid");
  }
}

// One-way, same pattern as admin.js's handleIssueCpack — no revoke here.
async function handleIssueCpack() {
  if (!currentUserDoc?.uid || currentUserDoc.cpackIssued) return;

  const ok = confirm(
    `Issue conference pack to ${currentUserDoc.fullName || "this participant"}?\n\nThis is a one-time action and cannot be undone from here.`
  );
  if (!ok) return;

  const updates = {
    cpackIssued: true,
    cpackIssuedAt: serverTimestamp(),
    cpackIssuedByName: currentStaff.name,
    cpackIssuedByEmail: currentStaff.email,
  };

  const btn = document.getElementById("issueCpackBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Issuing…"; }

  try {
    await updateDoc(doc(db, USERS_COLLECTION, currentUserDoc.uid), updates);
    Object.assign(currentUserDoc, updates);
    await syncPassDoc(currentUserDoc);
    await logCpackIssuance({
      uid: currentUserDoc.uid,
      serial: currentUserDoc.serial || "",
      fullName: currentUserDoc.fullName || "",
      issuedByUid: currentStaff.uid,
      issuedByName: currentStaff.name,
      issuedByEmail: currentStaff.email,
      source: "badgeverifier",
    });
    renderCpackBadge(true);
  } catch (err) {
    console.error(err);
    alert("Failed to issue cpack. Please try again.");
    if (btn) { btn.disabled = false; btn.textContent = "Issue Cpack"; }
  }
}