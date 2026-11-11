'use strict';

const profile = require('./profiles/gibs-so-informatik-bm-2021');
const definitions = profile.subjects;
const ordinaryKeys = definitions.filter(item => item.key !== 'ida').map(item => item.key);
const inputKeys = new Set([...ordinaryKeys, 'physik', 'chemie', 'idaf', 'idpa']);
const examKeys = new Set(definitions.filter(item => item.exam).map(item => item.key).concat(['physik', 'chemie', 'idpa']));
const safeId = /^[a-zA-Z0-9_-]{1,100}$/;
const moduleKey = /^m\d{1,4}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function invalid() {
  const error = new Error('Invalid qualification scenario. Check supported fields, bounds and grades (1–6).');
  error.name = 'ValidationError';
  error.status = 400;
  throw error;
}
function gradeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 6; }
function validateScenario(input) {
  if (!isObject(input)) invalid();
  const accepted = new Set(['startYear', 'semesterOverrides', 'targets', 'examGrades', 'ukGrades', 'ipaGrade', 'confirmedCertificateGrades', 'examComponents', 'idafGroups', 'moduleSelections']);
  if (Object.keys(input).some(key => !accepted.has(key))) invalid();
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'startYear') {
      if (!Number.isInteger(value) || value < 2000 || value > 2100) invalid();
    } else if (key === 'confirmedCertificateGrades') {
      if (typeof value !== 'boolean') invalid();
    } else if (key === 'ipaGrade') {
      if (!gradeNumber(value)) invalid();
    } else if (key === 'ukGrades') {
      if (!Array.isArray(value) || value.length > 7 || !Array.from(value).every(gradeNumber)) invalid();
    } else if (key === 'semesterOverrides') {
      if (!isObject(value) || Object.keys(value).length > 16) invalid();
      for (const [id, marks] of Object.entries(value)) {
        if (!safeId.test(id) || !isObject(marks) || Object.keys(marks).length > 40) invalid();
        if (Object.entries(marks).some(([subject, mark]) => (!inputKeys.has(subject) && !moduleKey.test(subject)) || !gradeNumber(mark))) invalid();
      }
    } else if (key === 'targets' || key === 'examGrades') {
      if (!isObject(value) || Object.keys(value).length > 12) invalid();
      const allowed = key === 'targets' ? new Set(definitions.map(item => item.key)) : examKeys;
      if (Object.entries(value).some(([subject, mark]) => !allowed.has(subject) || !gradeNumber(mark))) invalid();
      if (key === 'examGrades' && Object.entries(value).some(([subject, mark]) => ['physik', 'chemie'].includes(subject) && !Number.isInteger(mark * 10))) invalid();
    } else if (key === 'examComponents') {
      if (!isObject(value) || Object.keys(value).length > 2) invalid();
      for (const [subject, marks] of Object.entries(value)) {
        if (!['deutsch', 'englisch'].includes(subject) || !Array.isArray(marks) || marks.length !== 2 || !Array.from(marks).every(gradeNumber)) invalid();
        if (input.examGrades && own(input.examGrades, subject)) invalid();
      }
    } else if (key === 'idafGroups') {
      if (!Array.isArray(value) || value.length > 2) invalid();
      const seen = new Set();
      for (const group of value) {
        if (!isObject(group) || Object.keys(group).sort().join(',') !== 'grades,semesterId' || typeof group.semesterId !== 'string' || !safeId.test(group.semesterId) || seen.has(group.semesterId) || !Array.isArray(group.grades) || group.grades.length < 2 || group.grades.length > 20 || !Array.from(group.grades).every(gradeNumber)) invalid();
        seen.add(group.semesterId);
      }
    } else if (key === 'moduleSelections') {
      if (!isObject(value) || Object.keys(value).length > 40 || Object.entries(value).some(([subject, id]) => !moduleKey.test(subject) || typeof id !== 'string' || !safeId.test(id))) invalid();
    }
    out[key] = clone(value);
  }
  return out;
}

