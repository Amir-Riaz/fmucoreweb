// ============================================================
// FMUCORE — Enrollment Manager
// Scoped-down version of admin.js: lists participants and lets
// an enrolmngr-flagged (non-admin) account approve registrations
// and verify fee transactions (abstract, presentation, observer).
// Approval is one-way from this screen (no unapprove) — mirrors
// the Cpack issuance pattern in admin.js. No block, cpack, or
// permissions controls here.
//
// Participants and their fee transactions are shown in a single
// merged table (one row per participant) rather than two separate
// lists, so an already-approved participant who later submits a
// transaction still shows up with that transaction attached to
// them, in the same place as anyone still pending approval.
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
  ABSTRACTS_COLLECTION,
  OBSERVER_REGISTRATIONS_COLLECTION,
} from "./firebase-config.js";
import { generateSerial } from "./helpers.js";
import { syncPassDoc } from "./pass-sync.js";
import {
  getAbstractTrx,
  verifyAbstractTrx as verifyAbstractFeeTrx,
  getPresentationTrx,
  verifyPresentationTrx as verifyPresentationFeeTrx,
  verifyObserverTrx as verifyObserverRegistrationTrx,
} from "./trx-helpers.js";

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
  renderParticipants();
}

async function loadUsers() {
  const snap = await getDocs(collection(db, USERS_COLLECTION));
  allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allUsers.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  document.getElementById("totalCount").textContent = allUsers.length;
  renderParticipants();
}

function wireControls() {
  document.getElementById("searchInput").addEventListener("input", renderParticipants);
  document.getElementById("checkDuplicatesBtn").addEventListener("click", showDuplicatesModal);
  document.getElementById("closeDuplicatesModal").addEventListener("click", hideDuplicatesModal);
}
function hideDuplicatesModal() {
  document.getElementById("duplicatesModal").classList.add("hidden");
}

function showDuplicatesModal() {
  const feesByUid = buildFeesByUid();

  // Flatten every transaction across every participant into one list, then
  // group by the raw trxId. Case/whitespace-insensitive so "TXN123 " and
  // "txn123" are still caught as the same id.
  const entries = [];
  Object.entries(feesByUid).forEach(([uid, fees]) => {
    const user = allUsers.find((u) => u.id === uid);
    fees.abstractItems.forEach((fee) => {
      entries.push({ uid, user, fee });
    });
    if (fees.observerFee) {
      entries.push({ uid, user, fee: fees.observerFee });
    }
  });

  const byTrxId = {};
  entries.forEach((entry) => {
    const key = (entry.fee.trxId || "").trim().toLowerCase();
    if (!key) return;
    if (!byTrxId[key]) byTrxId[key] = [];
    byTrxId[key].push(entry);
  });

  const duplicateGroups = Object.values(byTrxId).filter((group) => group.length > 1);

  const list = document.getElementById("duplicatesList");
  const emptyState = document.getElementById("duplicatesEmptyState");
  list.innerHTML = "";

  if (duplicateGroups.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
    duplicateGroups.forEach((group) => {
      const card = document.createElement("div");
      card.className = "rounded-xl border-2 border-red-200 bg-red-50 p-4";

      const header = document.createElement("p");
      header.className = "font-mono text-xs font-bold text-red-700 mb-3";
      header.textContent = `Transaction ID: ${group[0].fee.trxId} — used ${group.length} times`;
      card.appendChild(header);

      const rows = document.createElement("div");
      rows.className = "space-y-2";
      group.forEach(({ user, fee }) => {
        const row = document.createElement("div");
        row.className = "bg-white rounded-lg border border-red-100 px-3 py-2";
        row.innerHTML = `
          <p class="font-semibold text-sm text-slate-900">${escapeHtml(user?.fullName || "—")} <span class="text-slate-400 font-normal">(${escapeHtml(user?.email || "—")})</span></p>
          <p class="text-xs text-slate-600 mt-0.5">${escapeHtml(fee.label)}${fee.title ? ` — ${escapeHtml(fee.title)}` : ""}</p>`;
        rows.appendChild(row);
      });
      card.appendChild(rows);
      list.appendChild(card);
    });
  }

  document.getElementById("duplicatesModal").classList.remove("hidden");
}
// Builds { uid -> { observerFee, abstractItems: [{label, trxId, title, verified, verifyFn}] } }
function buildFeesByUid() {
  const byUid = {};
  const ensure = (uid) => {
    if (!byUid[uid]) byUid[uid] = { observerFee: null, abstractItems: [] };
    return byUid[uid];
  };

  Object.entries(observerRegByUid).forEach(([uid, reg]) => {
    if (!reg.obstrxid) return;
    ensure(uid).observerFee = {
      label: "Observer Fee",
      trxId: reg.obstrxid,
      title: null,
      verified: (reg.status || "submitted") === "verified",
      verifyFn: () => verifyObserverTrx(uid),
    };
  });

  allAbstracts.forEach((a) => {
    const uid = a.submittedBy?.uid;
    if (!uid) return;
    const title = a.abstract?.title || null;

    const abTrx = getAbstractTrx(a);
    if (abTrx) {
      ensure(uid).abstractItems.push({
        label: "Abstract Fee",
        trxId: abTrx.transactionId,
        title,
        verified: abTrx.status === "verified",
        verifyFn: () => verifyAbstractTrx(a.id),
      });
    }

    const presTrx = getPresentationTrx(a);
    if (presTrx) {
      ensure(uid).abstractItems.push({
        label: "Presentation Fee",
        trxId: presTrx.transactionId,
        title,
        verified: presTrx.status === "verified",
        verifyFn: () => verifyPresentationTrx(a.id),
      });
    }
  });

  return byUid;
}

