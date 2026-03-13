// Main evaluation engine. Takes an evaluation context and produces an evaluation result.
// Single-program mode only for this first implementation.

import { evaluateCondition, resolveField } from './conditions.js';
import { resolveVerdict } from './verdict.js';

/**
 * Filter out expired language tests based on evaluation date.
 * Returns a new applicant object with only valid language tests.
 */
function filterExpiredTests(applicant, evaluationDate) {
  if (!applicant.language_proficiency || applicant.language_proficiency.length === 0) {
    return applicant;
  }

  const evalDate = new Date(evaluationDate);
  const validTests = applicant.language_proficiency.filter(test => {
    if (test.expiry_date) {
      return new Date(test.expiry_date) >= evalDate;
    }
    // No explicit expiry — treat as valid
    return true;
  });

  return { ...applicant, language_proficiency: validTests };
}

/**
 * Detect if a rule's condition references structurally absent data.
 * This triggers insufficient_data rather than a normal rule failure.
 *
 * Checks: if a quantifier filters education_history for secondary entries,
 * and the matched entry has no grading data when the inner condition needs it.
 */
function detectInsufficientData(rule, applicant) {
  const missing = [];

  // Walk the condition tree looking for any_of on education_history with inner conditions
  // that reference grading fields
  function checkCondition(cond) {
    if (!cond) return;

    if ((cond.type === 'any_of' || cond.type === 'all_of') && cond.array_field === 'education_history') {
      const arr = applicant.education_history || [];
      const filtered = cond.filter ? arr.filter(el => {
        for (const [k, v] of Object.entries(cond.filter)) {
          if (resolveField(el, k).value !== v) return false;
        }
        return true;
      }) : arr;

      // Check if matched elements are missing data the inner condition needs
      for (const element of filtered) {
        const neededFields = collectReferencedFields(cond.condition);
        for (const field of neededFields) {
          if (field.startsWith('grading.') && !element.grading) {
            missing.push({
              field: `education_history.${arr.indexOf(element)}.grading`,
              description: 'No grade information available for secondary education',
              requiredForRules: [rule.rule_id]
            });
          }
        }
      }
    }

    // Recurse into composite/conditional
    if (cond.type === 'composite' && cond.conditions) {
      for (const sub of cond.conditions) checkCondition(sub);
    }
    if (cond.type === 'conditional') {
      checkCondition(cond.if);
      checkCondition(cond.then);
      if (cond.else) checkCondition(cond.else);
    }
    if ((cond.type === 'any_of' || cond.type === 'all_of') && cond.condition) {
      // Already handled above for education_history
    }
  }

  checkCondition(rule.condition);
  return missing;
}

/**
 * Collect field paths referenced by comparison conditions in a condition tree.
 */
function collectReferencedFields(cond) {
  const fields = new Set();
  function walk(c) {
    if (!c) return;
    if (c.type === 'comparison' && c.field) {
      fields.add(c.field);
    }
    if (c.type === 'composite' && c.conditions) {
      c.conditions.forEach(walk);
    }
    if (c.type === 'conditional') {
      walk(c.if);
      walk(c.then);
      if (c.else) walk(c.else);
    }
    if ((c.type === 'any_of' || c.type === 'all_of') && c.condition) {
      walk(c.condition);
    }
  }
  walk(cond);
  return fields;
}

/**
 * Evaluate an applicant against a rule set.
 *
 * @param {object} context - Matches evaluation_context schema
 * @param {object} externalReferenceTables - From data/reference_tables.json
 * @returns {object} Evaluation result matching evaluation_result schema
 */
