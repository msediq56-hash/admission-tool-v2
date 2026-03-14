// Comparison mode: evaluates a student profile against ALL university paths simultaneously.
// Reads flow JSONs from the same /api/ endpoints as the main advisor.
// The evaluation engine walks question trees generically — no hardcoded university logic.

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────────────────────────

// Extensible certificate type list — add new types here as needed.
const CERTIFICATE_TYPES = [
  { id: 'arabic', label: 'شهادات عربية' },
  { id: 'british', label: 'شهادة بريطانية' }
];

// ──────────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────────

let allPaths = [];     // { universityId, universityLabel, countryLabel, programLabel, pathId, pathLabel, certId, flow }
let isLoading = false;

const $ = id => document.getElementById(id);
const UNANSWERABLE = Symbol('UNANSWERABLE');

// ──────────────────────────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────────────────────────

async function init() {
  const data = await fetchJSON('/api/universities');
  if (!data || !data.universities) {
    $('app').innerHTML = '<div class="loading">خطأ في تحميل البيانات</div>';
    return;
  }

  // Load all metas in parallel
  const metas = await Promise.all(
    data.universities.map(async uni => {
      const meta = await fetchJSON(`/api/${uni.id}/meta`);
      return { uni, meta };
    })
  );

  // Build path catalog from metas
  const pathCatalog = [];
  for (const { uni, meta } of metas) {
    if (!meta || !meta.programs) continue;
    for (const prog of meta.programs) {
      if (prog.placeholder) continue;

      if (prog.certificates) {
        for (const cert of prog.certificates) {
          pathCatalog.push({
            universityId: uni.id,
            universityLabel: meta.university_label,
            countryLabel: meta.country_label,
            programLabel: prog.label,
            pathId: cert.id,
            pathLabel: null, // loaded from flow
            certId: cert.id,
            certLabel: cert.label,
            flowFile: cert.id,
            flow: null
          });
        }
      } else if (prog.direct_flow) {
        pathCatalog.push({
          universityId: uni.id,
          universityLabel: meta.university_label,
          countryLabel: meta.country_label,
          programLabel: prog.label,
          pathId: prog.direct_flow,
          pathLabel: null,
          certId: null,
          certLabel: null,
          flowFile: prog.direct_flow,
          flow: null
        });
      }
    }
  }

  // Load all flows in parallel
  await Promise.all(
    pathCatalog.map(async p => {
      const flow = await fetchJSON(`/api/${p.universityId}/flow/${p.flowFile}`);
      if (flow) {
        p.flow = flow;
        p.pathLabel = flow.path_label || p.programLabel;
      }
    })
  );

  allPaths = pathCatalog.filter(p => p.flow);
  renderPage();
}

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// RENDER PAGE
// ──────────────────────────────────────────────────────────────────────────────