function renderParticipants() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const tbody = document.getElementById("participantsTableBody");
  const emptyState = document.getElementById("participantsEmptyState");

  // Blocked accounts are out of scope for this screen either way.
  const matchesQuery = (u) =>
    !q ||
    (u.fullName || "").toLowerCase().includes(q) ||
    (u.email || "").toLowerCase().includes(q);

  const participants = allUsers.filter((u) => !u.blocked && matchesQuery(u));
  const feesByUid = buildFeesByUid();

  document.getElementById("participantsCount").textContent = `(${participants.length})`;

  if (participants.length === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");
  tbody.innerHTML = "";

  participants.forEach((u) => {
    const fees = feesByUid[u.id] || { observerFee: null, abstractItems: [] };

    const tr = document.createElement("tr");
    tr.className = "align-top hover:bg-slate-50/60 transition";

    // Column 1 — participant identity
    const participantTd = document.createElement("td");
    participantTd.className = "px-4 py-3 whitespace-nowrap";
    participantTd.innerHTML = `
      <p class="font-medium text-slate-900">${escapeHtml(u.fullName || "—")}</p>
      <p class="text-slate-500 text-xs mt-0.5">${escapeHtml(u.email || "—")}</p>
      <p class="text-slate-400 text-xs mt-0.5">${escapeHtml(u.organization || "—")}</p>`;
    tr.appendChild(participantTd);

    // Column 2 — approval status / action
    const approvalTd = document.createElement("td");
    approvalTd.className = "px-4 py-3";
    if (u.status === "approved") {
      approvalTd.innerHTML = `
        <span class="inline-block px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 mb-1">Approved</span>
        <p class="text-slate-400 text-xs">${escapeHtml(u.approvedByName || "—")}</p>`;
    } else {
      const btn = document.createElement("button");
      btn.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-700 hover:bg-green-50 transition";
      btn.textContent = "Approve";
      btn.addEventListener("click", () => handleApprove(u.id));
      approvalTd.appendChild(btn);
    }
    tr.appendChild(approvalTd);

    // Column 3 — fees
    const feesTd = document.createElement("td");
    feesTd.className = "px-4 py-3";
    const list = document.createElement("div");
    list.className = "space-y-2";

    const renderFeeRow = (fee) => {
      const row = document.createElement("div");
      row.className = "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2";

      const info = document.createElement("div");
      info.className = "min-w-0";
      info.innerHTML = `
        <p class="text-xs font-semibold text-slate-700">${escapeHtml(fee.label)}</p>
        <p class="font-mono text-[11px] text-slate-500 truncate">${escapeHtml(fee.trxId)}</p>
        ${fee.title ? `<p class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(fee.title)}</p>` : ""}`;
      row.appendChild(info);

      if (fee.verified) {
        const badge = document.createElement("span");
        badge.className = "text-emerald-600 text-xs font-bold shrink-0";
        badge.textContent = "✔ Verified";
        row.appendChild(badge);
      } else {
        const btn = document.createElement("button");
        btn.className = "px-2.5 py-1.5 rounded-lg text-xs font-semibold text-amber-700 hover:bg-amber-50 transition shrink-0";
        btn.textContent = "Verify";
        btn.addEventListener("click", async () => {
          await fee.verifyFn();
          await loadTransactions();
        });
        row.appendChild(btn);
      }
      return row;
    };

    fees.abstractItems.forEach((fee) => list.appendChild(renderFeeRow(fee)));
    if (fees.observerFee) list.appendChild(renderFeeRow(fees.observerFee));

    if (!fees.abstractItems.length && !fees.observerFee) {
      const none = document.createElement("p");
      none.className = "text-slate-400 text-xs";
      none.textContent = "No transactions yet.";
      list.appendChild(none);
    }

    feesTd.appendChild(list);
    tr.appendChild(feesTd);
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
    await verifyAbstractFeeTrx(id, a);
    a.abstractTrxStatus = "verified";
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
    renderParticipants();
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