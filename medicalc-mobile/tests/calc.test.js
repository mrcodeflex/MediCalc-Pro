// Run from the folder that contains both `medicalc/` and `tests/`:
//   node tests/calc.test.js
// Requires Node 18+ (uses the built-in test runner). No packages needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../www/js/calc.js');

const near = (actual, expected, tol = 0.01, msg = '') =>
    assert.ok(Math.abs(actual - expected) <= tol,
        `${msg} expected ${expected} ± ${tol}, got ${actual}`);

test('PT/INR', () => {
    const r = Calc.ptInr({ patient: 13.4, control: 12, isi: 1 });
    near(r.inr, 1.1167, 0.001);
    near(r.ratio, 1.1167, 0.001);
    near(r.activity, 89.55, 0.01);
    near(Calc.ptInr({ patient: 13.4, control: 12, isi: 1.5 }).inr, 1.180, 0.001);
});

test('eGFR: CKD-EPI 2021 and 2009 match independently computed values', () => {
    near(Calc.egfr({ creatinine: 1.1, unit: 'mg/dL', age: 50, sex: 'male', equation: '2021' }).egfr, 81.78, 0.05);
    near(Calc.egfr({ creatinine: 1.0, unit: 'mg/dL', age: 60, sex: 'female', equation: '2021' }).egfr, 64.50, 0.05);
    near(Calc.egfr({ creatinine: 1.1, unit: 'mg/dL', age: 50, sex: 'male', equation: '2009' }).egfr, 77.86, 0.05);
    near(Calc.egfr({ creatinine: 1.1, unit: 'mg/dL', age: 50, sex: 'male', equation: '2009', race: true }).egfr, 90.24, 0.05);
});

test('eGFR: µmol/L input equals the mg/dL equivalent; stages', () => {
    const a = Calc.egfr({ creatinine: 1.1, unit: 'mg/dL', age: 50, sex: 'male' });
    const b = Calc.egfr({ creatinine: 1.1 * 88.4, unit: 'umol/L', age: 50, sex: 'male' });
    near(a.egfr, b.egfr, 1e-9);
    assert.match(Calc.egfr({ creatinine: 1.1, unit: 'mg/dL', age: 50, sex: 'male' }).stage, /^G2/);
    assert.match(Calc.egfr({ creatinine: 8, unit: 'mg/dL', age: 70, sex: 'male' }).stage, /^G5/);
});

test('CrCl (Cockcroft-Gault)', () => {
    near(Calc.crcl({ creatinine: 1.2, unit: 'mg/dL', weight: 70, age: 60, sex: 'male' }).crcl, 64.815, 0.001);
    near(Calc.crcl({ creatinine: 1.2, unit: 'mg/dL', weight: 70, age: 60, sex: 'female' }).crcl, 55.093, 0.001);
});

test('CCR: DuBois BSA, unit equivalence and flow rate', () => {
    const base = {
        urineCreatinine: 100, urineCreatinineUnit: 'mg/dL',
        serumCreatinine: 1.0, serumCreatinineUnit: 'mg/dL',
        volume: 1440, volumeUnit: 'mL', hours: 24,
        height: 170, heightUnit: 'cm', weight: 70, weightUnit: 'kg'
    };
    const r = Calc.ccr(base);
    near(r.raw, 100, 1e-9);                 // 1440 mL / 1440 min = 1 mL/min
    near(r.bsa, 1.8097, 0.001);
    near(r.corrected, 95.596, 0.01);
    // same collection expressed in other units must give the same answer
    const alt = Calc.ccr({
        ...base,
        urineCreatinine: 100 / 11.312, urineCreatinineUnit: 'mmol/L',
        serumCreatinine: 88.4, serumCreatinineUnit: 'umol/L',
        volume: 1.44, volumeUnit: 'L',
        height: 1.7, heightUnit: 'm', weight: 70000, weightUnit: 'g'
    });
    near(alt.raw, r.raw, 1e-6);
    near(alt.corrected, r.corrected, 1e-6);
    near(Calc.ccr({ ...base, height: 5.5, heightUnit: 'ft' }).bsa,
        Calc.ccr({ ...base, height: 167.64 }).bsa, 1e-9);
});

