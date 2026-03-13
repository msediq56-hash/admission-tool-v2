// Verdict resolution per the policy in docs/rule_model.md.
// Resolves per-rule statuses into a single overall_verdict.

/**
 * Resolve the overall verdict from rule results.
 *
 * @param {Array} ruleResults - Array of { rule_id, stage, category, status, onFail, ... }
 * @param {object} opts - { hasInsufficientData, insufficientDataFields, applicant, hasOverrides }
 * @returns {{ verdict, confidence, conditionsToMeet, missingInformation, advisoryNotes }}
 */
export function resolveVerdict(ruleResults, opts = {}) {
  const { hasInsufficientData = false, insufficientDataFields = [], applicant = {}, hasOverrides = false } = opts;

  const failedRules = ruleResults.filter(r => r.status === 'failed');
  const skippedOverrides = ruleResults.filter(r => r.status === 'skipped_override');

  // Collect on_fail actions from failed rules (exclude warn)
  const rejectFailures = failedRules.filter(r => r.onFail === 'reject');
  const flagForReviewFailures = failedRules.filter(r => r.onFail === 'flag_for_review');
  const conditionalAcceptFailures = failedRules.filter(r => r.onFail === 'conditional_accept');
  const warnFailures = failedRules.filter(r => r.onFail === 'warn');

  // --- Verdict precedence ---
  let verdict;
  if (hasInsufficientData) {
    verdict = 'insufficient_data';
  } else if (rejectFailures.length > 0) {
    verdict = 'not_eligible';
  } else if (flagForReviewFailures.length > 0) {
    verdict = 'needs_review';
  } else if (conditionalAcceptFailures.length > 0) {
    verdict = 'conditional';
  } else {
    verdict = 'eligible';
  }

  // skipped_override caps verdict at conditional (if otherwise would be eligible)
  if (verdict === 'eligible' && skippedOverrides.length > 0) {
    verdict = 'conditional';
  }

  // --- Conditions to meet ---
  // Only populated for conditional_accept failures, appearing in conditional and needs_review verdicts
  const conditionsToMeet = [];
  if ((verdict === 'conditional' || verdict === 'needs_review') && conditionalAcceptFailures.length > 0) {
    for (const rule of conditionalAcceptFailures) {
      conditionsToMeet.push({
        condition_id: `cond_${rule.rule_id}`,
        description: rule.message || `Meet requirement for ${rule.rule_id}`,
        category: rule.category,
        related_rule_id: rule.rule_id,
        priority: 'required'
      });
    }
  }

  // --- Missing information ---
  const missingInformation = [];
  if (verdict === 'insufficient_data') {
    for (const field of insufficientDataFields) {
      missingInformation.push({
        field: field.field,
        description: field.description,
        impact: field.impact || 'blocks_evaluation',
        required_for_rules: field.requiredForRules || []
      });
    }
  }

  // --- Advisory notes ---
  const advisoryNotes = [];
  // Warn failures become advisory notes
  for (const rule of warnFailures) {
    if (rule.category === 'scholarship_eligibility') {
      // Only add scholarship note if the rule passed (scholarship threshold met)
      // Warn failures for scholarship mean they did NOT meet the threshold — don't add a positive note
    } else {
      advisoryNotes.push({
        type: 'tip',
        title: rule.rule_id,
        message: rule.message || `Warning from rule ${rule.rule_id}`
      });
    }
  }

  // --- Confidence ---
  const confidenceFactors = [];
  if (hasOverrides || skippedOverrides.length > 0) {
    confidenceFactors.push('advisor_override_applied');
  }

  // Check for self-reported language scores
  const langProf = applicant.language_proficiency || [];
  for (const lp of langProf) {
    if (lp.certificate_status === 'self_reported') {
      confidenceFactors.push('self_reported_language_score');
      break;
    }
  }

  // Check for expected (not completed) graduation
  const eduHistory = applicant.education_history || [];
  for (const edu of eduHistory) {
    if (edu.graduation_status === 'expected') {
      confidenceFactors.push('graduation_expected_not_completed');
      break;
    }
  }

  // Check for missing grading data
  for (const edu of eduHistory) {
    if (edu.qualification_level === 'secondary' && !edu.grading) {
      confidenceFactors.push('no_grading_data');
      break;
    }
  }

  // Check for pending documents
  for (const edu of eduHistory) {
    if (edu.documents) {
      const statuses = Object.values(edu.documents);
      if (statuses.some(s => s === 'pending')) {
        confidenceFactors.push('pending_documents');
        break;
      }
    }
  }

  let confidenceLevel;
  if (verdict === 'insufficient_data') {
    confidenceLevel = 'low';
  } else if (confidenceFactors.length === 0 && (rejectFailures.length + flagForReviewFailures.length + conditionalAcceptFailures.length) === 0) {
    confidenceLevel = 'definitive';
  } else if (confidenceFactors.length === 0) {
    confidenceLevel = 'high';
  } else if (confidenceFactors.length >= 2) {
    confidenceLevel = 'low';
  } else {
    // 1 confidence factor
    confidenceLevel = 'moderate';
  }

  return {
    verdict,
    confidence: { level: confidenceLevel, factors: confidenceFactors },
    conditionsToMeet,
    missingInformation,
    advisoryNotes
  };
}
