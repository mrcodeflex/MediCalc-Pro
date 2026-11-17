// Run:  node tests/registry.test.js
// Exercises every calculator through the same path the app uses:
//   raw form text -> Registry.collect() (validation) -> compute() -> result model
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../www/js/registry.js');

/** Builds a fake form source. `raw` maps field id -> text/bool, `units` maps field id -> unit code. */
function run(id, raw, units = {}) {
    const calc = R.BY_ID[id];
    const source = {
        value: (fid) => {
            if (fid in raw) return raw[fid];
            const fl = calc.fields.find((x) => x.id === fid);
            if (fl.type === 'choice') return fl.options[0][0];
            if (fl.type === 'switch') return false;
            return fl.def !== undefined ? fl.def : '';
        },
        unit: (fid) => {
            if (fid in units) return units[fid];
            return calc.fields.find((x) => x.id === fid).units[0][0];
        }
    };
    return calc.compute(R.collect(calc, source));
}

const rowText = (m) => (m.rows || []).map((r) => r.join(': ')).join(' | ');
const fails = (id, raw, units, re) =>
    assert.throws(() => run(id, raw, units), (e) => e instanceof R.FieldError && re.test(e.message), `expected FieldError ${re}`);

test('registry is well-formed', () => {
    assert.equal(R.CALCULATORS.length, 17);
    const ids = new Set();
    for (const c of R.CALCULATORS) {
        assert.ok(!ids.has(c.id), 'duplicate id ' + c.id); ids.add(c.id);
        assert.ok(R.CATEGORIES.some((k) => k.id === c.cat), c.id + ' has an unknown category');
        assert.ok(c.tag && c.name && c.desc && c.blurb && Array.isArray(c.kw) && c.kw.length, c.id + ' is missing metadata');
        const fieldIds = new Set();
        for (const fl of c.fields) {
            assert.ok(!fieldIds.has(fl.id), `${c.id}: duplicate field ${fl.id}`); fieldIds.add(fl.id);
            assert.ok(['number', 'choice', 'switch'].includes(fl.type));
        }
    }
});

test('PT/INR', () => {
    const m = run('pt-inr', { patient: '13.4', control: '12' });
    assert.equal(m.primary.value, '1.12');
    assert.match(rowText(m), /Approx\. activity: 89\.6 %/);
    assert.equal(run('pt-inr', { patient: '13.4', control: '12', isi: '1.5' }).primary.value, '1.18');
});

test('eGFR: value, stage chip, scale marker, equation switch', () => {
    const m = run('egfr', { creatinine: '1.1', age: '50' });
    assert.equal(m.primary.value, '81.8');
    assert.equal(m.chip.text, 'G2 · Mildly decreased');
    assert.equal(m.chip.tone, 'good');
    assert.equal(m.scale.items[m.scale.active].code, 'G2');
    assert.equal(m.scale.items.length, 6);
    // 2009 with race factor, only applies when the 2009 equation is selected
    const m09 = run('egfr', { creatinine: '1.1', age: '50', equation: '2009', race: true });
    assert.equal(m09.primary.value, '90.2');
    assert.match(rowText(m09), /race factor/);
    const hidden = run('egfr', { creatinine: '1.1', age: '50', equation: '2021', race: true });
    assert.equal(hidden.primary.value, '81.8');                 // race ignored when its switch is hidden
    // µmol/L entry
    assert.match(run('egfr', { creatinine: '97.24', age: '50' }, { creatinine: 'umol/L' }).primary.value, /^81\.[78]$/);
    // late-stage chip
    const g5 = run('egfr', { creatinine: '9', age: '70' });
    assert.equal(g5.scale.items[g5.scale.active].code, 'G5');
    assert.equal(g5.chip.tone, 'severe');
    // paediatric warning
    assert.match(run('egfr', { creatinine: '0.5', age: '10' }).warnings[0], /adults/);
});

test('CrCl', () => {
    assert.equal(run('crcl', { creatinine: '1.2', weight: '70', age: '60' }).primary.value, '64.8');
    assert.equal(run('crcl', { creatinine: '1.2', weight: '70', age: '60', sex: 'female' }).primary.value, '55.1');
    // Age is capped at 120 by validation, so the "negative result" guard can only be reached directly.
    fails('crcl', { creatinine: '1.2', weight: '70', age: '150' }, {}, /too high/);
    const neg = R.BY_ID.crcl.compute({ creatinine: 1.2, creatinineUnit: 'mg/dL', weight: 70, age: 150, sex: 'male' });
    assert.equal(neg.primary, null);
    assert.match(neg.warnings[0], /negative/);
});

