const { buildQualification, validateScenario, getRules } = require('./index');

const subject = (name, average, grades = []) => ({ name, average, grades });
const term = (semester, subjects, start = 2023) => ({ id: `s${semester}`, label: `${semester % 2 ? 1 : 2}.${String(start + Math.floor((semester - 1) / 2)).slice(-2)}/${String(start + 1 + Math.floor((semester - 1) / 2)).slice(-2)}`, subjects });
const history = (...semesters) => ({ semesters, complete: true, issues: [], retrievedAt: '2026-11-10T00:00:00Z' });

test('missing scheduled BM subjects prevent a partial semester promotion from being on track', () => {
  const partial = buildQualification(history(term(1, [subject('Deutsch', 5)])), { startYear: 2023 });
  expect(partial.semesterSummaries[0].promotion.status).toBe('incomplete');
  const complete = buildQualification(history(term(1, [subject('Deutsch', 5), subject('Französisch', 4), subject('Englisch', 4), subject('Mathematik Grundlagen', 4), subject('Geschichte und Politik', 4)])), { startYear: 2023 });
  expect(complete.semesterSummaries[0].promotion.status).toBe('on-track');
});
const row = (result, key) => result.bm.subjects.find(item => item.key === key);
const completeHistory = (grade = 4) => history(...Array.from({ length: 8 }, (_, index) => {
  const semester = index + 1;
  return term(semester, [subject('Deutsch', grade), subject('Englisch', grade),
    ...(semester <= 6 ? [subject('Französisch', grade)] : []),
    subject('Mathematik', grade),
    ...(semester <= 4 ? [subject('Geschichte und Politik', grade)] : []),
    ...(semester >= 3 ? [subject('Physik', grade), subject('Wirtschaft und Recht', grade)] : []),
    ...(semester >= 5 ? [subject('Chemie', grade)] : []),
    ...Array.from({ length: 3 }, (_, module) => subject(`M${100 + index * 3 + module}`, grade))]);
}));