test('HOMA', () => {
    const r = Calc.homa({ glucose: 100, glucoseUnit: 'mg/dL', insulin: 10, insulinUnit: 'uU/mL' });
    near(r.ir, 2.4691, 0.001);
    near(r.betaPct, 97.30, 0.05);
    near(r.sensitivityPct, 40.5, 0.01);
    assert.equal(Calc.homa({ glucose: 3, glucoseUnit: 'mmol/L', insulin: 10, insulinUnit: 'uU/mL' }).betaPct, null);
    near(Calc.homa({ glucose: 5, glucoseUnit: 'mmol/L', insulin: 6.945 * 10, insulinUnit: 'pmol/L' }).insulinU, 10, 1e-9);
});

test('Urine ACR: KDIGO categories use mg/g thresholds (regression: were 10x too low)', () => {
    // the form placeholders: 30 mg/L albumin, 0.8 g/L creatinine = 37.5 mg/g = A2
    const r = Calc.acr({ albumin: 30, albuminUnit: 'mg/L', creatinine: 0.8, creatinineUnit: 'g/L' });
    near(r.mgPerG, 37.5, 1e-9);
    assert.equal(r.category.code, 'A2');
    // a normal 20 mg/g must be A1, not A2
    assert.equal(Calc.acrCategory(20).code, 'A1');
    assert.equal(Calc.acrCategory(29.9).code, 'A1');
    assert.equal(Calc.acrCategory(30).code, 'A2');
    assert.equal(Calc.acrCategory(300).code, 'A2');
    assert.equal(Calc.acrCategory(300.1).code, 'A3');
});

test('Urine ACR: unit equivalence and mg/mmol', () => {
    const a = Calc.acr({ albumin: 30, albuminUnit: 'mg/L', creatinine: 0.8, creatinineUnit: 'g/L' });
    const b = Calc.acr({ albumin: 3, albuminUnit: 'mg/dL', creatinine: 80, creatinineUnit: 'mg/dL' });
    const c = Calc.acr({ albumin: 30, albuminUnit: 'mg/L', creatinine: 0.8 / 0.11312, creatinineUnit: 'mmol/L' });
    near(b.mgPerG, a.mgPerG, 1e-9);
    near(c.mgPerG, a.mgPerG, 1e-9);
    near(a.mgPerMmol, 4.24, 0.01);          // 37.5 mg/g ÷ 8.84
});

test('Urine PCR', () => {
    const r = Calc.pcr({ protein: 15, proteinUnit: 'mg/dL', creatinine: 50, creatinineUnit: 'mg/dL' });
    near(r.ratio, 0.3, 1e-9);
    near(r.mgPerG, 300, 1e-9);
    near(r.mgPerMmol, 33.936, 0.001);
    const alt = Calc.pcr({ protein: 0.15, proteinUnit: 'g/L', creatinine: 0.5, creatinineUnit: 'g/L' });
    near(alt.mgPerG, 300, 1e-9);
});

test('Thyroid converter works in both directions', () => {
    let c = Calc.convertThyroid('ft4', 1.2, 'ng/dL');
    near(c.converted, 15.444, 0.001); assert.equal(c.convertedUnit, 'pmol/L');
    c = Calc.convertThyroid('ft4', 15.444, 'pmol/L');
    near(c.converted, 1.2, 0.001); assert.equal(c.convertedUnit, 'ng/dL');
    near(Calc.convertThyroid('t3', 120, 'ng/dL').converted, 1.8432, 0.0001);
    near(Calc.convertThyroid('t3', 1.8432, 'nmol/L').converted, 120, 0.001);
    near(Calc.convertThyroid('t4', 8, 'ug/dL').converted, 102.96, 0.001);
    near(Calc.convertThyroid('ft3', 3, 'pg/mL').converted, 4.62, 0.001);
    assert.equal(Calc.prettyUnit('ug/dL'), 'µg/dL');
    assert.equal(Calc.prettyUnit('umol/L'), 'µmol/L');
});

