// Client-side advisor flow engine.
// Drives a step-by-step Arabic question flow from declarative JSON configs.
//
// ARCHITECTURE NOTE:
// - All question text, labels, and results come from flow JSON configs (Arabic-only).
// - Dynamic logic is isolated in the DYNAMIC_RESOLVERS section below.
// - The flow engine itself is generic and config-driven.
// - Results use the project's status model: positive / conditional / negative.

// ──────────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────────

let meta = null;        // _meta.json
let majorsData = null;  // shared/majors.json
let currentFlow = null; // loaded flow JSON for current path
let history = [];       // array of { questionId, answer, answerLabel }
let currentQuestion = null;

const $ = id => document.getElementById(id);

// ──────────────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────────────

async function init() {
  meta = await fetchJSON('/api/meta');
  majorsData = await fetchJSON('/api/majors');
  showPathSelector();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY FLOW — 2-step selection: program type → certificate type → flow start
//
// Structure (from _meta.json):
//   programs[] → each has certificates[] (bachelor, ify)
//                or direct_flow (master)
//                or placeholder (pre_bachelor)
// ──────────────────────────────────────────────────────────────────────────────

// Track the entry selections so "back" works correctly at every level
let selectedProgram = null;

function showPathSelector() {
  showProgramSelector();
}

// Step 1: "ما نوع البرنامج المطلوب؟"
function showProgramSelector() {
  history = [];
  currentFlow = null;
  currentQuestion = null;
  selectedProgram = null;

  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(meta.country_label)}</p>
    </div>
    <div class="card">
      <h2>ما نوع البرنامج المطلوب؟</h2>
      <div class="path-list" id="programList"></div>
    </div>
  `;

  const list = $('programList');
  for (const prog of meta.programs) {
    const btn = document.createElement('button');
    btn.className = 'path-btn';
    btn.textContent = prog.label;

    if (prog.placeholder) {
      btn.classList.add('placeholder');
      btn.addEventListener('click', () => showPlaceholder(prog));
    } else if (prog.direct_flow) {
      // Master's — no certificate step, go straight to flow
      btn.addEventListener('click', () => {
        selectedProgram = prog;
        startFlow(prog.direct_flow);
      });
    } else {
      // Has certificates — go to step 2
      btn.addEventListener('click', () => showCertificateSelector(prog));
    }

    list.appendChild(btn);
  }
}

// Step 2: "ما نوع شهادة الطالب؟"
function showCertificateSelector(program) {
  selectedProgram = program;

  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(program.label)}</p>
    </div>
    <div class="card">
      <h2>ما نوع شهادة الطالب؟</h2>
      <div class="path-list" id="certList"></div>
    </div>
    <button class="back-btn" onclick="showProgramSelector()">العودة لاختيار البرنامج</button>
  `;

  const list = $('certList');
  for (const cert of program.certificates) {
    const btn = document.createElement('button');
    btn.className = 'path-btn';
    btn.textContent = cert.label;
    btn.addEventListener('click', () => startFlow(cert.id));
    list.appendChild(btn);
  }
}

// Placeholder screen (Pre-Bachelor)
function showPlaceholder(programDef) {
  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
    </div>
    <div class="card result-box status-conditional">
      <h2>${esc(programDef.label)}</h2>
      <p>${esc(programDef.placeholder_message)}</p>
    </div>
    <button class="back-btn" onclick="showProgramSelector()">العودة لاختيار البرنامج</button>
  `;
}

// ──────────────────────────────────────────────────────────────────────────────
// FLOW ENGINE
// ──────────────────────────────────────────────────────────────────────────────

async function startFlow(pathId) {
  currentFlow = await fetchJSON(`/api/flow/${pathId}`);
  history = [];
  showQuestion(currentFlow.first_question);
}

function showQuestion(questionId) {
  currentQuestion = questionId;
  const q = currentFlow.questions[questionId];
  if (!q) {
    showResult({ status: 'negative', title: 'خطأ', message: `السؤال ${questionId} غير موجود في التدفق.` });
    return;
  }

  let optionsHTML = '';

  if (q.type === 'yes_no') {
    optionsHTML = q.options.map(o =>
      `<button class="option-btn" data-value="${esc(o.value)}">${esc(o.label)}</button>`
    ).join('');

  } else if (q.type === 'select') {
    optionsHTML = q.options.map(o =>
      `<button class="option-btn" data-value="${esc(o.value)}">${esc(o.label)}</button>`
    ).join('');

  } else if (q.type === 'major_select') {
    optionsHTML = buildMajorSelectHTML(q);

  } else if (q.type === 'program_select') {
    optionsHTML = buildProgramSelectHTML();
  }

  const progressHTML = buildProgressHTML();

  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(currentFlow.path_label)}</p>
    </div>
    ${progressHTML}
    <div class="card">
      <h2>${esc(q.text)}</h2>
      <div class="options" id="optionsArea">${optionsHTML}</div>
    </div>
    <button class="back-btn" onclick="goBack()">${history.length > 0 ? 'السؤال السابق' : 'العودة'}</button>
  `;

  // Attach click handlers
  const optBtns = document.querySelectorAll('.option-btn');
  for (const btn of optBtns) {
    btn.addEventListener('click', () => handleAnswer(questionId, btn.dataset.value, btn.textContent));
  }
}

