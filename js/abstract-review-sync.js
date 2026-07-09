// ============================================================
// FMUCORE — Abstract Review Sync
// Keeps a PII-free `abstractReviewViews/{abstractId}` document in sync
// whenever an abstract is submitted or its status/track/assignment
// changes. Reviewers are granted Firestore read/write access to THIS
// collection only — never to `abstracts`, which holds submitter names,
// emails, institutes, and author lists.
//
// Deliberately excluded from this view: submittedBy, personalInfo, authors,
// and reviewer NAMES (only reviewer UIDs are mirrored, purely so a
// reviewer's own dashboard query — where assignedXReviewerUid == their uid —
// can find their assigned abstracts without ever touching `abstracts`).
//
// Uses merge:true so this sync never clobbers fields it doesn't own
// (studentReviewDecision / facultyReviewDecision and their audit fields
// are written directly by the reviewer pages, not by this function).
// ============================================================

import { db, doc, setDoc, ABSTRACT_REVIEWS_COLLECTION } from "./firebase-config.js";

/**
 * @param {string} abstractId - the Firestore doc id in the `abstracts` collection
 * @param {Object} abstract - the full abstract document being written/updated
 */
// abstract-review-sync.js
export async function syncAbstractReviewView(abstractId, abstract) {
  await setDoc(
    doc(db, ABSTRACT_REVIEWS_COLLECTION, abstractId),
    {
      reviewKey: abstract.reviewKey,
      abstractType: abstract.abstractType,
      abstract: {
        title: abstract.abstract.title,
        introduction: abstract.abstract.introduction,
        objectives: abstract.abstract.objectives,
        methodology: abstract.abstract.methodology,
        results: abstract.abstract.results,
        conclusion: abstract.abstract.conclusion,
        keywords: abstract.abstract.keywords,
        figure1Url: abstract.abstract.figure1Url || null,
        figure2Url: abstract.abstract.figure2Url || null,
      },
      status: abstract.status,
      track: abstract.track,
      // FIX: source fields are `studentReviewerUid` / `facultyReviewerUid`
      // on the abstract doc (see abstracts-admin.js saveReviewerAssignments),
      // not `assignedStudentReviewerUid` / `assignedFacultyReviewerUid`.
      assignedStudentReviewerUid: abstract.studentReviewerUid || null,
      assignedFacultyReviewerUid: abstract.facultyReviewerUid || null,
    },
    { merge: true }
  );
}
