// Turns parsed Talos "flight record" rows into a job summary: one row per
// battery run, grouped into per-field (per Plot ID) summaries plus an
// overall total. No GPS/geometry lives in this file -- see fieldBoundary.js
// for how shapes get attached separately.

'use strict';

const KG_TO_LB = 2.20462262;
const L_TO_GAL = 0.264172052;
// The Talos "flight record" export's "Sprayed area" column is in Chinese
// "mu" (亩), not acres, even though the app is US-facing -- confirmed by
// cross-checking a real export against the totals shown on the Talos
// dashboard itself (20.38 acres there == 123.74 mu here, exactly this
// conversion). "Usage Per Mu" is correspondingly genuinely per-mu, so once
// area is converted to acres, per-acre rate is recomputed from scratch
// (totalAmount / totalAcres) rather than trusted from that column.
const MU_TO_ACRE = 0.16474;

function parseFlightTimeRange(str, referenceDate) {
  // Format observed: "2026-09-19 18:05:55-18:09:08" (date, then start-end times, same day).
  if (!str) return { start: null, end: null };
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})-(\d{2}:\d{2}:\d{2})$/.exec(str.trim());
  if (!m) return { start: null, end: null, raw: str };
  const [, date, startT, endT] = m;
  return {
    start: new Date(`${date}T${startT}`),
    end: new Date(`${date}T${endT}`),
    date,
  };
}

function parseDurationToSeconds(str) {
  if (!str) return 0;
  const m = /^(\d+):(\d+)$/.exec(String(str).trim());
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * @param {Array<object>} records - rows from readFirstSheetAsRecords()
 * @returns {object} normalized job summary
 */
function summarizeFlightRecords(records) {
  const passes = records.map((r, i) => {
    const timeRange = parseFlightTimeRange(str(r['Flight time']));
    const plotId = str(r['Plot ID']);
    const fieldName = str(r['Field Name']);
    return {
      index: i,
      serial: str(r['Serial Number']),
      plotId: plotId || null,
      fieldName: fieldName || null,
      taskType: str(r['Task Type']) || 'Unknown',
      crop: str(r['Crop']) || null,
      pilot: str(r['Team Name']) || str(r['Pliot Name']) || null,
      aircraft: str(r['Aircraft name']) || null,
      batterySN: str(r['Battery SN']) || null,
      location: str(r['Location']) || null,
      areaMu: num(r['Sprayed area']),
      area: round(num(r['Sprayed area']) * MU_TO_ACRE, 4), // acres
      totalAmount: num(r['Total Amount(L/Kg)']),
      ratePerMu: num(r['Usage Per Mu(L/Kg/Mu)']), // genuinely per-mu; not used for display, see avgRatePerAcre below
      durationSec: parseDurationToSeconds(r['Flight duration(min:sec)']),
      speed: r['Speed'] === '' ? null : num(r['Speed'], null),
      height: r['Height'] === '' ? null : num(r['Height'], null),
      rowSpacing: r['Row Spacing'] === '' ? null : num(r['Row Spacing'], null),
      start: timeRange.start,
      end: timeRange.end,
      date: timeRange.date || null,
    };
  });

  // Group into fields: rows sharing a Plot ID are the same field. Rows with
  // no Plot ID at all are each their own ad-hoc "field" (no mapped boundary
  // in Talos for that pass), rather than being silently merged together.
  const groupOrder = [];
  const groups = new Map();
  passes.forEach((p) => {
    const key = p.plotId || `__unassigned_${p.index}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(p);
  });

  const fields = groupOrder.map((key, i) => {
    const groupPasses = groups.get(key);
    const totalArea = groupPasses.reduce((s, p) => s + p.area, 0);
    const totalAmount = groupPasses.reduce((s, p) => s + p.totalAmount, 0);
    const totalDuration = groupPasses.reduce((s, p) => s + p.durationSec, 0);
    const starts = groupPasses.map((p) => p.start).filter(Boolean);
    const ends = groupPasses.map((p) => p.end).filter(Boolean);
    const taskTypes = [...new Set(groupPasses.map((p) => p.taskType))];
    const isUnassigned = key.startsWith('__unassigned_');

    return {
      plotId: isUnassigned ? null : key,
      label: isUnassigned ? `Additional pass ${i + 1} (no saved boundary)` : `Field ${i + 1}`,
      fieldName: groupPasses.find((p) => p.fieldName)?.fieldName || null,
      taskType: taskTypes.length === 1 ? taskTypes[0] : taskTypes.join(' + '),
      crop: groupPasses.find((p) => p.crop && p.crop !== 'other')?.crop || groupPasses[0]?.crop || null,
      passCount: groupPasses.length,
      totalAcres: round(totalArea, 2),
      totalAmount: round(totalAmount, 2),
      unit: guessUnit(groupPasses[0]?.taskType),
      avgRatePerAcre: totalArea > 0 ? round(totalAmount / totalArea, 2) : 0,
      totalDurationSec: totalDuration,
      startTime: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
      endTime: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
      location: groupPasses[0]?.location || null,
      pilot: groupPasses[0]?.pilot || null,
      aircraft: groupPasses[0]?.aircraft || null,
      passes: groupPasses,
    };
  });

  const overall = {
    totalAcres: round(fields.reduce((s, f) => s + f.totalAcres, 0), 2),
    totalAmount: round(fields.reduce((s, f) => s + f.totalAmount, 0), 2),
    totalPasses: passes.length,
    fieldCount: fields.length,
    totalDurationSec: fields.reduce((s, f) => s + f.totalDurationSec, 0),
    unit: guessUnit(passes[0]?.taskType),
    taskTypes: [...new Set(passes.map((p) => p.taskType))],
    date: passes.find((p) => p.date)?.date || null,
    location: passes.find((p) => p.location)?.location || null,
    pilot: passes.find((p) => p.pilot)?.pilot || null,
    aircraft: [...new Set(passes.map((p) => p.aircraft).filter(Boolean))].join(', ') || null,
    startTime: minDate(passes.map((p) => p.start)),
    endTime: maxDate(passes.map((p) => p.end)),
  };
  overall.avgRatePerAcre = overall.totalAcres > 0 ? round(overall.totalAmount / overall.totalAcres, 2) : 0;
  overall.totalAmountLb = round(overall.totalAmount * KG_TO_LB, 1);
  overall.totalAmountGal = round(overall.totalAmount * L_TO_GAL, 1);

  fields.forEach((f) => {
    f.totalAmountLb = round(f.totalAmount * KG_TO_LB, 1);
    f.totalAmountGal = round(f.totalAmount * L_TO_GAL, 1);
  });

  return { overall, fields };
}

function guessUnit(taskType) {
  // Spreading = dry product (kg -> lb makes sense); Spraying = liquid (L -> gal).
  if (!taskType) return 'kg';
  return /spray/i.test(taskType) ? 'L' : 'kg';
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function minDate(dates) {
  const valid = dates.filter(Boolean);
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
}
function maxDate(dates) {
  const valid = dates.filter(Boolean);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
}

module.exports = { summarizeFlightRecords };
