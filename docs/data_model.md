# Data Model

## Overview

The system separates data into five distinct domains. Each has its own schema and storage. They are connected through ID references at storage time, but resolved into self-contained documents at evaluation time.

## Domains

### 1. Applicant Profile

**Schema**: `schemas/applicant_profile.schema.json`

Represents a single student being evaluated. Created by the advisor per evaluation request.

**`education_history`** (array) — the core of the profile. Each entry represents a qualification:

| Field | Purpose |
|---|---|
| `entry_id` | Internal reference used by rule conditions (e.g. `edu_secondary`) |
| `qualification_level` | secondary, studienkolleg, foundation_year, bachelor, master, etc. |
| `certificate_type` | Name as recognized in the issuing country (Tawjihi, Abitur, IB, etc.) |
| `certificate_country` | ISO 3166-1 alpha-2 |
| `graduation_status` | completed, in_progress, withdrawn, expected |
| `grading.system` | Grading system identifier matching reference_tables (gpa_4, percentage, german_1_to_6, etc.) |
| `grading.value` | The grade — numeric or string depending on system |
| `recognition.anabin_rating` | H_plus, H_plus_minus, H_minus, not_rated, not_applicable |
| `studienkolleg_track` | T/W/M/G/S — only for Studienkolleg entries |
| `subjects` | Array of subjects studied — used for prerequisite checks |
| `documents` | Per-document submission status (provided, pending, not_required) |

**`language_proficiency`** (array) — each entry is a test result:
- `overall_score` + `sub_scores` (reading, writing, speaking, listening)
- `test_date` + `expiry_date` — engine checks validity against `reference_tables.json/language_test_validity`
- `certificate_status` — provided, pending, or self_reported (affects confidence)

**`personal_info`** — nationality (primary + additional), visa_status, date of birth, country of residence.

**`documents_summary`** — advisor-maintained overview of overall document completeness.

**`work_experience`** — total_years, field, description.

### 2. Catalog Data

**Files**: `data/universities.json`, `data/programs.json`, `data/program_offerings.json`

Reference data maintained by the advisory team. Describes what universities and programs exist.

**Universities** include:
- Basic info (country, type, website)
- Admission office contacts (email, phone, portal URL)
- Recognition agreements (per-country)
- Anabin institution status
- Supported languages

**Programs** define the academic structure (university-independent):
- Degree level, language of instruction, duration
- Prerequisite subjects (array)
- ECTS credits, accreditation

**Program Offerings** link university + program for a specific intake. This is where intake-specific data lives:
- Tuition (amount, currency, per semester/year/total, scholarship availability) — lives here because tuition can vary by university, intake cycle, and scholarship period
- Multiple deadline types: early_admission, regular, late_admission, scholarship, document_submission
- Admission type: open, selective, highly_selective
- Status: open, closed, waitlist

Relationships:
- A **university** has many **programs**
- A **program** has many **program offerings** (per intake semester)
- Program offerings reference both university and program by ID

### 3. Reference Tables

**File**: `data/reference_tables.json`

Lookup data used by the rule engine for country-specific and cross-system logic. This is the single source of truth for domain reference data.

| Table | Purpose |
|---|---|
| `english_native_countries` | Countries whose nationals are exempt from English testing |
| `recognized_certificates_by_country` | Maps countries to certificate names, Anabin defaults, foundation year requirements |
| `gpa_normalization` | Per grading system: min, max, passing threshold, direction (higher_is_better / lower_is_better) |
| `studienkolleg_tracks` | T/W/M/G/S tracks with their target study fields |
| `language_test_validity` | How long each test type remains valid (months) |

Rules reference these tables via `lookup` conditions or the engine uses them directly for expiry checks and GPA normalization.

### 4. Rule Sets

**Schema**: `schemas/rule_set.schema.json`
**Files**: `rules/*.json`

Declarative eligibility rules per university + program + degree level. Each rule set contains:
- **Stages** — ordered evaluation groups with optional stop-on-first-failure
- **Rules** — each with: category, stage, dependencies, recursive condition tree, failure action, exceptions
- **Reference tables** — inline or `$ref` to shared tables
- **Metadata** — author, source, version

See `docs/rule_model.md` for detailed condition system documentation.

### 5. Evaluation Results

**Schema**: `schemas/evaluation_result.schema.json`

The output of the evaluation engine. Contains:
- Overall verdict + confidence level
- Per-rule results with condition traces and data sources used
- Missing information with impact classification
- Conditions to meet (for conditional and needs_review verdicts with conditional_accept failures)
- Advisory notes (tips, alternatives, edge cases)
- Next steps (actions for advisor/applicant/system)
- Matched programs (for multi-program screening)
- Evaluation metadata (engine version, duration, override tracking)

## ID Reference Conventions

All cross-references use string IDs:
- `university_id` — e.g. `"constructor_university"`
- `program_id` — e.g. `"cs_bachelor"`
- `offering_id` — e.g. `"constructor_cs_bachelor_w2026"`
- `rule_set_id` — e.g. `"constructor_cs_bachelor_v1"`
- `applicant_id` — e.g. `"app_2026_001"`
- `entry_id` — e.g. `"edu_secondary"` (within education_history)

IDs are used for storage and cross-file references. At evaluation time, the system resolves IDs to full objects in the evaluation context so the engine operates on self-contained data.

## Document Status Tracking

Documents are tracked at two levels:

1. **Per education entry** — `education_history[].documents` tracks transcript, certificate, translation, and apostille status for each qualification.
2. **Profile-level summary** — `documents_summary` provides an overall assessment (complete, partially_complete, incomplete) with a list of missing documents.

The engine can check document status in rules (category `document_requirement`) and reports missing documents in the result's `missing_information` array.
