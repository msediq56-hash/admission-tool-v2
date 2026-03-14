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

let universities = null;  // list from /api/universities
let currentUni = null;    // selected university ID
let meta = null;          // _meta.json for selected university
let majorsData = null;    // shared/majors.json for selected university
let currentFlow = null;   // loaded flow JSON for current path
let history = [];         // array of { questionId, answer, answerLabel }
let currentQuestion = null;

// SRH faculty/program selection state
// WHY: SRH bachelor/master require faculty→program selection before questions start.
// The selected program determines whether portfolio/audition/MBA questions are needed.
let facultyData = null;   // loaded faculty list for current flow
let programData = null;   // loaded program list for current flow
let selectedFaculty = null;
let selectedProgram_srh = null;

const $ = id => document.getElementById(id);

// ──────────────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────────────

// Entry selection state
let selectedCountry = null;
let selectedUniType = null;

async function init() {
  const data = await fetchJSON('/api/universities');
  universities = data.universities;
  showCountrySelector();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// ENTRY SELECTION — Country → University Type → University
// ──────────────────────────────────────────────────────────────────────────────

function resetAllState() {
  currentUni = null;
  meta = null;
  majorsData = null;
  currentFlow = null;
  history = [];
  currentQuestion = null;
  selectedProgram = null;
  selectedCountry = null;
  selectedUniType = null;
}

// Step 0a: Select country
function showCountrySelector() {
  resetAllState();

  // Extract unique countries from universities
  const countries = [...new Set(universities.map(u => u.country))];

  $('app').innerHTML = `
    <div class="header">
      <h1>تقييم أهلية القبول</h1>
      <p class="subtitle">اختر الدولة للبدء</p>
    </div>
    <div class="card">
      <h2>اختر الدولة</h2>
      <div class="path-list" id="countryList"></div>
    </div>
  `;

  const list = $('countryList');
  for (const country of countries) {
    const btn = document.createElement('button');
    btn.className = 'path-btn';
    btn.textContent = country;
    btn.addEventListener('click', () => selectCountry(country));
    list.appendChild(btn);
  }
}

// Step 0b: Select university type (حكومية / خاصة)
// Skips if only one type exists for the selected country.
function selectCountry(country) {
  selectedCountry = country;
  const filtered = universities.filter(u => u.country === country);
  const types = [...new Set(filtered.map(u => u.university_type))];

  if (types.length === 1) {
    // Only one type — skip type selection
    selectUniType(types[0]);
    return;
  }

  $('app').innerHTML = `
    <div class="header">
      <h1>تقييم أهلية القبول</h1>
      <p class="subtitle">${esc(country)}</p>
    </div>
    <div class="card">
      <h2>اختر نوع الجامعة</h2>
      <div class="path-list" id="typeList"></div>
    </div>
    <button class="back-btn" onclick="showCountrySelector()">العودة لاختيار الدولة</button>
  `;

  const list = $('typeList');
  for (const t of types) {
    const btn = document.createElement('button');
    btn.className = 'path-btn';
    btn.textContent = t;
    btn.addEventListener('click', () => selectUniType(t));
    list.appendChild(btn);
  }
}

// Step 0c: Select university (filtered by country + type)
// Skips if only one university matches.
function selectUniType(uniType) {
  selectedUniType = uniType;
  const filtered = universities.filter(u => u.country === selectedCountry && u.university_type === uniType);

  if (filtered.length === 1) {
    // Only one university — skip university selection
    selectUniversity(filtered[0].id);
    return;
  }

  $('app').innerHTML = `
    <div class="header">
      <h1>تقييم أهلية القبول</h1>
      <p class="subtitle">${esc(selectedCountry)} — ${esc(uniType)}</p>
    </div>
    <div class="card">
      <h2>اختر الجامعة</h2>
      <div class="path-list" id="uniList"></div>
    </div>
    <button class="back-btn" onclick="goBackFromUniSelector()">العودة لاختيار نوع الجامعة</button>
  `;

  const list = $('uniList');
  for (const uni of filtered) {
    const btn = document.createElement('button');
    btn.className = 'path-btn';
    btn.textContent = uni.label;
    btn.addEventListener('click', () => selectUniversity(uni.id));
    list.appendChild(btn);
  }
}

// Back from university selector — go to type selector or country selector
function goBackFromUniSelector() {
  const filtered = universities.filter(u => u.country === selectedCountry);
  const types = [...new Set(filtered.map(u => u.university_type))];
  if (types.length === 1) {
    // Type was skipped — go back to country
    showCountrySelector();
  } else {
    selectCountry(selectedCountry);
  }
}

// Back from program selector — navigate to university list, type list, or country list
// depending on whether steps were skipped (single type or single university).
function goBackToEntryFlow() {
  const filtered = universities.filter(u => u.country === selectedCountry && u.university_type === selectedUniType);
  if (filtered.length > 1) {
    // Multiple universities — go back to university selector
    selectUniType(selectedUniType);
  } else {
    // University was auto-selected — go back further
    goBackFromUniSelector();
  }
}

async function selectUniversity(uniId) {
  currentUni = uniId;
  meta = await fetchJSON(`/api/${uniId}/meta`);
  // majors.json is optional — only Constructor uses major_select questions
  majorsData = await fetchJSON(`/api/${uniId}/majors`);
  showProgramSelector();
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
    <button class="back-btn" onclick="goBackToEntryFlow()">العودة لاختيار الجامعة</button>
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
      // No certificate step, go straight to flow
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

// Placeholder screen (e.g. Pre-Bachelor)
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
  currentFlow = await fetchJSON(`/api/${currentUni}/flow/${pathId}`);
  history = [];
  selectedFaculty = null;
  selectedProgram_srh = null;
  facultyData = null;
  programData = null;

  // If flow has faculty_select, load faculty/program data and show selection first
  if (currentFlow.faculty_select) {
    const fs = currentFlow.faculty_select;
    facultyData = await fetchJSON(`/api/${currentUni}/shared/${fs.data_file}`);
    programData = await fetchJSON(`/api/${currentUni}/shared/${fs.programs_file}`);
    showFacultySelector();
  } else {
    showQuestion(currentFlow.first_question);
  }
}

// Faculty selection screen (SRH bachelor/master)
function showFacultySelector() {
  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(currentFlow.path_label)}</p>
    </div>
    <div class="card">
      <h2>اختر الكلية</h2>
      <div class="options" id="facultyList"></div>
    </div>
    <button class="back-btn" onclick="showProgramSelector()">العودة لاختيار البرنامج</button>
  `;
  const list = $('facultyList');
  for (const fac of facultyData.faculties) {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = fac.label;
    btn.addEventListener('click', () => showFacultyProgramSelector(fac));
    list.appendChild(btn);
  }
}

// Program selection within faculty (SRH bachelor/master)
function showFacultyProgramSelector(faculty) {
  selectedFaculty = faculty;
  const filtered = programData.programs.filter(p => p.faculty === faculty.id);

  $('app').innerHTML = `
    <div class="header">
      <h1>${esc(meta.university_label)}</h1>
      <p class="subtitle">${esc(currentFlow.path_label)} — ${esc(faculty.label)}</p>
    </div>
    <div class="card">
      <h2>اختر البرنامج</h2>
      <div class="options" id="progList"></div>
    </div>
    <button class="back-btn" onclick="showFacultySelector()">العودة لاختيار الكلية</button>
  `;
  const list = $('progList');
  for (const prog of filtered) {
    const btn = document.createElement('button');
    btn.className = 'option-btn program-btn';
    btn.textContent = prog.label;
    btn.addEventListener('click', () => {
      selectedProgram_srh = prog;
      showQuestion(currentFlow.first_question);
    });
    list.appendChild(btn);
  }
}

function showQuestion(questionId) {
  currentQuestion = questionId;
  const q = currentFlow.questions[questionId];
  if (!q) {
    showResult({ status: 'negative', title: 'خطأ', message: `السؤال ${questionId} غير موجود في التدفق.` });
    return;
  }

  // Dynamic question text override:
  // 1. Debrecen bachelor: exam question text depends on selected program's exam_type.
  // 2. Debrecen master/PhD: IELTS question text depends on selected program's ielts score.
  let questionText = q.text;
  if (currentFlow.exam_questions && questionId === 'DB_BSC_EXAM') {
    const programId = getHistoryAnswer(history, 'DB_BSC_PROGRAM');
    const program = currentFlow.program_select.programs.find(p => p.id === programId);
    if (program && currentFlow.exam_questions[program.exam_type]) {
      questionText = currentFlow.exam_questions[program.exam_type];
    }
  }
  // dynamic_text_from_program: replaces question text with program-specific IELTS score
  // WHY: Debrecen master/PhD IELTS requirements vary per program (5.5, 6, 6.5, 7, 7.5, 8, or interview).
  // The advisor needs to show the exact required score so the advisor knows what to check.
  if (q.dynamic_text_from_program) {
    questionText = resolveDynamicText(q, questionId);
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
      <h2>${esc(questionText)}</h2>
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
    let text = q ? q.text : h.questionId;
    // Dynamic text override for Debrecen bachelor exam question
    if (currentFlow.exam_questions && h.questionId === 'DB_BSC_EXAM') {
      const programId = getHistoryAnswer(history, 'DB_BSC_PROGRAM');
      const program = currentFlow.program_select.programs.find(p => p.id === programId);
      if (program && currentFlow.exam_questions[program.exam_type]) {
        text = currentFlow.exam_questions[program.exam_type];
      }
    }
    // Dynamic text override for Debrecen master/PhD IELTS question
    if (q && q.dynamic_text_from_program) {
      text = resolveDynamicText(q, h.questionId);
    }
    return `<div class="progress-item"><span class="progress-q">${esc(text)}</span><span class="progress-a">${esc(h.answerLabel)}</span></div>`;
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

  // --- Program select: store selection, check for dynamic routing, go to next ---
  if (q.type === 'program_select') {
    // Support dynamic routing after program selection (e.g. Debrecen master interview exception)
    if (q.dynamic_result) {
      const resolver = DYNAMIC_RESOLVERS[q.dynamic_result];
      if (resolver) {
        const result = resolver(value, history, currentFlow);
        if (typeof result === 'string' && result.startsWith('__next:')) {
          showQuestion(result.slice(7));
          return;
        }
        showResult(result);
        return;
      }
    }
    showQuestion(q.next);
    return;
  }

  // --- Dynamic result: delegate to resolver ---
  if (q.dynamic_result) {
    const resolver = DYNAMIC_RESOLVERS[q.dynamic_result];
    if (resolver) {
      const result = resolver(value, history, currentFlow);
      // Special signal: '__next:QUESTION_ID' means show next question instead of result
      if (typeof result === 'string' && result.startsWith('__next:')) {
        showQuestion(result.slice(7));
        return;
      }
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
  },

  // ─── SRH Foundation (Business/Creative/Engineering): Language question ──
  // Reference: SRH section 3.2 — all 3 foundation types share the same language logic.
  // WHY dynamic: result depends on language level + foundation type (from flow config).
  // The flow JSON contains location, admission_seasons, duration, and progression_programs.
  srh_foundation_language(langValue, hist, flow) {
    const fndLabel = flow.path_label;

    if (langValue === 'below_4') {
      return {
        status: 'negative',
        title: 'غير مؤهل حالياً — اللغة الإنجليزية',
        message: `الحد الأدنى لهذا الفاونديشن هو IELTS 5.0 أو ما يعادله. مستوى الطالب الحالي أقل من المطلوب.`,
        notes: ['يمكن للطالب التقديم بعد تحسين مستوى اللغة والوصول لـ IELTS 5.0 على الأقل.']
      };
    }
    if (langValue === 'ielts_4_5') {
      return {
        status: 'conditional',
        title: '💡 جرّب برنامج اللغة الإنجليزية المكثف (IEF)',
        message: 'مستوى اللغة الإنجليزية لدى الطالب (4.0-4.9) أقل من شرط الفاونديشن (5.0+) — لكنه مؤهل لبرنامج اللغة المكثف الذي يؤدي للفاونديشن.',
        notes: ['💡 يُنصح بالتقديم على برنامج اللغة الإنجليزية المكثف (IEF) أولاً — يتطلب IELTS 4.0 ويؤدي للفاونديشن بعد فصل واحد.'],
        suggestions: [{ label: 'برنامج اللغة المكثف (IEF)', path: 'ief' }]
      };
    }
    if (langValue === 'ielts_65_plus') {
      return {
        status: 'conditional',
        title: '🔶 الطالب مؤهل للتقديم المباشر على البكالوريوس',
        message: 'مستوى اللغة الإنجليزية لدى الطالب (6.5+) يؤهله للتقديم مباشرة على برنامج البكالوريوس دون الحاجة لفاونديشن.',
        notes: ['💡 ابدأ مسار البكالوريوس مباشرة في جامعة SRH.'],
        suggestions: [{ label: 'ابدأ مسار البكالوريوس', path: 'bachelor' }]
      };
    }
    // ielts_5_6 → eligible
    const notes = [
      'الطالب مؤهل — تواصل معه لتجهيز ملف التقديم.',
      `الموقع: ${flow.location}`,
      `القبول: ${flow.admission_seasons}`,
      `المدة: ${flow.duration}`
    ];
    if (flow.progression_programs) {
      notes.push('برامج البكالوريوس المتاحة بعد الفاونديشن:');
      for (const p of flow.progression_programs) notes.push(`• ${p}`);
    }
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${fndLabel}`,
      message: 'الطالب يستوفي شروط القبول في برنامج الفاونديشن في جامعة SRH.',
      notes
    };
  },

  // ─── SRH Pre-Master: Language question ────────────────────────────────
  // Reference: SRH section 3.3, SRH_PM_IELTS
  // WHY dynamic: result includes selected program name + progression info from flow config.
  srh_pre_master_language(langValue, hist, flow) {
    if (langValue === 'no') {
      return flow.results.no_lang;
    }
    // Yes → eligible
    const programId = getHistoryAnswer(hist, 'SRH_PM_TYPE');
    const pm = flow.pm_programs[programId];
    const notes = [
      'الطالب مؤهل — تواصل معه لتجهيز ملف التقديم لجامعة SRH.',
      `الموقع: ${flow.location}`,
      `مواعيد القبول: ${flow.admission_seasons}`,
      `المدة: ${flow.duration}`,
      `الرسوم: ${flow.tuition}`
    ];
    if (pm && pm.progression) {
      notes.push('برامج الماجستير المتاحة بعد هذا البرنامج:');
      for (const p of pm.progression) notes.push(`• ${p}`);
    }
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${pm ? pm.label : 'بري ماستر'}`,
      message: 'الطالب يستوفي شروط القبول لبرامج بري ماستر في SRH.',
      notes
    };
  },

  // ─── SRH Bachelor: Language question ──────────────────────────────────
  // Reference: SRH section 3.4, SRH_BSC_IELTS
  // WHY dynamic: after language=yes, must check if selected program requires
  // portfolio/audition and route to appropriate next question. Otherwise → eligible.
  srh_bachelor_language(langValue, hist, flow) {
    if (langValue === 'no') {
      return flow.results.no_lang;
    }
    // Yes → check program requirements
    if (selectedProgram_srh && selectedProgram_srh.requires === 'portfolio') {
      // Route to portfolio question — return null to signal "show next question"
      return '__next:SRH_BSC_PORTFOLIO';
    }
    if (selectedProgram_srh && selectedProgram_srh.requires === 'audition') {
      return '__next:SRH_BSC_AUDITION';
    }
    // No special requirement → eligible
    return buildBscResult();
  },

  // ─── SRH Bachelor: Portfolio question ─────────────────────────────────
  srh_bachelor_portfolio(value, hist, flow) {
    if (value === 'no') return flow.results.no_portfolio;
    return buildBscResult();
  },

  // ─── SRH Bachelor: Audition question ──────────────────────────────────
  srh_bachelor_audition(value, hist, flow) {
    if (value === 'no') return flow.results.no_audition;
    return buildBscResult();
  },

  // ─── SRH Master: Language question ────────────────────────────────────
  // Reference: SRH section 3.5, SRH_MSC_IELTS
  // WHY dynamic: language routing depends on level (below 5.5 → reject,
  // 5.5-6.4 → pre-master suggestion, 6.5+ → check program requirements).
  srh_master_language(langValue, hist, flow) {
    if (langValue === 'below_55') {
      return flow.results.no_lang;
    }
    if (langValue === 'ielts_55_64') {
      return flow.results.try_pre_master;
    }
    // 6.5+ → check program requirements
    if (selectedProgram_srh && selectedProgram_srh.requires === 'mba_experience') {
      return '__next:SRH_MSC_MBA_EXP';
    }
    if (selectedProgram_srh && selectedProgram_srh.requires === 'portfolio') {
      return '__next:SRH_MSC_PORTFOLIO';
    }
    return buildMscResult(hist, flow);
  },

  // ─── SRH Master: MBA experience question ──────────────────────────────
  srh_master_mba_exp(value, hist, flow) {
    if (value === 'no') return flow.results.no_mba_exp;
    // MBA programs with experience also need portfolio check?
    // Reference says: "نعم → (تحقق من البورتفوليو إذا لزم، وإلا → ✅ مؤهل)"
    // MBA programs are NOT in portfolio list, so → eligible
    if (selectedProgram_srh && selectedProgram_srh.requires === 'portfolio') {
      return '__next:SRH_MSC_PORTFOLIO';
    }
    return buildMscResult(hist, flow);
  },

  // ─── SRH Master: Portfolio question ───────────────────────────────────
  srh_master_portfolio(value, hist, flow) {
    if (value === 'no') return flow.results.no_portfolio;
    return buildMscResult(hist, flow);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DEBRECEN RESOLVERS
  // Reference: docs/reference/debrecen_all_program_paths_approved_logic.md
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Debrecen Foundation: HS question ───────────────────────────────
  // WHY dynamic: result includes selected program's details (fees, duration, start, notes).
  debrecen_fnd_eligible(value, hist, flow) {
    if (value === 'no') return flow.results.no_hs;
    const programId = getHistoryAnswer(hist, 'DB_FND_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);
    const notes = [
      'الطالب مؤهل — نجمع أوراقه ويعبّي فورم التقديم ونقدمها للجامعة.',
      program ? `البرنامج: ${program.label}` : '',
      program ? `البدء: ${program.start}` : '',
      program ? `المدة: ${program.duration}` : '',
      program ? `الرسوم: ${program.fee}` : '',
      program && program.note ? `ℹ️ ${program.note}` : '',
      program && program.link ? `🔗 ${program.link}` : '',
      flow.fee_note
    ].filter(Boolean);
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${program ? program.label : 'فاونديشن'}`,
      message: 'الطالب يستوفي شروط القبول في البرنامج التحضيري بجامعة ديبريسن.',
      notes
    };
  },

  // ─── Debrecen Bachelor: HS question → route to exam ─────────────────
  // WHY dynamic: after HS=yes, must route to the specific exam question
  // matching the selected program's exam_type (17 different exams).
  debrecen_bsc_hs(value, hist, flow) {
    if (value === 'no') return flow.results.no_hs;
    // Route to the single exam question (text is overridden dynamically in showQuestion)
    return '__next:DB_BSC_EXAM';
  },

  // ─── Debrecen Bachelor: Exam question result ────────────────────────
  // WHY dynamic: result includes selected program's details (fees, duration, link).
  debrecen_bsc_exam(value, hist, flow) {
    if (value === 'no') return flow.results.no_exam;
    const programId = getHistoryAnswer(hist, 'DB_BSC_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);
    const notes = [
      'الطالب مؤهل — ابحث عن سعر البرنامج في السيلز فورس.',
      program ? `التخصص: ${program.label}` : '',
      program ? `الرسوم: ${program.fee}` : '',
      program ? `المدة: ${program.duration}` : '',
      program && program.link ? `🔗 ${program.link}` : '',
      flow.lang_note,
      flow.fee_note
    ].filter(Boolean);
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${program ? program.label : 'بكالوريوس'}`,
      message: 'الطالب يستوفي شروط القبول في جامعة ديبريسن.',
      notes
    };
  },

  // ─── Debrecen Master: IELTS question ────────────────────────────────
  // WHY dynamic: IELTS requirement varies per program (5.5, 6, 7, or interview).
  // One program (العمل الاجتماعي والاقتصاد الاجتماعي) uses interview assessment
  // instead of IELTS — both answers lead to eligible for that program.
  debrecen_msc_ielts(value, hist, flow) {
    const programId = getHistoryAnswer(hist, 'DB_MSC_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);

    // Special case: interview-based language assessment
    if (program && program.ielts === 'interview') {
      const notes = [
        'الطالب مؤهل — ابحث عن سعر البرنامج في السيلز فورس.',
        `التخصص: ${program.label}`,
        `الرسوم: ${program.fee}`,
        `المدة: ${program.duration}`,
        'ℹ️ هذا البرنامج لا يتطلب شهادة IELTS — يتم تقييم اللغة خلال مقابلة القبول.',
        program.link ? `🔗 ${program.link}` : '',
        flow.fee_note
      ].filter(Boolean);
      return {
        status: 'positive',
        title: `مؤهل للتقديم — ${program.label}`,
        message: 'الطالب مؤهل للتقديم — يتم تقييم اللغة خلال مقابلة القبول.',
        notes
      };
    }

    if (value === 'no') {
      const ieltsScore = program ? program.ielts : '6';
      return {
        status: 'negative',
        title: 'غير مؤهل حالياً — يحتاج شهادة IELTS',
        message: `الطالب يحتاج شهادة IELTS بدرجة ${ieltsScore} على الأقل للتقديم على هذا التخصص.`,
        notes: [
          program ? `التخصص: ${program.label}` : '',
          `الدرجة المطلوبة: IELTS ${ieltsScore}`,
          flow.fee_note
        ].filter(Boolean)
      };
    }

    // Yes → eligible
    const notes = [
      'الطالب مؤهل — ابحث عن سعر البرنامج في السيلز فورس.',
      program ? `التخصص: ${program.label}` : '',
      program ? `الرسوم: ${program.fee}` : '',
      program ? `المدة: ${program.duration}` : '',
      program && program.link ? `🔗 ${program.link}` : '',
      flow.fee_note
    ].filter(Boolean);
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${program ? program.label : 'ماجستير'}`,
      message: 'الطالب يستوفي شروط القبول في ماجستير جامعة ديبريسن.',
      notes
    };
  },

  // ─── Debrecen PhD: IELTS question ──────────────────────────────────
  // WHY dynamic: IELTS requirement varies per program (6, 6.5, 7.5, 8).
  // If IELTS=yes → route to research plan question.
  debrecen_phd_ielts(value, hist, flow) {
    const programId = getHistoryAnswer(hist, 'DB_PHD_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);

    if (value === 'no') {
      const ieltsScore = program ? program.ielts : '6';
      return {
        status: 'negative',
        title: 'غير مؤهل حالياً — يحتاج شهادة IELTS',
        message: `الطالب يحتاج شهادة IELTS بدرجة ${ieltsScore} على الأقل للتقديم على هذا التخصص.`,
        notes: [
          program ? `التخصص: ${program.label}` : '',
          `الدرجة المطلوبة: IELTS ${ieltsScore}`,
          flow.fee_note
        ].filter(Boolean)
      };
    }

    // Yes → ask about research plan
    return '__next:DB_PHD_RESEARCH';
  },

  // ─── Debrecen PhD: Research plan question ──────────────────────────
  // WHY dynamic: result includes program details. No plan = conditional.
  debrecen_phd_research(value, hist, flow) {
    const programId = getHistoryAnswer(hist, 'DB_PHD_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);
    const baseNotes = [
      program ? `التخصص: ${program.label}` : '',
      program ? `الرسوم: ${program.fee}` : '',
      program && program.link ? `🔗 ${program.link}` : '',
      flow.fee_note
    ].filter(Boolean);

    if (value === 'no') {
      return {
        status: 'conditional',
        title: 'مشروط — يحتاج تجهيز خطة بحث',
        message: 'الطالب يستوفي شرط اللغة لكنه يحتاج تجهيز خطة بحث قبل التقديم.',
        notes: ['يجب إعداد خطة بحث واضحة وتقديمها مع ملف التقديم.', ...baseNotes]
      };
    }

    // Yes → fully eligible
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${program ? program.label : 'دكتوراة'}`,
      message: 'الطالب يستوفي جميع شروط القبول في برنامج الدكتوراة بجامعة ديبريسن.',
      notes: ['الطالب مؤهل — ابحث عن سعر البرنامج في السيلز فورس.', ...baseNotes]
    };
  },

  // ─── Debrecen Medical: Exam subject choice ─────────────────────────
  // WHY dynamic: result includes selected medical program's details.
  // Both exam options lead to eligible (it's just which subjects the student prefers).
  debrecen_med_result(value, hist, flow) {
    const programId = getHistoryAnswer(hist, 'DB_MED_PROGRAM');
    const program = flow.program_select.programs.find(p => p.id === programId);
    const examLabel = value === 'bio_phys'
      ? 'أحياء + فيزياء (وأساسيات كيمياء)'
      : 'أحياء + كيمياء (وأساسيات فيزياء)';
    const notes = [
      'الطالب مؤهل للتقديم — نجمع أوراقه ويعبّي فورم التقديم ونقدمها للجامعة.',
      program ? `البرنامج: ${program.label}` : '',
      program ? `الرسوم: ${program.fee}` : '',
      `مواد الامتحان: ${examLabel}`,
      program && program.link ? `🔗 ${program.link}` : '',
      flow.fee_note
    ].filter(Boolean);
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${program ? program.label : 'طبيات'}`,
      message: 'الطالب مؤهل للتقديم على البرنامج الطبي في جامعة ديبريسن.',
      notes
    };
  }
};

