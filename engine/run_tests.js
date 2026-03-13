// Test runner for the admission eligibility evaluation engine.
// Loads the Constructor CS bachelor test cases and validates engine output against expected results.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { evaluate } from './evaluate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(projectRoot, relativePath), 'utf-8'));
}

// Load test data
const testSuite = loadJSON('tests/constructor_test_cases.json');
const ruleSet = loadJSON('rules/constructor_bachelor_rules.json');
const referenceTables = loadJSON('data/reference_tables.json');

let passed = 0;
let failed = 0;
const failures = [];

for (const testCase of testSuite.test_cases) {
  const { test_id, description, input, expected } = testCase;

  // Inject the full rule set into the target (test cases only have minimal rule_set refs)
  const context = {
    ...input,
    evaluation_scope: {
      ...input.evaluation_scope,
      targets: input.evaluation_scope.targets.map(t => ({
        ...t,
        rule_set: { ...ruleSet, ...t.rule_set }
      }))
    }
  };

  let result;
  try {
    result = evaluate(context, referenceTables);
  } catch (err) {
    failures.push({ test_id, error: err.message, stack: err.stack });
    failed++;
    console.log(`  FAIL  ${test_id} — ${description}`);
    console.log(`        Error: ${err.message}`);
    continue;
  }

  // Compare results
  const mismatches = [];

  // 1. Overall verdict
  if (result.overall_verdict !== expected.overall_verdict) {
    mismatches.push(`verdict: expected '${expected.overall_verdict}', got '${result.overall_verdict}'`);
  }

  // 2. Rule results (check each expected rule_result by rule_id and status)
  if (expected.rule_results) {
    for (const expectedRule of expected.rule_results) {
      const actualRule = result.rule_results.find(r => r.rule_id === expectedRule.rule_id);
      if (!actualRule) {
        mismatches.push(`rule '${expectedRule.rule_id}': not found in results`);
      } else if (actualRule.status !== expectedRule.status) {
        mismatches.push(`rule '${expectedRule.rule_id}': expected status '${expectedRule.status}', got '${actualRule.status}'`);
      }
      // Check exception_applied if specified
      if (expectedRule.exception_applied !== undefined && actualRule) {
        if (actualRule.exception_applied !== expectedRule.exception_applied) {
          mismatches.push(`rule '${expectedRule.rule_id}': expected exception '${expectedRule.exception_applied}', got '${actualRule.exception_applied}'`);
        }
      }
    }
  }

  // 3. Confidence level
  if (expected.confidence?.level) {
    if (result.confidence?.level !== expected.confidence.level) {
      mismatches.push(`confidence: expected '${expected.confidence.level}', got '${result.confidence?.level}'`);
    }
  }

  // 4. Conditions to meet
  if (expected.conditions_to_meet) {
    if (!result.conditions_to_meet || result.conditions_to_meet.length !== expected.conditions_to_meet.length) {
      mismatches.push(`conditions_to_meet: expected ${expected.conditions_to_meet.length} items, got ${result.conditions_to_meet?.length || 0}`);
    } else {
      for (let i = 0; i < expected.conditions_to_meet.length; i++) {
        const exp = expected.conditions_to_meet[i];
        const act = result.conditions_to_meet[i];
        if (exp.category && act.category !== exp.category) {
          mismatches.push(`conditions_to_meet[${i}]: expected category '${exp.category}', got '${act.category}'`);
        }
      }
    }
  }

  // 5. Missing information
  if (expected.missing_information) {
    if (!result.missing_information || result.missing_information.length < expected.missing_information.length) {
      mismatches.push(`missing_information: expected at least ${expected.missing_information.length} items, got ${result.missing_information?.length || 0}`);
    } else {
      for (const exp of expected.missing_information) {
        const match = result.missing_information.find(m => m.field === exp.field);
        if (!match) {
          mismatches.push(`missing_information: expected field '${exp.field}' not found`);
        } else if (exp.impact && match.impact !== exp.impact) {
          mismatches.push(`missing_information '${exp.field}': expected impact '${exp.impact}', got '${match.impact}'`);
        }
      }
    }
  }

  // 6. Advisory notes
  if (expected.advisory_notes) {
    if (!result.advisory_notes || result.advisory_notes.length < expected.advisory_notes.length) {
      mismatches.push(`advisory_notes: expected at least ${expected.advisory_notes.length} items, got ${result.advisory_notes?.length || 0}`);
    } else {
      for (const exp of expected.advisory_notes) {
        const match = result.advisory_notes.find(n => n.type === exp.type);
        if (!match) {
          mismatches.push(`advisory_notes: expected type '${exp.type}' not found`);
        }
      }
    }
  }

  if (mismatches.length === 0) {
    passed++;
    console.log(`  PASS  ${test_id}`);
  } else {
    failed++;
    failures.push({ test_id, mismatches });
    console.log(`  FAIL  ${test_id} — ${description}`);
    for (const m of mismatches) {
      console.log(`        ${m}`);
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${testSuite.test_cases.length} tests`);

if (failures.length > 0) {
  console.log(`\nFailed tests:`);
  for (const f of failures) {
    console.log(`  - ${f.test_id}`);
    if (f.error) console.log(`    Error: ${f.error}`);
    if (f.mismatches) {
      for (const m of f.mismatches) console.log(`    ${m}`);
    }
  }
}

process.exit(failed > 0 ? 1 : 0);
