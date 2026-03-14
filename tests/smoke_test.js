// Smoke test: validates all university flow configs without needing a browser.
// Checks structural integrity, references, Arabic text, and shared data.
// Usage: node tests/smoke_test.js
// Exit code 0 = all pass, 1 = errors found.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOWS_ROOT = path.resolve(__dirname, '..', 'flows');

// ── Counters ──
let totalUniversities = 0;
let totalPaths = 0;
let totalQuestions = 0;
let totalResults = 0;
let totalSharedFiles = 0;
const errors = [];

function err(context, msg) {
  errors.push(`[${context}] ${msg}`);
}

// ── Arabic detection ──
// Returns true if the string contains at least one Arabic character.
function hasArabic(str) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(str);
}

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

// ── Validate a single flow JSON ──
function validateFlow(uniId, flowFile, flowPath) {
  const ctx = `${uniId}/${flowFile}`;
  let flow;
  try {
    flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
  } catch (e) {
    err(ctx, `Failed to parse JSON: ${e.message}`);
    return;
  }

  // Must have path_label
  if (!isNonEmptyString(flow.path_label)) {
    err(ctx, 'Missing or empty path_label');
  }

  const questions = flow.questions || {};
  const results = flow.results || {};
  const questionIds = new Set(Object.keys(questions));
  const resultIds = new Set(Object.keys(results));

  totalQuestions += questionIds.size;
  totalResults += resultIds.size;

  // Track referenced questions and results
  const referencedQuestions = new Set();
  const referencedResults = new Set();

  // first_question must exist
  if (!flow.first_question) {
    err(ctx, 'Missing first_question');
  } else if (!questionIds.has(flow.first_question)) {
    err(ctx, `first_question "${flow.first_question}" does not exist in questions`);
  } else {
    referencedQuestions.add(flow.first_question);
  }

  // Validate each question
  for (const [qId, q] of Object.entries(questions)) {
    const qCtx = `${ctx}:${qId}`;

    // Question text must be non-empty (allow dynamic text placeholders)
    if (!isNonEmptyString(q.text)) {
      err(qCtx, 'Empty or missing question text');
    }

    // Question type must exist
    if (!q.type) {
      err(qCtx, 'Missing question type');
    }

    // Validate options
    if (q.options) {
      for (const opt of q.options) {
        if (opt.next) {
          if (!questionIds.has(opt.next)) {
            err(qCtx, `Option "${opt.value}" references non-existent next question "${opt.next}"`);
          } else {
            referencedQuestions.add(opt.next);
          }
        }
        if (opt.result) {
          if (!resultIds.has(opt.result)) {
            err(qCtx, `Option "${opt.value}" references non-existent result "${opt.result}"`);
          } else {
            referencedResults.add(opt.result);
          }
        }
        // Options with dynamic_result on the question don't need next/result
        if (!opt.next && !opt.result && !q.dynamic_result && !q.next) {
          err(qCtx, `Option "${opt.value}" has no next, result, or dynamic_result`);
        }
      }
    }

    // Question-level next
    if (q.next) {
      if (!questionIds.has(q.next)) {
        err(qCtx, `Question-level next "${q.next}" does not exist`);
      } else {
        referencedQuestions.add(q.next);
      }
    }

    // major_select branching
    if (q.branching) {
      for (const [group, target] of Object.entries(q.branching)) {
        if (target && !questionIds.has(target)) {
          err(qCtx, `Branching group "${group}" references non-existent question "${target}"`);
        } else if (target) {
          referencedQuestions.add(target);
        }
      }
    }

    // program_select with next
    if (q.type === 'program_select' && q.next) {
      if (!questionIds.has(q.next)) {
        err(qCtx, `program_select next "${q.next}" does not exist`);
      } else {
        referencedQuestions.add(q.next);
      }
    }
  }

  // Validate each result
  for (const [rId, r] of Object.entries(results)) {
    const rCtx = `${ctx}:result:${rId}`;
    if (!isNonEmptyString(r.title)) {
      err(rCtx, 'Empty or missing result title');
    }
    if (!isNonEmptyString(r.message)) {
      err(rCtx, 'Empty or missing result message');
    }
    if (!['positive', 'conditional', 'negative'].includes(r.status)) {
      err(rCtx, `Invalid result status "${r.status}"`);
    }
    // Result title/message should contain Arabic
    if (isNonEmptyString(r.title) && !hasArabic(r.title)) {
      err(rCtx, `Result title has no Arabic text: "${r.title}"`);
    }
    if (isNonEmptyString(r.message) && !hasArabic(r.message)) {
      err(rCtx, `Result message has no Arabic text: "${r.message}"`);
    }
  }

  // Check for orphan questions (not referenced by anything)
  // NOTE: dynamic resolvers can route to questions via __next: signal,
  // so we can't fully detect orphans for dynamic flows. We skip questions
  // that are likely targets of dynamic resolvers.
  const dynamicQuestionIds = new Set();
  for (const [qId, q] of Object.entries(questions)) {
    if (q.dynamic_result) {
      // Any question after a dynamic_result question might be a dynamic target
      // We mark all questions that aren't first_question and aren't statically referenced
      // These could be dynamic targets — we don't flag them as orphans.
      dynamicQuestionIds.add(qId);
    }
  }

  // Also, exam_questions can reference DB_BSC_EXAM dynamically
  const hasDynamicRouting = Object.values(questions).some(q => q.dynamic_result);

  for (const qId of questionIds) {
    if (qId === flow.first_question) continue;
    if (referencedQuestions.has(qId)) continue;
    // Skip orphan check if this flow uses dynamic resolvers (they route via __next:)
    if (hasDynamicRouting) continue;
    err(ctx, `Orphan question "${qId}" — nothing references it`);
  }

  // Check for orphan results (not referenced by any option)
  // Skip if flow uses dynamic resolvers (they return results programmatically)
  if (!hasDynamicRouting) {
    for (const rId of resultIds) {
      if (!referencedResults.has(rId)) {
        err(ctx, `Orphan result "${rId}" — nothing references it`);
      }
    }
  }

  // Validate question text is Arabic (skip dynamic placeholders)
  for (const [qId, q] of Object.entries(questions)) {
    if (isNonEmptyString(q.text) && !hasArabic(q.text)) {
      // Allow placeholder text for dynamically overridden questions
      if (!q.dynamic_text_from_program && !flow.exam_questions) {
        err(`${ctx}:${qId}`, `Question text has no Arabic: "${q.text}"`);
      }
    }
  }
}

