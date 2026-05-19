import { EXAMS } from './exams.js';

const DIFF = {
  Spanish: 100, History: 91, "English Language": 82, "Further Mathematics": 73,
  "Computer Science": 64, "English Literature": 55, Economics: 46, Biology: 36,
  Chemistry: 27, Physics: 18, Mathematics: 9,
};
const ALEV = new Set(["Mathematics", "Further Mathematics", "Physics", "Economics"]);
const ALL_SUBJS = Object.keys(DIFF);

export const DEFAULT_WEIGHTS = { urgency: 0.48, recency: 0.32, difficulty: 0.14, alevel: 0.06 };

export const DEFAULT_TODOS = [
  { id: 'breakfast', name: 'Breakfast', start: 8 * 60,       end: 8 * 60 + 30,  days: [], color: '#8b9ab0' },
  { id: 'lunch',     name: 'Lunch',     start: 12 * 60 + 30, end: 13 * 60,       days: [], color: '#8b9ab0' },
  { id: 'dinner',    name: 'Dinner',    start: 19 * 60 + 15, end: 20 * 60,       days: [], color: '#8b9ab0' },
];

export function toMins(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function toEpoch(dateStr, minutes) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, 0, minutes).getTime();
}

export function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function fmtTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function calcPri(subj, ds, curMinutes, lastSessionMs, weights = DEFAULT_WEIGHTS) {
  const ce = toEpoch(ds, curMinutes);
  const futureExams = EXAMS
    .filter(e => e.subj === subj && toEpoch(e.date, toMins(e.end)) > ce)
    .sort((a, b) => toEpoch(a.date, toMins(a.start)) - toEpoch(b.date, toMins(b.start)));
  if (!futureExams.length) return 0;

  const hrs = (toEpoch(futureExams[0].date, toMins(futureExams[0].start)) - ce) / 3600000;
  const urg = hrs <= 0 ? 0 : hrs <= 2 ? 58 : hrs <= 8 ? 100 : hrs <= 16 ? 94 : hrs <= 24 ? 86 :
    hrs <= 36 ? 72 : hrs <= 48 ? 58 : hrs <= 72 ? 44 : hrs <= 120 ? 30 : hrs <= 168 ? 20 : 12;

  const hoursAgo = lastSessionMs ? Math.max(0, (ce - lastSessionMs) / 3600000) : 9999;
  let rec = hoursAgo < 0.5 ? 0 : hoursAgo < 1 ? 12 : hoursAgo < 2 ? 25 : hoursAgo < 4 ? 42 :
    hoursAgo < 8 ? 60 : hoursAgo < 16 ? 76 : hoursAgo < 24 ? 90 : hoursAgo < 48 ? 97 : 100;
  if (subj === "Spanish" && rec > 10) rec = Math.min(100, rec * 1.25);
  if (subj === "Further Mathematics" && rec > 10) rec = Math.min(100, rec * 1.10);

  const w = weights;
  return Math.round((urg * w.urgency + rec * w.recency + DIFF[subj] * w.difficulty + (ALEV.has(subj) ? 100 : 0) * w.alevel) * 10) / 10;
}

function getSessionDur(subj, ds, curMinutes, maxLen, spanishIdx) {
  if (subj === "Spanish") return Math.min([40, 45, 50][spanishIdx % 3], maxLen);
  const ce = toEpoch(ds, curMinutes);
  const next = EXAMS
    .filter(e => e.subj === subj && toEpoch(e.date, toMins(e.start)) > ce)
    .sort((a, b) => toEpoch(a.date, toMins(a.start)) - toEpoch(b.date, toMins(b.start)))[0];
  if (!next) return Math.min(45, maxLen);
  const hrs = (toEpoch(next.date, toMins(next.start)) - ce) / 3600000;
  const base = hrs <= 12 ? 44 : hrs <= 24 ? 54 : hrs <= 36 ? 64 : hrs <= 72 ? 78 : hrs <= 168 ? 90 : 105;
  return Math.min(base, maxLen);
}