test('Urine protein 24 h', () => {
    const r = Calc.urineProtein24h({ concentration: 150, concentrationUnit: 'mg/dL', volume: 1500, volumeUnit: 'mL' });
    near(r.totalG, 2.25, 1e-9);
    near(r.totalMg, 2250, 1e-6);
});

test('Urine electrolytes 24 h: ions are optional', () => {
    const r = Calc.urineElectrolytes24h({ na: 120, k: null, cl: 110, volume: 1.5, volumeUnit: 'L' });
    near(r.na, 180, 1e-9);
    assert.equal(r.k, null);
    near(r.cl, 165, 1e-9);
});

test('Serum osmolality: urea mmol/L is added directly; BUN uses 2.8 (regression)', () => {
    // Na 140, glucose 5.5 mmol/L, urea 14 mmol/L -> 280 + 5.5 + 14
    near(Calc.serumOsm({ na: 140, glucose: 5.5, glucoseUnit: 'mmol/L', urea: 14, ureaUnit: 'urea-mmol/L' }).osm, 299.5, 1e-9);
    // urea 30 mg/dL (≈ 4.995 mmol/L)
    near(Calc.serumOsm({ na: 140, glucose: 99, glucoseUnit: 'mg/dL', urea: 30, ureaUnit: 'urea-mg/dL' }).osm,
        280 + 5.5 + 30 / 6.006, 1e-6);
    // BUN 50 mg/dL contributes BUN/2.8 ≈ 17.85, not BUN/6 ≈ 8.3
    near(Calc.serumOsm({ na: 140, glucose: 5.5, glucoseUnit: 'mmol/L', urea: 50, ureaUnit: 'bun-mg/dL' }).ureaMmol, 17.85, 0.01);
    // the same patient entered as BUN or as urea must agree (urea mg/dL = BUN × 2.14)
    const asBun = Calc.serumOsm({ na: 140, glucose: 5.5, glucoseUnit: 'mmol/L', urea: 14, ureaUnit: 'bun-mg/dL' }).osm;
    const asUrea = Calc.serumOsm({ na: 140, glucose: 5.5, glucoseUnit: 'mmol/L', urea: 14 * 2.1432, ureaUnit: 'urea-mg/dL' }).osm;
    near(asBun, asUrea, 0.01);
});

test('Urine osmolality estimate; glucose optional', () => {
    near(Calc.urineOsm({ na: 60, k: 30, urea: 600, ureaUnit: 'urea-mg/dL' }).osm, 279.9, 0.001);
    near(Calc.urineOsm({ na: 60, k: 30, urea: 99.9, ureaUnit: 'urea-mmol/L', glucose: 10, glucoseUnit: 'mmol/L' }).osm, 289.9, 1e-9);
});

test('CK-MB index', () => {
    near(Calc.ckmbIndex({ total: 300, mb: 10 }).index, 3.333, 0.001);
});

test('Anion gap', () => {
    near(Calc.anionGap({ na: 140, k: null, cl: 104, hco3: 24, includeK: false }).ag, 12, 1e-9);
    near(Calc.anionGap({ na: 140, k: 4.2, cl: 104, hco3: 24, includeK: true }).ag, 16.2, 1e-9);
    // albumin 2.0 g/dL: 12 + 2.5 × (4.4 − 2.0) = 18
    const r = Calc.anionGap({ na: 140, k: null, cl: 104, hco3: 24, albumin: 2.0, albuminUnit: 'g/dL', includeK: false });
    near(r.corrected, 18, 1e-9);
    near(Calc.anionGap({ na: 140, k: null, cl: 104, hco3: 24, albumin: 20, albuminUnit: 'g/L', includeK: false }).corrected, 18, 1e-9);
    // K requested but missing must fail loudly, not silently drop K (regression)
    assert.throws(() => Calc.anionGap({ na: 140, k: null, cl: 104, hco3: 24, includeK: true }), RangeError);
});

