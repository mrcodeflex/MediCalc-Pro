/* ==========================================================================
   MediCalc Pro — registry.js
   Describes every calculator (fields, validation, result model).
   DOM-free: runs in the app and in Node tests (tests/registry.test.js).

   A calculator is: { id, cat, tag, name, desc, blurb, kw[], fields[], compute(v) }
   compute(v) returns a result model:
     { primary:{label,value,unit}|null, chip:{text,tone}|null,
       scale:{items:[{code,sub,tone}], active}|null,
       rows:[[label,value]], warnings:[], notes:[] }
   ========================================================================== */
(function (global) {
    'use strict';

    const Calc = (typeof module !== 'undefined' && module.exports) ? require('./calc.js') : global.Calc;

    class FieldError extends Error {
        constructor(fieldId, message) {
            super(message);
            this.name = 'FieldError';
            this.fieldId = fieldId;
        }
    }

    const U = Calc.prettyUnit;
    const f = (n, d = 2) => n.toFixed(d);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // ---------- field builders ----------
    const num = (id, label, o = {}) => ({ type: 'number', id, label, ...o });
    const choice = (id, label, options, o = {}) => ({ type: 'choice', id, label, options, ...o });
    const sw = (id, label, o = {}) => ({ type: 'switch', id, label, ...o });

    const CREAT_UNITS = [['mg/dL', 'mg/dL'], ['umol/L', 'µmol/L']];
    const VOLUME_UNITS = [['mL', 'mL'], ['L', 'L']];
    const ALBUMIN_UNITS = [['g/dL', 'g/dL'], ['g/L', 'g/L']];
    const creatBounds = (u) => (u === 'mg/dL' ? { min: 0.1, max: 30 } : { min: 8, max: 2650 });
    const volBounds = (u) => ({ max: u === 'mL' ? 20000 : 20 });
    const SEX = [['male', 'Male'], ['female', 'Female']];

    const CATEGORIES = [
        { id: 'hema', name: 'Hematology & coagulation', short: 'Hematology' },
        { id: 'renal', name: 'Renal & urine', short: 'Renal & urine' },
        { id: 'chem', name: 'Chemistry', short: 'Chemistry' },
        { id: 'endo', name: 'Endocrine', short: 'Endocrine' }
    ];

    // ---------- the calculators ----------
    const CALCULATORS = [
        // ===== Hematology & coagulation =====
        {
            id: 'pt-inr', cat: 'hema', tag: 'INR', name: 'PT / INR',
            desc: 'Prothrombin time to INR',
            blurb: 'INR = (patient PT ÷ MNPT) ^ ISI',
            kw: ['coagulation', 'warfarin', 'prothrombin', 'isi', 'clotting'],
            fields: [
                num('patient', 'Patient PT', { suffix: 's', ph: '13.4', hint: 'Normal: 11–13.5 s', bounds: { max: 300 } }),
                num('control', 'Control PT / MNPT', { suffix: 's', ph: '12.0', hint: 'Use the mean normal PT (MNPT) of your reagent lot where available.', bounds: { max: 300 } }),
                num('isi', 'ISI', { def: '1.0', hint: 'From the thromboplastin reagent insert.', bounds: { max: 5 } })
            ],
            compute(v) {
                const r = Calc.ptInr({ patient: v.patient, control: v.control, isi: v.isi });
                return {
                    primary: { label: 'INR', value: f(r.inr), unit: '' },
                    rows: [
                        ['Ratio (patient ÷ control)', f(r.ratio)],
                        ['Approx. activity', `${f(r.activity, 1)} %`]
                    ],
                    notes: ['The activity value is only a rough estimate (control ÷ patient × 100). A true Quick % is read from a calibration curve.']
                };
            }
        },
        {
            id: 'hema-abs', cat: 'hema', tag: 'ANC', name: 'Absolute counts',
            desc: 'ANC and counts from WBC differential',
            blurb: 'Absolute count = WBC × differential % ÷ 100',
            kw: ['neutrophil', 'lymphocyte', 'wbc', 'differential', 'cbc', 'anc'],
            fields: [
                num('wbc', 'WBC', { units: [['10^9/L', '×10⁹/L'], ['cells/uL', 'cells/µL']], ph: '6.5', bounds: (u) => ({ max: u === '10^9/L' ? 1000 : 1000000 }) }),
                num('neut', 'Neutrophils (segs + bands)', { suffix: '%', ph: '60', allowZero: true, bounds: { max: 100 } }),
                num('lymph', 'Lymphocytes', { suffix: '%', ph: '30', allowZero: true, bounds: { max: 100 } }),
                num('mono', 'Monocytes', { suffix: '%', ph: '6', optional: true, allowZero: true, bounds: { max: 100 } }),
                num('eos', 'Eosinophils', { suffix: '%', ph: '3', optional: true, allowZero: true, bounds: { max: 100 } }),
                num('bas', 'Basophils', { suffix: '%', ph: '1', optional: true, allowZero: true, bounds: { max: 100 } })
            ],
            compute(v) {
                const r = Calc.hemaAbs({ wbc: v.wbc, wbcUnit: v.wbcUnit, neut: v.neut, lymph: v.lymph, mono: v.mono, eos: v.eos, bas: v.bas });
                const u = '×10⁹/L';
                const rows = [['WBC', `${f(r.wbc109)} ${u}`], ['Lymphocytes', `${f(r.lymph)} ${u}`]];
                if (r.mono !== null) rows.push(['Monocytes', `${f(r.mono)} ${u}`]);
                if (r.eos !== null) rows.push(['Eosinophils', `${f(r.eos)} ${u}`]);
                if (r.bas !== null) rows.push(['Basophils', `${f(r.bas)} ${u}`]);
                rows.push(['Differential total', `${f(r.sumPct, 1)} %`]);
                const warnings = [];
                if (r.sumPct > 100.5 || (r.allFive && Math.abs(r.sumPct - 100) > 0.5)) {
                    warnings.push('The differential percentages do not add up to 100 %. Check the entries.');
                }
                return { primary: { label: 'Absolute neutrophil count (ANC)', value: f(r.neut), unit: u }, rows, warnings };
            }
        },

        // ===== Renal & urine =====
        {
            id: 'egfr', cat: 'renal', tag: 'eGFR', name: 'eGFR',
            desc: 'CKD-EPI · kidney function',
            blurb: 'CKD-EPI creatinine equation. The race-free 2021 version is the default.',
            kw: ['kidney', 'ckd', 'gfr', 'creatinine', 'renal', 'ckd-epi'],
            fields: [
                num('creatinine', 'Serum creatinine', { units: CREAT_UNITS, ph: '1.2', bounds: creatBounds }),
                num('age', 'Age', { suffix: 'years', ph: '45', bounds: { max: 120 } }),
                choice('sex', 'Sex', SEX),
                choice('equation', 'Equation', [['2021', '2021 · race-free'], ['2009', '2009']]),
                sw('race', 'Apply race coefficient', { hint: 'African American factor (×1.159). Not recommended by the NKF–ASN task force (2021).', showIf: (p) => p.equation === '2009' })
            ],
            compute(v) {
                const r = Calc.egfr({ creatinine: v.creatinine, unit: v.creatinineUnit, age: v.age, sex: v.sex, equation: v.equation, race: v.race });
                const m = r.stage.match(/^(G\d[ab]?): (.+?) \((.+)\)$/);
                const code = m ? m[1] : 'G5';
                const items = [
                    { code: 'G5', sub: '<15', tone: 'severe' }, { code: 'G4', sub: '15–29', tone: 'bad' },
                    { code: 'G3b', sub: '30–44', tone: 'warn' }, { code: 'G3a', sub: '45–59', tone: 'watch' },
                    { code: 'G2', sub: '60–89', tone: 'good' }, { code: 'G1', sub: '≥90', tone: 'good' }
                ];
                const active = items.findIndex((i) => i.code === code);
                const warnings = [];
                if (v.age < 18) warnings.push('CKD-EPI is validated for adults. Use a paediatric equation (e.g. bedside Schwartz) for children.');
                return {
                    primary: { label: 'eGFR', value: f(r.egfr, 1), unit: 'mL/min/1.73 m²' },
                    chip: m ? { text: `${code} · ${cap(m[3])}`, tone: items[active].tone } : null,
                    scale: { items, active },
                    rows: [
                        ['Equation', `CKD-EPI ${r.equation}${v.race ? ' + race factor' : ''}`],
                        ['Creatinine', `${v.creatinine} ${U(v.creatinineUnit)}`],
                        ['Converted', `${f(r.creatinineMgDl, 2)} mg/dL · ${f(r.creatinineUmolL, 0)} µmol/L`]
                    ],
                    warnings,
                    notes: ['Staging needs persistence for 3+ months and the albuminuria category.']
                };
            }
        },
        {
            id: 'crcl', cat: 'renal', tag: 'CrCl', name: 'CrCl (Cockcroft–Gault)',
            desc: 'Creatinine clearance from weight and age',
            blurb: 'CrCl = (140 − age) × weight ÷ (72 × creatinine), × 0.85 if female',
            kw: ['cockcroft', 'gault', 'creatinine clearance', 'drug dosing', 'renal'],
            fields: [
                num('creatinine', 'Serum creatinine', { units: CREAT_UNITS, ph: '1.2', bounds: creatBounds }),
                num('weight', 'Weight', { suffix: 'kg', ph: '70', hint: 'Uses the weight you enter (actual body weight). Consider ideal or adjusted weight in obesity.', bounds: { min: 0.5, max: 500 } }),
                num('age', 'Age', { suffix: 'years', ph: '60', bounds: { max: 120 } }),
                choice('sex', 'Sex', SEX)
            ],
            compute(v) {
                const r = Calc.crcl({ creatinine: v.creatinine, unit: v.creatinineUnit, weight: v.weight, age: v.age, sex: v.sex });
                const rows = [
                    ['Creatinine', `${v.creatinine} ${U(v.creatinineUnit)}`],
                    ['Converted', `${f(r.creatinineMgDl, 2)} mg/dL · ${f(r.creatinineUmolL, 0)} µmol/L`]
                ];
                if (r.crcl < 0) {
                    return { primary: null, rows, warnings: ['Result is negative (age above 140). Cockcroft-Gault is not meaningful here.'] };
                }
                return { primary: { label: 'Cockcroft–Gault CrCl', value: f(r.crcl, 1), unit: 'mL/min' }, rows };
            }
        },
        {
            id: 'ccr', cat: 'renal', tag: 'CCR', name: 'CCR (timed urine)',
            desc: 'Measured clearance with BSA correction',
            blurb: 'CCR = (U × V) ÷ P, corrected to 1.73 m² with DuBois BSA',
            kw: ['creatinine clearance', '24 hour', 'bsa', 'urine collection', 'renal'],
            fields: [
                num('urineCreatinine', 'Urine creatinine (U)', { units: [['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']], ph: '100', bounds: (u) => ({ max: u === 'mg/dL' ? 1000 : 90 }) }),
                num('serumCreatinine', 'Serum creatinine (P)', { units: CREAT_UNITS, ph: '1.0', bounds: creatBounds }),
                num('volume', 'Total urine volume', { units: VOLUME_UNITS, ph: '1440', bounds: volBounds }),
                num('hours', 'Collection duration', { suffix: 'hours', def: '24', bounds: { max: 72 } }),
                num('height', 'Height', {
                    units: [['ft', 'ft'], ['cm', 'cm'], ['m', 'm']], ph: '5.6',
                    hint: 'Decimal feet: 5 ft 8 in = 5.67 ft.',
                    bounds: (u) => ({ ft: { min: 1, max: 8.5 }, cm: { min: 30, max: 260 }, m: { min: 0.3, max: 2.6 } }[u])
                }),
                num('weight', 'Weight', { units: [['kg', 'kg'], ['g', 'g']], ph: '70', bounds: (u) => (u === 'kg' ? { min: 0.5, max: 500 } : { min: 500, max: 500000 }) })
            ],
            compute(v) {
                const r = Calc.ccr({
                    urineCreatinine: v.urineCreatinine, urineCreatinineUnit: v.urineCreatinineUnit,
                    serumCreatinine: v.serumCreatinine, serumCreatinineUnit: v.serumCreatinineUnit,
                    volume: v.volume, volumeUnit: v.volumeUnit, hours: v.hours,
                    height: v.height, heightUnit: v.heightUnit, weight: v.weight, weightUnit: v.weightUnit
                });
                return {
                    primary: { label: 'Corrected CCR (1.73 m²)', value: f(r.corrected), unit: 'mL/min' },
                    rows: [['Raw CCR', `${f(r.raw)} mL/min`], ['BSA (DuBois)', `${f(r.bsa)} m²`]]
                };
            }
        },
        {
            id: 'urine-acr', cat: 'renal', tag: 'ACR', name: 'Urine ACR',
            desc: 'Albumin:creatinine · KDIGO stage',
            blurb: 'ACR = urine albumin ÷ urine creatinine',
            kw: ['albumin', 'albuminuria', 'microalbumin', 'kdigo', 'proteinuria'],
            fields: [
                num('albumin', 'Urine albumin', { units: [['mg/L', 'mg/L'], ['mg/dL', 'mg/dL']], ph: '30', allowZero: true, bounds: (u) => ({ max: u === 'mg/L' ? 100000 : 10000 }) }),
                num('creatinine', 'Urine creatinine', { units: [['g/L', 'g/L'], ['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']], ph: '0.8', bounds: (u) => ({ max: { 'g/L': 10, 'mg/dL': 1000, 'mmol/L': 90 }[u] }) })
            ],
            compute(v) {
                const r = Calc.acr({ albumin: v.albumin, albuminUnit: v.albuminUnit, creatinine: v.creatinine, creatinineUnit: v.creatinineUnit });
                const items = [
                    { code: 'A1', sub: '<30', tone: 'good' },
                    { code: 'A2', sub: '30–300', tone: 'watch' },
                    { code: 'A3', sub: '>300', tone: 'bad' }
                ];
                const active = items.findIndex((i) => i.code === r.category.code);
                return {
                    primary: { label: 'ACR', value: f(r.mgPerG, 1), unit: 'mg/g' },
                    chip: { text: `${r.category.code} · ${r.category.label}`, tone: items[active].tone },
                    scale: { items, active },
                    rows: [['ACR', `${f(r.mgPerMmol)} mg/mmol`]],
                    notes: ['KDIGO (mg/g): A1 < 30, A2 30–300, A3 > 300. Confirm with repeat testing over 3 months.']
                };
            }
        },
        {
            id: 'urine-pcr', cat: 'renal', tag: 'PCR', name: 'Urine PCR',
            desc: 'Protein-to-creatinine ratio',
            blurb: 'PCR = urine protein ÷ urine creatinine',
            kw: ['protein', 'proteinuria', 'creatinine', 'spot urine'],
            fields: [
                num('protein', 'Urine protein', { units: [['mg/dL', 'mg/dL'], ['mg/L', 'mg/L'], ['g/L', 'g/L']], ph: '15', allowZero: true, bounds: (u) => ({ max: { 'mg/dL': 50000, 'mg/L': 500000, 'g/L': 500 }[u] }) }),
                num('creatinine', 'Urine creatinine', { units: [['mg/dL', 'mg/dL'], ['g/L', 'g/L'], ['mmol/L', 'mmol/L']], ph: '50', bounds: (u) => ({ max: { 'mg/dL': 1000, 'g/L': 10, 'mmol/L': 90 }[u] }) })
            ],
            compute(v) {
                const r = Calc.pcr({ protein: v.protein, proteinUnit: v.proteinUnit, creatinine: v.creatinine, creatinineUnit: v.creatinineUnit });
                return {
                    primary: { label: 'PCR', value: f(r.mgPerG, 1), unit: 'mg/g' },
                    rows: [['PCR', `${f(r.mgPerMmol)} mg/mmol`], ['Ratio (g/g)', f(r.ratio, 3)]]
                };
            }
        },
        {
            id: 'uprotein-24', cat: 'renal', tag: '24h', name: 'Urine protein, 24 h',
            desc: 'Total protein excreted per day',
            blurb: 'Total = concentration × 24 h volume',
            kw: ['proteinuria', 'nephrotic', 'urine', '24 hour'],
            fields: [
                num('conc', 'Protein concentration', { units: [['mg/dL', 'mg/dL'], ['mg/L', 'mg/L'], ['g/L', 'g/L']], ph: '150', hint: 'Use the concentration measured on the 24 h collection, not a spot sample.', allowZero: true, bounds: (u) => ({ max: { 'mg/dL': 20000, 'mg/L': 200000, 'g/L': 200 }[u] }) }),
                num('vol', '24-hour urine volume', { units: VOLUME_UNITS, ph: '1500', bounds: volBounds })
            ],
            compute(v) {
                const r = Calc.urineProtein24h({ concentration: v.conc, concentrationUnit: v.concUnit, volume: v.vol, volumeUnit: v.volUnit });
                return {
                    primary: { label: 'Total protein', value: f(r.totalMg, 0), unit: 'mg / 24 h' },
                    rows: [['Total protein', `${f(r.totalG, 3)} g / 24 h`]],
                    notes: ['A typical adult reference is below about 150 mg/24 h (lab-dependent).']
                };
            }
        },
        {
            id: 'uelectro-24', cat: 'renal', tag: 'Na K', name: 'Urine electrolytes, 24 h',
            desc: 'Na⁺, K⁺, Cl⁻ excretion per day',
            blurb: 'mmol/day = concentration (mmol/L) × volume (L)',
            kw: ['sodium', 'potassium', 'chloride', 'urine', '24 hour'],
            fields: [
                num('na', 'Urine Na⁺', { suffix: 'mmol/L', ph: '120', optional: true, allowZero: true, hint: 'mmol/L = mEq/L for Na⁺, K⁺ and Cl⁻. Fill in at least one.', bounds: { max: 500 } }),
                num('k', 'Urine K⁺', { suffix: 'mmol/L', ph: '25', optional: true, allowZero: true, bounds: { max: 500 } }),
                num('cl', 'Urine Cl⁻', { suffix: 'mmol/L', ph: '110', optional: true, allowZero: true, bounds: { max: 500 } }),
                num('vol', '24-hour urine volume', { units: VOLUME_UNITS, ph: '1500', bounds: volBounds })
            ],
            compute(v) {
                if (v.na === null && v.k === null && v.cl === null) {
                    throw new FieldError('na', 'Enter at least one electrolyte (Na⁺, K⁺ or Cl⁻).');
                }
                const r = Calc.urineElectrolytes24h({ na: v.na, k: v.k, cl: v.cl, volume: v.vol, volumeUnit: v.volUnit });
                const rows = [];
                if (r.na !== null) rows.push(['Na⁺ excretion', `${f(r.na, 1)} mmol/day`]);
                if (r.k !== null) rows.push(['K⁺ excretion', `${f(r.k, 1)} mmol/day`]);
                if (r.cl !== null) rows.push(['Cl⁻ excretion', `${f(r.cl, 1)} mmol/day`]);
                return { primary: null, rows };
            }
        },
        {
            id: 'urine-osm', cat: 'renal', tag: 'U-Osm', name: 'Urine osmolality (est.)',
            desc: 'From Na, K, urea and glucose',
            blurb: 'Urine Osm ≈ 2 × (Na + K) + urea + glucose (mmol/L)',
            kw: ['osmolarity', 'osmolality', 'urine', 'urea'],
            fields: [
                num('na', 'Urine Na⁺', { suffix: 'mmol/L', ph: '60', allowZero: true, bounds: { max: 500 } }),
                num('k', 'Urine K⁺', { suffix: 'mmol/L', ph: '30', allowZero: true, bounds: { max: 500 } }),
                num('urea', 'Urine urea', { units: [['urea-mg/dL', 'mg/dL'], ['urea-mmol/L', 'mmol/L']], ph: '600', bounds: (u) => ({ max: u === 'urea-mg/dL' ? 20000 : 3500 }) }),
                num('glucose', 'Urine glucose', { units: [['mmol/L', 'mmol/L'], ['mg/dL', 'mg/dL']], ph: '0', optional: true, allowZero: true, hint: 'Optional. Leave blank for 0.', bounds: (u) => ({ max: u === 'mg/dL' ? 20000 : 1100 }) })
            ],
            compute(v) {
                const r = Calc.urineOsm({ na: v.na, k: v.k, urea: v.urea, ureaUnit: v.ureaUnit, glucose: v.glucose, glucoseUnit: v.glucoseUnit });
                return {
                    primary: { label: 'Estimated urine osmolality', value: f(r.osm, 1), unit: 'mOsm/kg' },
                    notes: ['Measured urine osmolality remains preferred.']
                };
            }
        },

        // ===== Chemistry =====
        {
            id: 'serum-osm', cat: 'chem', tag: 'Osm', name: 'Serum osmolality (est.)',
            desc: 'From Na, glucose and urea / BUN',
            blurb: 'Osm ≈ 2 × Na + glucose + urea (all in mmol/L)',
            kw: ['osmolarity', 'osmolality', 'urea', 'bun', 'sodium', 'glucose'],
            fields: [
                num('na', 'Serum Na⁺', { suffix: 'mmol/L', ph: '140', bounds: { max: 250 } }),
                num('glucose', 'Glucose', { units: [['mmol/L', 'mmol/L'], ['mg/dL', 'mg/dL']], ph: '5.5', bounds: (u) => ({ max: u === 'mg/dL' ? 2000 : 110 }) }),
                num('urea', 'Urea or BUN', {
                    units: [['urea-mg/dL', 'Urea mg/dL'], ['urea-mmol/L', 'Urea mmol/L'], ['bun-mg/dL', 'BUN mg/dL']], ph: '30',
                    hint: 'Choose the exact quantity your lab reports.',
                    bounds: (u) => ({ max: { 'urea-mg/dL': 1000, 'urea-mmol/L': 170, 'bun-mg/dL': 500 }[u] })
                })
            ],
            compute(v) {
                const r = Calc.serumOsm({ na: v.na, glucose: v.glucose, glucoseUnit: v.glucoseUnit, urea: v.urea, ureaUnit: v.ureaUnit });
                return {
                    primary: { label: 'Estimated serum osmolality', value: f(r.osm, 1), unit: 'mOsm/kg' },
                    rows: [['2 × Na⁺', `${f(2 * v.na, 1)}`], ['Glucose', `${f(r.glucoseMmol, 1)} mmol/L`], ['Urea', `${f(r.ureaMmol, 1)} mmol/L`]],
                    notes: ['Measured osmolality remains the reference.']
                };
            }
        },
        {
            id: 'anion-gap', cat: 'chem', tag: 'AG', name: 'Anion gap',
            desc: 'With optional albumin correction',
            blurb: 'AG = Na (+ K) − (Cl + HCO₃). Corrected: AG + 2.5 × (4.4 − albumin g/dL)',
            kw: ['acidosis', 'bicarbonate', 'albumin', 'electrolytes', 'metabolic'],
            fields: [
                choice('includeK', 'Potassium', [['no', 'Exclude K⁺'], ['yes', 'Include K⁺']]),
                num('na', 'Na⁺', { suffix: 'mmol/L', ph: '140', bounds: { max: 250 } }),
                num('k', 'K⁺', { suffix: 'mmol/L', ph: '4.2', bounds: { max: 20 }, showIf: (p) => p.includeK === 'yes' }),
                num('cl', 'Cl⁻', { suffix: 'mmol/L', ph: '104', bounds: { max: 250 } }),
                num('hco3', 'HCO₃⁻', { suffix: 'mmol/L', ph: '24', bounds: { max: 80 } }),
                num('albumin', 'Albumin', { units: ALBUMIN_UNITS, ph: '4.0', optional: true, hint: 'Optional. Adds the albumin-corrected anion gap.', bounds: (u) => ({ max: u === 'g/dL' ? 10 : 100 }) })
            ],
            compute(v) {
                const r = Calc.anionGap({ na: v.na, k: v.k, cl: v.cl, hco3: v.hco3, albumin: v.albumin, albuminUnit: v.albuminUnit, includeK: v.includeK === 'yes' });
                const rows = [];
                if (r.corrected !== null) rows.push([`Corrected (albumin ${f(r.albuminGdl)} g/dL)`, `${f(r.corrected)} mmol/L`]);
                return {
                    primary: { label: 'Anion gap', value: f(r.ag), unit: 'mmol/L' },
                    rows,
                    notes: ['A typical reference is about 8–12 mmol/L without K⁺ (assay-dependent).']
                };
            }
        },
        {
            id: 'ckmb-index', cat: 'chem', tag: 'CK-MB', name: 'CK-MB index',
            desc: 'CK-MB mass relative to total CK',
            blurb: 'Index = (CK-MB mass ng/mL ÷ total CK U/L) × 100',
            kw: ['cardiac', 'troponin', 'myocardial', 'ck'],
            fields: [
                num('total', 'Total CK', { suffix: 'U/L', ph: '300', bounds: { max: 100000 } }),
                num('mb', 'CK-MB (mass)', { suffix: 'ng/mL', ph: '10', allowZero: true, bounds: { max: 5000 } })
            ],
            compute(v) {
                const r = Calc.ckmbIndex({ total: v.total, mb: v.mb });
                return {
                    primary: { label: 'CK-MB index', value: f(r.index), unit: '%' },
                    notes: ['Cut-offs are assay-specific (commonly about 2.5–3 %).']
                };
            }
        },

        // ===== Endocrine =====
        {
            id: 'homa-ir', cat: 'endo', tag: 'HOMA', name: 'HOMA',
            desc: 'Insulin resistance, beta-cell function',
            blurb: 'HOMA-IR = glucose (mmol/L) × insulin (µU/mL) ÷ 22.5',
            kw: ['insulin', 'diabetes', 'resistance', 'beta cell', 'glucose'],
            fields: [
                num('glucose', 'Fasting glucose', { units: [['mg/dL', 'mg/dL'], ['mmol/L', 'mmol/L']], ph: '100', bounds: (u) => ({ max: u === 'mg/dL' ? 2000 : 110 }) }),
                num('insulin', 'Fasting insulin', { units: [['uU/mL', 'µU/mL'], ['pmol/L', 'pmol/L']], ph: '10', bounds: (u) => ({ max: u === 'uU/mL' ? 2000 : 14000 }) })
            ],
            compute(v) {
                const r = Calc.homa({ glucose: v.glucose, glucoseUnit: v.glucoseUnit, insulin: v.insulin, insulinUnit: v.insulinUnit });
                return {
                    primary: { label: 'HOMA-IR', value: f(r.ir, 3), unit: '' },
                    rows: [
                        ['HOMA %B (beta-cell)', r.betaPct === null ? 'N/A (glucose ≤ 3.5 mmol/L)' : `${f(r.betaPct, 1)} %`],
                        ['HOMA %S (sensitivity)', r.sensitivityPct === null ? 'N/A' : `${f(r.sensitivityPct, 1)} %`],
                        ['Glucose', `${f(r.glucoseMmol)} mmol/L`],
                        ['Insulin', `${f(r.insulinU)} µU/mL`]
                    ],
                    notes: ['HOMA1 closed-form equations.']
                };
            }
        },
        {
            id: 'thyroid', cat: 'endo', tag: 'TFT', name: 'Thyroid units',
            desc: 'TSH, FT4, FT3, T4, T3 conversions',
            blurb: 'Enter any value. Each one converts to the other unit.',
            kw: ['tsh', 'ft4', 'ft3', 'thyroxine', 'triiodothyronine', 'conversion'],
            fields: [
                num('tsh', 'TSH', { units: [['mIU/L', 'mIU/L']], ph: '2.5', optional: true, hint: 'mIU/L is numerically identical to µIU/mL.', bounds: { max: 1000 } }),
                num('ft4', 'Free T4', { units: [['ng/dL', 'ng/dL'], ['pmol/L', 'pmol/L']], ph: '1.2', optional: true, bounds: (u) => ({ max: u === 'ng/dL' ? 20 : 260 }) }),
                num('ft3', 'Free T3', { units: [['pg/mL', 'pg/mL'], ['pmol/L', 'pmol/L']], ph: '3.0', optional: true, bounds: (u) => ({ max: u === 'pg/mL' ? 50 : 80 }) }),
                num('t4', 'Total T4', { units: [['ug/dL', 'µg/dL'], ['nmol/L', 'nmol/L']], ph: '8.0', optional: true, bounds: (u) => ({ max: u === 'ug/dL' ? 50 : 650 }) }),
                num('t3', 'Total T3', { units: [['ng/dL', 'ng/dL'], ['nmol/L', 'nmol/L']], ph: '120', optional: true, bounds: (u) => ({ max: u === 'ng/dL' ? 1000 : 15 }) })
            ],
            compute(v) {
                const rows = [];
                if (v.tsh !== null) rows.push(['TSH', `${v.tsh} mIU/L = ${v.tsh} µIU/mL`]);
                [['ft4', 'Free T4'], ['ft3', 'Free T3'], ['t4', 'Total T4'], ['t3', 'Total T3']].forEach(([key, label]) => {
                    if (v[key] === null) return;
                    const c = Calc.convertThyroid(key, v[key], v[key + 'Unit']);
                    rows.push([label, `${v[key]} ${U(v[key + 'Unit'])} = ${f(c.converted)} ${U(c.convertedUnit)}`]);
                });
                if (!rows.length) throw new FieldError('tsh', 'Enter at least one thyroid value.');
                return { primary: null, rows, notes: ['FT4 1 ng/dL = 12.87 pmol/L · FT3 1 pg/mL = 1.54 pmol/L · T4 1 µg/dL = 12.87 nmol/L · T3 1 ng/dL = 0.01536 nmol/L.'] };
            }
        },
        {
            id: 'free-test', cat: 'endo', tag: 'Free T', name: 'Free testosterone',
            desc: 'Calculated (Vermeulen)',
            blurb: 'Law-of-mass-action solution with albumin and SHBG binding.',
            kw: ['testosterone', 'shbg', 'vermeulen', 'androgen'],
            fields: [
                num('total', 'Total testosterone', { units: [['ng/dL', 'ng/dL'], ['nmol/L', 'nmol/L']], ph: '400', bounds: (u) => ({ max: u === 'ng/dL' ? 5000 : 175 }) }),
                num('shbg', 'SHBG', { suffix: 'nmol/L', ph: '30', bounds: { max: 500 } }),
                num('albumin', 'Albumin', { units: ALBUMIN_UNITS, ph: '4.0', bounds: (u) => ({ max: u === 'g/dL' ? 10 : 100 }) }),
                choice('out', 'Show result in', [['pmol/L', 'pmol/L'], ['pg/mL', 'pg/mL'], ['ng/dL', 'ng/dL']])
            ],
            compute(v) {
                const r = Calc.freeTestosterone({ total: v.total, totalUnit: v.totalUnit, shbg: v.shbg, albumin: v.albumin, albuminUnit: v.albuminUnit });
                const all = { 'pmol/L': r.freePmolL, 'pg/mL': r.freePgMl, 'ng/dL': r.freeNgDl };
                const rows = [['Free fraction', `${f(r.percentFree)} %`]];
                Object.keys(all).filter((u) => u !== v.out).forEach((u) => rows.push(['Also', `${f(all[u])} ${u}`]));
                return {
                    primary: { label: 'Free testosterone', value: f(all[v.out]), unit: v.out },
                    rows,
                    notes: ['Binding constants: albumin 3.6×10⁴ L/mol, SHBG 1×10⁹ L/mol. Compare with your lab’s reference range and method.']
                };
            }
        },
        {
            id: 'ft-index', cat: 'endo', tag: 'FTI', name: 'FT3 / FT4 index',
            desc: 'Free hormone index approximations',
            blurb: 'Index = (total hormone × T-uptake %) ÷ 100',
            kw: ['thyroid', 'fti', 't3 uptake', 'free thyroxine index'],
            fields: [
                choice('kind', 'Index', [['ft4idx', 'FT4 index'], ['ft3idx', 'FT3 index']]),
                num('uptake', 'T3 uptake', { suffix: '%', ph: '30', bounds: { max: 100 } }),
                num('t4', 'Total T4', { units: [['ug/dL', 'µg/dL'], ['nmol/L', 'nmol/L']], ph: '8.0', bounds: (u) => ({ max: u === 'ug/dL' ? 50 : 650 }), showIf: (p) => p.kind === 'ft4idx' }),
                num('t3', 'Total T3', { units: [['ng/dL', 'ng/dL'], ['nmol/L', 'nmol/L']], ph: '120', bounds: (u) => ({ max: u === 'ng/dL' ? 1000 : 15 }), showIf: (p) => p.kind === 'ft3idx' })
            ],
            compute(v) {
                const r = Calc.ftIndex({ kind: v.kind, t4: v.t4, t4Unit: v.t4Unit, t3: v.t3, t3Unit: v.t3Unit, uptake: v.uptake });
                return {
                    primary: { label: v.kind === 'ft4idx' ? 'FT4 index' : 'FT3 index', value: f(r.value), unit: '' },
                    notes: ['Compare with your lab’s reference interval. The FT3 index is less standardised than the FT4 index.']
                };
            }
        }
    ];

    const BY_ID = Object.fromEntries(CALCULATORS.map((c) => [c.id, c]));

    // ---------- input handling ----------
    const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

    /** Accepts Bengali digits and a decimal comma, returns a plain "12.5"-style string. */
    function normalizeNumber(s) {
        return String(s)
            .replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)))
            .replace(/[٫,]/g, '.')
            .replace(/\s+/g, '');
    }

    const unitLabel = (field, unit) => {
        const hit = (field.units || []).find((u) => u[0] === unit);
        return hit ? hit[1] : '';
    };

    function parseNumber(field, rawInput, unit) {
        const raw = normalizeNumber(rawInput || '');
        const o = field;
        const label = unit && o.units && o.units.length > 1 ? `${o.label} (${unitLabel(o, unit)})` : o.label;
        if (raw === '') {
            if (o.optional) return null;
            throw new FieldError(o.id, `${o.label} is required.`);
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new FieldError(o.id, `${o.label} must be a valid number.`);
        if (o.allowZero ? n < 0 : n <= 0) {
            throw new FieldError(o.id, o.allowZero ? `${label} cannot be negative.` : `${label} must be greater than 0.`);
        }
        const b = (typeof o.bounds === 'function' ? o.bounds(unit) : o.bounds) || {};
        if (b.min !== undefined && n < b.min) throw new FieldError(o.id, `${label} looks too low (minimum ${b.min}).`);
        if (b.max !== undefined && n > b.max) throw new FieldError(o.id, `${label} looks too high (maximum ${b.max}).`);
        return n;
    }

    /**
     * Turns raw form state into clean values for compute().
     * source.value(id) -> string | boolean,  source.unit(id) -> unit code
     * Fields hidden by showIf are returned as null / false.
     */
    function collect(calc, source) {
        const peek = {};
        calc.fields.forEach((fl) => { peek[fl.id] = source.value(fl.id); });
        const v = {};
        for (const fl of calc.fields) {
            const visible = !fl.showIf || fl.showIf(peek);
            if (fl.type === 'number') {
                const unit = fl.units ? (fl.units.length === 1 ? fl.units[0][0] : source.unit(fl.id)) : null;
                if (unit) v[fl.id + 'Unit'] = unit;
                v[fl.id] = visible ? parseNumber(fl, peek[fl.id], unit) : null;
            } else if (fl.type === 'switch') {
                v[fl.id] = visible ? !!peek[fl.id] : false;
            } else {
                v[fl.id] = peek[fl.id];
            }
        }
        return v;
    }

    /** Plain-text version of a result, for copy / share. */
    function toText(calc, model, inputs) {
        const out = [`MediCalc Pro · ${calc.name}`];
        if (model.primary) {
            out.push(`${model.primary.label}: ${model.primary.value}${model.primary.unit ? ' ' + model.primary.unit : ''}`);
        }
        if (model.chip) out.push(model.chip.text);
        (model.rows || []).forEach(([a, b]) => out.push(`${a}: ${b}`));
        if (inputs && inputs.length) out.push('', 'Inputs', ...inputs);
        (model.warnings || []).forEach((w) => out.push('', `Warning: ${w}`));
        return out.join('\n');
    }

    const api = { CATEGORIES, CALCULATORS, BY_ID, FieldError, collect, parseNumber, normalizeNumber, unitLabel, toText };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.Registry = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
