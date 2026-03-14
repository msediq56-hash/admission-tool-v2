// Comparison mode: evaluates a student profile against ALL university paths simultaneously.
// Uses comparison_rules from _meta.json — simple rule-based evaluation, no flow-walking.
// Each rule defines eligibility criteria at the PROGRAM TYPE level.

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────────────────────────

const CERTIFICATE_TYPES = [
  { id: 'arabic', label: 'شهادات عربية' },
  { id: 'british', label: 'شهادة بريطانية' }
];

const CATEGORY_FILTERS = [
  { id: 'foundation', label: 'فاونديشن', defaultOn: true },
  { id: 'bachelor', label: 'بكالوريوس', defaultOn: true },
  { id: 'master', label: 'ماجستير', defaultOn: false },
  { id: 'phd', label: 'دكتوراة', defaultOn: false },
  { id: 'medical', label: 'طبيات / صيدلة', defaultOn: false }
];

// ──────────────────────────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────────────────────────

let allRules = [];  // { universityId, universityLabel, countryLabel, ruleKey, rule }

const $ = id => document.getElementById(id);

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

  // Build rule catalog from metas
  for (const { uni, meta } of metas) {
    if (!meta || !meta.comparison_rules) continue;
    for (const [ruleKey, rule] of Object.entries(meta.comparison_rules)) {
      allRules.push({
        universityId: uni.id,
        universityLabel: meta.university_label,
        countryLabel: meta.country_label,
        ruleKey,
        rule
      });
    }
  }

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

  const categoryCheckboxes = CATEGORY_FILTERS.map(cat => `
    <label class="checkbox-label">
      <input type="checkbox" value="${esc(cat.id)}" ${cat.defaultOn ? 'checked' : ''}>
      <span>${esc(cat.label)}</span>
    </label>
  `).join('');

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

      <div class="form-group">
        <label>أنواع البرامج المطلوبة:</label>
        <div class="checkbox-group" id="categoryGroup">
          ${categoryCheckboxes}
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