function renderPage() {
  const certOptions = CERTIFICATE_TYPES.map(c =>
    `<option value="${esc(c.id)}">${esc(c.label)}</option>`
  ).join('');

  $('app').innerHTML = `
    <div class="header">
      <h1>وضع المقارنة</h1>
      <p class="subtitle">أدخل بيانات الطالب لتقييم أهليته في جميع الجامعات والمسارات</p>
      <a href="/" class="nav-link">← التقييم التفصيلي</a>
    </div>

    <div class="card">
      <h2>بيانات الطالب</h2>

      <div class="form-group">
        <label>هل لدى الطالب شهادة ثانوية؟</label>
        <div class="toggle-group" id="hsGroup">
          <button class="toggle-btn active" data-value="yes" onclick="toggleBtn('hsGroup', this)">نعم</button>
          <button class="toggle-btn" data-value="no" onclick="toggleBtn('hsGroup', this)">لا</button>
        </div>
      </div>

      <div class="form-group">
        <label>نوع الشهادة</label>
        <select id="certType">${certOptions}</select>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>مستوى IELTS</label>
          <div class="toggle-group" id="ieltsToggle">
            <button class="toggle-btn active" data-value="has" onclick="toggleBtn('ieltsToggle', this); toggleIeltsInput()">يوجد</button>
            <button class="toggle-btn" data-value="none" onclick="toggleBtn('ieltsToggle', this); toggleIeltsInput()">لا يوجد</button>
          </div>
        </div>
        <div class="form-group" id="ieltsInputGroup">
          <label>الدرجة</label>
          <input type="number" id="ieltsScore" min="0" max="9" step="0.5" value="6.0">
        </div>
      </div>

      <div class="form-group">
        <label>هل لدى الطالب شهادة SAT؟</label>
        <div class="toggle-group" id="satGroup">
          <button class="toggle-btn" data-value="yes" onclick="toggleBtn('satGroup', this); toggleSatInput()">نعم</button>
          <button class="toggle-btn active" data-value="no" onclick="toggleBtn('satGroup', this); toggleSatInput()">لا</button>
        </div>
      </div>

      <div class="form-group hidden" id="satInputGroup">
        <label>درجة SAT</label>
        <input type="number" id="satScore" min="400" max="1600" step="10" value="1200">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>المعدل</label>
          <div class="toggle-group" id="gpaToggle">
            <button class="toggle-btn active" data-value="has" onclick="toggleBtn('gpaToggle', this); toggleGpaInput()">محدد</button>
            <button class="toggle-btn" data-value="none" onclick="toggleBtn('gpaToggle', this); toggleGpaInput()">غير محدد</button>
          </div>
        </div>
        <div class="form-group" id="gpaInputGroup">
          <label>النسبة المئوية</label>
          <input type="number" id="gpaScore" min="0" max="100" step="1" value="85">
        </div>
      </div>

      <div class="form-group">
        <label>هل لدى الطالب شهادة بكالوريوس؟</label>
        <div class="toggle-group" id="bachelorGroup">
          <button class="toggle-btn" data-value="yes" onclick="toggleBtn('bachelorGroup', this)">نعم</button>
          <button class="toggle-btn active" data-value="no" onclick="toggleBtn('bachelorGroup', this)">لا</button>
        </div>
      </div>

      <button class="submit-btn" id="evalBtn" onclick="runEvaluation()">تقييم الأهلية في جميع الجامعات</button>
    </div>

    <div id="resultsContainer"></div>
  `;
}

// ──────────────────────────────────────────────────────────────────────────────
// FORM HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function toggleBtn(groupId, btn) {
  const group = $(groupId);
  for (const b of group.querySelectorAll('.toggle-btn')) b.classList.remove('active');
  btn.classList.add('active');
}

function getToggleValue(groupId) {
  const active = $(groupId).querySelector('.toggle-btn.active');
  return active ? active.dataset.value : null;
}

function toggleIeltsInput() {
  const has = getToggleValue('ieltsToggle') === 'has';
  $('ieltsInputGroup').classList.toggle('hidden', !has);
}

function toggleSatInput() {
  const has = getToggleValue('satGroup') === 'yes';
  $('satInputGroup').classList.toggle('hidden', !has);
}

function toggleGpaInput() {
  const has = getToggleValue('gpaToggle') === 'has';
  $('gpaInputGroup').classList.toggle('hidden', !has);
}