function buildMajorSelectHTML(q) {
  return majorsData.majors.map(m => {
    let label = m.label;
    if (m.warning) label += ` ⚠️`;
    return `<button class="option-btn major-btn" data-value="${esc(m.id)}" data-group="${esc(m.group)}" title="${m.warning ? esc(m.warning) : ''}">${esc(label)}</button>`;
  }).join('');
}

function buildProgramSelectHTML() {
  const programs = currentFlow.program_select.programs;
  return programs.map(p =>
    `<button class="option-btn program-btn" data-value="${esc(p.id)}">${esc(p.label)}</button>`
  ).join('');
}

function buildProgressHTML() {
  if (history.length === 0) return '';
  const items = history.map(h => {
    const q = currentFlow.questions[h.questionId];
    return `<div class="progress-item"><span class="progress-q">${esc(q ? q.text : h.questionId)}</span><span class="progress-a">${esc(h.answerLabel)}</span></div>`;
  }).join('');
  return `<div class="progress-bar">${items}</div>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// ANSWER HANDLING
// ──────────────────────────────────────────────────────────────────────────────

function handleAnswer(questionId, value, label) {
  history.push({ questionId, answer: value, answerLabel: label });

  const q = currentFlow.questions[questionId];

  // --- Major select: branch by group (British) or go to next (Arabic) ---
  if (q.type === 'major_select') {
    const clickedBtn = document.querySelector(`.option-btn[data-value="${value}"]`);
    const group = clickedBtn ? clickedBtn.dataset.group : null;

    if (q.branching && group && q.branching[group]) {
      showQuestion(q.branching[group]);
    } else if (q.next) {
      showQuestion(q.next);
    }
    return;
  }

  // --- Program select (master's): store selection, go to next ---
  if (q.type === 'program_select') {
    showQuestion(q.next);
    return;
  }

  // --- Dynamic result: delegate to resolver ---
  if (q.dynamic_result) {
    const resolver = DYNAMIC_RESOLVERS[q.dynamic_result];
    if (resolver) {
      const result = resolver(value, history, currentFlow);
      showResult(result);
      return;
    }
  }

  // --- Standard option routing ---
  const option = q.options ? q.options.find(o => o.value === value) : null;

  if (option && option.result) {
    // Terminal: show result from flow config
    const resultDef = currentFlow.results[option.result];
    showResult(resultDef || { status: 'negative', title: 'خطأ', message: 'نتيجة غير معرّفة' });
  } else if (option && option.next) {
    showQuestion(option.next);
  } else if (q.next) {
    // Question-level next (e.g., select questions where all options go to the same next)
    showQuestion(q.next);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DYNAMIC RESOLVERS — isolated section for logic that cannot be config-driven.
//
// Each resolver receives (currentAnswerValue, history, flow) and returns
// a result object matching the project's status model:
//   { status: 'positive'|'conditional'|'negative', title, message, notes?, conditions?, suggestions? }
//
// WHY these exist:
// The approved Constructor reference (section 6) identifies 3 cases where
// the result is computed from a combination of previous answers, not from
// a single question's branching. These cannot be represented as static
// question→result mappings in the flow JSON.
// ──────────────────────────────────────────────────────────────────────────────

const DYNAMIC_RESOLVERS = {

  // ─── Bachelor Arabic: GPA question ─────────────────────────────────────
  // Reference: section 3.b, KO_AR_GPA
  // Result is ALWAYS positive. Scholarship note varies by GPA tier.
  // SAT and language status from previous answers add conditions/notes.
  bachelor_arabic_gpa(gpaValue, hist, flow) {
    const satAnswer = getHistoryAnswer(hist, 'KO_AR_SAT');
    const langAnswer = getHistoryAnswer(hist, 'KO_AR_IELTS');
    const scholarship = flow.scholarship_table[gpaValue];

    const notes = [];
    const conditions = [];

    // Scholarship note from GPA
    if (scholarship) {
      notes.push(scholarship.scholarship);
    }

    // Tuition note
    if (flow.tuition_note) {
      notes.push(flow.tuition_note);
    }

    // GPA scale warning
    if (flow.gpa_warning) {
      notes.push(flow.gpa_warning);
    }

    // SAT condition
    if (satAnswer === 'no') {
      conditions.push({
        category: 'sat',
        description: 'يجب تقديم شهادة SAT بدرجة 1200 أو أعلى قبل 31 ديسمبر'
      });
    }

    // Language note
    if (langAnswer === 'no') {
      notes.push('يجب إجراء مقابلة تقييم لغة.');
    }

    return {
      status: conditions.length > 0 ? 'conditional' : 'positive',
      title: 'نمضي بالتقديم',
      message: 'الطالب مؤهل للتقديم للبكالوريوس.',
      notes,
      conditions: conditions.length > 0 ? conditions : undefined
    };
  },

  // ─── IFY Arabic: Language question ─────────────────────────────────────
  // Reference: section 3.d, KO_IFY_AR_IELTS
  // 6-scenario matrix: [gpa_answer][language_answer] → result
  // The result table is stored in the flow JSON (dynamic_result_table).
  ify_arabic_language(langValue, hist, flow) {
    const gpaAnswer = getHistoryAnswer(hist, 'KO_IFY_AR_GPA');
    const table = flow.dynamic_result_table;

    if (table && table[gpaAnswer] && table[gpaAnswer][langValue]) {
      return table[gpaAnswer][langValue];
    }

    // Fallback — should not happen if flow config is correct
    return {
      status: 'positive',
      title: 'مؤهل للسنة التأسيسية',
      message: 'الطالب مؤهل لبرنامج السنة التأسيسية.',
      notes: ['رسوم السنة التأسيسية: 13,000 يورو.']
    };
  },

  // ─── Master's: Language question ───────────────────────────────────────
  // Reference: section 3.e, KO_MSC_IELTS
  // Appends campus/semester info from the selected program.
  master_language(langValue, hist, flow) {
    const programId = getHistoryAnswer(hist, 'KO_MSC_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);
    const notes = [];

    if (program) {
      if (program.campus !== '—') {
        notes.push(`الكامبوس: ${program.campus}`);
      }
      if (program.semester !== '—') {
        notes.push(`الفصل الدراسي: ${program.semester}`);
      }
    }

    if (langValue === 'yes') {
      return {
        status: 'positive',
        title: 'مؤهل للتقديم',
        message: 'الطالب مؤهل للتقديم لبرنامج الماجستير.',
        notes
      };
    } else {
      notes.push('يجب إجراء مقابلة تقييم لغة.');
      return {
        status: 'positive',
        title: 'نمضي بالتقديم + مقابلة لغة',
        message: 'الطالب مؤهل للتقديم مع إجراء مقابلة تقييم لغة.',
        notes
      };
    }
  }
};

// Helper: find a previous answer in history by question ID
function getHistoryAnswer(hist, questionId) {
  const entry = hist.find(h => h.questionId === questionId);
  return entry ? entry.answer : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESULT DISPLAY
// ──────────────────────────────────────────────────────────────────────────────

function showResult(result) {
  const statusClass = `status-${result.status}`;
  const statusLabels = {
    positive: '✅ مؤهل',
    conditional: '🔶 مشروط',
    negative: '❌ غير مؤهل'
  };

  let html = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(currentFlow.path_label)}</p>
    </div>
    ${buildProgressHTML()}
    <div class="card result-box ${statusClass}">
      <div class="result-status">${statusLabels[result.status] || result.status}</div>
      <h2>${esc(result.title)}</h2>
      <p>${esc(result.message)}</p>
  `;

  // Conditions
  if (result.conditions && result.conditions.length > 0) {
    html += `<div class="result-section"><h3>الشروط المطلوبة</h3><ul>`;
    for (const c of result.conditions) {
      html += `<li>${esc(c.description)}</li>`;
    }
    html += `</ul></div>`;
  }

  // Notes
  if (result.notes && result.notes.length > 0) {
    html += `<div class="result-section"><h3>ملاحظات</h3><ul>`;
    for (const n of result.notes) {
      html += `<li>${esc(n)}</li>`;
    }
    html += `</ul></div>`;
  }

  // Suggestions (path redirects)
  if (result.suggestions && result.suggestions.length > 0) {
    html += `<div class="result-section"><h3>اقتراحات</h3>`;
    for (const s of result.suggestions) {
      html += `<button class="suggestion-btn" onclick="startFlow('${esc(s.path)}')">${esc(s.label)}</button>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  html += `<button class="back-btn" onclick="showProgramSelector()">العودة لاختيار البرنامج</button>`;

  $('app').innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ──────────────────────────────────────────────────────────────────────────────

// goBack: replay from start
function goBack() {
  if (history.length === 0) {
    // At first question — go back to certificate or program selector
    if (selectedProgram && selectedProgram.certificates) {
      showCertificateSelector(selectedProgram);
    } else {
      showProgramSelector();
    }
    return;
  }
  history.pop();
  // Replay: start from first question, fast-forward through history
  if (history.length === 0) {
    showQuestion(currentFlow.first_question);
    return;
  }
  // Find what question should be shown now (the one after the last answered)
  const saved = [...history];
  history = [];
  let qId = currentFlow.first_question;
  for (const entry of saved) {
    history.push(entry);
    const q = currentFlow.questions[entry.questionId];
    // Determine next question from this answer
    qId = resolveNextQuestion(q, entry.answer);
  }
  if (qId) {
    showQuestion(qId);
  }
}

function resolveNextQuestion(q, value) {
  if (q.type === 'major_select') {
    if (q.branching) {
      const major = majorsData.majors.find(m => m.id === value);
      if (major && q.branching[major.group]) return q.branching[major.group];
    }
    return q.next || null;
  }
  if (q.type === 'program_select') {
    return q.next || null;
  }
  if (q.type === 'select' && q.next) {
    return q.next;
  }
  if (q.options) {
    const opt = q.options.find(o => o.value === value);
    if (opt && opt.next) return opt.next;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────────────────────────

function esc(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
