// Client-side JS for the admission eligibility prototype.

const form = document.getElementById('evalForm');
const resultDiv = document.getElementById('result');
const evalBtn = document.getElementById('evalBtn');
const hasSkSelect = document.getElementById('hasStudienkolleg');
const skTrackSelect = document.getElementById('skTrack');

// Enable/disable Studienkolleg track based on selection
hasSkSelect.addEventListener('change', () => {
  skTrackSelect.disabled = hasSkSelect.value === 'no';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  evalBtn.disabled = true;
  evalBtn.textContent = 'Evaluating...';
  resultDiv.innerHTML = '';

  try {
    const applicant = buildApplicant();
    const res = await fetch('/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applicant)
    });
    const result = await res.json();

    if (result.error) {
      resultDiv.innerHTML = `<div class="error-box">Error: ${escapeHtml(result.error)}</div>`;
    } else {
      resultDiv.innerHTML = renderResult(result);
    }
  } catch (err) {
    resultDiv.innerHTML = `<div class="error-box">Request failed: ${escapeHtml(err.message)}</div>`;
  } finally {
    evalBtn.disabled = false;
    evalBtn.textContent = 'Evaluate Eligibility';
  }
});

function buildApplicant() {
  const nationality = document.getElementById('nationality').value;
  const dob = document.getElementById('dob').value;
  const certCountry = document.getElementById('certCountry').value;
  const certType = document.getElementById('certType').value;
  const gradStatus = document.getElementById('gradStatus').value;
  const gradYear = parseInt(document.getElementById('gradYear').value, 10);
  const gradingSystem = document.getElementById('gradingSystem').value;
  const gradeValue = parseFloat(document.getElementById('gradeValue').value);
  const subjects = document.getElementById('subjects').value
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const hasStudienkolleg = document.getElementById('hasStudienkolleg').value === 'yes';
  const skTrack = document.getElementById('skTrack').value;

  const langTestType = document.getElementById('langTestType').value;
  const langScore = parseFloat(document.getElementById('langScore').value);
  const langTestDate = document.getElementById('langTestDate').value;
  const langCertStatus = document.getElementById('langCertStatus').value;

  // Build education_history
  const educationHistory = [];

  // Secondary education entry
  const secondary = {
    entry_id: 'edu_secondary',
    qualification_level: 'secondary',
    certificate_type: certType,
    certificate_country: certCountry,
    graduation_status: gradStatus,
    graduation_year: gradYear,
    subjects,
    documents: {
      transcript_status: 'provided',
      certificate_status: 'provided',
      translation_status: 'provided',
      apostille_status: 'provided'
    }
  };

  // Add grading if a system is selected
  if (gradingSystem && !isNaN(gradeValue)) {
    const scaleMax = {
      gpa_4: 4.0, gpa_5: 5.0, percentage: 100,
      german_1_to_6: 6, ib_points: 45, french_20: 20
    };
    secondary.grading = {
      system: gradingSystem,
      value: gradeValue,
      scale_max: scaleMax[gradingSystem] || null
    };
  }

  educationHistory.push(secondary);

  // Studienkolleg entry (if completed)
  if (hasStudienkolleg) {
    educationHistory.push({
      entry_id: 'edu_studienkolleg',
      qualification_level: 'studienkolleg',
      certificate_type: 'Studienkolleg Certificate',
      certificate_country: 'DE',
      graduation_status: 'completed',
      graduation_year: gradYear + 1,
      studienkolleg_track: skTrack,
      documents: {
        transcript_status: 'provided',
        certificate_status: 'provided',
        translation_status: 'not_applicable',
        apostille_status: 'not_applicable'
      }
    });
  }

  // Build language_proficiency
  const languageProficiency = [];
  if (langTestType && !isNaN(langScore)) {
    languageProficiency.push({
      language: 'english',
      test_type: langTestType,
      overall_score: langScore,
      test_date: langTestDate || null,
      certificate_status: langCertStatus
    });
  }

  return {
    applicant_id: 'prototype_test',
    personal_info: {
      nationality,
      date_of_birth: dob
    },
    education_history: educationHistory,
    language_proficiency: languageProficiency
  };
}

function renderResult(result) {
  const verdictClass = `verdict-${result.overall_verdict}`;
  const verdictLabels = {
    eligible: 'Eligible',
    not_eligible: 'Not Eligible',
    conditional: 'Conditional',
    needs_review: 'Needs Review',
    insufficient_data: 'Insufficient Data'
  };

  let html = `<div class="verdict-box ${verdictClass}">`;
  html += `<div class="verdict-label">${verdictLabels[result.overall_verdict] || result.overall_verdict}</div>`;
  html += `<div class="confidence">Confidence: ${result.confidence.level}`;
  if (result.confidence.factors.length > 0) {
    html += ` (${result.confidence.factors.join(', ')})`;
  }
  html += `</div></div>`;

  // Rule results
  html += `<div class="section"><h3>Rule Results</h3><ul>`;
  for (const r of result.rule_results) {
    const cls = r.status === 'passed' ? 'rule-passed'
      : r.status === 'failed' ? 'rule-failed'
      : r.status.startsWith('skipped') ? 'rule-skipped'
      : 'rule-exception';
    html += `<li class="${cls}"><strong>${escapeHtml(r.rule_id)}</strong>: ${escapeHtml(r.status)}`;
    if (r.message) html += ` &mdash; ${escapeHtml(r.message)}`;
    if (r.exception_applied) html += ` (exception: ${escapeHtml(r.exception_applied)})`;
    html += `</li>`;
  }
  html += `</ul></div>`;

  // Conditions to meet
  if (result.conditions_to_meet && result.conditions_to_meet.length > 0) {
    html += `<div class="section"><h3>Conditions to Meet</h3><ul>`;
    for (const c of result.conditions_to_meet) {
      html += `<li><strong>${escapeHtml(c.category)}</strong>: ${escapeHtml(c.description)}</li>`;
    }
    html += `</ul></div>`;
  }

  // Missing information
  if (result.missing_information && result.missing_information.length > 0) {
    html += `<div class="section"><h3>Missing Information</h3><ul>`;
    for (const m of result.missing_information) {
      html += `<li><strong>${escapeHtml(m.field)}</strong>: ${escapeHtml(m.description)} (${escapeHtml(m.impact)})</li>`;
    }
    html += `</ul></div>`;
  }

  // Advisory notes
  if (result.advisory_notes && result.advisory_notes.length > 0) {
    html += `<div class="section"><h3>Advisory Notes</h3><ul>`;
    for (const n of result.advisory_notes) {
      html += `<li><strong>${escapeHtml(n.title)}</strong>: ${escapeHtml(n.message)}</li>`;
    }
    html += `</ul></div>`;
  }

  return html;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