// ── Validate shared data files ──
function validateShared(uniId) {
  const sharedDir = path.join(FLOWS_ROOT, uniId, 'shared');
  if (!fs.existsSync(sharedDir)) return;

  const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    totalSharedFiles++;
    const filePath = path.join(sharedDir, file);
    const ctx = `${uniId}/shared/${file}`;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      err(ctx, `Failed to parse JSON: ${e.message}`);
      continue;
    }

    // Check that the file contains at least one non-empty array
    const arrays = Object.values(data).filter(v => Array.isArray(v));
    if (arrays.length === 0) {
      err(ctx, 'No arrays found in shared data file');
      continue;
    }
    for (const arr of arrays) {
      if (arr.length === 0) {
        err(ctx, 'Empty array in shared data file');
      }
    }
  }
}

// ── Main ──
function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    Smoke Test — Flow Config Validation   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log();

  if (!fs.existsSync(FLOWS_ROOT)) {
    console.error(`ERROR: flows/ directory not found at ${FLOWS_ROOT}`);
    process.exit(1);
  }

  const uniDirs = fs.readdirSync(FLOWS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const uniId of uniDirs) {
    const metaPath = path.join(FLOWS_ROOT, uniId, '_meta.json');
    if (!fs.existsSync(metaPath)) continue;

    totalUniversities++;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      err(`${uniId}/_meta.json`, `Failed to parse: ${e.message}`);
      continue;
    }

    console.log(`📚 ${meta.university_label || uniId}`);

    // Validate _meta.json fields
    if (!isNonEmptyString(meta.university_label)) {
      err(`${uniId}/_meta.json`, 'Missing university_label');
    }
    if (!isNonEmptyString(meta.country)) {
      err(`${uniId}/_meta.json`, 'Missing country');
    }
    if (!isNonEmptyString(meta.university_type)) {
      err(`${uniId}/_meta.json`, 'Missing university_type');
    }
    if (!meta.programs || !Array.isArray(meta.programs) || meta.programs.length === 0) {
      err(`${uniId}/_meta.json`, 'Missing or empty programs array');
      continue;
    }

    // Collect all flow files from _meta.json
    for (const prog of meta.programs) {
      if (prog.placeholder) continue;

      if (prog.certificates) {
        for (const cert of prog.certificates) {
          if (!cert.file) {
            err(`${uniId}/_meta.json`, `Certificate "${cert.id}" missing file`);
            continue;
          }
          const flowPath = path.join(FLOWS_ROOT, uniId, cert.file);
          if (!fs.existsSync(flowPath)) {
            err(`${uniId}/_meta.json`, `Flow file "${cert.file}" not found`);
            continue;
          }
          totalPaths++;
          console.log(`   ├─ ${cert.label || cert.id}`);
          validateFlow(uniId, cert.file, flowPath);
        }
      } else if (prog.file) {
        const flowPath = path.join(FLOWS_ROOT, uniId, prog.file);
        if (!fs.existsSync(flowPath)) {
          err(`${uniId}/_meta.json`, `Flow file "${prog.file}" not found`);
          continue;
        }
        totalPaths++;
        console.log(`   ├─ ${prog.label || prog.id}`);
        validateFlow(uniId, prog.file, flowPath);
      }
    }

    // Validate shared data
    validateShared(uniId);
  }

  // ── Summary ──
  console.log();
  console.log('═══════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════');
  console.log(`  Universities:    ${totalUniversities}`);
  console.log(`  Flow paths:      ${totalPaths}`);
  console.log(`  Questions:       ${totalQuestions}`);
  console.log(`  Results:         ${totalResults}`);
  console.log(`  Shared files:    ${totalSharedFiles}`);
  console.log();

  if (errors.length === 0) {
    console.log('  ✅ All checks passed!');
    console.log();
    process.exit(0);
  } else {
    console.log(`  ❌ ${errors.length} error(s) found:`);
    console.log();
    for (const e of errors) {
      console.log(`  • ${e}`);
    }
    console.log();
    process.exit(1);
  }
}

main();
