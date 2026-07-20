// ============================================================
// FMUCORE — Pass Sync
// Keeps a public-safe `passes/{serial}` document in sync whenever
// an admin changes a participant's approval/block/cpack status.
// This document intentionally excludes email/phone so the public
// verify.html page can read it without exposing PII.
//
// It does store `uid` — not PII on its own, and required so that
// authenticated staff (admin/badgeverifier) can look up the full
// users/{uid} record and abstract submissions from verify.js.
// ============================================================

import { db, doc, setDoc, PASSES_COLLECTION } from "./firebase-config.js";

/**
 * @param {Object} profile - the user's Firestore profile (users/{uid} data),
 *   plus an id/uid field identifying which user this is. Callers pass either
 *   an allUsers-style object (`.id`) or a uid-lookup object (`.uid`) — both
 *   are handled.
 */
export async function syncPassDoc(profile) {
  if (!profile.serial) return; // nothing to sync until a serial exists

  const uid = profile.id || profile.uid;
  if (!uid) {
    console.error("syncPassDoc: profile has no id/uid — skipping pass sync.", profile);
    return;
  }

  const combinedStatus = profile.blocked ? "blocked" : profile.status === "approved" ? "approved" : "pending";

  await setDoc(doc(db, PASSES_COLLECTION, profile.serial), {
    uid,
    serial: profile.serial,
    fullName: profile.fullName || "",
    organization: profile.organization || "",
    status: combinedStatus,
    cpackIssued: !!profile.cpackIssued,
  });
}