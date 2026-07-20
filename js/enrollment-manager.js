// ============================================================
// FMUCORE — Enrollment Manager
// Scoped-down version of admin.js: lists participants and lets
// an enrolmngr-flagged (non-admin) account approve registrations
// only. Approval is one-way from this screen (no unapprove) —
// mirrors the Cpack issuance pattern in admin.js. No block,
// cpack, or permissions controls here.
// ============================================================

import { guardPage, attachLogout } from "./auth-guard.js";
import { renderTopbar } from "./topbar.js";
import {
  db,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  USERS_COLLECTION,
  ABSTRACTS_COLLECTION,          // NEW
  OBSERVER_REGISTRATIONS_COLLECTION, // NEW
} from "./firebase-config.js";
import { generateSerial } from "./helpers.js";
import { syncPassDoc } from "./pass-sync.js";
import {
  getAbstractTrxId,
  isAbstractTrxVerified,
  verifyAbstractPaymentTrx,
  getPresentationTrxId,
  getPresentationTrxStatus,
  verifyPresentationFeeTrx,
  getObserverTrxId,
  getObserverTrxStatus,
  verifyObserverRegistrationTrx,
} from "./trx-helpers.js"; // NEW

let allAbstracts = [];
let observerRegByUid = {};
let allUsers = [];
let currentManager = { name: "", email: "" };

guardPage({
  requireAdmin: false, // enrolmngr is a permission flag, not the admin role
  onReady: async (user, profile) => {
    if (!profile.enrolmngr) {
      // Not granted this permission — bounce back to the regular dashboard
      window.location.href = "dashboard.html";
      return;
    }

    currentManager = { name: profile.fullName || "Enrollment Manager", email: user.email || "" };

    renderTopbar("enrollment-manager", { isAdmin: false });
    attachLogout("logoutBtn");
   await loadUsers();
await loadTransactions();
wireControls();

    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");
  },
});

async function loadTransactions() {
  const [absSnap, obsSnap] = await Promise.all([
    getDocs(collection(db, ABSTRACTS_COLLECTION)),
    getDocs(collection(db, OBSERVER_REGISTRATIONS_COLLECTION)),
  ]);
  allAbstracts = absSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  observerRegByUid = {};
  obsSnap.docs.forEach((d) => { observerRegByUid[d.id] = d.data(); });
  renderTransactions();
}
async function loadUsers() {
  const snap = await getDocs(collection(db, USERS_COLLECTION));
  allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  document.getElementById("totalCount").textContent = allUsers.length;
  renderLists();
}

function wireControls() {
  document.getElementById("searchInput").addEventListener("input", renderLists);
}

function renderTransactions() {
  const tbody = document.getElementById("transactionsTableBody");
  const emptyState = document.getElementById("transactionsEmptyState");
  const rows = [];

  Object.entries(observerRegByUid).forEach(([uid, reg]) => {
    const trxId = getObserverTrxId(reg);
    if (!trxId) return;
    const user = allUsers.find((u) => u.id === uid);
    rows.push({
      type: "Observer Registration",
      name: user?.fullName || "—",
      trxId,
      verified: getObserverTrxStatus(reg) === "verified",
      verifyFn: () => verifyObserverTrx(uid),
      viewHref: null,
    });
  });

  allAbstracts.forEach((a) => {
    const user = allUsers.find((u) => u.id === a.submittedBy?.uid);
    const name = user?.fullName || `${a.personalInfo?.firstName || ""} ${a.personalInfo?.lastName || ""}`.trim() || "—";

    const abTrxId = getAbstractTrxId(a);
    if (abTrxId) {
      rows.push({
        type: `Abstract Fee (${a.reviewKey || a.id})`,
        name,
        trxId: abTrxId,
        verified: isAbstractTrxVerified(a),
        verifyFn: () => verifyAbstractTrx(a.id),
        viewHref: `abstract-detail.html?id=${encodeURIComponent(a.id)}`,
      });
    }
    const presTrxId = getPresentationTrxId(a);
    if (presTrxId) {
      rows.push({
        type: `Presentation Fee (${a.reviewKey || a.id})`,
        name,
        trxId: presTrxId,
        verified: getPresentationTrxStatus(a) === "verified",
        verifyFn: () => verifyPresentationTrx(a.id),
        viewHref: `abstract-detail.html?id=${encodeURIComponent(a.id)}`,
      });
    }
  });

  document.getElementById("transactionsCount").textContent = `(${rows.length})`;

  if (rows.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/60 transition";
    tr.innerHTML = `
      <td class="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">${escapeHtml(r.name)}</td>
      <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${escapeHtml(r.type)}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-700">${escapeHtml(r.trxId)}</td>
      <td class="px-4 py-3 text-right"></td>`;
    const actionsTd = tr.querySelector("td:last-child");
    if (r.verified) {
      actionsTd.innerHTML = `<span class="text-emerald-600 text-xs font-bold">✔ Verified</span>`;
    } else {
      const btn = document.createElement("button");
      btn.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-50 transition mr-1";
      btn.textContent = "Verify";
      btn.addEventListener("click", async () => {
        await r.verifyFn();
        await loadTransactions();
      });
      actionsTd.appendChild(btn);
    }
    if (r.viewHref) {
      const link = document.createElement("a");
      link.href = r.viewHref;
      link.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-brand-700 hover:bg-brand-50 transition";
      link.textContent = "View";
      actionsTd.appendChild(link);
    }
    tbody.appendChild(tr);
  });
}

