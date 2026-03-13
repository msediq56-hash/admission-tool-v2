# System Overview — Admission Eligibility Evaluation Tool v2

## Purpose

This is an internal advisor tool used by education consultants to evaluate whether a student is eligible for specific university programs. It is **not** student-facing and **not** a CRM.

The system handles the complexity of international admissions: varying certificate types, country-specific recognition frameworks (Anabin), multiple grading systems, language test pathways, and university-specific exceptions.

## Core Workflow

1. **Advisor inputs an applicant profile** — education history (multiple entries), certificates, language scores, document status, personal info.
2. **Advisor selects target(s)** — single program evaluation or multi-program screening across multiple university/program combinations.
3. **System assembles an evaluation context** — resolves catalog data (university, program, offering) and selects the appropriate rule set version. The context is self-contained: the engine needs only this document.
4. **Evaluation engine runs the rule set** — stages are evaluated in order, rules within each stage check conditions against the profile using a recursive condition system. Advisor overrides are applied.
5. **System returns an evaluation result** — overall verdict with per-rule traces, missing information, conditions to meet, advisory notes, and next steps.

## Evaluation Modes

- **Single program**: evaluate one applicant against one specific university/program/intake. Returns a detailed result.
- **Multi-program screening**: evaluate one applicant against multiple programs. Returns per-program verdicts with a summary of which programs match.

## Architectural Layers

### Applicant Profile (`schemas/applicant_profile.schema.json`)
The student's full data as assembled by the advisor. Key structures:
- `education_history` — array of education entries (secondary, Studienkolleg, foundation year, bachelor, etc.)
- Each entry tracks: qualification level, certificate type/country, grading (with system identifier), recognition status (Anabin), document status
- `language_proficiency` — array with overall scores, sub-scores, expiry dates, verification status
- `personal_info` — nationality (+ additional), visa status
- `documents_summary` — overall completeness assessment

### Catalog Data (`data/`)
Reference data maintained by the advisory team:
- `universities.json` — institution info, admission office contacts, recognition agreements
- `programs.json` — academic program definitions: degree level, prerequisites, accreditation, language of instruction
- `program_offerings.json` — per-intake offerings: tuition, deadlines, admission type, status
- `reference_tables.json` — lookup tables for certificate recognition, GPA normalization, Studienkolleg tracks, language test validity

### Rule Sets (`rules/`)
Declarative eligibility rules per university + program + degree level. Features:
- **Staged evaluation** — rules are grouped into ordered stages (qualification, foundation routing, language, GPA, prerequisites, supplementary)
- **Recursive condition system** — five condition types: comparison, composite (AND/OR/NOT), lookup, conditional (IF/THEN/ELSE), quantifier (any_of/all_of)
- **Rule dependencies** — a rule can declare that it only runs if prior rules passed
- **Exceptions** — known overrides with their own conditions (e.g. native speaker exception for language)
- **Reference table integration** — rules can check values against lookup tables (certificate recognition, country lists)

### Evaluation Context (`schemas/evaluation_context.schema.json`)
The assembled engine input — self-contained document combining:
- Resolved applicant profile
- Resolved catalog data (university, program, offering, rule set)
- Evaluation scope (single or multi-program)
- Evaluation date (for expiry checks, age calculations)
- Advisor overrides (skip categories/rules, assumed documents, justifications)

### Evaluation Result (`schemas/evaluation_result.schema.json`)
The engine output for the advisor:
- **Overall verdict** — eligible, not_eligible, conditional, needs_review, insufficient_data
- **Confidence** — definitive/high/moderate/low/cannot_determine with contributing factors
- **Per-rule results** — status, message, actual vs expected values, condition trace, data sources used
- **Missing information** — what data is needed, with impact classification (blocks evaluation / may change outcome)
- **Conditions to meet** — actionable items for conditional verdicts
- **Advisory notes** — tips, alternative pathways, edge cases, scholarship notes
- **Next steps** — recommended actions for advisor, applicant, or system
- **Matched programs** — per-program verdicts for multi-program screening

## Key Design Principles

- **Separation of data and logic**: catalog data, applicant data, rules, and reference tables are independent
- **Self-contained evaluation**: the evaluation context includes everything the engine needs — no runtime lookups
- **Transparency**: every verdict is explainable through per-rule condition traces
- **Versioned rules**: rule sets are versioned and dated; evaluations are reproducible
- **Structured exceptions**: special cases are encoded as exception conditions, not ad-hoc overrides
- **Advisor control**: overrides allow advisors to skip checks with documented justification
- **Cross-system grading**: grading system metadata enables normalization across GPA, percentage, German, IB, and other scales

## Current Status

Phase 0 refined — architecture foundation strengthened with recursive condition model, staged evaluation, reference tables, and richer result schema. Catalog data and sample rule set are marked as DEMO_PLACEHOLDER. Engine implementation pending.
