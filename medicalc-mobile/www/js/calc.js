/* ==========================================================================
   MediCalc Pro — calc.js
   Pure calculation functions. No DOM access, so the same file runs in the
   app and in Node unit tests (see tests/calc.test.js).
   ========================================================================== */
(function (global) {
    'use strict';

    const Calc = (() => {
        // ----- unit helpers -----
        function factor(unit, table) {
            if (!Object.prototype.hasOwnProperty.call(table, unit)) {
                throw new Error('Unknown unit: ' + unit);
            }
            return table[unit];
        }

        // Each table gives "multiply by this to reach the target unit".
        const CREATININE_TO_MGDL = { 'mg/dL': 1, 'umol/L': 1 / 88.4 };
        const URINE_CREATININE_TO_MGDL = { 'mg/dL': 1, 'mmol/L': 11.312 };
        const ACR_CREATININE_TO_GL = { 'g/L': 1, 'mg/dL': 0.01, 'mmol/L': 0.11312 };
        const ACR_ALBUMIN_TO_MGL = { 'mg/L': 1, 'mg/dL': 10 };
        const GLUCOSE_TO_MMOLL = { 'mmol/L': 1, 'mg/dL': 1 / 18 };
        const INSULIN_TO_UUML = { 'uU/mL': 1, 'pmol/L': 1 / 6.945 };
        const VOLUME_TO_L = { L: 1, mL: 0.001 };
        const VOLUME_TO_ML = { mL: 1, L: 1000 };
        const PROTEIN_TO_GL = { 'g/L': 1, 'mg/L': 0.001, 'mg/dL': 0.01 };
        const PROTEIN_TO_MGL = { 'mg/L': 1, 'mg/dL': 10, 'g/L': 1000 };
        const PCR_CREATININE_TO_MGL = { 'mg/L': 1, 'mg/dL': 10, 'g/L': 1000, 'mmol/L': 113.12 };
        const ALBUMIN_TO_GDL = { 'g/dL': 1, 'g/L': 0.1 };
        const ALBUMIN_TO_GL = { 'g/L': 1, 'g/dL': 10 };
        // urea (MW 60.06): 1 mmol/L = 6.006 mg/dL.  BUN (urea nitrogen): 1 mmol/L = 2.801 mg/dL.
        const UREA_TO_MMOLL = { 'urea-mmol/L': 1, 'urea-mg/dL': 1 / 6.006, 'bun-mg/dL': 1 / 2.801 };
        const HEIGHT_TO_CM = { cm: 1, m: 100, ft: 30.48 };
        const WEIGHT_TO_KG = { kg: 1, g: 0.001 };
        const TESTOSTERONE_TO_NMOLL = { 'nmol/L': 1, 'ng/dL': 0.03467 };

        const TESTOSTERONE_MW = 288.42; // g/mol -> 1 nmol/L = 28.842 ng/dL = 288.42 pg/mL

        /** "umol/L" -> "µmol/L" etc., for display only. */
        function prettyUnit(u) {
            return String(u).replace(/^u(?=g|mol|U)/, 'µ').replace('/uL', '/µL');
        }

        // ----- Coagulation -----
        function ptInr({ patient, control, isi }) {
            const ratio = patient / control;
            return {
                inr: Math.pow(ratio, isi),
                ratio,
                // Rough estimate only. A true Quick % comes from a calibration curve.
                activity: (control / patient) * 100
            };
        }

        // ----- Renal -----
        const EGFR_STAGES = [
            [90, 'G1: ≥90 (normal/high)'],
            [60, 'G2: 60–89 (mildly decreased)'],
            [45, 'G3a: 45–59 (mild to moderately decreased)'],
            [30, 'G3b: 30–44 (moderate to severely decreased)'],
            [15, 'G4: 15–29 (severely decreased)']
        ];

        function egfrStage(value) {
            const hit = EGFR_STAGES.find(([min]) => value >= min);
            return hit ? hit[1] : 'G5: <15 (kidney failure)';
        }

        /** CKD-EPI 2021 (race-free) or CKD-EPI 2009 (optional race coefficient). */
        function egfr({ creatinine, unit, age, sex, equation = '2021', race = false }) {
            const scr = creatinine * factor(unit, CREATININE_TO_MGDL);
            const female = sex === 'female';
            const kappa = female ? 0.7 : 0.9;
            const ratio = scr / kappa;
            const low = Math.min(ratio, 1);
            const high = Math.max(ratio, 1);
            let value;

            if (equation === '2021') {
                const alpha = female ? -0.241 : -0.302;
                value = 142 * Math.pow(low, alpha) * Math.pow(high, -1.2) *
                    Math.pow(0.9938, age) * (female ? 1.012 : 1);
            } else if (equation === '2009') {
                const alpha = female ? -0.329 : -0.411;
                value = 141 * Math.pow(low, alpha) * Math.pow(high, -1.209) *
                    Math.pow(0.993, age) * (female ? 1.018 : 1) * (race ? 1.159 : 1);
            } else {
                throw new Error('Unknown eGFR equation: ' + equation);
            }

            return {
                egfr: value,
                creatinineMgDl: scr,
                creatinineUmolL: scr * 88.4,
                stage: egfrStage(value),
                equation
            };
        }

        /** Cockcroft-Gault (mL/min). */
        function crcl({ creatinine, unit, weight, age, sex }) {
            const scr = creatinine * factor(unit, CREATININE_TO_MGDL);
            const sexFactor = sex === 'female' ? 0.85 : 1;
            return {
                crcl: ((140 - age) * weight * sexFactor) / (72 * scr),
                creatinineMgDl: scr,
                creatinineUmolL: scr * 88.4
            };
        }

        /** Measured clearance from a timed urine collection, plus BSA-corrected value (DuBois). */
        function ccr(p) {
            const U = p.urineCreatinine * factor(p.urineCreatinineUnit, URINE_CREATININE_TO_MGDL);
            const P = p.serumCreatinine * factor(p.serumCreatinineUnit, CREATININE_TO_MGDL);
            const volumeMl = p.volume * factor(p.volumeUnit, VOLUME_TO_ML);
            const flowMlPerMin = volumeMl / (p.hours * 60);
            const heightCm = p.height * factor(p.heightUnit, HEIGHT_TO_CM);
            const weightKg = p.weight * factor(p.weightUnit, WEIGHT_TO_KG);
            const bsa = 0.007184 * Math.pow(heightCm, 0.725) * Math.pow(weightKg, 0.425);
            const raw = (U * flowMlPerMin) / P;
            return { raw, corrected: raw * (1.73 / bsa), bsa };
        }

        // ----- Endocrine -----
        function homa({ glucose, glucoseUnit, insulin, insulinUnit }) {
            const glucoseMmol = glucose * factor(glucoseUnit, GLUCOSE_TO_MMOLL);
            const insulinU = insulin * factor(insulinUnit, INSULIN_TO_UUML);
            const ir = (glucoseMmol * insulinU) / 22.5;
            return {
                glucoseMmol,
                insulinU,
                ir,
                betaPct: glucoseMmol > 3.5 ? (20 * insulinU) / (glucoseMmol - 3.5) : null,
                sensitivityPct: ir > 0 ? 100 / ir : null
            };
        }

        const THYROID = {
            ft4: { a: 'ng/dL', b: 'pmol/L', factor: 12.87 },   // a × factor = b
            ft3: { a: 'pg/mL', b: 'pmol/L', factor: 1.54 },
            t4: { a: 'ug/dL', b: 'nmol/L', factor: 12.87 },
            t3: { a: 'ng/dL', b: 'nmol/L', factor: 0.01536 }
        };

        /** Converts to the "other" unit, in either direction. */
        function convertThyroid(analyte, value, unit) {
            const d = THYROID[analyte];
            if (!d) throw new Error('Unknown analyte: ' + analyte);
            if (unit === d.a) return { converted: value * d.factor, convertedUnit: d.b };
            if (unit === d.b) return { converted: value / d.factor, convertedUnit: d.a };
            throw new Error('Unknown unit: ' + unit);
        }

        function ftIndex({ kind, t4, t4Unit, t3, t3Unit, uptake }) {
            if (kind === 'ft4idx') {
                const t4UgDl = t4 / (t4Unit === 'nmol/L' ? 12.87 : 1);
                return { kind, value: (t4UgDl * uptake) / 100 };
            }
            if (kind === 'ft3idx') {
                const t3NgDl = t3 / (t3Unit === 'nmol/L' ? 0.01536 : 1);
                return { kind, value: (t3NgDl * uptake) / 100 };
            }
            throw new Error('Unknown index: ' + kind);
        }

        /**
         * Calculated free testosterone (Vermeulen).
         * Solves the law-of-mass-action balance, which is a quadratic in free T:
         *   N·Ks·c² + (N + Ks·(SHBG − T))·c − T = 0,   N = 1 + Ka·[albumin]
         * All concentrations in mol/L.
         */
        function freeTestosterone({ total, totalUnit, shbg, albumin, albuminUnit }) {
            const Ka = 3.6e4;   // L/mol, albumin
            const Ks = 1.0e9;   // L/mol, SHBG
            const ALBUMIN_MW = 66500;

            const totalNmol = total * factor(totalUnit, TESTOSTERONE_TO_NMOLL);
            const T = totalNmol * 1e-9;
            const S = shbg * 1e-9;
            const A = (albumin * factor(albuminUnit, ALBUMIN_TO_GL)) / ALBUMIN_MW;

            const N = 1 + Ka * A;
            const a = N * Ks;
            const b = N + Ks * (S - T);
            const root = Math.sqrt(b * b + 4 * a * T);
            // numerically stable form of (-b + root) / (2a)
            const c = b >= 0 ? (2 * T) / (b + root) : (-b + root) / (2 * a);

            const nmolL = c * 1e9;
            return {
                totalNmolL: totalNmol,
                freeNmolL: nmolL,
                freePmolL: nmolL * 1000,
                freeNgDl: nmolL * (TESTOSTERONE_MW / 10),  // 1 nmol/L = 28.842 ng/dL
                freePgMl: nmolL * TESTOSTERONE_MW,         // 1 nmol/L = 288.42 pg/mL
                percentFree: (c / T) * 100
            };
        }

        // ----- Urine -----
        function acrCategory(mgPerG) {
            // KDIGO, mg/g: A1 < 30, A2 30–300, A3 > 300
            if (mgPerG < 30) return { code: 'A1', label: 'Normal to mildly increased' };
            if (mgPerG <= 300) return { code: 'A2', label: 'Moderately increased' };
            return { code: 'A3', label: 'Severely increased' };
        }

        function acr({ albumin, albuminUnit, creatinine, creatinineUnit }) {
            const albuminMgL = albumin * factor(albuminUnit, ACR_ALBUMIN_TO_MGL);
            const creatinineGL = creatinine * factor(creatinineUnit, ACR_CREATININE_TO_GL);
            const mgPerG = albuminMgL / creatinineGL;
            return {
                mgPerG,
                mgPerMmol: mgPerG * 0.11312, // 1 mmol creatinine = 113.12 mg
                category: acrCategory(mgPerG)
            };
        }

        function pcr({ protein, proteinUnit, creatinine, creatinineUnit }) {
            const proteinMgL = protein * factor(proteinUnit, PROTEIN_TO_MGL);
            const creatinineMgL = creatinine * factor(creatinineUnit, PCR_CREATININE_TO_MGL);
            const ratio = proteinMgL / creatinineMgL;                 // mg/mg = g/g
            return {
                ratio,
                mgPerG: ratio * 1000,
                mgPerMmol: proteinMgL / (creatinineMgL / 113.12)
            };
        }

        function urineProtein24h({ concentration, concentrationUnit, volume, volumeUnit }) {
            const totalG = concentration * factor(concentrationUnit, PROTEIN_TO_GL) *
                volume * factor(volumeUnit, VOLUME_TO_L);
            return { totalG, totalMg: totalG * 1000 };
        }

        /** na / k / cl may each be null (not measured). Concentrations in mmol/L (= mEq/L). */
        function urineElectrolytes24h({ na, k, cl, volume, volumeUnit }) {
            const litres = volume * factor(volumeUnit, VOLUME_TO_L);
            const total = (c) => (c === null || c === undefined ? null : c * litres);
            return { na: total(na), k: total(k), cl: total(cl) };
        }

        function urineOsm({ na, k, urea, ureaUnit, glucose, glucoseUnit }) {
            const ureaMmol = urea * factor(ureaUnit, UREA_TO_MMOLL);
            const glucoseMmol = (glucose || 0) * factor(glucoseUnit || 'mmol/L', GLUCOSE_TO_MMOLL);
            return { osm: 2 * (na + k) + ureaMmol + glucoseMmol, ureaMmol, glucoseMmol };
        }

        // ----- Chemistry -----
        /** Osm ≈ 2·Na + glucose + urea (all mmol/L). `bun-mg/dL` is converted with 2.801, not 6. */
        function serumOsm({ na, glucose, glucoseUnit, urea, ureaUnit }) {
            const glucoseMmol = glucose * factor(glucoseUnit, GLUCOSE_TO_MMOLL);
            const ureaMmol = urea * factor(ureaUnit, UREA_TO_MMOLL);
            return { osm: 2 * na + glucoseMmol + ureaMmol, glucoseMmol, ureaMmol };
        }

        function ckmbIndex({ total, mb }) {
            return { index: (mb / total) * 100 };
        }

        /** Albumin correction (Figge): AG + 2.5 × (4.4 − albumin g/dL). */
        function anionGap({ na, k, cl, hco3, albumin, albuminUnit, includeK }) {
            if (includeK && (k === null || k === undefined)) {
                throw new RangeError('K is required when it is included in the anion gap.');
            }
            const ag = na + (includeK ? k : 0) - (cl + hco3);
            let albuminGdl = null;
            let corrected = null;
            if (albumin !== null && albumin !== undefined) {
                albuminGdl = albumin * factor(albuminUnit || 'g/dL', ALBUMIN_TO_GDL);
                corrected = ag + 2.5 * (4.4 - albuminGdl);
            }
            return { ag, albuminGdl, corrected };
        }

        // ----- Hematology -----
        function hemaAbs({ wbc, wbcUnit, neut, lymph, mono, eos, bas }) {
            const wbc109 = wbcUnit === 'cells/uL' ? wbc / 1000 : wbc;
            const abs = (pct) => (pct === null || pct === undefined ? null : wbc109 * (pct / 100));
            const pcts = [neut, lymph, mono, eos, bas];
            return {
                wbc109,
                neut: abs(neut),
                lymph: abs(lymph),
                mono: abs(mono),
                eos: abs(eos),
                bas: abs(bas),
                sumPct: pcts.reduce((s, p) => s + (p || 0), 0),
                allFive: pcts.every((p) => p !== null && p !== undefined)
            };
        }

        return {
            prettyUnit, ptInr, egfr, crcl, ccr, homa, convertThyroid, ftIndex, freeTestosterone,
            acr, acrCategory, pcr, urineProtein24h, urineElectrolytes24h, urineOsm, serumOsm,
            ckmbIndex, anionGap, hemaAbs
        };
    })();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Calc;
    } else {
        global.Calc = Calc;
    }
})(typeof window !== 'undefined' ? window : globalThis);