function dowOf(ds) {
  const [y, mo, d] = ds.split('-').map(Number);
  return new Date(y, mo - 1, d).getDay();
}

// Build fixed blocks for a day (exams + travel + review + user todos)
function buildDayMeta(ds, userTodos = []) {
  const todayExams = EXAMS.filter(e => e.date === ds).sort((a, b) => toMins(a.start) - toMins(b.start));
  const tomorrowExams = EXAMS.filter(e => e.date === addDays(ds, 1));
  const hasExamToday = todayExams.length > 0;
  const hasExamTomorrow = tomorrowExams.length > 0;

  const maxLen = hasExamToday ? 50 : hasExamTomorrow ? 65 : 115;
  const dayEnd = hasExamTomorrow ? 21 * 60 : 20 * 60;
  const dayStart = 6 * 60 + 20;

  const fixed = [];

  if (hasExamTomorrow) {
    fixed.push({ type: 'review', label: 'Past Paper Review', start: 20 * 60, end: 21 * 60 });
  }

  if (hasExamToday) {
    const groups = [];
    let grp = [todayExams[0]];
    for (let i = 1; i < todayExams.length; i++) {
      const gap = toMins(todayExams[i].start) - toMins(grp[grp.length - 1].end);
      if (gap < 90) grp.push(todayExams[i]);
      else { groups.push(grp); grp = [todayExams[i]]; }
    }
    groups.push(grp);

    const firstStart = toMins(groups[0][0].start);
    fixed.push({ type: 'travel', label: 'Travel to exam', start: firstStart - 60, end: firstStart });
    const lastGrp = groups[groups.length - 1];
    const lastEnd = toMins(lastGrp[lastGrp.length - 1].end);
    fixed.push({ type: 'travel', label: 'Travel home', start: lastEnd, end: lastEnd + 60 });

    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        const ex = g[i];
        fixed.push({ type: 'exam', id: ex.id, label: ex.subj, sublabel: ex.paper, subj: ex.subj, start: toMins(ex.start), end: toMins(ex.end), seat: ex.seat });
        if (i < g.length - 1) {
          const nxt = g[i + 1];
          const bs = toMins(ex.end), be = toMins(nxt.start);
          if (be > bs) fixed.push({ type: 'break', label: 'Break', start: bs, end: be });
        }
      }
    }
  }

  // User todos filtered by day of week
  const dow = dowOf(ds);
  for (const t of userTodos) {
    if (!t.days || t.days.length === 0 || t.days.includes(dow)) {
      fixed.push({ type: 'todo', id: t.id, label: t.name, name: t.name, start: t.start, end: t.end, todoColor: t.color || '#8b5cf6', days: t.days || [] });
    }
  }

  fixed.sort((a, b) => a.start - b.start);
  return { fixed, dayEnd, maxLen, dayStart };
}

export function generateSchedule(ds, lastSeen = {}, weights = DEFAULT_WEIGHTS, userTodos = []) {
  const { fixed, dayEnd, maxLen, dayStart } = buildDayMeta(ds, userTodos);

  const result = [];
  const lsNow = { ...lastSeen };
  let sessionIdx = 0;
  let spanishIdx = 0;
  let cursor = dayStart;

  const getActiveFixed = (at) => fixed.find(b => b.start <= at && at < b.end);
  const getNextFixed = (from) => fixed.filter(b => b.start > from).sort((a, b) => a.start - b.start)[0];

  while (cursor < dayEnd) {
    const af = getActiveFixed(cursor);
    if (af) {
      result.push({ ...af, startFmt: fmtTime(af.start), endFmt: fmtTime(af.end) });
      cursor = af.end;
      continue;
    }

    const nf = getNextFixed(cursor);
    const freeUntil = nf ? nf.start : dayEnd;
    if (freeUntil - cursor < 15) { cursor = freeUntil; continue; }

    const pris = ALL_SUBJS
      .map(subj => ({ subj, pri: calcPri(subj, ds, cursor, lsNow[subj] || null, weights) }))
      .filter(x => x.pri > 0)
      .sort((a, b) => b.pri - a.pri);

    if (!pris.length) { cursor = freeUntil; continue; }

    const { subj } = pris[0];
    const dur = getSessionDur(subj, ds, cursor, maxLen, spanishIdx);
    if (subj === 'Spanish') spanishIdx++;

    const actualDur = Math.min(dur, freeUntil - cursor);
    if (actualDur < 15) { cursor = freeUntil; continue; }

    const id = `${ds}-R${sessionIdx++}`;
    result.push({ type: 'study', id, subj, label: subj, start: cursor, end: cursor + actualDur, startFmt: fmtTime(cursor), endFmt: fmtTime(cursor + actualDur), duration: actualDur });

    lsNow[subj] = toEpoch(ds, cursor + actualDur);
    cursor += actualDur;
    if (cursor + 5 <= freeUntil) cursor += 5;
  }

  return result;
}