// ─── SRH result builders ────────────────────────────────────────────────
// WHY separate: these combine selected program details with the base result
// to produce the final output. Called from multiple resolver paths.

function buildBscResult() {
  const prog = selectedProgram_srh;
  const notes = [
    'الطالب مؤهل — تواصل معه لتجهيز ملف التقديم.',
    prog ? prog.details : ''
  ].filter(Boolean);
  return {
    status: 'positive',
    title: `مؤهل للتقديم — ${prog ? prog.label : 'بكالوريوس'}`,
    message: 'الطالب يستوفي جميع شروط القبول في جامعة SRH.',
    notes
  };
}

function buildMscResult(hist, flow) {
  const prog = selectedProgram_srh;
  const ectsAnswer = getHistoryAnswer(hist, 'SRH_MSC_ECTS');
  const notes = [
    'الطالب مؤهل — تواصل معه لتجهيز ملف التقديم.',
    prog ? prog.details : ''
  ].filter(Boolean);
  // Add ECTS note
  if (flow.ects_notes && ectsAnswer && flow.ects_notes[ectsAnswer]) {
    notes.push(flow.ects_notes[ectsAnswer]);
  }
  return {
    status: 'positive',
    title: `مؤهل للتقديم — ${prog ? prog.label : 'ماجستير'}`,
    message: 'الطالب يستوفي جميع شروط القبول في ماجستير جامعة SRH.',
    notes
  };
}

// Helper: resolve dynamic question text from selected program's IELTS score.
// WHY: Debrecen master/PhD have per-program IELTS requirements (5.5–8 or interview).
// The flow JSON question has dynamic_text_from_program with a template like
// "هل لدى الطالب شهادة IELTS بدرجة {ielts} أو أعلى؟"
// and optionally an interview_text for programs that use interview instead of IELTS.
function resolveDynamicText(q, questionId) {
  const cfg = q.dynamic_text_from_program;
  const programId = getHistoryAnswer(history, cfg.program_question);
  const program = currentFlow.program_select.programs.find(p => p.id === programId);
  if (program && program.ielts === 'interview' && cfg.interview_text) {
    return cfg.interview_text;
  }
  if (program && program.ielts) {
    return cfg.template.replace('{ielts}', program.ielts);
  }
  return q.text; // fallback to static text
}

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
    // At first question — go back to faculty selector, certificate selector, or program selector
    if (currentFlow && currentFlow.faculty_select && selectedProgram_srh) {
      showFacultyProgramSelector(selectedFaculty);
    } else if (currentFlow && currentFlow.faculty_select) {
      showFacultySelector();
    } else if (selectedProgram && selectedProgram.certificates) {
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