// Small rational arithmetic layer keeps 4.25/4.35 boundaries independent of IEEE754 errors.
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function rational(n, d = 1n) { const common = gcd(n < 0 ? -n : n, d); return { n: n / common, d: d / common }; }
function fraction(value) {
  const [mantissa, exponentText] = String(value).toLowerCase().split('e');
  const exponent = Number(exponentText || 0);
  const pieces = mantissa.split('.');
  const digits = BigInt(pieces.join(''));
  const scale = (pieces[1] || '').length - exponent;
  return scale >= 0 ? rational(digits, 10n ** BigInt(scale)) : rational(digits * 10n ** BigInt(-scale));
}
function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function multiply(a, b) { return rational(a.n * b.n, a.d * b.d); }
function divide(a, divisor) { return rational(a.n, a.d * BigInt(divisor)); }
function numeric(value) { return Number(value.n) / Number(value.d); }
function roundFraction(value, factor) {
  const numerator = value.n * BigInt(factor);
  const rounded = (numerator * 2n + value.d) / (2n * value.d);
  return Number(rounded) / factor;
}
function meanFraction(values) { return divide(values.map(fraction).reduce(add, rational(0n)), values.length); }
function mean(values) { return values.length ? numeric(meanFraction(values)) : null; }
function half(value) { return roundFraction(fraction(value), 2); }
function roundedMean(values, factor = 2) { return values.length ? roundFraction(meanFraction(values), factor) : null; }
function weighted(values, weights, factor) {
  return roundFraction(values.map((value, index) => multiply(fraction(value), fraction(weights[index]))).reduce(add, rational(0n)), factor);
}
function portalGrade(value) {
  if (typeof value === 'number') return gradeNumber(value) ? value : null;
  if (typeof value !== 'string' || !/^\s*\d+(?:[.,]\d+)?\s*$/.test(value)) return null;
  const mark = Number(value.trim().replace(',', '.'));
  return gradeNumber(mark) ? mark : null;
}
function termDate(label) {
  const compact = String(label || '').trim();
  let match = compact.match(/^([12])\.\s*(\d{2}|\d{4})\/(\d{2}|\d{4})$/);
  if (match) {
    const year = Number(match[2]) + (match[2].length === 2 ? 2000 : 0);
    const next = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    return next === year + 1 ? { year, half: Number(match[1]) } : null;
  }
  match = compact.match(/^(HS|FS|Herbstsemester|Fr[üu]hlingssemester)\s+(20\d{2})$/i);
  if (match) {
    const spring = /^(FS|Fr)/i.test(match[1]);
    return { year: Number(match[2]) - (spring ? 1 : 0), half: spring ? 2 : 1 };
  }
  return null;
}
function normalizedName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/\([^)]*\)/g, ' ').replace(/[&/]/g, ' und ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function subjectKey(name, semester) {
  const norm = normalizedName(name);
  const module = norm.match(/^(?:m\s*|modul\s+)(\d{1,4})(?:\s|$)/);
  if (module) return `m${Number(module[1])}`;
  if (/^(deutsch|de)(?: bm)?$/.test(norm)) return 'deutsch';
  if (/^(franzosisch|franzoesisch|fr)(?: bm)?$/.test(norm)) return 'franzoesisch';
  if (/^(englisch|en)(?: bm)?$/.test(norm)) return 'englisch';
  if (/^mathematik (grundlagen|grundlagenfach|g)$/.test(norm)) return 'mathematikGrundlagen';
  if (/^mathematik (schwerpunkt|schwerpunktfach|s)$/.test(norm)) return 'mathematikSchwerpunkt';
  if (/^(mathematik|mathe|ma)(?: bm)?$/.test(norm) && semester) return semester <= 4 ? 'mathematikGrundlagen' : 'mathematikSchwerpunkt';
  if (/^(naturwissenschaften|nw)$/.test(norm)) return 'naturwissenschaften';
  if (/^(physik|ph)$/.test(norm)) return 'physik';
  if (/^(chemie|ch)$/.test(norm)) return 'chemie';
  if (/^(geschichte(?: und politik)?|geschichte politik|gp)$/.test(norm)) return 'geschichtePolitik';
  if (/^(wirtschaft(?: und recht)?|wirtschaft recht|wr)$/.test(norm)) return 'wirtschaftRecht';
  // Numbered portal subjects are individual IDAF performances, never certificate semester marks.
  if (/^(idaf|interdisziplinares arbeiten in den fachern) \d+ \d+$/.test(norm)) return 'idafPerformance';
  if (/^(idaf|interdisziplinares arbeiten in den fachern)$/.test(norm)) return 'idaf';
  if (/^(idpa|interdisziplinare projektarbeit)$/.test(norm)) return 'idpa';
  return null;
}
function passNumbers(marks) {
  return { average: roundedMean(marks, 10), count: marks.length, insufficientCount: marks.filter(mark => mark < 4).length, deficitPoints: numeric(marks.filter(mark => mark < 4).map(mark => fraction(4 - mark)).reduce(add, rational(0n))) };
}
function numericConditions(stats) { return stats.average >= 4 && stats.insufficientCount <= 2 && stats.deficitPoints <= 2; }
function getRules() { return clone(profile); }