export function resetSchedule(ds, fromMinutes, existingSchedule, lastSeen, weights = DEFAULT_WEIGHTS, userTodos = []) {
  const { fixed, dayEnd, maxLen } = buildDayMeta(ds, userTodos);
  const allFixed = fixed.map(b => ({ ...b, startFmt: fmtTime(b.start), endFmt: fmtTime(b.end) }));

  const beforeCut = existingSchedule.filter(item => item.end <= fromMinutes);
  const futureFixed = allFixed.filter(b => b.end > fromMinutes);

  const lsNow = { ...lastSeen };
  beforeCut.filter(i => i.type === 'study').forEach(i => {
    if (!lsNow[i.subj] || lsNow[i.subj] < toEpoch(ds, i.end)) lsNow[i.subj] = toEpoch(ds, i.end);
  });

  let cursor = fromMinutes;
  const activeFixed = allFixed.find(b => b.start <= fromMinutes && fromMinutes < b.end);
  if (activeFixed) cursor = activeFixed.end;

  const getActiveF = (at) => allFixed.find(b => b.start <= at && at < b.end);
  const getNextF = (from) => allFixed.filter(b => b.start > from).sort((a, b) => a.start - b.start)[0];

  const newStudy = [];
  let sessionIdx = 1000;
  let spanishIdx = 0;

  while (cursor < dayEnd) {
    const af = getActiveF(cursor);
    if (af) { cursor = af.end; continue; }

    const nf = getNextF(cursor);
    const freeUntil = nf ? nf.start : dayEnd;
    if (freeUntil - cursor < 15) { cursor = freeUntil; continue; }

    const pris = ALL_SUBJS
      .map(subj => ({ subj, pri: calcPri(subj, ds, cursor, lsNow[subj] || null, weights) }))
      .filter(x => x.pri > 0)
      .sort((a, b) => b.pri - a.pri);

    if (!pris.length) { cursor = freeUntil; continue; }

    const { subj } = pris[0];
    const dur = getSessionDur(subj, ds, cursor, maxLen, spanishIdx);
    if (subj === 'Spanish') spanishIdx++;
    const actualDur = Math.min(dur, freeUntil - cursor);
    if (actualDur < 15) { cursor = freeUntil; continue; }

    const id = `${ds}-RR${sessionIdx++}`;
    newStudy.push({ type: 'study', id, subj, label: subj, start: cursor, end: cursor + actualDur, startFmt: fmtTime(cursor), endFmt: fmtTime(cursor + actualDur), duration: actualDur });

    lsNow[subj] = toEpoch(ds, cursor + actualDur);
    cursor += actualDur;
    if (cursor + 5 <= freeUntil) cursor += 5;
  }

  return [...beforeCut, ...futureFixed, ...newStudy].sort((a, b) => a.start - b.start);
}

export function calcAllPriorities(ds, curMinutes, lastSeen, weights = DEFAULT_WEIGHTS) {
  return ALL_SUBJS
    .map(subj => ({ subj, pri: calcPri(subj, ds, curMinutes, lastSeen[subj] || null, weights) }))
    .filter(x => x.pri > 0)
    .sort((a, b) => b.pri - a.pri);
}