export function evaluate(context, externalReferenceTables = {}) {
  const startTime = Date.now();

  const { applicant, evaluation_scope, evaluation_date, advisor_overrides } = context;
  const target = evaluation_scope.targets[0]; // single_program mode
  const ruleSet = target.rule_set;

  // Merge reference tables: rule set inline + external
  const referenceTables = { ...externalReferenceTables, ...(ruleSet.reference_tables || {}) };

  // Pre-process: filter expired language tests
  const processedApplicant = filterExpiredTests(applicant, evaluation_date);

  // Sort stages by evaluation_order
  const stages = [...(ruleSet.stages || [])].sort((a, b) => a.evaluation_order - b.evaluation_order);

  // Group rules by stage and sort by priority
  const rulesByStage = new Map();
  for (const stage of stages) {
    rulesByStage.set(stage.stage_id, []);
  }
  for (const rule of ruleSet.rules || []) {
    const stageRules = rulesByStage.get(rule.stage);
    if (stageRules) {
      stageRules.push(rule);
    }
  }
  for (const [, rules] of rulesByStage) {
    rules.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  // Build ordered rule list
  const orderedRules = [];
  for (const stage of stages) {
    const rules = rulesByStage.get(stage.stage_id) || [];
    orderedRules.push(...rules);
  }

  // Track rule statuses for dependency checking
  const ruleStatusMap = new Map(); // rule_id → status
  const ruleResults = [];
  let insufficientDataFields = [];
  let rulesEvaluated = 0;
  let rulesSkipped = 0;

  // Skip categories/rules from advisor overrides
  const skipCategories = new Set(advisor_overrides?.skip_categories || []);
  const skipRules = new Set(advisor_overrides?.skip_rules || []);

  for (const rule of orderedRules) {
    const dataSources = new Set();
    const evalCtx = {
      profile: processedApplicant,
      referenceTables,
      evaluationDate: evaluation_date,
      dataSources
    };

    // 1. Check advisor overrides
    if (skipCategories.has(rule.category) || skipRules.has(rule.rule_id)) {
      const result = {
        rule_id: rule.rule_id,
        stage: rule.stage,
        category: rule.category,
        status: 'skipped_override',
        message: `Skipped by advisor override (${skipCategories.has(rule.category) ? 'category: ' + rule.category : 'rule: ' + rule.rule_id})`,
        onFail: rule.on_fail || 'reject',
        data_sources_used: []
      };
      ruleResults.push(result);
      ruleStatusMap.set(rule.rule_id, 'skipped_override');
      rulesSkipped++;
      continue;
    }

    // 2. Check dependencies
    const dependencies = rule.depends_on || [];
    const failedDep = dependencies.find(depId => {
      const depStatus = ruleStatusMap.get(depId);
      return depStatus === 'failed';
    });

    if (failedDep) {
      const result = {
        rule_id: rule.rule_id,
        stage: rule.stage,
        category: rule.category,
        status: 'skipped_dependency',
        message: `Skipped because dependency '${failedDep}' failed`,
        onFail: rule.on_fail || 'reject',
        data_sources_used: []
      };
      ruleResults.push(result);
      ruleStatusMap.set(rule.rule_id, 'skipped_dependency');
      rulesSkipped++;
      continue;
    }

    // 3. Check for insufficient data
    const missingData = detectInsufficientData(rule, processedApplicant);
    if (missingData.length > 0) {
      insufficientDataFields.push(...missingData);
      // Still evaluate rules that come after, but mark this as a data gap
      // The overall verdict will be insufficient_data
    }

    // 4. Evaluate the condition
    rulesEvaluated++;
    const condResult = evaluateCondition(rule.condition, processedApplicant, evalCtx);

    // 5. Check exceptions if condition failed
    let status = condResult.passed ? 'passed' : 'failed';
    let exceptionApplied = null;

    if (!condResult.passed && rule.exceptions && rule.exceptions.length > 0) {
      for (const exception of rule.exceptions) {
        const excResult = evaluateCondition(exception.condition, processedApplicant, evalCtx);
        if (excResult.passed) {
          status = 'exception_applied';
          exceptionApplied = exception.exception_id;
          break;
        }
      }
    }

    // Build message from template
    let message = '';
    if (status === 'failed' && rule.on_fail_message_template) {
      message = rule.on_fail_message_template;
    } else if (status === 'passed') {
      message = `Rule ${rule.rule_id} passed`;
    } else if (status === 'exception_applied') {
      message = `Rule ${rule.rule_id} failed but exception '${exceptionApplied}' was applied`;
    }

    const result = {
      rule_id: rule.rule_id,
      stage: rule.stage,
      category: rule.category,
      status,
      message,
      onFail: rule.on_fail || 'reject',
      exception_applied: exceptionApplied,
      condition_trace: condResult.trace,
      data_sources_used: [...dataSources]
    };

    ruleResults.push(result);
    ruleStatusMap.set(rule.rule_id, status);
  }

  // 6. Resolve verdict
  const hasInsufficientData = insufficientDataFields.length > 0;
  const hasOverrides = skipCategories.size > 0 || skipRules.size > 0;

  // Also check: if graduation is expected and no grading, that's insufficient data
  // for the tc_missing_documents_insufficient_data case
  for (const edu of processedApplicant.education_history || []) {
    if (edu.qualification_level === 'secondary' && edu.graduation_status === 'expected' && !edu.grading) {
      const eduIndex = (processedApplicant.education_history || []).indexOf(edu);
      // Add grading field if not already detected by detectInsufficientData
      const gradingField = `education_history.${eduIndex}.grading`;
      if (!insufficientDataFields.some(f => f.field === gradingField)) {
        insufficientDataFields.push({
          field: gradingField,
          description: 'No grade information available for secondary education',
          requiredForRules: ['gpa_minimum']
        });
      }
      // Always add graduation_status as may_change_outcome
      const gradStatusField = `education_history.${eduIndex}.graduation_status`;
      if (!insufficientDataFields.some(f => f.field === gradStatusField)) {
        insufficientDataFields.push({
          field: gradStatusField,
          description: `Student has not yet graduated (expected ${edu.graduation_year || 'unknown'})`,
          impact: 'may_change_outcome',
          requiredForRules: ['qualification_level']
        });
      }
    }
  }

  const verdictResult = resolveVerdict(ruleResults, {
    hasInsufficientData: insufficientDataFields.length > 0,
    insufficientDataFields,
    applicant: processedApplicant,
    hasOverrides
  });

  // Build advisory notes for expired tests (for not_eligible due to expiry)
  if (verdictResult.verdict === 'not_eligible') {
    // Check if the original (pre-filtered) applicant had tests that were filtered out
    const originalTests = applicant.language_proficiency || [];
    const filteredTests = processedApplicant.language_proficiency || [];
    if (originalTests.length > filteredTests.length) {
      for (const test of originalTests) {
        if (test.expiry_date && new Date(test.expiry_date) < new Date(evaluation_date)) {
          verdictResult.advisoryNotes.push({
            type: 'tip',
            title: 'Expired language test',
            message: `Previous ${test.test_type} (${test.overall_score}) expired ${test.expiry_date}. Retake ${test.test_type} or provide another valid English proficiency test to re-evaluate eligibility.`
          });
        }
      }
    }
  }

  // Build advisory notes for conditional_accept failures (foundation year routing)
  for (const result of ruleResults) {
    if (result.status === 'failed' && result.onFail === 'conditional_accept' && result.category === 'foundation_year_requirement') {
      // Check if the university is private (Constructor is private)
      const uniType = target.university?.type;
      verdictResult.advisoryNotes.push({
        type: 'tip',
        title: 'Private university exception',
        message: 'Constructor University is a private institution and may waive the Studienkolleg requirement. Contact admissions to confirm.'
      });
    }
  }

  // Build scholarship advisory notes for passed scholarship rules
  for (const result of ruleResults) {
    if (result.category === 'scholarship_eligibility' && result.status === 'passed') {
      // Find the scholarship-related data
      verdictResult.advisoryNotes.push({
        type: 'scholarship_note',
        title: 'Scholarship eligibility',
        message: `Applicant meets the scholarship consideration threshold. Ensure scholarship deadline is met.`
      });
    }
  }

  // Build "missing_information" for not_eligible with no language proof (may_change_outcome)
  const englishRule = ruleResults.find(r => r.rule_id === 'english_proficiency');
  if (englishRule && englishRule.status === 'failed' && verdictResult.verdict === 'not_eligible') {
    const originalLang = applicant.language_proficiency || [];
    const processedLang = processedApplicant.language_proficiency || [];
    if (originalLang.length === 0 || processedLang.length === 0) {
      // Check if it's truly empty (no tests at all) vs expired
      if (originalLang.length === 0) {
        verdictResult.missingInformation.push({
          field: 'language_proficiency',
          description: 'No English proficiency test provided. Submitting IELTS, TOEFL, Duolingo, or Cambridge result could change the outcome.',
          impact: 'may_change_outcome',
          required_for_rules: ['english_proficiency']
        });
      }
    }
  }

  const duration = Date.now() - startTime;

  // Build final result
  const evaluationResult = {
    evaluation_id: `eval_${Date.now()}`,
    applicant_id: applicant.applicant_id,
    university_id: target.university?.university_id || null,
    program_id: target.program?.program_id || null,
    overall_verdict: verdictResult.verdict,
    confidence: verdictResult.confidence,
    rule_results: ruleResults.map(r => ({
      rule_id: r.rule_id,
      stage: r.stage,
      category: r.category,
      status: r.status,
      message: r.message,
      exception_applied: r.exception_applied || null,
      condition_trace: r.condition_trace || null,
      data_sources_used: r.data_sources_used || []
    })),
    missing_information: verdictResult.missingInformation,
    conditions_to_meet: verdictResult.conditionsToMeet,
    advisory_notes: verdictResult.advisoryNotes,
    evaluated_at: new Date().toISOString(),
    rule_set_version: ruleSet.version,
    evaluation_metadata: {
      engine_version: '0.1.0',
      evaluation_duration_ms: duration,
      rules_evaluated: rulesEvaluated,
      rules_skipped: rulesSkipped,
      overrides_applied: [...skipCategories, ...skipRules]
    }
  };

  return evaluationResult;
}