async function verifyObserverTrx(uid) {
  try {
    await verifyObserverRegistrationTrx(uid);
    if (observerRegByUid[uid]) observerRegByUid[uid].status = "verified";
    showToast("Observer registration verified.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to verify observer registration.", "error");
  }
}

async function verifyAbstractTrx(id) {
  const a = allAbstracts.find((x) => x.id === id);
  if (!a) return;
  try {
    await verifyAbstractPaymentTrx(id, a);
    if (a.abstractTrx) a.abstractTrx.verified = true;
    else if (a.paymentInfo) a.paymentInfo.verified = true;
    showToast("Abstract payment verified.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to verify abstract payment.", "error");
  }
}

async function verifyPresentationTrx(id) {
  const a = allAbstracts.find((x) => x.id === id);
  if (!a) return;
  try {
    await verifyPresentationFeeTrx(id);
    a.presentationFeeStatus = "verified";
    showToast("Presentation fee verified.", "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to verify presentation fee.", "error");
  }
}
function renderLists() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();

  // Blocked accounts are out of scope for enrolment approval either way
  const inScope = allUsers.filter((u) => !u.blocked);
  const matchesQuery = (u) =>
    !q ||
    (u.fullName || "").toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q);

  const pending = inScope.filter((u) => u.status !== "approved" && matchesQuery(u));
  const approved = inScope.filter((u) => u.status === "approved" && matchesQuery(u));

  renderPending(pending);
  renderApproved(approved);
}

function renderPending(list) {
  const tbody = document.getElementById("pendingTableBody");
  const emptyState = document.getElementById("pendingEmptyState");
  document.getElementById("pendingCount").textContent = `(${list.length})`;

  if (list.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  tbody.innerHTML = list
    .map(
      (u) => `
        <tr class="hover:bg-slate-50/60 transition">
          <td class="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">${escapeHtml(u.fullName || "—")}</td>
          <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${escapeHtml(u.email || "—")}</td>
          <td class="px-4 py-3 text-slate-600 hidden md:table-cell whitespace-nowrap">${escapeHtml(u.organization || "—")}</td>
          <td class="px-4 py-3 text-right">
            <button data-action="approve" data-uid="${u.id}"
              class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-700 hover:bg-green-50 transition">
              Approve
            </button>
          </td>
        </tr>`
    )
    .join("");

  tbody.querySelectorAll('[data-action="approve"]').forEach((btn) => {
    btn.addEventListener("click", () => handleApprove(btn.dataset.uid));
  });
}

function renderApproved(list) {
  const tbody = document.getElementById("approvedTableBody");
  const emptyState = document.getElementById("approvedEmptyState");
  document.getElementById("approvedCount").textContent = `(${list.length})`;

  if (list.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  tbody.innerHTML = list
    .map(
      (u) => `
        <tr class="hover:bg-slate-50/60 transition">
          <td class="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">${escapeHtml(u.fullName || "—")}</td>
          <td class="px-4 py-3 text-slate-600 whitespace-nowrap">${escapeHtml(u.email || "—")}</td>
          <td class="px-4 py-3 text-slate-600 hidden md:table-cell whitespace-nowrap">${escapeHtml(u.organization || "—")}</td>
          <td class="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">${escapeHtml(u.approvedByName || "—")}</td>
        </tr>`
    )
    .join("");
}

// Approval is one-way from this screen — no unapprove control here.
// If a mistaken approval needs reverting, that goes through the full
// admin panel, which retains that control.
async function handleApprove(uid) {
  const u = allUsers.find((x) => x.id === uid);
  if (!u || u.status === "approved") return; // already approved — nothing to do

  const ok = confirm(`Approve ${u.fullName}?\n\nThis cannot be undone from this screen.`);
  if (!ok) return;

  const updates = {
    status: "approved",
    approvedByName: currentManager.name,
    approvedByEmail: currentManager.email,
    approvedAt: serverTimestamp(),
  };

  // Assign a serial only the first time a user is approved
  if (!u.serial) {
    updates.serial = generateSerial();
  }

  try {
    await updateDoc(doc(db, USERS_COLLECTION, uid), updates);
    Object.assign(u, updates);
    await syncPassDoc(u);
    renderLists();
    showToast(`${u.fullName} approved.`, "success");
  } catch (err) {
    console.error(err);
    showToast("Failed to approve. Please try again.", "error");
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}