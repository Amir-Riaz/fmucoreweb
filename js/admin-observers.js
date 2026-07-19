import { guardPage, attachLogout } from "./auth-guard.js";
import { renderTopbar } from "./topbar.js";
import {
  db, collection, getDocs, doc, updateDoc, serverTimestamp,
  USERS_COLLECTION, OBSERVER_REGISTRATIONS_COLLECTION,
} from "./firebase-config.js";

let allRegistrations = [];
let currentAdmin = null;

guardPage({
  requireAdmin: true,
  onReady: async (user, profile) => {
    currentAdmin = { name: profile.fullName || "Admin", email: profile.email || user.email };
    renderTopbar("admin-observers", { isAdmin: true });
    attachLogout("logoutBtn");

    await loadRegistrations();
    render();

    document.getElementById("searchInput").addEventListener("input", render);
    document.getElementById("statusFilter").addEventListener("change", render);

    document.getElementById("loadingState").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");
  },
});

async function loadRegistrations() {
  const snap = await getDocs(collection(db, OBSERVER_REGISTRATIONS_COLLECTION));
  allRegistrations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  allRegistrations.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
}

const STATUS_STYLE = {
  submitted: "bg-amber-50 text-amber-700",
  verified: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

function render() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;

  const filtered = allRegistrations.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (!search) return true;
    const haystack = [r.fullName, r.email, r.obstrxid, r.ambassadorCode, r.ambassadorName]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(search);
  });

  const body = document.getElementById("tableBody");
  const empty = document.getElementById("emptyState");
  body.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-slate-100";
    tr.innerHTML = `
      <td class="px-4 py-3">
        <p class="font-semibold text-slate-900">${escapeHtml(r.fullName || "—")}</p>
        <p class="text-xs text-slate-500">${escapeHtml(r.email || "—")}</p>
      </td>
      <td class="px-4 py-3 text-xs">${escapeHtml(r.categoryLabel || r.category || "—")}</td>
      <td class="px-4 py-3">
        <p class="font-bold text-brand-700">PKR ${(r.payableFee ?? 0).toLocaleString()}</p>
        ${r.discountApplied ? `<p class="text-xs text-slate-400 line-through">PKR ${(r.regularFee ?? 0).toLocaleString()}</p>` : ""}
      </td>
      <td class="px-4 py-3 text-xs">
        ${r.ambassadorValid ? `<span class="font-semibold text-emerald-700">${escapeHtml(r.ambassadorName || "")}</span><br>${escapeHtml(r.ambassadorCode || "")}` : "—"}
      </td>
      <td class="px-4 py-3 text-xs">
        <p class="font-mono">${escapeHtml(r.obstrxid || "—")}</p>
        <p class="text-slate-400">${escapeHtml(r.paymentAccount?.name || "—")}</p>
      </td>
      <td class="px-4 py-3">
        ${r.admitCardUrl ? `<a href="${r.admitCardUrl}" target="_blank" rel="noopener" class="text-brand-600 font-semibold text-xs hover:underline">View →</a>` : `<span class="text-xs text-slate-300">—</span>`}
      </td>
      <td class="px-4 py-3">
        <span class="px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLE[r.status] || "bg-slate-100 text-slate-600"}">${r.status || "—"}</span>
      </td>
      <td class="px-4 py-3">
        <div class="flex gap-1.5">
          <button data-verify="${r.id}" data-uid="${r.uid}" class="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition ${r.status === "verified" ? "opacity-40 pointer-events-none" : ""}">Verify</button>
          <button data-reject="${r.id}" data-uid="${r.uid}" class="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 transition ${r.status === "rejected" ? "opacity-40 pointer-events-none" : ""}">Reject</button>
        </div>
      </td>`;
    body.appendChild(tr);
  });

  body.querySelectorAll("[data-verify]").forEach((btn) =>
    btn.addEventListener("click", () => setStatus(btn.dataset.verify, btn.dataset.uid, "verified"))
  );
  body.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", () => setStatus(btn.dataset.reject, btn.dataset.uid, "rejected"))
  );
}

async function setStatus(regId, uid, status) {
  try {
    await updateDoc(doc(db, OBSERVER_REGISTRATIONS_COLLECTION, regId), {
      status,
      verifiedByName: currentAdmin.name,
      verifiedByEmail: currentAdmin.email,
      verifiedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, USERS_COLLECTION, uid), { observerStatus: status });

    const local = allRegistrations.find((r) => r.id === regId);
    if (local) local.status = status;
    render();
  } catch (err) {
    console.error("Failed to update registration status", err);
    alert("Couldn't update this registration — please try again.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}