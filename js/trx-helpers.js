// ============================================================
// FMUCORE — Shared Transaction Helpers
// Single source of truth for reading/verifying all three trx
// types (abstract fee, presentation fee, observer fee) so every
// admin-facing screen behaves consistently.
//
// Retroactive note: abstract processing-fee data used to live
// under `paymentInfo` (with an inline `verified` boolean). Newer
// submissions write `abstractTrx` instead, and verification now
// lives in a top-level `abstractTrxStatus` field (matching the
// presentation-fee pattern). getAbstractTrx() reads either shape.
// ============================================================

import {
  db, doc, getDoc, updateDoc, serverTimestamp,
  ABSTRACTS_COLLECTION, USERS_COLLECTION, OBSERVER_REGISTRATIONS_COLLECTION,
} from "./firebase-config.js";

export const TRX_STATUS_LABEL = {
  submitted: "Pending Verification",
  pending: "Pending Verification",
  verified: "Verified",
  rejected: "Rejected",
};

export const TRX_STATUS_STYLE = {
  submitted: "bg-amber-50 text-amber-700",
  pending: "bg-amber-50 text-amber-700",
  verified: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

// --- Abstract processing fee ---------------------------------------
export function getAbstractTrx(a) {
  const trx = a?.abstractTrx || a?.paymentInfo || null;
  if (!trx || !trx.transactionId) return null;

  let status = "pending";
  if (a.abstractTrxStatus) {
    status = a.abstractTrxStatus;
  } else if (trx.verified) {
    status = "verified"; // legacy inline flag from the old paymentInfo shape
  }

  return {
    transactionId: trx.transactionId,
    account: trx.account || null,
    submittedAt: trx.submittedAt || null,
    status,
  };
}

export async function verifyAbstractTrx(abstractId, abstractData) {
  const updates = {
    abstractTrxStatus: "verified",
    status: "submitted", // payment confirmed — leaves pending_payment_verification
    updatedAt: serverTimestamp(),
  };
  if (abstractData?.paymentInfo) {
    updates["paymentInfo.verified"] = true; // keep legacy flag in sync too
  }
  await updateDoc(doc(db, ABSTRACTS_COLLECTION, abstractId), updates);
}

// Temporary — lets admins reverse a mistaken verification during testing.
export async function unverifyAbstractTrx(abstractId, abstractData) {
  const updates = {
    abstractTrxStatus: "pending",
    status: "pending_payment_verification",
    updatedAt: serverTimestamp(),
  };
  if (abstractData?.paymentInfo) {
    updates["paymentInfo.verified"] = false;
  }
  await updateDoc(doc(db, ABSTRACTS_COLLECTION, abstractId), updates);
}
// --- Presentation fee -------------------------------------------------
export function getPresentationTrx(a) {
  if (!a?.presentationTrackTrxId) return null;
  return {
    transactionId: a.presentationTrackTrxId,
    status: a.presentationFeeStatus || "pending",
  };
}

export async function verifyPresentationTrx(abstractId) {
  await updateDoc(doc(db, ABSTRACTS_COLLECTION, abstractId), {
    presentationFeeStatus: "verified",
    updatedAt: serverTimestamp(),
  });
}

// --- Observer registration fee ----------------------------------------
export async function getObserverTrx(uid) {
  try {
    const snap = await getDoc(doc(db, OBSERVER_REGISTRATIONS_COLLECTION, uid));
    if (!snap.exists()) return null;
    const reg = snap.data();
    if (!reg.obstrxid) return null;
    return {
      transactionId: reg.obstrxid,
      categoryLabel: reg.categoryLabel || null,
      payableFee: reg.payableFee ?? null,
      status: reg.status || "submitted",
    };
  } catch (err) {
    console.error("Failed to load observer registration", err);
    return null;
  }
}

export async function verifyObserverTrx(uid) {
  await updateDoc(doc(db, OBSERVER_REGISTRATIONS_COLLECTION, uid), {
    status: "verified",
    updatedAt: serverTimestamp(),
  });
  // dashboard.js reads observerStatus off the users/{uid} mirror, not the
  // registration doc — keep both in sync.
  await updateDoc(doc(db, USERS_COLLECTION, uid), {
    observerStatus: "verified",
  });
}