test('CCR', () => {
    const m = run('ccr', { urineCreatinine: '100', serumCreatinine: '1.0', volume: '1440', height: '170', weight: '70' }, { height: 'cm' });
    assert.equal(m.primary.value, '95.60');
    assert.match(rowText(m), /Raw CCR: 100\.00 mL\/min/);
    assert.match(rowText(m), /BSA \(DuBois\): 1\.81 m²/);
    // 24 h default for the duration field
    assert.equal(R.BY_ID.ccr.fields.find((x) => x.id === 'hours').def, '24');
});

test('Urine ACR: KDIGO stage uses mg/g (regression) and drives the scale', () => {
    let m = run('urine-acr', { albumin: '30', creatinine: '0.8' });
    assert.equal(m.primary.value, '37.5');
    assert.match(m.chip.text, /^A2/);
    assert.equal(m.scale.items[m.scale.active].code, 'A2');
    m = run('urine-acr', { albumin: '16', creatinine: '0.8' });
    assert.match(m.chip.text, /^A1/); assert.equal(m.chip.tone, 'good');
    m = run('urine-acr', { albumin: '400', creatinine: '0.8' });
    assert.match(m.chip.text, /^A3/); assert.equal(m.chip.tone, 'bad');
    // zero albumin is allowed
    assert.equal(run('urine-acr', { albumin: '0', creatinine: '0.8' }).primary.value, '0.0');
});

test('Urine PCR', () => {
    const m = run('urine-pcr', { protein: '15', creatinine: '50' });
    assert.equal(m.primary.value, '300.0');
    assert.match(rowText(m), /33\.94 mg\/mmol/);
});

test('Urine protein 24 h', () => {
    const m = run('uprotein-24', { conc: '150', vol: '1500' });
    assert.equal(m.primary.value, '2250');
    assert.match(rowText(m), /2\.250 g/);
});

test('Urine electrolytes 24 h: ions optional, at least one required', () => {
    const m = run('uelectro-24', { na: '120', vol: '1500' });
    assert.equal(m.primary, null);
    assert.match(rowText(m), /Na⁺ excretion: 180\.0 mmol\/day/);
    assert.doesNotMatch(rowText(m), /K⁺/);
    fails('uelectro-24', { vol: '1500' }, {}, /at least one/);
});

test('Urine osmolality; glucose optional', () => {
    assert.equal(run('urine-osm', { na: '60', k: '30', urea: '600' }).primary.value, '279.9');
});

test('Serum osmolality: urea / BUN selector (regression)', () => {
    assert.equal(run('serum-osm', { na: '140', glucose: '5.5', urea: '14' }, { urea: 'urea-mmol/L' }).primary.value, '299.5');
    const bun = run('serum-osm', { na: '140', glucose: '5.5', urea: '50' }, { urea: 'bun-mg/dL' });
    assert.equal(bun.primary.value, '303.4');
    assert.match(rowText(bun), /Urea: 17\.9 mmol\/L/);
});

test('Anion gap: K field appears only when included (regression)', () => {
    assert.equal(run('anion-gap', { na: '140', cl: '104', hco3: '24' }).primary.value, '12.00');
    const k = run('anion-gap', { na: '140', cl: '104', hco3: '24', includeK: 'yes', k: '4.2' });
    assert.equal(k.primary.value, '16.20');
    const alb = run('anion-gap', { na: '140', cl: '104', hco3: '24', albumin: '2.0' }, { albumin: 'g/dL' });
    assert.match(rowText(alb), /Corrected \(albumin 2\.00 g\/dL\): 18\.00 mmol\/L/);
    fails('anion-gap', { na: '140', cl: '104', hco3: '24', includeK: 'yes' }, {}, /required/);
    // a stale K value must be ignored when "Exclude K" is chosen
    assert.equal(run('anion-gap', { na: '140', cl: '104', hco3: '24', includeK: 'no', k: '9' }).primary.value, '12.00');
});

test('CK-MB index', () => {
    assert.equal(run('ckmb-index', { total: '300', mb: '10' }).primary.value, '3.33');
});

test('HOMA', () => {
    const m = run('homa-ir', { glucose: '100', insulin: '10' });
    assert.equal(m.primary.value, '2.469');
    assert.match(rowText(m), /97\.3 %/);
    assert.match(rowText(m), /40\.5 %/);
    assert.match(rowText(run('homa-ir', { glucose: '3', insulin: '10' }, { glucose: 'mmol/L' })), /N\/A/);
});

