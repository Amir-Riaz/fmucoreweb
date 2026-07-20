// ============================================================
// FMUCORE — Cpack Issuance Log
// Append-only audit trail of every conference-pack issuance, kept
// separate from users/{uid} so the record survives even if the
// user doc's cpackIssuedBy* fields are ever overwritten later
// (e.g. the disabled "revoke/re-issue" flow being turned back on).
// Written by both admin.js (Participant Management table) and
// verify.js (badge-verifier check-in desk) whenever a cpack is issued.
// ============================================================

import {
  db, collection, addDoc, serverTimestamp, CPACK_ISSUANCES_COLLECTION,
} from "./firebase-config.js";

/**
 * @param {Object} details
 * @param {string} details.uid          - participant/observer receiving the pack
 * @param {string} details.serial       - their serial/pass number, for quick lookup
 * @param {string} details.fullName     - their name, for readability in the log
 * @param {string} details.issuedByUid
 * @param {string} details.issuedByName
 * @param {string} details.issuedByEmail
 * @param {"admin"|"badgeverifier"} details.source - which screen this came from
 */
export async function logCpackIssuance(details) {
  try {
    await addDoc(collection(db, CPACK_ISSUANCES_COLLECTION), {
      ...details,
      issuedAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal by design — users/{uid}.cpackIssued is the actual source of
    // truth for whether a pack was issued. Losing a log entry shouldn't
    // roll back or block the issuance itself, just get surfaced for review.
    console.error("Failed to write cpack issuance log", err);
  }
}