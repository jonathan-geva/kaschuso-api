import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOverview, subjectGrades, projectGrade, unconfirmedGrades, swissDate, numberValue } from '../grades.mjs';

const subjects = [
  { class: 'SYNTHETIC_COURSE_A', name: 'Mathematics', average: '5,0', grades: [
    { date: '01.01.2000', name: 'Synthetic assessment A', value: '5,5', points: '18', weighting: '1', average: '4,8' },
    { date: '02.01.2000', name: 'Synthetic assessment B', value: '4', weighting: '0,5' },
  ] },
];
test('grade presentation separates source subject and exam class averages and hides course codes', () => {
  const overview = gradeOverview(subjects);
  assert.equal(overview.subjects[0].portalAverage, '5,0');
  assert.equal(JSON.stringify(overview).includes('SYNTHETIC_COURSE'), false);
  const details = subjectGrades(subjects, { subject: overview.subjects[0].reference });
  assert.equal(details.grades[0].numericValue, 5.5);
  assert.equal(details.grades[0].classAverage, '4,8');
  assert.equal(details.grades[1].classAverage, null);
  assert.equal(details.grades[0].dateISO, '2000-01-01');
  assert.equal(details.grades[1].points, null);
});
test('ambiguous subject names return choices and paging preserves access to every assessment', () => {
  const extra = { ...subjects[0], class: 'SYNTHETIC_COURSE_B' };
  assert.equal(subjectGrades([...subjects, extra], { subject: 'Mathematics' }).error, 'AMBIGUOUS_SUBJECT');
  const first = subjectGrades(subjects, { subject: 'Mathematics', limit: 1 });
  assert.equal(first.nextOffset, 1);
  assert.equal(subjectGrades(subjects, { subject: 'Mathematics', offset: 1, limit: 1 }).nextOffset, null);
});
test('Swiss dates and decimals reject unsupported and impossible representations', () => {
  assert.equal(swissDate('31.02.2000'), null);
  assert.equal(swissDate('29.02.2000'), '2000-02-29');
  assert.equal(numberValue('5,25'), 5.25);
  assert.equal(numberValue('5.2 trailing text'), null);
  assert.equal(numberValue('1/2'), null);
  assert.equal(numberValue(''), null);
});
test('projection uses visible weighted grades without portal rounding assumptions', () => {
  const result = projectGrade(subjects, { subject: 'Mathematics', targetAverage: 5, nextWeight: 1 });
  assert.equal(result.requiredGrade, 5);
  assert.equal(result.visibleAverage, 5);
  assert.equal(result.estimate, true);
  assert.equal(result.portalAverage, '5,0');
  assert.equal(projectGrade(subjects, { subject: 'Mathematics', targetAverage: 6, nextWeight: 0.1 }).achievable, false);
});
test('missing weights block exact projections and zero weights are excluded explicitly', () => {
  const missing = [{ ...subjects[0], grades: [{ value: '5', weighting: '' }] }];
  assert.equal(projectGrade(missing, { subject: 'Mathematics', targetAverage: 5, nextWeight: 1 }).error, 'INCOMPLETE_GRADES');
  const zero = [{ ...subjects[0], grades: [...subjects[0].grades, { value: 'unsupported', weighting: '0' }] }];
  assert.equal(projectGrade(zero, { subject: 'Mathematics', targetAverage: 5, nextWeight: 1 }).requiredGrade, 5);
  assert.equal(projectGrade(subjects, { subject: 'Mathematics', targetAverage: 5, nextWeight: -1 }).error, 'INVALID_PROJECTION');
});

test('unconfirmed feed does not expose raw course identifiers or invent subject matches', () => {
  const result = unconfirmedGrades([{ subject: 'SYNTHETIC_COURSE_A', name: 'Synthetic assessment', date: '01.01.2000', value: '5' }], 0, 50, subjects);
  assert.equal(result.grades[0].subject, 'Mathematics');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_COURSE'), false);
  const unknown = unconfirmedGrades([{ subject: 'SYNTHETIC_UNKNOWN', name: 'Synthetic assessment', value: '5' }]);
  assert.equal(unknown.grades[0].subject, null);
});
