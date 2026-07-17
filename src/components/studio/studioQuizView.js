/**
 * studioQuizView (Studio PR 3) — the EDITING VIEW over the verbatim stored
 * quiz shape. Storage is never restructured (the server re-scores from this
 * exact shape; the v2 clamp passes `quiz` through wholesale): every helper
 * clones, mutates the target in place, preserves sibling questions, steps and
 * unknown keys, and returns a new quiz object.
 *
 * Referential integrity (Codex F7) — the classic editor is NOT the precedent
 * here (it dangles references): profile REMOVAL atomically strips the id from
 *   - scoring.profileOrder
 *   - scoring.readiness.rankFactor
 *   - every steps[].questions[].options[].scores
 * and profile ID RENAME rewrites all three sites. The Studio UI never exposes
 * raw id editing (§03 needs add/remove + copy fields only), but the rename
 * helper keeps the invariant testable and available.
 *
 * Multi-key `scores` maps (advanced weighting) are NEVER collapsed: the UI
 * shows them read-only; only single-key (or empty) maps get the simple
 * option→profile selector.
 */

const clone = (q) => structuredClone(q);

let uidCounter = 0;
const rawUid = (prefix) => `${prefix}-${Date.now().toString(36)}${(uidCounter += 1)}`;

/** Every id already present anywhere in the quiz (steps, questions, options,
 * profiles) — generated ids must never collide with stored ones. */
function existingIds(quiz) {
  const ids = new Set();
  for (const p of quiz?.resultProfiles || []) if (p?.id) ids.add(p.id);
  for (const s of quiz?.steps || []) {
    if (s?.id) ids.add(s.id);
    for (const q of s.questions || []) {
      if (q?.id) ids.add(q.id);
      for (const o of q.options || []) if (o?.id) ids.add(o.id);
    }
  }
  return ids;
}

function uid(prefix, quiz) {
  const taken = existingIds(quiz);
  let id = rawUid(prefix);
  while (taken.has(id)) id = rawUid(prefix);
  return id;
}

/** Flattened editing view: one row per question with its stable locator. */
export function flattenQuestions(quiz) {
  const out = [];
  (quiz?.steps || []).forEach((step, stepIndex) => {
    (step.questions || []).forEach((question, questionIndex) => {
      out.push({ stepIndex, questionIndex, question });
    });
  });
  return out;
}

export function updateQuestion(quiz, stepIndex, questionIndex, patch) {
  const next = clone(quiz);
  const q = next.steps?.[stepIndex]?.questions?.[questionIndex];
  if (q) Object.assign(q, patch);
  return next;
}

export function removeQuestion(quiz, stepIndex, questionIndex) {
  const next = clone(quiz);
  const step = next.steps?.[stepIndex];
  if (!step?.questions) return next;
  step.questions.splice(questionIndex, 1);
  // An emptied step is dropped (renderers flatten across steps, so an empty
  // shell only risks confusing future readers).
  if (step.questions.length === 0) next.steps.splice(stepIndex, 1);
  return next;
}

export function addQuestion(quiz) {
  const next = clone(quiz);
  next.steps = next.steps || [];
  const question = {
    id: uid('q', next),
    prompt: '',
    type: 'single',
    weight: 1,
    options: [
      { id: uid('opt', next), label: '', scores: {} },
      { id: uid('opt', next), label: '', scores: {} },
    ],
  };
  if (next.steps.length === 0) next.steps.push({ id: uid('step', next), questions: [question] });
  else next.steps[next.steps.length - 1].questions.push(question);
  return next;
}

export function updateOption(quiz, stepIndex, questionIndex, optionIndex, patch) {
  const next = clone(quiz);
  const opt = next.steps?.[stepIndex]?.questions?.[questionIndex]?.options?.[optionIndex];
  if (opt) Object.assign(opt, patch);
  return next;
}

export function addOption(quiz, stepIndex, questionIndex) {
  const next = clone(quiz);
  const q = next.steps?.[stepIndex]?.questions?.[questionIndex];
  if (q) {
    q.options = q.options || [];
    q.options.push({ id: uid('opt', next), label: '', scores: {} });
  }
  return next;
}

export function removeOption(quiz, stepIndex, questionIndex, optionIndex) {
  const next = clone(quiz);
  const q = next.steps?.[stepIndex]?.questions?.[questionIndex];
  if (q?.options) q.options.splice(optionIndex, 1);
  return next;
}

