# Rule Model

## Overview

Eligibility rules are the core logic of the evaluation system. Rules are declarative — they describe *what* to check, not *how* to check it. The evaluation engine interprets the rule definitions and produces results.

Each rule evaluates a condition against the applicant's profile and produces a status. Rules are grouped into stages, can depend on other rules, and support exceptions.

See `schemas/rule_set.schema.json` for the full schema.

## Rule Set Structure

A rule set targets a specific university + program + degree level and contains:

- **stages** — ordered evaluation stages (e.g. qualification check, language, GPA)
- **reference_tables** — lookup data used by rules (inline or referenced from `data/reference_tables.json`)
- **rules** — the ordered list of eligibility rules
- **metadata** — authorship, source, version

## Stages

Rules are grouped into stages. Stages define evaluation order and can optionally stop after the first failure within the stage.

| Stage ID | Purpose | Example rules |
|---|---|---|
| `qualification` | Verify the applicant has a recognized qualification | qualification_level, cert_recognition |
| `foundation_routing` | Determine if Studienkolleg/foundation year is needed | foundation_year_routing |
| `language` | Check language proficiency | english_proficiency, german_proficiency |
| `academic_performance` | Check grades/GPA | gpa_minimum |
| `subject_prerequisites` | Check subject-specific requirements | math_prerequisite |
| `supplementary` | Non-blocking: scholarship, documents | scholarship_gpa |

## Rule Categories

| Category | Description |
|---|---|
| `certificate_recognition` | Certificate is from a recognized country/institution |
| `qualification_level` | Applicant holds the required qualification level |
| `language_requirement` | Language proficiency meets thresholds |
| `gpa_requirement` | Grade meets minimum threshold |
| `subject_prerequisite` | Required subjects were studied |
| `foundation_year_requirement` | Studienkolleg/foundation year is needed or completed |
| `age_limit` | Age restrictions |
| `work_experience` | Professional experience requirements |
| `document_requirement` | Required documents are provided |
| `visa_requirement` | Visa/residency conditions |
| `scholarship_eligibility` | Scholarship thresholds (informational) |
| `special_condition` | Other requirements |

## Condition System

The condition system is **recursive**. Every condition node has a `type` that determines its structure. Conditions can be nested to form complex logic trees.

### 1. `comparison` — Leaf Condition

The basic building block. Compares a profile field against a value.

```json
{
  "type": "comparison",
  "field": "personal_info.nationality",
  "operator": "in",
  "value": ["US", "GB", "AU"]
}
```

Operators: `eq`, `neq`, `in`, `not_in`, `gte`, `lte`, `gt`, `lt`, `exists`, `not_exists`, `contains`, `contains_any`, `matches_regex`.

- `in` / `not_in` — checks if a scalar field value is (or is not) in a provided array. E.g. `nationality in ["US", "GB"]`.
- `contains` — checks if an array field contains a single value. E.g. `subjects contains "mathematics"`.
- `contains_any` — checks if an array field contains at least one value from a provided array. E.g. `additional_nationalities contains_any ["US", "GB", "AU"]`. Use this instead of `any_of` when the target is an array of primitive values (strings, numbers) rather than an array of objects.

### 2. `composite` — AND / OR / NOT

Groups multiple conditions with boolean logic.

```json
{
  "type": "composite",
  "operator": "or",
  "conditions": [
    { "type": "comparison", "field": "grading.system", "operator": "eq", "value": "gpa_4" },
    { "type": "comparison", "field": "grading.system", "operator": "eq", "value": "percentage" }
  ]
}
```

For `not`, the `conditions` array must have exactly one element.

### 3. `lookup` — Reference Table Check

Checks a value against a reference table (e.g. recognized certificates by country).

```json
{
  "type": "lookup",
  "table": "recognized_certificates_by_country",
  "lookup_key_field": "certificate_country",
  "result_field": "certificates",
  "expected_values": null
}
```

If `expected_values` is null, passes if the key exists in the table.

### 4. `conditional` — IF / THEN / ELSE

Branching logic. If the predicate passes, evaluate `then`. If it fails, evaluate `else` (or pass if `else` is absent).

```json
{
  "type": "conditional",
  "if": { "type": "comparison", "field": "grading.system", "operator": "eq", "value": "gpa_4" },
  "then": { "type": "comparison", "field": "grading.value", "operator": "gte", "value": 2.5 },
  "else": { "type": "comparison", "field": "grading.value", "operator": "gte", "value": 60 }
}
```

This is critical for GPA normalization: different thresholds for different grading systems.

### 5. `any_of` / `all_of` — Array Quantifiers

Evaluates a condition across array elements. `any_of` passes if at least one element matches. `all_of` passes if every element matches.

```json
{
  "type": "any_of",
  "array_field": "language_proficiency",
  "filter": { "language": "english", "test_type": "IELTS" },
  "condition": { "type": "comparison", "field": "overall_score", "operator": "gte", "value": 6.5 }
}
```

The `filter` narrows which array elements to check. The inner `condition` field paths are relative to each array element.

**Important**: `any_of`/`all_of` is designed for arrays of objects (like `education_history`, `language_proficiency`). For arrays of primitive values (like `additional_nationalities: ["US", "GB"]`), use a `comparison` with `contains` or `contains_any` instead — this avoids the ambiguity of referencing "the element itself" within a quantifier.

## Rule Dependencies

A rule can declare `depends_on`: an array of rule IDs that must have passed. If any dependency failed, the dependent rule is skipped with status `skipped_dependency`.

```json
{
  "rule_id": "gpa_minimum",
  "depends_on": ["qualification_level"],
  "...": "..."
}
```