test('Free testosterone (Vermeulen quadratic) and unit conversions (regression)', () => {
    const r = Calc.freeTestosterone({ total: 400, totalUnit: 'ng/dL', shbg: 30, albumin: 4.0, albuminUnit: 'g/dL' });
    // independent brute-force mass-action solve gives 0.30368 nmol/L
    near(r.freeNmolL, 0.30368, 0.0005);
    near(r.freePmolL, 303.68, 0.5);
    near(r.freeNgDl, 8.759, 0.01);          // was 10x too high (87.6)
    near(r.freePgMl, 87.59, 0.1);           // was displaying 0.00
    near(r.percentFree, 2.19, 0.01);
    // unit relationships
    near(r.freeNgDl, r.freePmolL * 0.028842, 1e-6);
    near(r.freePgMl, r.freeNgDl * 10, 1e-6);
    // same sample entered as nmol/L
    const b = Calc.freeTestosterone({ total: 13.868, totalUnit: 'nmol/L', shbg: 30, albumin: 40, albuminUnit: 'g/L' });
    near(b.freeNmolL, r.freeNmolL, 0.001);
    // mass balance: total = free + albumin-bound + SHBG-bound
    const Ka = 3.6e4, Ks = 1e9, c = r.freeNmolL * 1e-9, S = 30e-9, A = 40 / 66500;
    const total = c * (1 + Ka * A) + (Ks * c * S) / (1 + Ks * c);
    near(total * 1e9, r.totalNmolL, 1e-6);
    // free T can never exceed total T, even with almost no binding protein
    const low = Calc.freeTestosterone({ total: 20, totalUnit: 'nmol/L', shbg: 0.5, albumin: 1, albuminUnit: 'g/L' });
    assert.ok(low.freeNmolL < 20 && low.freeNmolL > 0);
});

test('FT index', () => {
    near(Calc.ftIndex({ kind: 'ft4idx', t4: 8, t4Unit: 'ug/dL', uptake: 30 }).value, 2.4, 1e-9);
    near(Calc.ftIndex({ kind: 'ft4idx', t4: 8 * 12.87, t4Unit: 'nmol/L', uptake: 30 }).value, 2.4, 1e-9);
    near(Calc.ftIndex({ kind: 'ft3idx', t3: 120, t3Unit: 'ng/dL', uptake: 30 }).value, 36, 1e-9);
});

test('Hematology absolute counts', () => {
    const a = Calc.hemaAbs({ wbc: 6.5, wbcUnit: '10^9/L', neut: 60, lymph: 30, mono: 6, eos: 3, bas: 1 });
    near(a.neut, 3.9, 1e-9); near(a.lymph, 1.95, 1e-9);
    near(a.sumPct, 100, 1e-9);
    assert.equal(a.allFive, true);
    const b = Calc.hemaAbs({ wbc: 6500, wbcUnit: 'cells/uL', neut: 60, lymph: 30, mono: null, eos: null, bas: null });
    near(b.wbc109, 6.5, 1e-9); near(b.neut, 3.9, 1e-9);
    assert.equal(b.mono, null);
    assert.equal(b.allFive, false);
});

test('Unknown units fail loudly instead of returning NaN', () => {
    assert.throws(() => Calc.egfr({ creatinine: 1, unit: 'bogus', age: 40, sex: 'male' }), /Unknown unit/);
    assert.throws(() => Calc.serumOsm({ na: 140, glucose: 5, glucoseUnit: 'mmol/L', urea: 5, ureaUnit: 'bogus' }), /Unknown unit/);
});
