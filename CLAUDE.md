# Project Instructions — Admission Eligibility Assessment System V2

## What is this project?

An internal Arabic-language tool used by education consultants (advisors) to evaluate whether a student is eligible for a specific university program. This is NOT a student-facing product, NOT a CRM, NOT a public website.

## Who uses it?

Academic/admissions advisors at United Education. They select a university → program → certificate type → answer questions → get a clear result in Arabic.

## Core architecture

```
flows/                  ← Each university = one folder with JSON configs
  constructor/          ← ✅ Complete (bachelor, IFY, master)
    _meta.json          ← University metadata + available programs
    bachelor_british.json
    bachelor_arabic.json
    ify_british.json
    ify_arabic.json
    master.json
    shared/majors.json
  srh/                  ← 🔧 Next to build
    _meta.json
    ...

engine/                 ← Generic evaluation engine (conditions, verdict)
advisor/                ← Arabic UI that reads from flows/ configs
data/                   ← Shared reference data (universities, programs)
schemas/                ← JSON schemas for validation
rules/                  ← Detailed rule sets
tests/                  ← Test cases
docs/                   ← Documentation + approved reference documents
  reference/            ← Source-of-truth documents per university (docx)
prototype/              ← Early prototype (may be superseded by advisor/)
```

## Critical rules — ALWAYS follow these

### Arabic UI
- Everything visible to the advisor must be in **Arabic only**
- English is allowed only in: code, filenames, internal keys, folder names
- No visible English text in the advisor-facing interface

### Architecture discipline
- Each university = isolated folder in `flows/` with its own JSON configs
- The advisor flow layer must remain a generic interaction layer
- Do NOT hardcode university logic into advisor.js — use JSON configs
- Dynamic resolvers in advisor.js are allowed ONLY when a result depends on combining multiple previous answers (document WHY in a comment)
- Reusable logic stays generic; university-specific logic is isolated

### Data integrity
- Do NOT invent admission rules — use only the approved reference documents in `docs/reference/`
- If something is unclear or missing, ask the user instead of guessing
- Do NOT silently change existing business logic
- Do NOT assume all universities work like Constructor

### Development discipline
- Before making changes: inspect the current repo state first
- Preserve what is already working (especially Constructor)
- Keep refactoring minimal — only what's needed for the current task
- Before coding, give a concise implementation plan listing: files to inspect, files to create, files to modify, any business ambiguity found
- After completing work: commit with a clear message describing what changed

## Current status

### ✅ Complete
- Project architecture (schemas, engine, data model)
- Evaluation engine (conditions.js, evaluate.js, verdict.js)
- Constructor University — all 5 paths working:
  - Bachelor (British certificates)
  - Bachelor (Arabic certificates)
  - IFY (British certificates)
  - IFY (Arabic certificates)
  - Master
- Advisor UI with step-by-step Arabic question flow
- Test cases for Constructor

### 🔧 In progress / Next
- SRH University — reference document uploaded, paths not yet built
- Multi-university selection (server.js currently hardcoded to Constructor only)

### 📋 Future (do NOT build yet)
- University of Debrecen
- German public universities (Anabin paths)
- Comparison mode between universities
- Login / authentication system
- Admin panel for managing data

## How the flow system works

Each university folder contains:

1. **`_meta.json`** — declares available programs and certificate paths
2. **Flow JSON files** — each file defines one complete question→result chain:
   - `questions` object with question IDs, text, options, branching
   - `results` object with all possible outcomes (status, title, message, notes, conditions, suggestions)
3. **`shared/` folder** — reusable data like majors lists, faculty lists, program lists

The advisor UI (`advisor/advisor.js`) is a generic engine that reads any `_meta.json` and renders the flow. Adding a new university should NOT require changing advisor.js except for adding dynamic resolvers when truly necessary.

## Question types supported
- `yes_no` — two buttons (نعم / لا)
- `select` — multiple choice buttons
- `major_select` — reads from shared/majors.json, branches by group
- `program_select` — reads program list from flow JSON

## Result statuses
- `positive` — eligible (✅ مؤهل)
- `conditional` — eligible with conditions (🔶 مشروط)
- `negative` — not eligible (❌ غير مؤهل)

## How to add a new university

1. Create `flows/{university_name}/` folder
2. Create `_meta.json` with programs and certificate paths
3. Create flow JSON files for each path
4. Create `shared/` folder for reusable data if needed
5. Update `advisor/server.js` to support multi-university routing (if not yet done)
6. Add test cases in `tests/`
7. Verify all paths produce correct Arabic results

## SRH-specific notes (for current task)

SRH differs from Constructor:
- Only Arabic certificate paths (do NOT invent British paths)
- No SAT logic (do NOT add SAT for SRH)
- Language requirements are mandatory and can block admission
- Programs requiring portfolio, audition, or work experience
- Expected paths: IEF, Foundation Business, Foundation Creative Studies, Foundation Engineering & IT, Pre-Master, Bachelor, Master
- Use `docs/reference/srh_all_program_paths_approved_logic.docx.docx` as source of truth

## Communication style

The project owner is not a developer. When asking questions:
- Use simple language, not technical jargon
- Give clear options when a decision is needed
- Examples of good questions:
  - "Should this case be treated as conditional or manual review?"
  - "Should this requirement block admission or only add a note?"
  - "Should this route appear as available or coming soon?"