function collectProfile() {
  const hasIelts = getToggleValue('ieltsToggle') === 'has';
  const hasSAT = getToggleValue('satGroup') === 'yes';
  const hasGpa = getToggleValue('gpaToggle') === 'has';

  return {
    hasHighSchool: getToggleValue('hsGroup') === 'yes',
    certificateType: $('certType').value,
    ielts: hasIelts ? parseFloat($('ieltsScore').value) : null,
    hasSAT,
    satScore: hasSAT ? parseInt($('satScore').value, 10) : null,
    gpa: hasGpa ? parseInt($('gpaScore').value, 10) : null,
    hasBachelor: getToggleValue('bachelorGroup') === 'yes'
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// EVALUATION ENGINE
// ──────────────────────────────────────────────────────────────────────────────

function runEvaluation() {
  const profile = collectProfile();
  const results = [];

  for (const p of allPaths) {
    // Filter by certificate type: if path has a certId, only evaluate matching cert
    if (p.certId) {
      const certMatch = matchCertificate(p.certId, profile.certificateType);
      if (!certMatch) continue;
    }

    const evalResult = evaluateFlow(p.flow, profile);
    results.push({
      universityLabel: p.universityLabel,
      countryLabel: p.countryLabel,
      programLabel: p.programLabel,
      pathLabel: p.pathLabel,
      ...evalResult
    });
  }

  renderResults(results);
}

// Map certId from _meta.json to profile certificateType.
// Only filter when the certId explicitly indicates a certificate type (contains 'arabic' or 'british').
// SRH foundation cert IDs (ief, foundation_business, etc.) are program-type names,
// not certificate-type names — they apply to all students regardless of cert type.
function matchCertificate(certId, profileCertType) {
  const isCertSpecific = certId.includes('arabic') || certId.includes('british');
  if (!isCertSpecific) return true; // not cert-type-specific → include for all
  if (profileCertType === 'british') return certId.includes('british');
  if (profileCertType === 'arabic') return certId.includes('arabic');
  return true;
}

function evaluateFlow(flow, profile) {
  // Flows with faculty_select require faculty/program selection — cannot evaluate
  if (flow.faculty_select) {
    return {
      status: 'needs_info',
      reason: 'يحتاج اختيار الكلية والتخصص أولاً'
    };
  }

  const history = [];
  let questionId = flow.first_question;
  let safetyCounter = 0;

  while (questionId && safetyCounter < 50) {
    safetyCounter++;
    const q = flow.questions[questionId];
    if (!q) {
      return { status: 'needs_info', reason: `سؤال غير موجود: ${questionId}` };
    }

    // Try to answer this question from the profile
    const answer = tryAnswer(q, questionId, profile, history, flow);

    if (answer === UNANSWERABLE) {
      return { status: 'needs_info', reason: q.text };
    }

    history.push({ questionId, answer: answer.value, answerLabel: answer.label });

    // Determine next step
    const next = resolveNext(q, answer, history, flow);

    if (next.type === 'result') {
      return {
        status: next.result.status,
        reason: next.result.title || next.result.message,
        result: next.result
      };
    } else if (next.type === 'next') {
      questionId = next.questionId;
    } else {
      return { status: 'needs_info', reason: 'لم يتم تحديد الخطوة التالية' };
    }
  }

  return { status: 'needs_info', reason: 'تدفق غير مكتمل' };
}

// ──────────────────────────────────────────────────────────────────────────────
// QUESTION ANSWERING — maps profile fields to question answers
// ──────────────────────────────────────────────────────────────────────────────

function tryAnswer(q, questionId, profile, history, flow) {
  const text = q.text || '';

  // ── program_select: UNANSWERABLE ──
  if (q.type === 'program_select') return UNANSWERABLE;

  // ── major_select ──
  if (q.type === 'major_select') {
    // If branching is null or empty, all majors go to same next → skip with dummy
    if (!q.branching || Object.keys(q.branching).length === 0) {
      return { value: '__any', label: '(أي تخصص)' };
    }
    return UNANSWERABLE;
  }

  // ── yes_no questions ──
  if (q.type === 'yes_no') {
    return tryAnswerYesNo(q, questionId, text, profile, history, flow);
  }

  // ── select questions ──
  if (q.type === 'select') {
    return tryAnswerSelect(q, questionId, text, profile, history, flow);
  }

  return UNANSWERABLE;
}

function tryAnswerYesNo(q, questionId, text, profile, history, flow) {
  // High school diploma
  if (textMatches(text, ['شهادة ثانوية', '12 سنة'])) {
    const val = profile.hasHighSchool ? 'yes' : 'no';
    return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
  }

  // SAT
  if (textMatches(text, ['SAT'])) {
    const hasSatMeetsThreshold = profile.hasSAT && profile.satScore >= 1200;
    const val = hasSatMeetsThreshold ? 'yes' : 'no';
    return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
  }

  // IELTS — extract threshold from text
  if (textMatches(text, ['IELTS', 'لغة إنجليزية', 'شهادة لغة'])) {
    if (profile.ielts === null) {
      return { value: 'no', label: 'لا' };
    }
    // Try to extract specific IELTS score from text
    const match = text.match(/IELTS[^0-9]*(\d+\.?\d*)/);
    if (match) {
      const threshold = parseFloat(match[1]);
      const val = profile.ielts >= threshold ? 'yes' : 'no';
      return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
    }
    // Dynamic text from program — check if question has dynamic_text_from_program
    if (q.dynamic_text_from_program) {
      const cfg = q.dynamic_text_from_program;
      const programId = findHistoryAnswer(history, cfg.program_question);
      if (programId && flow.program_select) {
        const program = flow.program_select.programs.find(p => p.id === programId);
        if (program) {
          if (program.ielts === 'interview') {
            // Interview-based — always yes (student will attend interview)
            return { value: 'yes', label: 'نعم' };
          }
          const threshold = parseFloat(program.ielts);
          if (!isNaN(threshold)) {
            const val = profile.ielts >= threshold ? 'yes' : 'no';
            return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
          }
        }
      }
    }
    // Generic IELTS — assume 6.5 threshold (most common)
    const val = profile.ielts >= 6.5 ? 'yes' : 'no';
    return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
  }

  // Bachelor degree — "هل لدى الطالب شهادة بكالوريوس" or "هل حصل الطالب على البكالوريوس"
  if (textMatches(text, ['بكالوريوس']) && textMatches(text, ['هل لدى', 'هل حصل'])) {
    const val = profile.hasBachelor ? 'yes' : 'no';
    return { value: val, label: val === 'yes' ? 'نعم' : 'لا' };
  }

  // Portfolio, audition, exam, research plan — UNANSWERABLE
  if (textMatches(text, ['بورتفوليو', 'أوديشن', 'خبرة عملية', 'خطة بحث', 'امتحان', 'A Level', 'مواد أساسية', 'مستعد للمقابلة'])) {
    return UNANSWERABLE;
  }

  return UNANSWERABLE;
}

function tryAnswerSelect(q, questionId, text, profile, history, flow) {
  if (!q.options || q.options.length === 0) return UNANSWERABLE;

  const optionValues = q.options.map(o => o.value);

  // IELTS band select — detect by option values
  if (hasIeltsBandOptions(optionValues)) {
    if (profile.ielts === null) {
      // No IELTS — pick the lowest band or "لا يوجد" option
      const noOption = q.options.find(o =>
        o.value.includes('below') || o.value.includes('no_') || o.label.includes('لا يوجد')
      );
      if (noOption) return { value: noOption.value, label: noOption.label };
      return { value: q.options[q.options.length - 1].value, label: q.options[q.options.length - 1].label };
    }
    const matched = matchIeltsBand(profile.ielts, q.options);
    if (matched) return { value: matched.value, label: matched.label };
    return UNANSWERABLE;
  }

  // GPA tier select — detect by option values containing percentage or GPA keywords
  if (hasGpaTierOptions(optionValues)) {
    if (profile.gpa === null) {
      // No GPA — pick "other" or lowest tier
      const otherOpt = q.options.find(o => o.value === 'other' || o.value.includes('below'));
      if (otherOpt) return { value: otherOpt.value, label: otherOpt.label };
      return { value: q.options[q.options.length - 1].value, label: q.options[q.options.length - 1].label };
    }
    const matched = matchGpaTier(profile.gpa, q.options);
    if (matched) return { value: matched.value, label: matched.label };
    return UNANSWERABLE;
  }

  // SRH master IELTS (3-option: below_55, ielts_55_64, ielts_65_plus)
  if (optionValues.includes('below_55') || optionValues.includes('ielts_55_64')) {
    if (profile.ielts === null) {
      const lowest = q.options.find(o => o.value.includes('below'));
      return lowest ? { value: lowest.value, label: lowest.label } : UNANSWERABLE;
    }
    const matched = matchIeltsBand(profile.ielts, q.options);
    if (matched) return { value: matched.value, label: matched.label };
    return UNANSWERABLE;
  }

  // ECTS questions — UNANSWERABLE (not in profile)
  if (optionValues.some(v => v.includes('ects') || v.includes('180') || v.includes('210') || v.includes('240'))) {
    return UNANSWERABLE;
  }

  return UNANSWERABLE;
}

// ──────────────────────────────────────────────────────────────────────────────
// OPTION MATCHING HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function hasIeltsBandOptions(values) {
  return values.some(v => v.includes('ielts_') || v === 'below_4' || v === 'below_50' || v === 'below_55');
}

function hasGpaTierOptions(values) {
  return values.some(v => v.includes('_plus') || v.includes('below_70') || v === 'other') &&
         values.some(v => /\d+_plus/.test(v));
}

function matchIeltsBand(score, options) {
  // Define known band mappings by option value
  const bands = [
    { value: 'ielts_65_plus', min: 6.5, max: 99 },
    { value: 'ielts_5_6', min: 5.0, max: 6.4 },
    { value: 'ielts_50_64', min: 5.0, max: 6.4 },   // Constructor IFY Arabic variant
    { value: 'ielts_55_64', min: 5.5, max: 6.4 },
    { value: 'ielts_4_5', min: 4.0, max: 4.9 },
    { value: 'below_4', min: -1, max: 3.9 },
    { value: 'below_50', min: -1, max: 4.9 },        // Constructor IFY Arabic variant
    { value: 'below_55', min: -1, max: 5.4 }
  ];

  for (const band of bands) {
    const opt = options.find(o => o.value === band.value);
    if (opt && score >= band.min && score <= band.max) {
      return opt;
    }
  }

  // Fallback: try to match by checking all options
  for (const opt of options) {
    if (opt.value.includes('plus') && score >= extractNumber(opt.value)) return opt;
  }

  return null;
}

function matchGpaTier(gpa, options) {
  // Sort tiers by threshold descending — pick first one that matches
  const tiers = options
    .map(o => {
      const num = extractNumber(o.value);
      return { opt: o, threshold: num };
    })
    .filter(t => t.threshold !== null)
    .sort((a, b) => b.threshold - a.threshold);

  for (const t of tiers) {
    if (gpa >= t.threshold) return t.opt;
  }

  // Below all tiers — pick "other" or "below" option
  const fallback = options.find(o => o.value === 'other' || o.value.includes('below'));
  return fallback || options[options.length - 1];
}

function extractNumber(str) {
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ──────────────────────────────────────────────────────────────────────────────
// NEXT STEP RESOLUTION — mirrors advisor.js handleAnswer logic
// ──────────────────────────────────────────────────────────────────────────────

function resolveNext(q, answer, history, flow) {
  // Dynamic result — use comparison resolvers
  if (q.dynamic_result) {
    const resolver = COMPARE_RESOLVERS[q.dynamic_result];
    if (resolver) {
      const result = resolver(answer.value, history, flow);
      if (result === null || result === undefined) {
        return { type: 'needs_info' };
      }
      // __next: signal
      if (typeof result === 'string' && result.startsWith('__next:')) {
        return { type: 'next', questionId: result.slice(7) };
      }
      return { type: 'result', result };
    }
    // Unknown resolver — mark as needs-info
    return { type: 'needs_info' };
  }

  // Standard option routing
  if (q.options) {
    const opt = q.options.find(o => o.value === answer.value);
    if (opt) {
      if (opt.result) {
        const resultDef = flow.results[opt.result];
        if (resultDef) return { type: 'result', result: resultDef };
      }
      if (opt.next) return { type: 'next', questionId: opt.next };
    }
  }

  // Question-level next
  if (q.next) return { type: 'next', questionId: q.next };

  // major_select branching
  if (q.type === 'major_select' && q.branching) {
    // We answered with dummy — use null branching or next
    if (q.next) return { type: 'next', questionId: q.next };
  }

  return { type: 'needs_info' };
}

// ──────────────────────────────────────────────────────────────────────────────
// COMPARE RESOLVERS — subset of dynamic resolvers reachable without program selection
// ──────────────────────────────────────────────────────────────────────────────

const COMPARE_RESOLVERS = {

  // Constructor Bachelor Arabic: GPA question
  // Always positive. SAT=no → conditional.
  bachelor_arabic_gpa(gpaValue, history, flow) {
    const satAnswer = findHistoryAnswer(history, 'KO_AR_SAT');
    const langAnswer = findHistoryAnswer(history, 'KO_AR_IELTS');
    const scholarship = flow.scholarship_table ? flow.scholarship_table[gpaValue] : null;

    const notes = [];
    const conditions = [];

    if (scholarship) notes.push(scholarship.scholarship);
    if (flow.tuition_note) notes.push(flow.tuition_note);
    if (flow.gpa_warning) notes.push(flow.gpa_warning);

    if (satAnswer === 'no') {
      conditions.push({ category: 'sat', description: 'يجب تقديم شهادة SAT بدرجة 1200 أو أعلى قبل 31 ديسمبر' });
    }
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

  // Constructor IFY Arabic: Language question
  // 6-scenario matrix: [gpa][lang] → result
  ify_arabic_language(langValue, history, flow) {
    const gpaAnswer = findHistoryAnswer(history, 'KO_IFY_AR_GPA');
    const table = flow.dynamic_result_table;
    if (table && table[gpaAnswer] && table[gpaAnswer][langValue]) {
      return table[gpaAnswer][langValue];
    }
    return {
      status: 'positive',
      title: 'مؤهل للسنة التأسيسية',
      message: 'الطالب مؤهل لبرنامج السنة التأسيسية.'
    };
  },

  // Constructor Master: Language question
  // Needs program details — but if reached, produce generic result
  master_language(langValue, history, flow) {
    if (langValue === 'yes') {
      return { status: 'positive', title: 'مؤهل للتقديم', message: 'الطالب مؤهل للتقديم لبرنامج الماجستير.' };
    }
    return { status: 'positive', title: 'نمضي بالتقديم + مقابلة لغة', message: 'الطالب مؤهل مع إجراء مقابلة تقييم لغة.' };
  },

  // SRH Foundation: Language question (shared by business/creative/engineering)
  srh_foundation_language(langValue, history, flow) {
    if (langValue === 'below_4') {
      return { status: 'negative', title: 'غير مؤهل حالياً — اللغة الإنجليزية', message: 'الحد الأدنى هو IELTS 5.0 أو ما يعادله.' };
    }
    if (langValue === 'ielts_4_5') {
      return { status: 'conditional', title: 'جرّب برنامج اللغة الإنجليزية المكثف (IEF)', message: 'مستوى اللغة أقل من شرط الفاونديشن — لكنه مؤهل لبرنامج اللغة المكثف.' };
    }
    if (langValue === 'ielts_65_plus') {
      return { status: 'conditional', title: 'الطالب مؤهل للتقديم المباشر على البكالوريوس', message: 'مستوى اللغة يؤهله للتقديم مباشرة على البكالوريوس.' };
    }
    // ielts_5_6 → eligible
    return {
      status: 'positive',
      title: `مؤهل للتقديم — ${flow.path_label || 'فاونديشن'}`,
      message: 'الطالب يستوفي شروط القبول في برنامج الفاونديشن.'
    };
  },

  // SRH Pre-Master: Language question
  srh_pre_master_language(langValue, history, flow) {
    if (langValue === 'no') {
      return flow.results && flow.results.no_lang
        ? flow.results.no_lang
        : { status: 'negative', title: 'غير مؤهل — اللغة', message: 'يحتاج IELTS 5.5 على الأقل.' };
    }
    return { status: 'positive', title: 'مؤهل للتقديم — بري ماستر', message: 'الطالب يستوفي شروط القبول لبرامج بري ماستر.' };
  },

  // SRH Bachelor: Language question — without program selection, can't check portfolio/audition
  srh_bachelor_language(langValue, history, flow) {
    if (langValue === 'no') {
      return flow.results && flow.results.no_lang
        ? flow.results.no_lang
        : { status: 'negative', title: 'غير مؤهل — اللغة', message: 'يحتاج IELTS 6.5 على الأقل.' };
    }
    // Without program, can't check portfolio/audition
    return { status: 'conditional', title: 'مؤهل — يعتمد على التخصص', message: 'الطالب مؤهل لغوياً — بعض التخصصات تحتاج بورتفوليو أو أوديشن.' };
  },

  // SRH Master: Language question
  srh_master_language(langValue, history, flow) {
    if (langValue === 'below_55') {
      return flow.results && flow.results.no_lang
        ? flow.results.no_lang
        : { status: 'negative', title: 'غير مؤهل — اللغة', message: 'يحتاج IELTS 5.5 على الأقل.' };
    }
    if (langValue === 'ielts_55_64') {
      return flow.results && flow.results.try_pre_master
        ? flow.results.try_pre_master
        : { status: 'conditional', title: 'جرّب بري ماستر', message: 'مستوى اللغة أقل من 6.5 — جرّب بري ماستر.' };
    }
    // 6.5+ → eligible (without program, can't check MBA/portfolio)
    return { status: 'conditional', title: 'مؤهل — يعتمد على التخصص', message: 'الطالب مؤهل لغوياً — بعض التخصصات لها شروط إضافية.' };
  },

  // Debrecen Foundation: HS question
  debrecen_fnd_eligible(value, history, flow) {
    if (value === 'no') {
      return flow.results && flow.results.no_hs
        ? flow.results.no_hs
        : { status: 'negative', title: 'غير مؤهل', message: 'يحتاج شهادة ثانوية.' };
    }
    return { status: 'positive', title: 'مؤهل للتقديم — فاونديشن', message: 'الطالب يستوفي شروط القبول في البرنامج التحضيري.' };
  },

  // Debrecen Bachelor: HS question → would route to exam (UNANSWERABLE)
  debrecen_bsc_hs(value, history, flow) {
    if (value === 'no') {
      return flow.results && flow.results.no_hs
        ? flow.results.no_hs
        : { status: 'negative', title: 'غير مؤهل', message: 'يحتاج شهادة ثانوية.' };
    }
    // yes → routes to exam question via __next:DB_BSC_EXAM
    return '__next:DB_BSC_EXAM';
  },

  // Debrecen Bachelor: Exam question — UNANSWERABLE but resolver exists
  debrecen_bsc_exam(value, history, flow) {
    // This should not be reached since tryAnswer marks exam questions as UNANSWERABLE
    return null;
  },

  // Debrecen Master: IELTS question
  debrecen_msc_ielts(value, history, flow) {
    const programId = findHistoryAnswer(history, 'DB_MSC_PROGRAM');
    const program = flow.program_select ? flow.program_select.programs.find(p => p.id === programId) : null;

    if (program && program.ielts === 'interview') {
      return { status: 'positive', title: `مؤهل — ${program.label}`, message: 'يتم تقييم اللغة خلال مقابلة القبول.' };
    }

    if (value === 'no') {
      const score = program ? program.ielts : '6';
      return { status: 'negative', title: 'غير مؤهل — يحتاج IELTS', message: `يحتاج IELTS بدرجة ${score} على الأقل.` };
    }

    return { status: 'positive', title: 'مؤهل للتقديم — ماجستير', message: 'الطالب يستوفي شروط القبول.' };
  },

  // Debrecen PhD: IELTS → routes to research plan
  debrecen_phd_ielts(value, history, flow) {
    if (value === 'no') {
      const programId = findHistoryAnswer(history, 'DB_PHD_PROGRAM');
      const program = flow.program_select ? flow.program_select.programs.find(p => p.id === programId) : null;
      const score = program ? program.ielts : '6';
      return { status: 'negative', title: 'غير مؤهل — يحتاج IELTS', message: `يحتاج IELTS بدرجة ${score} على الأقل.` };
    }
    return '__next:DB_PHD_RESEARCH';
  },

  // Debrecen PhD: Research plan
  debrecen_phd_research(value, history, flow) {
    if (value === 'no') {
      return { status: 'conditional', title: 'مشروط — يحتاج تجهيز خطة بحث', message: 'يحتاج تجهيز خطة بحث قبل التقديم.' };
    }
    return { status: 'positive', title: 'مؤهل للتقديم — دكتوراة', message: 'الطالب يستوفي جميع شروط القبول.' };
  },

  // Debrecen Medical: Exam result
  debrecen_med_result(value, history, flow) {
    return { status: 'positive', title: 'مؤهل للتقديم — طبيات', message: 'الطالب مؤهل للتقديم على البرنامج الطبي.' };
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function findHistoryAnswer(history, questionId) {
  const entry = history.find(h => h.questionId === questionId);
  return entry ? entry.answer : null;
}

function textMatches(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

function esc(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// RENDER RESULTS
// ──────────────────────────────────────────────────────────────────────────────

function renderResults(results) {
  const groups = {
    positive: { label: '✅ مؤهل', items: [] },
    conditional: { label: '🔶 مشروط', items: [] },
    needs_info: { label: '❓ يحتاج معلومات إضافية', items: [] },
    negative: { label: '❌ غير مؤهل', items: [] }
  };

  for (const r of results) {
    const key = groups[r.status] ? r.status : 'needs_info';
    groups[key].items.push(r);
  }

  let html = '<div class="results-section">';

  for (const [status, group] of Object.entries(groups)) {
    if (group.items.length === 0) continue;

    html += `
      <div class="section-header">
        <span>${group.label}</span>
        <span class="section-count">${group.items.length}</span>
      </div>
    `;

    for (const r of group.items) {
      const badgeClass = `badge-${status}`;
      const badgeLabels = {
        positive: 'مؤهل',
        conditional: 'مشروط',
        needs_info: 'معلومات ناقصة',
        negative: 'غير مؤهل'
      };

      html += `
        <div class="result-card status-${status}">
          <div class="result-card-header">
            <div>
              <div class="result-card-uni">${esc(r.universityLabel)}</div>
              <div class="result-card-path">${esc(r.programLabel)} — ${esc(r.pathLabel)}</div>
            </div>
            <span class="result-card-badge ${badgeClass}">${badgeLabels[status]}</span>
          </div>
          <div class="result-card-reason">${esc(r.reason || '')}</div>
        </div>
      `;
    }
  }

  if (results.length === 0) {
    html += '<div class="no-results">لا توجد مسارات مطابقة لنوع الشهادة المحدد</div>';
  }

  html += '</div>';
  $('resultsContainer').innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
