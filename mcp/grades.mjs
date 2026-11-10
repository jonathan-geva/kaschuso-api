import { createHash } from 'node:crypto';

const text = (value, max = 200) => value == null || value === '' ? null : String(value).slice(0, max);
const reference = subject => `sub_${createHash('sha256').update(JSON.stringify([subject.class, subject.name])).digest('hex').slice(0, 24)}`;
const basic = subject => ({ reference: reference(subject), name: text(subject.name), portalAverage: text(subject.average, 32), assessmentCount: subject.grades?.length || 0 });

export function numberValue(value) {
  const raw = String(value ?? '').trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const number = Number(raw.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function swissDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

export function gradeOverview(subjects) {
  return { source: 'current_school_grades', subjects: subjects.slice(0, 200).map(basic), truncated: subjects.length > 200 };
}

function select(subjects, value) {
  const matches = subjects.filter(subject => reference(subject) === value || subject.name?.trim().toLocaleLowerCase() === String(value).trim().toLocaleLowerCase());
  if (matches.length !== 1) return { error: matches.length ? 'AMBIGUOUS_SUBJECT' : 'SUBJECT_NOT_FOUND', choices: matches.length ? matches.map(basic) : gradeOverview(subjects).subjects };
  return { subject: matches[0] };
}

export function subjectGrades(subjects, { subject: value, offset = 0, limit = 50 }) {
  const selected = select(subjects, value);
  if (selected.error) return selected;
  const subject = selected.subject;
  const grades = subject.grades || [];
  return {
    ...basic(subject), source: 'current_school_grades',
    grades: grades.slice(offset, offset + limit).map(grade => ({
      date: text(grade.date, 32), dateISO: swissDate(grade.date), name: text(grade.name),
      value: text(grade.value, 32), numericValue: numberValue(grade.value),
      points: text(grade.points, 32), weighting: text(grade.weighting, 32), weight: numberValue(grade.weighting),
      classAverage: text(grade.average, 32),
    })),
    nextOffset: offset + limit < grades.length ? offset + limit : null,
  };
}

export function projectGrade(subjects, { subject: value, targetAverage, nextWeight }) {
  if (!Number.isFinite(targetAverage) || targetAverage < 1 || targetAverage > 6 || !Number.isFinite(nextWeight) || nextWeight <= 0 || nextWeight > 10000) return { error: 'INVALID_PROJECTION' };
  const selected = select(subjects, value);
  if (selected.error) return selected;
  let sum = 0;
  let weight = 0;
  let excludedZeroWeight = 0;
  for (const grade of selected.subject.grades || []) {
    const w = numberValue(grade.weighting);
    if (w === 0) { excludedZeroWeight++; continue; }
    const mark = numberValue(grade.value);
    if (mark === null || mark < 1 || mark > 6 || w === null || w < 0 || w > 10000) return { error: 'INCOMPLETE_GRADES', message: 'An assessment has an unsupported grade or weight. Missing weights are not assumed to be one.' };
    sum += mark * w;
    weight += w;
  }
  if (weight <= 0) return { error: 'INCOMPLETE_GRADES', message: 'No contributing assessments are available.' };
  const required = (targetAverage * (weight + nextWeight) - sum) / nextWeight;
  return {
    ...basic(selected.subject), targetAverage, nextWeight, requiredGrade: required, visibleAverage: sum / weight,
    totalExistingWeight: weight, excludedZeroWeight, achievable: required <= 6,
    minimumGradeSuffices: required <= 1, estimate: true,
    limitation: 'Uses visible assessments and an exact unrounded target. School rounding, semester weighting, promotion and compensation rules are not inferred.',
  };
}

export function unconfirmedGrades(grades, offset = 0, limit = 50, subjects = []) {
  return {
    source: 'awaiting_confirmation_feed',
    grades: grades.slice(offset, offset + limit).map(grade => {
      const matches = subjects.filter(subject => subject.class === grade.subject || subject.name === grade.subject);
      const matched = matches.length === 1 ? matches[0] : null;
      return { subject: matched ? text(matched.name) : null, subjectReference: matched ? reference(matched) : `feed_${createHash('sha256').update(String(grade.subject)).digest('hex').slice(0, 24)}`, name: text(grade.name), date: text(grade.date, 32), dateISO: swissDate(grade.date), value: text(grade.value, 32) };
    }),
    nextOffset: offset + limit < grades.length ? offset + limit : null,
    limitation: 'This feed shows awaiting-confirmation grades. Assessment dates do not establish upload time. Subject labels require an exact unique match; unavailable labels are not inferred.',
  };
}
