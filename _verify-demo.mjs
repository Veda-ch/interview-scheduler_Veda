/** Drives every demo beat through the real API and reports what actually happened. */
import { DateTime } from 'luxon';

const BASE = 'http://localhost:4000/api';
let pass = 0, fail = 0;
const notes = [];

function ok(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? ' -- ' + detail : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`); }
}
function note(s) { notes.push(s); console.log(`  ..    ${s}`); }

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function login(email) {
  const r = await call('POST', '/auth/login', { body: { email, password: 'Password123' } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.accessToken;
}

const IST = 'Asia/Kolkata';
const LON = 'Europe/London';

function weekdayAfter(zone, n) {
  let d = DateTime.now().setZone(zone).startOf('day').plus({ days: 1 });
  let seen = 0;
  for (let i = 0; i < 60; i += 1) {
    if (d.weekday <= 5) { if (seen === n) return d; seen += 1; }
    d = d.plus({ days: 1 });
  }
  return d;
}

const main = async () => {
console.log('\n=== logging in ===');
const T = {};
for (const [k, email] of Object.entries({
  kavya: 'recruiter@scheduler.dev',
  aisha: 'aisha.khan@example.dev',
  rahul: 'rahul.mehta@example.dev',
  grace: 'grace.adeyemi@example.dev',
  ananya: 'ananya.sharma@company.dev',
  priya: 'priya.nair@company.dev',
  leila: 'leila.haddad@company.dev',
  carlos: 'carlos.mendes@company.dev',
})) {
  T[k] = await login(email);
}
ok('all eight personas can log in', Object.keys(T).length === 8);

// --- find the open requests
const list = await call('GET', '/interview-requests?limit=50', { token: T.kavya });
const items = list.json?.items ?? list.json ?? [];
const byCandidate = {};
for (const r of items) {
  const n = r.candidate?.name || r.application?.candidate?.user?.name;
  if (n) (byCandidate[n] ??= []).push(r);
}
console.log('  requests seen:', Object.entries(byCandidate).map(([k, v]) => `${k}:${v.map(x => x.status).join('/')}`).join('  '));

const reqAisha = (byCandidate['Aisha Khan'] || [])[0];
const reqRahul = (byCandidate['Rahul Mehta'] || [])[0];
const reqGrace = (byCandidate['Grace Adeyemi'] || [])[0];
ok('three open PENDING requests exist', [reqAisha, reqRahul, reqGrace].every((r) => r?.status === 'PENDING'));

// ============================ BEAT 2: happy path ============================
console.log('\n=== BEAT 2: Aisha (London mornings) -> instant book ===');
{
  const d1 = weekdayAfter(LON, 0), d2 = weekdayAfter(LON, 1);
  const slots = [
    { startUtc: d1.set({ hour: 9 }).toUTC().toISO(), endUtc: d1.set({ hour: 12 }).toUTC().toISO() },
    { startUtc: d2.set({ hour: 9 }).toUTC().toISO(), endUtc: d2.set({ hour: 12 }).toUTC().toISO() },
  ];
  const r = await call('POST', `/interview-requests/${reqAisha.id}/candidate-slots`, { token: T.aisha, body: { slots } });
  ok('slot submission accepted', r.status === 200 || r.status === 201, `status ${r.status}`);
  const outcome = r.json?.outcome;
  ok('outcome is BOOKED', outcome === 'BOOKED', `got ${outcome} ${r.json?.reason || ''}`);

  const after = await call('GET', `/interview-requests/${reqAisha.id}`, { token: T.kavya });
  ok('request is SCHEDULED', after.json?.status === 'SCHEDULED', `got ${after.json?.status}`);

  const ivs = await call('GET', '/interviews?limit=50', { token: T.kavya });
  const mine = (ivs.json?.items ?? ivs.json ?? []).find((i) => i.requestId === reqAisha.id);
  if (mine) {
    const seat = mine.panel?.[0];
    note(`booked with ${seat?.name || seat?.interviewer?.user?.name} at ${DateTime.fromISO(mine.startUtc).setZone(LON).toFormat('ccc HH:mm')} London / ${DateTime.fromISO(mine.startUtc).setZone(IST).toFormat('HH:mm')} IST`);
    ok('interviewer is Ananya Sharma', (seat?.name || seat?.interviewer?.user?.name) === 'Ananya Sharma');
    ok('seat auto-accepted (declared window = consent)', seat?.responseStatus === 'ACCEPTED', `got ${seat?.responseStatus}`);
  } else { ok('interview row found', false); }
}

// ============================ BEAT 3: ranking ==============================
console.log('\n=== BEAT 3: ranking + AI skill adjacency ===');
{
  const r = await call('POST', '/scheduler/match-interviewers', { token: T.kavya, body: { requestId: reqAisha.id } });
  const ranked = r.json?.ranked ?? [];
  note(`provider=${r.json?.aiProvider} fallbackUsed=${r.json?.fallbackUsed}`);
  note('order: ' + ranked.slice(0, 5).map((x) => `${x.name} ${x.matchScore}`).join(', '));
  ok('Ananya ranks first', ranked[0]?.name === 'Ananya Sharma', `got ${ranked[0]?.name}`);
  const priya = ranked.find((x) => x.name === 'Priya Nair');
  ok('an interviewer missing the must-haves ranks below one who has them', (priya?.matchScore ?? 100) < (ranked[0]?.matchScore ?? 0), `Priya ${priya?.matchScore} vs top ${ranked[0]?.matchScore}`);
  const top = ranked[0];
  const per = top?.perSkill ?? [];
  const msg = per.find((p) => /messaging/i.test(p.required || p.skill || ''));
  const db = per.find((p) => /relational/i.test(p.required || p.skill || ''));
  note('per-skill: ' + per.map((p) => `${p.required || p.skill}<-${p.covered_by || p.matched_with || '-'}=${p.coverage ?? p.score}`).join('  '));
  ok('adjacency scored Distributed Messaging above zero', (msg?.coverage ?? msg?.score ?? 0) > 0, JSON.stringify(msg || {}));
  ok('adjacency scored Relational Databases above zero', (db?.coverage ?? db?.score ?? 0) > 0, JSON.stringify(db || {}));
  ok('the LLM path was used, not the lexical fallback', r.json?.fallbackUsed === false, `aiProvider=${r.json?.aiProvider} fallbackUsed=${r.json?.fallbackUsed}`);
}

// ============================ BEAT 4/5: the ladder =========================
console.log('\n=== BEAT 4: Rahul (IST afternoons) -> offer ladder ===');
let offer1 = null;
{
  const d1 = weekdayAfter(IST, 0), d2 = weekdayAfter(IST, 1);
  const slots = [
    { startUtc: d1.set({ hour: 14 }).toUTC().toISO(), endUtc: d1.set({ hour: 17 }).toUTC().toISO() },
    { startUtc: d2.set({ hour: 14 }).toUTC().toISO(), endUtc: d2.set({ hour: 17 }).toUTC().toISO() },
  ];
  const r = await call('POST', `/interview-requests/${reqRahul.id}/candidate-slots`, { token: T.rahul, body: { slots } });
  ok('outcome is OFFER_SENT (not booked)', r.json?.outcome === 'OFFER_SENT', `got ${r.json?.outcome}`);

  const after = await call('GET', `/interview-requests/${reqRahul.id}`, { token: T.kavya });
  ok('request is WAITING', after.json?.status === 'WAITING', `got ${after.json?.status}`);

  const inbox = await call('GET', '/offers/mine', { token: T.priya });
  const mine = (inbox.json?.items ?? inbox.json ?? []).filter((o) => o.status === 'PENDING');
  offer1 = mine[0];
  ok('Priya (rank 1) has the pending offer', !!offer1, `${mine.length} pending`);
  if (offer1) note(`offer rank ${offer1.rank}, ${offer1.slots?.length ?? 0} slots on the table`);
}

console.log('\n=== BEAT 5: two declines -> fallback B -> candidate picks ===');
{
  const d1 = await call('POST', `/offers/${offer1.id}/decline`, { token: T.priya, body: { reason: 'Booked with a release that week.' } });
  ok('Priya can decline', d1.status === 200, `status ${d1.status}`);
  note(`after decline 1: ${d1.json?.outcome ?? JSON.stringify(d1.json).slice(0, 120)}`);

  const inbox2 = await call('GET', '/offers/mine', { token: T.leila });
  const offer2 = (inbox2.json?.items ?? inbox2.json ?? []).filter((o) => o.status === 'PENDING')[0];
  ok('escalated to Leila (rank 2)', !!offer2, offer2 ? `rank ${offer2.rank}` : 'no offer');

  if (offer2) {
    const d2 = await call('POST', `/offers/${offer2.id}/decline`, { token: T.leila, body: { reason: 'Teaching that afternoon.' } });
    ok('Leila can decline', d2.status === 200, `status ${d2.status}`);
    note(`after decline 2: ${d2.json?.outcome ?? ''}`);
  }

  const after = await call('GET', `/interview-requests/${reqRahul.id}`, { token: T.kavya });
  ok('request is SLOTS_OFFERED (fallback B)', after.json?.status === 'SLOTS_OFFERED', `got ${after.json?.status}`);

  const offered = await call('GET', `/interview-requests/${reqRahul.id}/offered-slots`, { token: T.rahul });
  const who = offered.json?.interviewer?.name || offered.json?.interviewer?.user?.name;
  const slots = offered.json?.slots ?? [];
  note(`fallback-B host: ${who}, ${slots.length} slots, first = ${slots[0] ? DateTime.fromISO(slots[0].startUtc).setZone(IST).toFormat('ccc HH:mm') : 'none'} IST`);
  ok('candidate is offered somebody\'s real availability', slots.length > 0);
  ok('offered times are sane for the candidate (not the middle of the night)', slots.length > 0 && DateTime.fromISO(slots[0].startUtc).setZone(IST).hour >= 8);

  if (slots.length) {
    const pick = slots[0];
    const c = await call('POST', `/interview-requests/${reqRahul.id}/choose-slot`, {
      token: T.rahul,
      body: { interviewerId: offered.json.interviewer.interviewerId || offered.json.interviewer.id, startUtc: pick.startUtc, endUtc: pick.endUtc },
    });
    ok('candidate can book the chosen slot', c.status === 200 || c.status === 201, `status ${c.status} ${c.text.slice(0, 160)}`);
    const fin = await call('GET', `/interview-requests/${reqRahul.id}`, { token: T.kavya });
    ok('request ends SCHEDULED', fin.json?.status === 'SCHEDULED', `got ${fin.json?.status}`);

    const ivs = await call('GET', '/interviews?limit=50', { token: T.kavya });
    const mine = (ivs.json?.items ?? ivs.json ?? []).find((i) => i.requestId === reqRahul.id);
    const seat = mine?.panel?.[0];
    note(`fallback-B seat: ${seat?.name || seat?.interviewer?.user?.name} -> ${seat?.responseStatus}`);
    ok('fallback-B seat is ACCEPTED (clean finish)', seat?.responseStatus === 'ACCEPTED', `got ${seat?.responseStatus}`);
  }
}

// ============================ BEAT 6: honest failure ========================
console.log('\n=== BEAT 6: Grace, an HR round nobody conducts ===');
{
  const d1 = weekdayAfter(LON, 0);
  const slots = [{ startUtc: d1.set({ hour: 10 }).toUTC().toISO(), endUtc: d1.set({ hour: 13 }).toUTC().toISO() }];
  const r = await call('POST', `/interview-requests/${reqGrace.id}/candidate-slots`, { token: T.grace, body: { slots } });
  ok('outcome is FAILED', r.json?.outcome === 'FAILED', `got ${r.json?.outcome}`);
  note(`reason: ${r.json?.reason || r.json?.request?.failureReason}`);
  const after = await call('GET', `/interview-requests/${reqGrace.id}`, { token: T.kavya });
  ok('request status is FAILED', after.json?.status === 'FAILED', `got ${after.json?.status}`);
  ok('a human-readable reason is stored', !!after.json?.failureReason, after.json?.failureReason || '');
}

// ============================ BEAT 7: feedback + AI =========================
console.log('\n=== BEAT 7: Carlos submits feedback -> AI analysis ===');
{
  const ivs = await call('GET', '/interviews?status=COMPLETED&limit=50', { token: T.carlos });
  const all = ivs.json?.items ?? ivs.json ?? [];
  const yusuf = all.find((i) => (i.candidate?.name || '') === 'Yusuf Demir');
  ok('Carlos can see Yusuf\'s completed round', !!yusuf, `${all.length} completed visible`);
  if (yusuf) {
    const started = Date.now();
    const r = await call('POST', `/interviews/${yusuf.id}/feedback`, {
      token: T.carlos,
      body: {
        overallRating: 4,
        recommendation: 'YES',
        ratings: { 'Technical Knowledge': 4, 'Problem Solving': 4, Communication: 5 },
        comments:
          'Strong React fundamentals and a clear sense of component boundaries. Explained the reasoning behind ' +
          'state placement well. Struggled a little with the accessibility follow-up and had not used ARIA live ' +
          'regions before, which is worth probing in the next round.',
      },
    });
    ok('feedback accepted', r.status === 201, `status ${r.status} ${r.text.slice(0, 200)}`);
    const fb = r.json?.feedback ?? r.json;
    const analysis = fb?.aiAnalysis ?? (fb?.aiAnalysisJson ? JSON.parse(fb.aiAnalysisJson) : null);
    note(`took ${((Date.now() - started) / 1000).toFixed(1)}s, provider=${fb?.aiProviderUsed}`);
    ok('an AI analysis came back', !!analysis, JSON.stringify(analysis || {}).slice(0, 200));
    if (analysis) {
      ok('analysis has a non-empty summary', !!(analysis.summary || '').trim(), analysis.summary || '(empty)');
      ok('analysis lists strengths', (analysis.strengths || []).length > 0);
      note(`gaps: ${JSON.stringify(analysis.skill_gaps || analysis.gaps || [])}`);
    }
  }
}

// ============================ BEAT 8: Control Tower =========================
console.log('\n=== BEAT 8: approve the recovery that needs a human ===');
{
  const snap = await call('GET', '/control-tower', { token: T.kavya });
  const incidents = snap.json?.incidents ?? snap.json?.openIncidents ?? [];
  note(`control tower shows ${incidents.length} incidents in the snapshot`);

  const listed = await call('GET', '/control-tower/incidents?includeResolved=true&take=50', { token: T.kavya });
  const rows = listed.json?.items ?? listed.json ?? [];
  const awaiting = rows.find((i) => i.status === 'AWAITING_APPROVAL');
  const resolved = rows.filter((i) => i.status === 'RESOLVED');
  ok('one incident is awaiting approval', !!awaiting, awaiting?.title || '');
  ok('two incidents already recovered themselves', resolved.length >= 2, `${resolved.length} resolved`);

  if (awaiting) {
    const before = await call('GET', `/control-tower/incidents/${awaiting.id}`, { token: T.kavya });
    const iv = before.json?.interview;
    const wasAt = iv?.startUtc;
    const r = await call('POST', `/control-tower/incidents/${awaiting.id}/approve`, { token: T.kavya, body: {} });
    ok('approval applies the plan', r.status === 200, `status ${r.status} ${r.text.slice(0, 200)}`);
    const after = await call('GET', `/control-tower/incidents/${awaiting.id}`, { token: T.kavya });
    note(`incident status now ${after.json?.status}`);
    const nowAt = after.json?.interview?.startUtc;
    if (wasAt && nowAt) {
      const moved = (new Date(nowAt) - new Date(wasAt)) / 60000;
      note(`interview moved ${moved} minutes (${DateTime.fromISO(wasAt).setZone(IST).toFormat('HH:mm')} -> ${DateTime.fromISO(nowAt).setZone(IST).toFormat('HH:mm')} IST)`);
      ok('the interview actually shifted by 60 minutes', moved === 60, `moved ${moved}`);
    }
  }
}

// ============================ ride-alongs ===================================
console.log('\n=== ride-alongs ===');
{
  const n = await call('GET', '/notifications', { token: T.kavya });
  note(`recruiter notifications: ${(n.json?.items ?? []).length}, unread ${n.json?.unread ?? '?'}`);
  const a = await call('GET', '/analytics/overview', { token: T.kavya });
  ok('analytics overview returns data', a.status === 200, `status ${a.status}`);
  const au = await call('GET', '/audit-logs?limit=10', { token: T.kavya });
  ok('audit trail is populated', ((au.json?.items ?? au.json ?? []).length) > 0);
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
};

main().catch((e) => { console.error('\nHARNESS ERROR:', e); process.exit(1); });