/** True when the option's scores map is simple enough for the 1:1 selector. */
export function isSimpleScores(option) {
  const keys = Object.keys(option?.scores || {});
  if (keys.length === 0) return true;
  return keys.length === 1 && option.scores[keys[0]] === 1;
}

/** Set the 1:1 option→profile mapping (only for simple scores; the UI guards). */
export function setOptionProfile(quiz, stepIndex, questionIndex, optionIndex, profileId) {
  const next = clone(quiz);
  const opt = next.steps?.[stepIndex]?.questions?.[questionIndex]?.options?.[optionIndex];
  if (opt) opt.scores = profileId ? { [profileId]: 1 } : {};
  return next;
}

export function addProfile(quiz) {
  const next = clone(quiz);
  const id = uid('profile', next);
  next.resultProfiles = next.resultProfiles || [];
  next.resultProfiles.push({ id, title: '', description: '', themeColor: '#D17029', ctaLabel: 'Continue', agentAngle: '' });
  next.scoring = next.scoring || {};
  next.scoring.profileOrder = [...(next.scoring.profileOrder || []), id];
  return next;
}

/** How many places reference this profile id (shown in the removal confirm). */
export function profileReferenceCounts(quiz, profileId) {
  let optionScores = 0;
  for (const { question } of flattenQuestions(quiz)) {
    for (const opt of question.options || []) {
      if (opt?.scores && Object.prototype.hasOwnProperty.call(opt.scores, profileId)) optionScores += 1;
    }
  }
  const rankFactor = Object.prototype.hasOwnProperty.call(quiz?.scoring?.readiness?.rankFactor || {}, profileId) ? 1 : 0;
  const profileOrder = (quiz?.scoring?.profileOrder || []).includes(profileId) ? 1 : 0;
  return { optionScores, rankFactor, profileOrder };
}

/** ATOMIC removal: the profile and every reference to it (F7). */
export function removeProfile(quiz, profileId) {
  const next = clone(quiz);
  next.resultProfiles = (next.resultProfiles || []).filter((p) => p.id !== profileId);
  if (next.scoring) {
    if (Array.isArray(next.scoring.profileOrder)) {
      next.scoring.profileOrder = next.scoring.profileOrder.filter((id) => id !== profileId);
    }
    if (next.scoring.readiness?.rankFactor) delete next.scoring.readiness.rankFactor[profileId];
    if (next.scoring.leadScore?.tagPoints) {
      // tagPoints are TAG-keyed, not profile-keyed — deliberately untouched.
    }
  }
  for (const step of next.steps || []) {
    for (const q of step.questions || []) {
      for (const opt of q.options || []) {
        if (opt?.scores) delete opt.scores[profileId];
      }
    }
  }
  return next;
}

export function updateProfile(quiz, profileId, patch) {
  const next = clone(quiz);
  const p = (next.resultProfiles || []).find((x) => x.id === profileId);
  if (p) Object.assign(p, patch);
  return next;
}

/** ATOMIC id rename across resultProfiles, profileOrder, rankFactor and every
 * option scores map. Not exposed in the Studio UI; kept for integrity work. */
export function renameProfileId(quiz, oldId, newId) {
  if (!newId || oldId === newId) return clone(quiz);
  // Collision guard (Codex diff-review #8): renaming ONTO an existing profile
  // id would silently merge two personas' scores — refuse, no-op.
  if ((quiz?.resultProfiles || []).some((p) => p.id === newId)) return clone(quiz);
  const next = clone(quiz);
  const p = (next.resultProfiles || []).find((x) => x.id === oldId);
  if (!p) return next;
  p.id = newId;
  if (Array.isArray(next.scoring?.profileOrder)) {
    next.scoring.profileOrder = next.scoring.profileOrder.map((id) => (id === oldId ? newId : id));
  }
  const rf = next.scoring?.readiness?.rankFactor;
  if (rf && Object.prototype.hasOwnProperty.call(rf, oldId)) {
    rf[newId] = rf[oldId];
    delete rf[oldId];
  }
  for (const step of next.steps || []) {
    for (const q of step.questions || []) {
      for (const opt of q.options || []) {
        if (opt?.scores && Object.prototype.hasOwnProperty.call(opt.scores, oldId)) {
          opt.scores[newId] = opt.scores[oldId];
          delete opt.scores[oldId];
        }
      }
    }
  }
  return next;
}