## Failure Actions

When a rule's condition evaluates to false:

| `on_fail` | Effect |
|---|---|
| `reject` | Applicant is not eligible |
| `conditional_accept` | Eligible if the condition is met later (e.g. Studienkolleg completion) |
| `flag_for_review` | Needs human review |
| `warn` | Informational warning, does not block eligibility |

Rules can include `on_fail_message_template` with placeholders like `{actual}`, `{expected}`, `{system}`.

## Exceptions

Each rule can have exceptions — conditions that, if met, override the rule's failure. Exceptions use the same recursive condition system.

```json
"exceptions": [{
  "exception_id": "exc_native_english_nationality",
  "description": "Nationals of English-speaking countries are exempt",
  "condition": {
    "type": "comparison",
    "field": "personal_info.nationality",
    "operator": "in",
    "value": ["US", "GB", "AU", "CA", "NZ", "IE", "SG"]
  }
}]
```

## Reference Tables

Rules reference lookup tables for country-specific logic (certificate recognition, GPA normalization, etc.). Tables can be:
- **Inline** in the rule set's `reference_tables` field
- **External** via `$ref` to `data/reference_tables.json`

See `data/reference_tables.json` for the current reference table structure.

## Verdict Resolution Policy

After all rules are evaluated, the engine resolves per-rule statuses into a single `overall_verdict`. This section defines the exact precedence and logic.

### Rule Status Summary

Each rule produces one of these statuses:

| Status | Meaning | Caused by |
|---|---|---|
| `passed` | Condition met | Condition evaluates to true |
| `failed` | Condition not met | Condition evaluates to false (action depends on `on_fail`) |
| `exception_applied` | Failed but overridden | Exception condition was met |
| `skipped_dependency` | Not evaluated | A `depends_on` rule failed |
| `skipped_override` | Not evaluated | Advisor override skipped this rule |

When a rule has status `failed`, its `on_fail` action determines the impact on the overall verdict.

### Verdict Precedence (Highest to Lowest)

The engine collects all `on_fail` actions from failed rules and resolves the verdict using this strict precedence:

1. **`insufficient_data`** — If any required data is missing such that a rule _cannot be evaluated_ (not just failed, but the engine cannot determine pass/fail), the verdict is `insufficient_data`. This is distinct from a rule failing — it means the engine could not run the check at all. Triggers when: grading data is absent for a GPA rule, no education_history entries match a required filter, or similar structural gaps.

2. **`not_eligible`** — If any rule with `on_fail: "reject"` has failed (and no exception applied), the verdict is `not_eligible`. A single reject overrides all other failure types.

3. **`needs_review`** — If no reject failures exist, but any rule with `on_fail: "flag_for_review"` has failed, the verdict is `needs_review`. This takes precedence over `conditional` because a human must make the call — automated conditional logic alone is not sufficient.

4. **`conditional`** — If the only failures are `on_fail: "conditional_accept"` (and optionally `on_fail: "warn"`), the verdict is `conditional`. The applicant can become eligible by meeting specific conditions.

5. **`eligible`** — All rules passed (or were skipped/exception_applied), and at most `on_fail: "warn"` failures exist. Warn failures do not block eligibility.

### Interaction Rules

- **`warn` failures never affect the verdict.** They produce advisory_notes but do not change the overall result.
- **`skipped_override` rules do not count as failures.** However, they reduce confidence and the verdict is at most `conditional` if any rule was skipped by override (since the check was not actually performed).
- **`skipped_dependency` rules do not independently affect the verdict.** The upstream failure that caused the skip already contributes its own `on_fail` action.
- **`exception_applied` rules count as passed.** The exception overrides the failure.

### Output Fields Per Verdict

Each verdict type has specific expectations for which output fields should be populated:

| Verdict | `conditions_to_meet` | `missing_information` | Typical confidence |
|---|---|---|---|
| `eligible` | Empty | Empty or `informational` only | `definitive` or `high` |
| `not_eligible` | Empty | Empty or `informational` only | `definitive` or `high` |
| `conditional` | Required (one per `conditional_accept` failure) | `may_change_outcome` allowed | `moderate` or higher |
| `needs_review` | From `conditional_accept` failures if any | `may_change_outcome` allowed | `moderate` or `low` |
| `insufficient_data` | Empty | Required (at least one `blocks_evaluation`) | `low` or `cannot_determine` |

Key constraints:
- **`conditions_to_meet`** is only populated when there are `conditional_accept` failures. It appears for `conditional` verdicts (always) and `needs_review` verdicts (when both `conditional_accept` and `flag_for_review` failures coexist).
- **`missing_information` with `blocks_evaluation` impact** only appears for `insufficient_data` verdicts. For other verdicts, missing info is at most `may_change_outcome` or `informational`.
- **`not_eligible` verdicts do not have `conditions_to_meet`**. Once a reject rule fails, there is no path to eligibility within this rule set. The `next_steps` and `advisory_notes` fields can suggest alternatives (retake a test, apply to different program).

### Combined Failure Example

If an applicant triggers both `conditional_accept` (foundation year routing) and `flag_for_review` (GPA below threshold):
- Verdict: `needs_review` (flag_for_review outranks conditional_accept)
- `conditions_to_meet`: populated with the foundation year condition
- `advisory_notes`: may note the GPA concern
- Rationale: a human reviewer needs to assess the GPA, and if they approve, the applicant still needs to meet the foundation year condition

## Versioning

Each rule set has a `version` (semantic) and `effective_from` date. When requirements change, a new version is created. Prior evaluations remain linked to the version active at evaluation time.