describe('public scoped qualification profile', () => {
  test('keeps public versioned rules separate from account data', () => {
    const rules = getRules();
    expect(rules.profile.id).toBe('gibs-so-informatik-bm-2021');
    expect(rules.sources.some(source => source.url.endsWith('/QV-Informatiker.pdf'))).toBe(true);
    rules.profile.name = 'mutated';
    expect(getRules().profile.name).not.toBe('mutated');
  });
  test('strict scenario validation bounds maps, unknown fields and decimal exam components', () => {
    expect(validateScenario({ startYear: 2023, examComponents: { deutsch: [4.1, 4.4] } })).toEqual({ startYear: 2023, examComponents: { deutsch: [4.1, 4.4] } });
    for (const invalid of [{ password: 'x' }, { targets: { unknown: 4 } }, { ipaGrade: 0 }, { ipaGrade: NaN }, { ipaGrade: '4' }, { startYear: 2023.5 }, { ukGrades: Array(8).fill(4) }, { examComponents: { deutsch: [4] } }, { semesterOverrides: { s1: { deutsch: 7 } } }, { moduleSelections: { m100: '' } }]) {
      expect(() => validateScenario(invalid)).toThrow(expect.objectContaining({ name: 'ValidationError', status: 400 }));
    }
  });
  test('does not mutate its history or scenario inputs', () => {
    const input = history(term(1, [subject('Deutsch', '4,25')]));
    const copy = JSON.stringify(input);
    buildQualification(input, { targets: { deutsch: 4 } });
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe('history interpretation and provenance', () => {
  test('parses only finite Swiss grades, separates BM/BFS and preserves unknowns', () => {
    const result = buildQualification(history(term(1, [subject('Deutsch', '4,25'), subject('Englisch', 0), subject('Französisch', null), subject('M100', '5.25'), subject('IDAF', 6), subject('Sport', 6), subject('M101', '5x'), subject('M102', 6.1)])));
    expect(result.semesterSummaries[0]).toMatchObject({ bmAverage: 4.25, bfsAverage: 5.25, bmCount: 1, bfsCount: 1, excludedCount: 6, provisional: true });
    expect(row(result, 'deutsch').semesterGrades[0]).toMatchObject({ semester: 1, value: 4.5, source: 'portal' });
    expect(result.unknownSubjects).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Sport' })]));
    expect(result.bm.overallAverage).toBeNull();
    expect(result.bm.status).toBe('incomplete');
  });
  test('infers start from nonempty terms only and lets explicit start shift semester mapping', () => {
    const empty = term(1, [], 2021);
    const result = buildQualification(history(empty, term(1, [subject('Deutsch', 4)], 2023)));
    expect(result.startYear).toEqual({ value: 2023, source: 'inferred' });
    expect(row(result, 'deutsch').semesterGrades[0].value).toBe(4);
    const shifted = buildQualification(history(term(1, [subject('Deutsch', 4)], 2023)), { startYear: 2022 });
    expect(row(shifted, 'deutsch').semesterGrades[2].value).toBe(4);
  });
  test('does not guess unrecognised labels, zero-only enrollment, or unsupported cohorts', () => {
    expect(buildQualification(history({ id: 'x', label: 'opaque', subjects: [subject('Deutsch', 4)] })).startYear.value).toBeNull();
    expect(buildQualification(history(term(1, [subject('Deutsch', 0)]))).startYear.value).toBeNull();
    const unsupported = buildQualification(completeHistory(), { startYear: 2026 });
    expect(unsupported.profile.applicable).toBe(false);
    expect(unsupported.bm.status).toBe('incomplete');
    expect(unsupported.issues.join(' ')).toMatch(/2026|cohort|Kohorte/i);
  });
  test('supports explicit future slot overrides with distinct provenance', () => {
    const result = buildQualification(history(term(1, [subject('Deutsch', 4)])), { semesterOverrides: { 'semester-2': { deutsch: 5.25 } } });
    expect(row(result, 'deutsch').semesterGrades[1]).toMatchObject({ semesterId: 'semester-2', value: 5.5, source: 'override' });
  });
});

describe('staged BM calculations', () => {
  test('rounds semester forecasts, ERFA, combined exams and subject final half up', () => {
    const result = buildQualification(completeHistory(4.25), { examComponents: { deutsch: [4.1, 4.4] }, examGrades: { mathematikGrundlagen: 4.25 } });
    expect(row(result, 'deutsch')).toMatchObject({ experienceGrade: 4.5, examGrade: 4.5, finalGrade: 4.5 });
    expect(row(result, 'mathematikGrundlagen').examGrade).toBe(4.5);
    expect(row(result, 'geschichtePolitik')).toMatchObject({ experienceGrade: 4.5, examGrade: null, finalGrade: 4.5 });
  });
  test('NW uses physics alone in3/4, both components in5–8 and2:1 exam weighting', () => {
    const result = buildQualification(history(term(3, [subject('Physik', 4)], 2022), term(5, [subject('Physik', 4), subject('Chemie', 5)], 2022)), { startYear: 2022, examGrades: { physik: 4.2, chemie: 5.1 } });
    expect(row(result, 'naturwissenschaften').semesterGrades.map(mark => mark.value)).toEqual([4, null, 4.5, null, null, null]);
    expect(row(result, 'naturwissenschaften').examGrade).toBe(4.5);
    const missing = buildQualification(history(term(5, [subject('Physik', 5)], 2022)), { startYear: 2022, examGrades: { physik: 5 } });
    expect(row(missing, 'naturwissenschaften').semesterGrades[2].value).toBeNull();
    expect(row(missing, 'naturwissenschaften').examGrade).toBeNull();
  });
  test('IDAF performance pairs form two marks, IDPA stays separate from vocational modules', () => {
    const result = buildQualification(completeHistory(), { idafGroups: [{ semesterId: 's3', grades: [4, 4.5] }, { semesterId: 's5', grades: [5, 5.5] }], examGrades: { idpa: 5 } });
    expect(row(result, 'ida')).toMatchObject({ experienceGrade: 5, examGrade: 5, finalGrade: 5 });
    expect(row(result, 'ida').semesterGrades.map(mark => mark.value)).toEqual([4.5, null, 5.5, null]);
    const unknownGrouping = buildQualification(history(term(3, [subject('IDAF', 5, [ { value: 4 }, { value: 5 }, { value: 5 }, { value: 6 } ])])));
    expect(row(unknownGrouping, 'ida').experienceGrade).toBeNull();
    expect(unknownGrouping.bm.issues.join(' ')).toMatch(/IDAF/);
    expect(unknownGrouping.efz.modules).toEqual([]);
  });
  test('nine final subjects have equal weights and complete numeric data never awards diploma', () => {
    const result = buildQualification(completeHistory(), {
      examGrades: { deutsch: 4, franzoesisch: 4, englisch: 4, mathematikGrundlagen: 4, mathematikSchwerpunkt: 4, naturwissenschaften: 4, idpa: 4 },
      idafGroups: [{ semesterId: 's3', grades: [4, 4] }, { semesterId: 's5', grades: [4, 4] }], ukGrades: Array(7).fill(4), ipaGrade: 4, confirmedCertificateGrades: true,
    });
    expect(result.bm.subjects).toHaveLength(9);
    expect(result.bm).toMatchObject({ overallAverage: 4, insufficientCount: 0, deficitPoints: 0, status: 'on-track' });
    expect(result.efz.status).not.toBe('passed');
    expect(result.efz.issues.join(' ')).toMatch(/50:50.*4:3|4:3.*50:50/);
  });
  test('promotion excludes IDAF and combines NW as one subject', () => {
    const result = buildQualification(history(term(5, [subject('Deutsch', 4), subject('Physik', 3), subject('Chemie', 5), subject('IDAF', 1)])), { startYear: 2023 });
    expect(result.semesterSummaries[0].promotion).toMatchObject({ average: 4, count: 2, insufficientCount: 0, deficitPoints: 0 });
  });
});

describe('EFZ staged module calculations', () => {
  test('deduplicates identical module IDs and excludes conflicting attempts until confirmed', () => {
    const input = history(term(1, [subject('M100 Titel', 4.25)]), term(2, [subject('Modul 100', 4.25), subject('M101', 3)]), term(3, [subject('M101', 5)]));
    const result = buildQualification(input, { ukGrades: Array(7).fill(4.25), ipaGrade: 5 });
    expect(result.efz.modules.map(module => [module.key, module.grade])).toEqual([['m100', 4.25], ['m101', null]]);
    expect(result.efz.bfsModuleAverage).toBeNull();
    expect(result.efz.issues.join(' ')).toMatch(/m101/);
    const selected = buildQualification(input, { moduleSelections: { m101: 's3' }, ukGrades: Array(7).fill(4.25), ipaGrade: 5 });
    expect(selected.efz.bfsModuleAverage).toBe(4.625);
    expect(selected.efz.bfsRoundedGrade).toBe(4.5);
    expect(selected.efz.ukRoundedGrade).toBe(4.5);
    expect(selected.efz.informaticsGrade).toBe(4.5);
    expect(selected.efz.overallAverage).toBe(4.8);
    expect(selected.efz.status).toBe('incomplete');
  });
  test('missing required üK/IPA stays null and distinguishes IK80:20 from local EFZ50:50', () => {
    const result = buildQualification(completeHistory(4), { ukGrades: Array(7).fill(5.25), ipaGrade: 5 });
    expect(result.efz).toMatchObject({ bfsRoundedGrade: 4, ukRoundedGrade: 5.5, informaticsGrade: 4.3, overallAverage: 4.7 });
    expect(buildQualification(completeHistory(), { ukGrades: [5] }).efz.informaticsGrade).toBeNull();
    expect(buildQualification(completeHistory()).efz.overallAverage).toBeNull();
  });
});

describe('target planning', () => {
  test('searches the half-grade boundary with equal future semester assumption', () => {
    const result = buildQualification(history(term(1, [subject('Geschichte und Politik', 3)])), { targets: { geschichtePolitik: 4 } });
    expect(row(result, 'geschichtePolitik')).toMatchObject({ missingCount: 3, target: 4, requiredFutureAverage: 4, targetStatus: 'reachable' });
    expect(row(result, 'geschichtePolitik').explanation).toMatch(/equal|gleich/i);
  });
  test('reports impossible and minimum-reachable outcomes without clamping away evidence', () => {
    const input = history(...[1, 2, 3].map(index => term(index, [subject('Geschichte und Politik', 1)])));
    expect(row(buildQualification(input, { targets: { geschichtePolitik: 6 } }), 'geschichtePolitik')).toMatchObject({ targetStatus: 'impossible', requiredFutureAverage: 20 });
    const high = history(...[1, 2, 3].map(index => term(index, [subject('Geschichte und Politik', 6)])));
    expect(row(buildQualification(high, { targets: { geschichtePolitik: 4 } }), 'geschichtePolitik')).toMatchObject({ requiredFutureAverage: 1, targetStatus: 'already-reachable' });
  });
  test('explicit exam input changes the staged final target threshold', () => {
    const input = history(term(1, [subject('Deutsch', 4)]));
    const withExam = row(buildQualification(input, { targets: { deutsch: 4.5 }, examGrades: { deutsch: 6 } }), 'deutsch');
    const withoutExam = row(buildQualification(input, { targets: { deutsch: 4.5 } }), 'deutsch');
    expect(withExam.requiredFutureAverage).toBeLessThan(withoutExam.requiredFutureAverage);
    expect(withExam.targetBasis).toBe('final');
    expect(withoutExam.targetBasis).toBe('experience');
  });
});


describe('incompleteness and conflicting input safeguards', () => {
  test('never presents a partial semester promotion as on-track when required observed components are missing', () => {
    const result = buildQualification(history(term(5, [subject('Deutsch', 5), subject('Physik', 5)])), { startYear: 2023 });
    expect(result.semesterSummaries[0].promotion.status).toBe('incomplete');
    const missingLanguage = buildQualification(history(term(1, [subject('Deutsch', 5), subject('Englisch', null)])));
    expect(missingLanguage.semesterSummaries[0].promotion.status).toBe('incomplete');
  });
  test('reports an insufficient known subject even while the final qualification remains incomplete', () => {
    const input = history(...[1, 2, 3, 4].map(index => term(index, [subject('Geschichte und Politik', 2.5)])));
    const result = buildQualification(input);
    expect(result.bm.status).toBe('incomplete');
    expect(result.bm.insufficientCount).toBe(1);
    expect(result.bm.deficitPoints).toBe(1.5);
  });
  test('rejects invalid future IDs, contradictory exam forms, and misplaced scenario subject marks', () => {
    for (const scenario of [
      { semesterOverrides: { unknown: { deutsch: 4 } } },
      { semesterOverrides: { 'semester-2': { chemie: 4 } } },
      { examGrades: { naturwissenschaften: 4, physik: 4 } },
      { examGrades: { physik: 4.25, chemie: 4.5 } },
      { idafGroups: [{ semesterId: 's1', grades: [4, 4] }] },
    ]) expect(() => buildQualification(history(term(1, [subject('Deutsch', 4)])), scenario)).toThrow(expect.objectContaining({ name: 'ValidationError' }));
  });
  test('an empty sparse marks array is invalid rather than a missing arithmetic value', () => {
    expect(() => validateScenario({ ukGrades: Array(7) })).toThrow();
  });
});


test('maps the portal spaced academic label and keeps a complete nine-subject equal mean', () => {
  const spaced = buildQualification(history({ id: 'spaced', label: '1. 23/24', subjects: [subject('Deutsch', 4.25)] }));
  expect(spaced.startYear.value).toBe(2023);
  expect(row(spaced, 'deutsch').semesterGrades[0].value).toBe(4.5);
  const overrides = {};
  for (let semester = 1; semester <= 8; semester++) overrides[`s${semester}`] = { deutsch: 6 };
  const result = buildQualification(completeHistory(), {
    semesterOverrides: overrides,
    examGrades: { deutsch: 6, franzoesisch: 4, englisch: 4, mathematikGrundlagen: 4, mathematikSchwerpunkt: 4, naturwissenschaften: 4, idpa: 4 },
    idafGroups: [{ semesterId: 's3', grades: [4, 4] }, { semesterId: 's5', grades: [4, 4] }], ukGrades: Array(7).fill(4), ipaGrade: 4,
  });
  expect(result.bm.overallAverage).toBe(4.2);
});

describe('planner integration contract', () => {
  test('always supplies an ISO retrieval timestamp when legacy history has no timestamp', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-10T21:00:00.000Z'));
    try {
      const input = history(term(1, [subject('Deutsch', 4)]));
      delete input.retrievedAt;
      expect(buildQualification(input).retrievedAt).toBe('2026-11-10T21:00:00.000Z');
      input.retrievedAt = '2026-11-10T20:59:00.000Z';
      expect(buildQualification(input).retrievedAt).toBe(input.retrievedAt);
    } finally {
      jest.useRealTimers();
    }
  });
  test('exposes numbered IDAF performances without assuming they are grouped semester marks', () => {
    const firstLabel = 'Interdisziplinäres Arbeiten in den Fächern 1.1';
    const secondLabel = 'Interdisziplinäres Arbeiten in den Fächern 1.2';
    const input = history(term(3, [subject(firstLabel, 4.25), subject(secondLabel, '5,1'), subject('IDAF', 4.5)]), term(5, [subject('Interdisziplinäres Arbeiten in den Fächern 2.1', 0)]));
    const result = buildQualification(input, { startYear: 2023, confirmedCertificateGrades: true });
    expect(result.interdisciplinaryInputs).toEqual([
      { semesterId: 's3', label: '1.24/25', performances: [{ label: firstLabel, grade: 4.25 }, { label: secondLabel, grade: 5.1 }] },
      { semesterId: 's5', label: '1.25/26', performances: [{ label: 'Interdisziplinäres Arbeiten in den Fächern 2.1', grade: null }] },
    ]);
    expect(result.unknownSubjects).toEqual([]);
    expect(row(result, 'ida').semesterGrades.map(mark => mark.value)).toEqual([4.5, null, null, null]);
    expect(row(result, 'ida').experienceGrade).toBeNull();
    expect(result.semesterSummaries[0]).toMatchObject({ bmAverage: null, bfsAverage: null, excludedCount: 3 });
    const onlyPerformances = buildQualification(history(term(3, [subject(firstLabel, 4), subject(secondLabel, 6)])), { startYear: 2023, confirmedCertificateGrades: true });
    expect(row(onlyPerformances, 'ida').semesterGrades.every(mark => mark.value === null)).toBe(true);
    expect(onlyPerformances.bm.issues.join(' ')).toMatch(/IDAF/);
  });
  test('counts NW once in the descriptive BM semester mean, retaining raw component precision', () => {
    const result = buildQualification(history(term(5, [subject('Deutsch', 6), subject('Physik', 3.1), subject('Chemie', 4.1), subject('M100', 5), subject('IDAF', 6)])), { startYear: 2023 });
    expect(result.semesterSummaries[0]).toMatchObject({ bmAverage: 4.8, bmCount: 2, bfsAverage: 5, bfsCount: 1 });
    const combined = buildQualification(history(term(5, [subject('Deutsch', 6), subject('Naturwissenschaften', 5), subject('Physik', 3), subject('Chemie', 4)])), { startYear: 2023 });
    expect(combined.semesterSummaries[0]).toMatchObject({ bmAverage: 5.5, bmCount: 2 });
    const missingComponent = buildQualification(history(term(5, [subject('Deutsch', 6), subject('Physik', 3)])), { startYear: 2023 });
    expect(missingComponent.semesterSummaries[0]).toMatchObject({ bmAverage: 6, bmCount: 1 });
  });
});