function buildQualification(history, input = {}) {
  const scenario = validateScenario(input);
  const historySemesters = Array.isArray(history?.semesters) ? history.semesters.slice(0, 8) : [];
  const issues = Array.isArray(history?.issues) ? history.issues.filter(issue => typeof issue === 'string').slice(0, 30) : [];
  const bmIssues = [];
  const efzIssues = [];
  const nonempty = historySemesters.filter(term => Array.isArray(term.subjects) && term.subjects.some(subject => portalGrade(subject.average) !== null));
  const years = nonempty.map(term => termDate(term.label)?.year).filter(Number.isInteger);
  const startYear = { value: scenario.startYear ?? (years.length ? Math.min(...years) : null), source: scenario.startYear !== undefined ? 'override' : years.length ? 'inferred' : 'unknown' };
  const applicable = startYear.value !== null && startYear.value >= profile.profile.minimumStartYear && startYear.value <= profile.profile.maximumStartYear;
  if (!applicable) issues.push('Unbekannte oder nicht unterstützte Kohorte: dieses Profil gilt nur für Beginn2021–2025. Ab2026/27 gelten andere BM-Rundungsregeln. Startjahr ausdrücklich prüfen.');
  else if (startYear.source === 'inferred') issues.push('Startjahr aus frühestem nichtleerem abgerufenem Schuljahr abgeleitet; bei unvollständiger Historie ausdrücklich korrigieren.');
  issues.push(...profile.assumptions);
  if (history?.complete === false) issues.push('Die abgerufene Semesterhistorie ist unvollständig.');
  const unknownSubjects = [];
  const interdisciplinaryInputs = [];
  const bySlot = new Map();
  const moduleAttempts = new Map();
  const semesterSummaries = [];
  const knownIds = new Set(historySemesters.map(term => String(term.id)));
  const mappedId = new Map();
  const addAttempt = (key, attempt) => {
    if (!moduleAttempts.has(key)) moduleAttempts.set(key, []);
    moduleAttempts.get(key).push(attempt);
  };
  for (const term of historySemesters) {
    const id = String(term.id);
    const date = termDate(term.label);
    const semester = date && startYear.value !== null ? (date.year - startYear.value) * 2 + date.half : null;
    const validSemester = semester >= 1 && semester <= 8;
    if (validSemester) mappedId.set(id, semester);
    else if (Array.isArray(term.subjects) && term.subjects.length) issues.push('Ein Semester konnte keinem der acht Ausbildungssemester zugeordnet werden.');
    const entries = new Map();
    const performances = [];
    const bmMarks = [];
    const bfsMarks = [];
    let excludedCount = 0;
    for (const subject of Array.isArray(term.subjects) ? term.subjects : []) {
      const key = subjectKey(subject.name, validSemester ? semester : null);
      const value = portalGrade(subject.average);
      if (key === 'idafPerformance') {
        performances.push({ label: String(subject.name || '').slice(0, 160), grade: value });
        bmIssues.push('Beobachtete IDAF-Leistungswerte sind provisorisch und benötigen explizite Werk-/Semestergruppierung; sie werden nicht automatisch als Semesternoten gezählt.');
        continue;
      }
      if (!key) unknownSubjects.push({ semesterId: id, name: String(subject.name || '').slice(0, 160), value });
      const mark = { value, source: 'portal', rawValue: value };
      if (key) {
        if (entries.has(key)) { entries.set(key, { value: null, source: 'missing', rawValue: null }); bmIssues.push('Mehrere Fachwerte im selben Semester benötigen eine explizite Zuordnung.'); }
        else entries.set(key, mark);
      }
      if (key && moduleKey.test(key)) {
        addAttempt(key, { key, label: String(subject.name || key).slice(0, 160), semesterId: id, grade: value, source: 'portal' });
        if (value !== null) bfsMarks.push(value); else excludedCount++;
      }

    }
    if (validSemester) {
      if (bySlot.has(semester)) { bmIssues.push('Mehrere Portal-Semester belegen denselben Ausbildungssemesterplatz; Noten benötigen explizite Bestätigung.'); bySlot.set(semester, { id: `semester-${semester}`, entries: new Map(), ambiguous: true }); }
      else bySlot.set(semester, { id, entries });
    }
    if (performances.length) interdisciplinaryInputs.push({ semesterId: id, label: String(term.label || ''), performances });
    const promotionMarks = [];
    for (const [key, entry] of entries) {
      if (ordinaryKeys.includes(key) && key !== 'naturwissenschaften' && entry.value !== null) {
        bmMarks.push(entry.value);
        promotionMarks.push(half(entry.value));
      }
    }
    const nw = entries.get('naturwissenschaften')?.value;
    const physics = entries.get('physik')?.value;
    const chemistry = entries.get('chemie')?.value;
    let nwMark = nw ?? null;
    if (nwMark === null && validSemester && semester >= 3) {
      if (physics !== undefined && physics !== null && semester <= 4) nwMark = physics;
      if (semester >= 5 && physics != null && chemistry != null) nwMark = mean([physics, chemistry]);
    }
    if (nwMark !== null) {
      bmMarks.push(nwMark);
      promotionMarks.push(half(nwMark));
    }
    // Canonical NW counts once; source components, IDAF/IDPA and unusable records do not add subject weights.
    excludedCount = (Array.isArray(term.subjects) ? term.subjects.length : 0) - bmMarks.length - bfsMarks.length;
    const promotion = promotionMarks.length ? passNumbers(promotionMarks) : { average: null, count: 0, insufficientCount: null, deficitPoints: null };
    const missingObservedMark = [...entries].some(([key, entry]) => ordinaryKeys.includes(key) && entry.value === null);
    const missingObservedNw = (entries.has('physik') || entries.has('chemie') || entries.has('naturwissenschaften')) && nwMark === null;
    const missingScheduledMark = definitions.filter(item => item.key !== 'ida' && item.semesters.includes(semester))
      .some(item => item.key === 'naturwissenschaften' ? nwMark === null : entries.get(item.key)?.value == null);
    promotion.status = promotionMarks.length && !missingObservedMark && !missingObservedNw && !missingScheduledMark && validSemester ? numericConditions(promotion) ? 'on-track' : 'at-risk' : 'incomplete';
    promotion.provisional = true;
    semesterSummaries.push({ id, label: String(term.label || ''), bmAverage: mean(bmMarks), bfsAverage: mean(bfsMarks), bmCount: bmMarks.length, bfsCount: bfsMarks.length, excludedCount, provisional: true, promotion });
  }
  // Only portal-provided IDs or explicit bounded synthetic future slots may be overridden.
  for (const id of Object.keys(scenario.semesterOverrides || {})) {
    const synthetic = id.match(/^semester-([1-8])$/);
    if (!knownIds.has(id) && !synthetic) invalid();
    const semester = synthetic ? Number(synthetic[1]) : mappedId.get(id);
    if (!semester) invalid();
    if (!bySlot.has(semester)) bySlot.set(semester, { id, entries: new Map() });
    const target = bySlot.get(semester);
    for (const [key, value] of Object.entries(scenario.semesterOverrides[id])) {
      const definition = definitions.find(subject => subject.key === key);
      if (definition && !definition.semesters.includes(semester)) invalid();
      if (key === 'physik' && semester < 3 || key === 'chemie' && semester < 5 || key === 'idaf' && ![3, 4, 5, 6].includes(semester)) invalid();
      target.entries.set(key, { value, rawValue: value, source: 'override' });
      if (moduleKey.test(key)) {
        const attempts = moduleAttempts.get(key) || [];
        moduleAttempts.set(key, attempts.filter(attempt => attempt.semesterId !== id && attempt.semesterId !== target.id));
        addAttempt(key, { key, label: key.toUpperCase(), semesterId: target.id, grade: value, source: 'override' });
      }
    }
  }
  for (const group of scenario.idafGroups || []) {
    const synthetic = group.semesterId.match(/^semester-([1-8])$/);
    const semester = synthetic ? Number(synthetic[1]) : mappedId.get(group.semesterId);
    if (![3, 4, 5, 6].includes(semester)) invalid();
    if (!bySlot.has(semester)) bySlot.set(semester, { id: group.semesterId, entries: new Map() });
    const slot = bySlot.get(semester);
    if (slot.entries.get('idaf')?.source === 'override') invalid();
    slot.entries.set('idaf', { value: roundedMean(group.grades), rawValue: mean(group.grades), source: 'override', grouped: true });
  }
  const getMark = (semester, key) => {
    const slot = bySlot.get(semester);
    let mark = slot?.entries.get(key);
    if (key === 'naturwissenschaften' && (!mark || mark.value === null)) {
      const physics = slot?.entries.get('physik');
      const chemistry = slot?.entries.get('chemie');
      if (physics?.value != null && semester <= 4) mark = { value: physics.value, rawValue: physics.value, source: 'derived' };
      else if (semester >= 5 && physics?.value != null && chemistry?.value != null) mark = { value: mean([physics.value, chemistry.value]), rawValue: mean([physics.value, chemistry.value]), source: 'derived' };
    }
    if (key === 'idaf' && mark?.source === 'portal' && !scenario.confirmedCertificateGrades) {
      bmIssues.push('IDAF-Portalwerte benötigen bestätigte Semesternoten oder explizit gruppierte Leistungsnoten; rohe Einträge werden nicht als Semester gezählt.');
      mark = null;
    }
    return { semester, semesterId: slot?.id || `semester-${semester}`, value: mark?.value != null ? half(mark.value) : null, source: mark?.value != null ? mark.source : 'missing' };
  };
  const exams = scenario.examGrades || {};
  if (exams.naturwissenschaften !== undefined && (exams.physik !== undefined || exams.chemie !== undefined)) invalid();
  const examFor = key => {
    if (scenario.examComponents?.[key]) return roundedMean(scenario.examComponents[key]);
    if (key === 'naturwissenschaften' && (exams.physik !== undefined || exams.chemie !== undefined)) return exams.physik !== undefined && exams.chemie !== undefined ? roundFraction(divide(add(multiply(fraction(exams.physik), fraction(2)), fraction(exams.chemie)), 3), 2) : null;
    return exams[key] !== undefined ? half(exams[key]) : null;
  };
  const subjects = definitions.map(definition => {
    const idaf = definition.key === 'ida';
    const semesterGrades = definition.semesters.map(semester => getMark(semester, idaf ? 'idaf' : definition.key));
    let grades = semesterGrades.filter(mark => mark.value !== null).map(mark => mark.value);
    let missingCount = semesterGrades.length - grades.length;
    if (idaf) {
      const first = semesterGrades.filter(mark => [3, 4].includes(mark.semester) && mark.value !== null);
      const second = semesterGrades.filter(mark => [5, 6].includes(mark.semester) && mark.value !== null);
      grades = first.length === 1 && second.length === 1 ? [first[0].value, second[0].value] : [];
      missingCount = (first.length === 1 ? 0 : 1) + (second.length === 1 ? 0 : 1);
      if (first.length > 1 || second.length > 1) bmIssues.push('Mehrere IDAF-Semesternoten in derselben Werkphase: Gruppierung/Schulregel ausdrücklich bestätigen.');
    }
    let experienceGrade = missingCount === 0 && grades.length && applicable ? roundedMean(grades) : null;
    let examGrade = idaf ? examFor('idpa') : definition.exam ? examFor(definition.key) : null;
    if (idaf && examGrade === null) {
      const idpa = [...bySlot.values()].map(slot => slot.entries.get('idpa')).filter(mark => mark?.value != null && (mark.source === 'override' || scenario.confirmedCertificateGrades));
      const unique = [...new Set(idpa.map(mark => mark.value))];
      if (unique.length === 1) examGrade = half(unique[0]);
      if (unique.length > 1) bmIssues.push('Mehrere unterschiedliche IDPA-Werte: eine bestätigte Endnote eingeben.');
    }
    const finalGrade = experienceGrade === null ? null : idaf || definition.exam ? examGrade === null ? null : roundedMean([experienceGrade, examGrade]) : experienceGrade;
    const target = scenario.targets?.[definition.key] ?? null;
    const targetBasis = definition.exam && examGrade === null ? 'experience' : 'final';
    let requiredFutureAverage = null;
    let targetStatus = target === null ? 'missing-target' : 'unsupported';
    let requiredExamGrade = null;
    const explanations = ['Portalwerte und daraus halbrundete Semesternoten sind provisorisch. ERFA = halbrunder Mittelwert vollständiger Semesternoten.'];
    if (definition.key === 'naturwissenschaften') explanations.push('NW: Physik in3/4; gleicher Physik/Chemie-Mittelwert in5–8 (offengelegte lokale Prognoseannahme); Prüfung Physik:Chemie2:1, danach halbrund.');
    if (idaf) explanations.push('IDAF: eine gruppierte Semesternote in3/4 und eine in5/6. IDA = halbrunder Mittelwert von IDAF-ERFA und separater IDPA.');
    else if (definition.exam) explanations.push('Prüfung halbrund; Fach-Endnote = halbrund(50%ERFA +50%Prüfung).');
    else explanations.push('Ergänzungsfach ohne ordentliche Abschlussprüfung: Endnote = ERFA.');
    if (target !== null && applicable && !idaf) {
      const meets = experience => (definition.exam && examGrade !== null ? roundedMean([experience, examGrade]) : experience) >= target;
      if (missingCount) {
        const project = future => roundedMean([...grades, ...Array(missingCount).fill(future)]);
        // Future certificate marks are half grades; search every possible equal future mark.
        const candidates = Array.from({ length: 199 }, (_, index) => 1 + index / 2);
        const first = candidates.find(value => meets(project(value)));
        requiredFutureAverage = first ?? null;
        targetStatus = first === undefined || first > 6 ? 'impossible' : first === 1 ? 'already-reachable' : 'reachable';
      } else targetStatus = experienceGrade !== null && meets(experienceGrade) ? 'complete' : 'impossible';
      if (definition.exam && experienceGrade !== null) requiredExamGrade = Array.from({ length: 11 }, (_, index) => 1 + index / 2).find(value => roundedMean([experienceGrade, value]) >= target) ?? null;
      explanations.push(`Zielplanung: gleiche zukünftige Semesternote (equal future marks) in allen ${missingCount} fehlenden Plätzen; Suche in Halbschritten mit sämtlichen Rundungsstufen. Es gibt weitere mögliche Notenverteilungen.`);
      if (targetBasis === 'experience') explanations.push('Ohne explizite Prüfungsnote bezieht sich der errechnete Semesterbedarf nur auf das ERFA-Ziel; die Endnote hängt zusätzlich von der Prüfung ab.');
      if (targetStatus === 'impossible') explanations.push('Mit den vorhandenen Noten und höchstens6 in jedem fehlenden Platz ist das gewählte Ziel unter diesen Annahmen nicht erreichbar.');
    } else if (target !== null && idaf) explanations.push('IDAF/IDPA-Zielverteilung ohne bestätigte künftige Werkgruppen wird nicht automatisch gelöst.');
    return { key: definition.key, label: definition.label, semesterGrades, experienceGrade, examGrade, finalGrade, target, requiredFutureAverage, missingCount, explanation: explanations.join(' '), targetStatus, targetBasis, requiredExamGrade, provisional: true, stages: { semesterRounding: 'half-up to 0.5', experienceRounding: 'half-up to 0.5', examRounding: 'half-up to 0.5', finalRounding: 'half-up to 0.5' } };
  });
  const modules = [...moduleAttempts.entries()].sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))).map(([key, attempts]) => {
    const selection = scenario.moduleSelections?.[key];
    if (selection !== undefined) {
      const selected = attempts.filter(attempt => attempt.semesterId === selection);
      if (selected.length !== 1 || selected[0].grade === null) invalid();
      return { ...selected[0], source: selected[0].source === 'override' ? 'override' : 'confirmed-selection' };
    }
    const marks = [...new Set(attempts.map(attempt => attempt.grade))];
    if (marks.length === 1 && marks[0] !== null) return { ...attempts[0] };
    efzIssues.push(`Modul ${key}: unterschiedliche oder fehlende Versuchsnoten; massgeblichen Versuch ausdrücklich bestätigen.`);
    return { key, label: attempts[0].label, semesterId: null, grade: null, source: 'conflict' };
  });
  for (const key of Object.keys(scenario.moduleSelections || {})) if (!moduleAttempts.has(key)) invalid();
  const hasConflict = modules.some(module => module.grade === null);
  const moduleMarks = modules.filter(module => module.grade !== null).map(module => module.grade);
  const bfsModuleAverage = moduleMarks.length && !hasConflict ? mean(moduleMarks) : null;
  const bfsRoundedGrade = bfsModuleAverage !== null ? roundedMean(moduleMarks) : null;
  const ukGrades = scenario.ukGrades || [];
  const ukAverage = ukGrades.length ? mean(ukGrades) : null;
  const ukRoundedGrade = ukGrades.length === profile.expectedUkCount ? roundedMean(ukGrades) : null;
  const informaticsGrade = bfsRoundedGrade !== null && ukRoundedGrade !== null ? weighted([bfsRoundedGrade, ukRoundedGrade], [0.8, 0.2], 10) : null;
  const ipaGrade = scenario.ipaGrade ?? null;
  const overallEfz = informaticsGrade !== null && ipaGrade !== null ? roundedMean([informaticsGrade, ipaGrade], 10) : null;
  const completeModules = moduleMarks.length === profile.expectedModuleCount && !hasConflict;
  const completeEfz = applicable && completeModules && ukGrades.length === profile.expectedUkCount && ipaGrade !== null;
  if (!completeModules) efzIssues.push(`Nur ${moduleMarks.length} eindeutige gültige Schulmodule; ${profile.expectedModuleCount} werden in diesem Standardprofil erwartet. Modulbestand und Abschlussstatus müssen bestätigt werden.`);
  if (ukGrades.length !== profile.expectedUkCount) efzIssues.push(`${ukGrades.length} von ${profile.expectedUkCount} üK-Noten ausdrücklich eingegeben; fehlende Werte bleiben offen.`);
  if (ipaGrade === null) efzIssues.push('Bestätigte IPA-Endnote fehlt.');
  efzIssues.push('Lokale GIBS-Quelle2021 nennt BM IPA:IK50:50; andere öffentliche Schulquellen nennen4:3. Quellenkonflikt: zuständige QV-Behörde/Kohorte muss die Gewichtung bestätigen. Keine amtliche Abschlussaussage.');
  const efzStatus = completeEfz ? informaticsGrade >= 4 && ipaGrade >= 4 && overallEfz >= 4 ? 'on-track' : 'at-risk' : 'incomplete';
  const finalMarks = subjects.map(subject => subject.finalGrade);
  const completeBm = applicable && finalMarks.every(mark => mark !== null);
  const observedFinalMarks = finalMarks.filter(mark => mark !== null);
  const bmStats = observedFinalMarks.length ? passNumbers(observedFinalMarks) : { average: null, insufficientCount: null, deficitPoints: null };
  if (!completeBm) bmStats.average = null;
  if (!completeBm) bmIssues.push('BM-Endnoten unvollständig: benötigte Semesternoten, gruppierte IDAF/IDPA oder Prüfungsnoten fehlen.');
  if (efzStatus === 'incomplete') bmIssues.push('Das erforderliche EFZ ist noch unvollständig.');
  bmIssues.push('Provisorische Prognose; die BM-Erteilung setzt vollständige amtliche Noten und das EFZ voraus. Keine automatische Diplomzusage.');
  const bmStatus = !completeBm || efzStatus === 'incomplete' ? 'incomplete' : numericConditions(bmStats) && efzStatus === 'on-track' ? 'on-track' : 'at-risk';
  return {
    profile: { ...clone(profile.profile), applicable }, startYear, semesterSummaries,
    bm: { subjects, overallAverage: bmStats.average, insufficientCount: bmStats.insufficientCount, deficitPoints: bmStats.deficitPoints, status: bmStatus, issues: [...new Set(bmIssues)], completedSubjectCount: observedFinalMarks.length, expectedSubjectCount: 9 },
    efz: { modules, bfsModuleAverage, bfsRoundedGrade, ukAverage, ukRoundedGrade, informaticsGrade, ipaGrade, overallAverage: overallEfz, status: efzStatus, issues: [...new Set(efzIssues)], weighting: clone(profile.weighting), ukGrades: [...ukGrades], expectedModuleCount: profile.expectedModuleCount, expectedUkCount: profile.expectedUkCount, provisional: true },
    sources: clone(profile.sources), issues: [...new Set(issues)], unknownSubjects, interdisciplinaryInputs,
    // Legacy supplied histories may predate the service timestamp; metadata alone uses the current clock.
    retrievedAt: typeof history?.retrievedAt === 'string' && Number.isFinite(Date.parse(history.retrievedAt)) ? history.retrievedAt : new Date().toISOString(),
  };
}
module.exports = { buildQualification, validateScenario, getRules };