function getSelectedCategories() {
  const checkboxes = $('categoryGroup').querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// ──────────────────────────────────────────────────────────────────────────────
// EVALUATION ENGINE — rule-based, no flow-walking
// ──────────────────────────────────────────────────────────────────────────────

function runEvaluation() {
  const profile = collectProfile();
  const selectedCategories = getSelectedCategories();
  const results = [];

  for (const entry of allRules) {
    const rule = entry.rule;

    // Filter by selected categories
    if (!selectedCategories.includes(rule.category)) continue;

    // Filter by certificate type
    if (rule.cert_type !== 'any' && rule.cert_type !== profile.certificateType) continue;

    const evalResult = evaluateRule(rule, profile);
    results.push({
      universityId: entry.universityId,
      universityLabel: entry.universityLabel,
      countryLabel: entry.countryLabel,
      ruleKey: entry.ruleKey,
      label: rule.label,
      category: rule.category,
      eligibleNote: rule.eligible_note || null,
      ...evalResult
    });
  }

  renderResults(results);
}

function evaluateRule(rule, profile) {
  // 1. Check hard requirements
  if (rule.requires_hs && !profile.hasHighSchool) {
    return { status: 'negative', reason: 'لا يملك شهادة ثانوية' };
  }
  if (rule.requires_bachelor && !profile.hasBachelor) {
    return { status: 'negative', reason: 'لا يملك شهادة بكالوريوس' };
  }

  // 2. Check IELTS minimum
  if (rule.ielts_min && profile.ielts !== null && profile.ielts < rule.ielts_min) {
    // Check conditional IELTS range (e.g., SRH master: 5.5-6.4 → pre-master)
    if (rule.ielts_conditional_min && profile.ielts >= rule.ielts_conditional_min) {
      return {
        status: 'conditional',
        reason: rule.conditions_text.ielts_mid || `مستوى IELTS أقل من المطلوب (${rule.ielts_min})`
      };
    }
    return {
      status: 'negative',
      reason: `مستوى IELTS أقل من المطلوب (${rule.ielts_min})`
    };
  }

  // 3. Check IELTS max (for IEF — student's IELTS too high for this program)
  if (rule.ielts_max && profile.ielts !== null && profile.ielts > rule.ielts_max) {
    if (profile.ielts >= 6.5) {
      return {
        status: 'conditional',
        reason: rule.conditions_text.ielts_too_high_65 || 'مستوى اللغة يؤهل للبكالوريوس المباشر'
      };
    }
    return {
      status: 'conditional',
      reason: rule.conditions_text.ielts_too_high_5 || 'مستوى اللغة أعلى من هذا البرنامج'
    };
  }

  // 4. Collect conditions and notes
  const conditions = [];
  const notes = [];

  // SAT check
  if (rule.sat_required) {
    const hasSatOk = profile.hasSAT && profile.satScore >= 1200;
    if (!hasSatOk && rule.conditions_text.no_sat) {
      conditions.push(rule.conditions_text.no_sat);
    }
  }

  // IELTS optional note (constructor style — no IELTS = interview, not blocking)
  if (rule.ielts_min === null && (profile.ielts === null || profile.ielts < 6.5)) {
    if (rule.conditions_text.no_ielts) {
      notes.push(rule.conditions_text.no_ielts);
    }
  }

  // Research plan (Debrecen PhD)
  if (rule.requires_research_plan && rule.conditions_text.no_research_plan) {
    conditions.push(rule.conditions_text.no_research_plan);
  }

  // 5. Always conditional (Debrecen bachelor, medical — exam required)
  if (rule.always_conditional) {
    return {
      status: 'conditional',
      reason: rule.conditions_text.has_all || 'مشروط',
      notes
    };
  }

  // 6. Needs extra info (Constructor British paths — need A Level details)
  if (rule.needs_extra_info) {
    return {
      status: 'needs_info',
      reason: rule.extra_info_text || 'يحتاج معلومات إضافية',
      notes: conditions.concat(notes)
    };
  }

  // 7. Determine final status
  if (conditions.length > 0) {
    return {
      status: 'conditional',
      reason: conditions.join(' | '),
      notes: notes.length > 0 ? notes : undefined
    };
  }

  // Positive — eligible
  return {
    status: 'positive',
    reason: rule.conditions_text.has_all || 'مؤهل للتقديم',
    notes: notes.length > 0 ? notes : undefined
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// RENDER RESULTS
// ──────────────────────────────────────────────────────────────────────────────

function renderResults(results) {
  const groups = {
    positive: { label: '✅ مؤهل', items: [] },
    conditional: { label: '🔶 مشروط', items: [] },
    needs_info: { label: '❓ يحتاج تقييم تفصيلي', items: [] },
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
        needs_info: 'تقييم تفصيلي',
        negative: 'غير مؤهل'
      };

      // Build notes HTML
      let notesHtml = '';
      if (r.notes && r.notes.length > 0) {
        notesHtml = `<div class="result-card-notes">${r.notes.map(n => `<span class="note-item">• ${esc(n)}</span>`).join('')}</div>`;
      }

      // Eligible note (fees, etc.)
      let eligibleNoteHtml = '';
      if (r.eligibleNote) {
        eligibleNoteHtml = `<div class="result-card-eligible-note">${esc(r.eligibleNote)}</div>`;
      }

      // Detail link
      const detailLink = `<a href="/?uni=${encodeURIComponent(r.universityId)}" class="detail-link">التقييم التفصيلي →</a>`;

      html += `
        <div class="result-card status-${status}">
          <div class="result-card-header">
            <div>
              <div class="result-card-uni">${esc(r.universityLabel)} <span class="result-card-country">${esc(r.countryLabel)}</span></div>
              <div class="result-card-path">${esc(r.label)}</div>
            </div>
            <span class="result-card-badge ${badgeClass}">${badgeLabels[status]}</span>
          </div>
          <div class="result-card-reason">${esc(r.reason || '')}</div>
          ${notesHtml}
          ${eligibleNoteHtml}
          <div class="result-card-footer">${detailLink}</div>
        </div>
      `;
    }
  }

  if (results.length === 0) {
    html += '<div class="no-results">لا توجد مسارات مطابقة — تأكد من اختيار أنواع البرامج المناسبة</div>';
  }

  html += '</div>';
  $('resultsContainer').innerHTML = html;
}

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function esc(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