test('Thyroid converter: both directions, any subset', () => {
    let m = run('thyroid', { ft4: '1.2' });
    assert.match(rowText(m), /Free T4: 1\.2 ng\/dL = 15\.44 pmol\/L/);
    m = run('thyroid', { ft4: '15.444' }, { ft4: 'pmol/L' });
    assert.match(rowText(m), /= 1\.20 ng\/dL/);
    m = run('thyroid', { t4: '8', tsh: '2.5' }, { t4: 'ug/dL' });
    assert.match(rowText(m), /Total T4: 8 µg\/dL = 102\.96 nmol\/L/);
    assert.match(rowText(m), /TSH: 2\.5 mIU\/L/);
    fails('thyroid', {}, {}, /at least one/);
});

test('Free testosterone: units (regression) and selected output', () => {
    let m = run('free-test', { total: '400', shbg: '30', albumin: '4.0' });
    assert.equal(m.primary.unit, 'pmol/L');
    assert.equal(m.primary.value, '303.68');
    m = run('free-test', { total: '400', shbg: '30', albumin: '4.0', out: 'ng/dL' });
    assert.equal(m.primary.value, '8.76');
    m = run('free-test', { total: '400', shbg: '30', albumin: '4.0', out: 'pg/mL' });
    assert.equal(m.primary.value, '87.59');
    assert.match(rowText(m), /Free fraction: 2\.19 %/);
});

test('FT index: only the relevant hormone is read', () => {
    assert.equal(run('ft-index', { uptake: '30', t4: '8' }).primary.value, '2.40');
    const t3 = run('ft-index', { kind: 'ft3idx', uptake: '30', t3: '120', t4: 'abc' });
    assert.equal(t3.primary.value, '36.00');             // the hidden T4 field is not validated
    assert.equal(t3.primary.label, 'FT3 index');
});

test('Absolute counts', () => {
    let m = run('hema-abs', { wbc: '6.5', neut: '60', lymph: '30' });
    assert.equal(m.primary.value, '3.90');
    assert.deepEqual(m.warnings, []);
    m = run('hema-abs', { wbc: '6.5', neut: '60', lymph: '30', mono: '6', eos: '3', bas: '9' });
    assert.equal(m.warnings.length, 1);
    m = run('hema-abs', { wbc: '6500', neut: '60', lymph: '30' }, { wbc: 'cells/uL' });
    assert.equal(m.primary.value, '3.90');
});

test('Validation messages', () => {
    fails('egfr', { creatinine: '0', age: '50' }, {}, /greater than 0|too low/);
    fails('egfr', { creatinine: '-1', age: '50' }, {}, /greater than 0/);
    fails('egfr', { creatinine: '', age: '50' }, {}, /required/);
    fails('egfr', { creatinine: '1.1', age: '500' }, {}, /too high/);
    fails('egfr', { creatinine: 'abc', age: '50' }, {}, /valid number/);
    fails('egfr', { creatinine: '1.1.1', age: '50' }, {}, /valid number/);
    // unit-aware limits: 30 mg/dL is the ceiling, 30 µmol/L is fine
    fails('egfr', { creatinine: '31', age: '50' }, { creatinine: 'mg/dL' }, /too high/);
    assert.ok(run('egfr', { creatinine: '31', age: '50' }, { creatinine: 'umol/L' }).primary);
    // error message names the unit when there is a choice of units
    fails('egfr', { creatinine: '0', age: '50' }, { creatinine: 'umol/L' }, /µmol\/L/);
});

test('Number input accepts Bengali digits and decimal commas', () => {
    assert.equal(R.normalizeNumber('১২.৫'), '12.5');
    assert.equal(R.normalizeNumber('1,2'), '1.2');
    assert.equal(R.normalizeNumber(' 0 . 8 '), '0.8');
    assert.equal(run('urine-acr', { albumin: '৩০', creatinine: '০,৮' }).primary.value, '37.5');
});

test('Copy/share text includes result and inputs', () => {
    const calc = R.BY_ID.egfr;
    const model = run('egfr', { creatinine: '1.1', age: '50' });
    const text = R.toText(calc, model, ['Serum creatinine: 1.1 mg/dL', 'Age: 50 years']);
    assert.match(text, /^MediCalc Pro · eGFR/);
    assert.match(text, /eGFR: 81\.8 mL\/min\/1\.73 m²/);
    assert.match(text, /G2 · Mildly decreased/);
    assert.match(text, /Inputs\nSerum creatinine: 1\.1 mg\/dL/);
});
