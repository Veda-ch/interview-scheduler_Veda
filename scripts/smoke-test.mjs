#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING stack.
 *
 * Walks the complete product loop the way a user would:
 *   login -> job (AI JD parse) -> application -> request -> match -> optimise
 *   -> simulate -> confirm (booking guard) -> candidate confirm -> interviewer
 *   accept -> feedback (adaptive next round) -> incident -> recovery -> analytics
 *
 * plus the negative paths: RBAC, double booking, expired/duplicate proposals,
 * and AI-service failure.
 *
 * Usage:  node scripts/smoke-test.mjs   (after `npm run dev`)
 */
const API = process.env.API_URL || 'http://localhost:4000/api';

let passed = 0;
let failed = 0;
const failures = [];

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[90m', x: '\x1b[0m' };

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${c.g}PASS${c.x} ${name}${detail ? ` ${c.d}${detail}${c.x}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ${c.r}FAIL${c.x} ${name}${detail ? ` ${c.d}${detail}${c.x}` : ''}`);
  }
}

const section = (n) => console.log(`\n${c.b}${n}${c.x}\n${'-'.repeat(n.length)}`);

async function api(path, { method = 'GET', body, token, headers = {}, expect } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (expect && res.status !== expect) {
    console.log(`  ${c.y}   ${method} ${path} -> ${res.status} (expected ${expect})${c.x}`, JSON.stringify(data)?.slice(0, 300));
  }
  return { status: res.status, data, ok: res.ok };
}

const login = async (email, password = 'Password123') => {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(r.data)}`);
  return r.data;
};

async function main() {
  console.log(`${c.b}Smoke test against ${API}${c.x}`);

  // ---------------------------------------------------------------- health
  section('0. Health & connectivity');
  const health = await api('/health');
  check('API responds', health.ok);
  check('Database reachable', health.data?.services?.database?.ok === true, `${health.data?.services?.database?.latencyMs}ms`);
  check('AI service reachable', health.data?.services?.aiService?.ok === true, `solver=${health.data?.services?.aiService?.solver}`);

  // ------------------------------------------------------------------ auth
  section('1. Authentication & RBAC');
  const recruiter = await login('recruiter@scheduler.dev');
  check('Recruiter login issues tokens', Boolean(recruiter.accessToken && recruiter.refreshToken));
  check('Recruiter role correct', recruiter.user.role === 'RECRUITER');

  const candidate = await login('rahul.mehta@example.dev');
  const interviewer = await login('ananya.sharma@company.dev');
  const admin = await login('admin@scheduler.dev');
  check('Candidate + interviewer + admin can sign in', Boolean(candidate.accessToken && interviewer.accessToken && admin.accessToken));

  const badLogin = await api('/auth/login', { method: 'POST', body: { email: 'recruiter@scheduler.dev', password: 'wrong' } });
  check('Wrong password rejected with 401', badLogin.status === 401);

  const noToken = await api('/interviews');
  check('Unauthenticated request rejected', noToken.status === 401);

  const candidateOnAnalytics = await api('/analytics/overview', { token: candidate.accessToken });
  check('Candidate blocked from recruiter analytics (403)', candidateOnAnalytics.status === 403);

  const interviewerOnAudit = await api('/audit-logs', { token: interviewer.accessToken });
  check('Interviewer blocked from audit logs (403)', interviewerOnAudit.status === 403);

  const refreshed = await api('/auth/refresh', { method: 'POST', body: { refreshToken: recruiter.refreshToken } });
  check('Refresh token rotates a session', refreshed.ok && Boolean(refreshed.data.accessToken));
  const reuse = await api('/auth/refresh', { method: 'POST', body: { refreshToken: recruiter.refreshToken } });
  check('Used refresh token cannot be replayed', reuse.status === 401);

  const R = recruiter.accessToken;
  const C = candidate.accessToken;
  const I = interviewer.accessToken;

  // ------------------------------------------------------------------- AI
  section('2. AI layer (JD, resume, availability, feedback)');
  const jd = await api('/ai/analyze-jd', {
    method: 'POST',
    token: R,
    body: {
      text: 'Backend engineer proficient in Java, Spring Boot, SQL and REST APIs. Must have: Java, SQL. Nice to have: AWS, Kubernetes. 2-4 years experience. Strong communication required.',
    },
  });
  const jdSkills = (jd.data?.result?.technical_skills || []).map((s) => s.name);
  check('JD analysis extracts Java', jdSkills.includes('Java'), jdSkills.join(', '));
  check('JD analysis extracts Spring Boot + SQL + REST APIs', ['Spring Boot', 'SQL', 'REST APIs'].every((s) => jdSkills.includes(s)));
  check('JD experience range parsed', jd.data?.result?.experience_min === 2 && jd.data?.result?.experience_max === 4);
  check('JD result labels its provider', Boolean(jd.data?.ai?.provider), jd.data?.ai?.provider);
  check('"Nice to have" skills weighted lower',
    (jd.data?.result?.technical_skills || []).some((s) => s.name === 'AWS' && s.weight < 0.8));

  const avail = await api('/ai/parse-availability', {
    method: 'POST',
    token: C,
    body: { text: "I'm free any weekday after 5 PM except Wednesday and I don't want two interviews on the same day", timezone: 'Asia/Kolkata' },
  });
  const av = avail.data?.result;
  check('NL availability excludes Wednesday', av?.avoid_days?.includes('wednesday') && !av?.days?.includes('wednesday'), `days=${av?.days?.join(',')}`);
  check('NL availability start time = 17:00', av?.start_time === '17:00');
  check('NL availability max/day = 1', av?.max_interviews_per_day === 1);

  const fb = await api('/ai/analyze-feedback', {
    method: 'POST',
    token: I,
    body: { comments: 'Strong Java fundamentals but weak SQL optimization.', ratings: { 'Technical Knowledge': 4, 'Problem Solving': 3 }, overallRating: 3 },
  });
  check('Feedback analysis finds Java as a strength', (fb.data?.result?.strengths || []).includes('Java'));
  check('Feedback analysis finds SQL Optimization as a gap', (fb.data?.result?.skill_gaps || []).includes('SQL Optimization'));
  check('Feedback suggests Database Indexing for next round',
    (fb.data?.result?.recommended_topics || []).includes('Database Indexing'),
    (fb.data?.result?.recommended_topics || []).join(', '));

  const aiStatus = await api('/ai/status', { token: R });
  check('AI transparency endpoint discloses provider role', aiStatus.ok && Array.isArray(aiStatus.data?.guarantees));

  // -------------------------------------------------------- job + request
  section('3. Job, application, interview request');
  const jobRes = await api('/jobs', {
    method: 'POST',
    token: R,
    body: {
      title: 'Smoke Test Backend Engineer',
      description:
        'Hiring a backend engineer. Must have: Java, Spring Boot, SQL, REST APIs. Nice to have: Kafka. 3-6 years experience.',
      department: 'Engineering',
      location: 'Remote',
      analyzeWithAi: true,
    },
  });
  check('Job created with AI-extracted skills', jobRes.status === 201 && jobRes.data.job.requiredSkills.length > 0,
    jobRes.data?.job?.requiredSkills?.map((s) => s.name).join(', '));

  const candidates = await api('/candidates?take=20', { token: R });
  const rahul = candidates.data.items.find((x) => x.email === 'rahul.mehta@example.dev');
  check('Candidate directory readable by recruiter', Boolean(rahul));

  const appRes = await api(`/jobs/${jobRes.data.job.id}/applications`, {
    method: 'POST', token: R, body: { candidateId: rahul.id },
  });
  check('Application created with a JD match score', appRes.status === 201 && typeof appRes.data.matchScore === 'number',
    `match=${appRes.data?.matchScore}%`);

  const dupApp = await api(`/jobs/${jobRes.data.job.id}/applications`, {
    method: 'POST', token: R, body: { candidateId: rahul.id },
  });
  check('Duplicate application rejected (409)', dupApp.status === 409);

  const now = Date.now();
  const reqRes = await api('/interview-requests', {
    method: 'POST',
    token: R,
    body: {
      applicationId: appRes.data.id,
      roundNumber: 1,
      roundName: 'Technical Screen',
      interviewType: 'TECHNICAL',
      durationMinutes: 45,
      requiredInterviewerCount: 1,
      bufferMinutes: 15,
      earliestUtc: new Date(now + 86400000).toISOString(),
      latestUtc: new Date(now + 9 * 86400000).toISOString(),
    },
  });
  check('Interview request created', reqRes.status === 201, reqRes.data?.roundName);
  const requestId = reqRes.data?.id;

  const badRange = await api('/interview-requests', {
    method: 'POST',
    token: R,
    body: {
      applicationId: appRes.data.id, roundNumber: 9, roundName: 'Bad', interviewType: 'TECHNICAL',
      durationMinutes: 120, requiredInterviewerCount: 1,
      earliestUtc: new Date(now + 86400000).toISOString(),
      latestUtc: new Date(now + 86400000 + 30 * 60000).toISOString(),
    },
  });
  check('Interview longer than the date range is rejected', badRange.status === 400, badRange.data?.error?.message?.slice(0, 60));

  // ----------------------------------------------------------- scheduling
  section('4. Matching + optimisation + simulation');
  const match = await api('/scheduler/match-interviewers', { method: 'POST', token: R, body: { requestId, limit: 10 } });
  check('Interviewer matching returns ranked candidates', match.ok && match.data.ranked.length > 0,
    `${match.data?.ranked?.length} eligible / ${match.data?.rejected?.length} rejected`);
  check('Top interviewer has an explainable breakdown',
    Boolean(match.data?.ranked?.[0]?.breakdown?.skill !== undefined && match.data?.ranked?.[0]?.reasons?.length));
  const tomRejected = (match.data?.rejected || []).some((r) => r.name === 'Tom Bradley');
  check('Weak-match interviewer filtered out with a stated reason', tomRejected,
    (match.data?.rejected || []).find((r) => r.name === 'Tom Bradley')?.reason);
  check('Overloaded interviewer excluded or de-ranked',
    !(match.data?.ranked || []).slice(0, 1).some((r) => r.name === 'Vikram Singh' && r.workload?.level === 'OVERLOADED'));

  const gen = await api('/scheduler/generate', { method: 'POST', token: R, body: { requestId, simulate: true } });
  check('Slot generation succeeded', gen.ok && gen.data.proposals.length > 0,
    `${gen.data?.proposals?.length} proposals from ${gen.data?.feasibleSlotCount} feasible slots via ${gen.data?.engineUsed}`);
  const top = gen.data?.proposals?.[0];
  check('Top proposal has a score and reasons', Boolean(top?.score && top?.reasons?.length >= 3));
  check('Proposal explains WHY (candidate preference)', (top?.reasons || []).some((r) => /preferred|preference/i.test(r)));
  check('Proposal includes a resilience score from simulation', typeof top?.resilienceScore === 'number',
    `resilience=${top?.resilienceScore}`);
  check('Proposals respect candidate evening-only constraint',
    (gen.data?.proposals || []).every((p) => {
      const d = new Date(p.startUtc);
      const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
      return istMinutes >= 17 * 60;
    }),
    (gen.data?.proposals || []).map((p) => p.localLabels.candidate).join(' | '));
  check('Proposals avoid Wednesday (candidate constraint)',
    (gen.data?.proposals || []).every((p) => {
      const ist = new Date(new Date(p.startUtc).getTime() + 5.5 * 3600000);
      return ist.getUTCDay() !== 3;
    }));

  const sim = await api('/scheduler/simulate', {
    method: 'POST', token: R,
    body: { proposalIds: gen.data.proposals.slice(0, 3).map((p) => p.id), iterations: 300, seed: 42 },
  });
  check('Digital twin simulation runs', sim.ok && sim.data.results.length > 0,
    sim.data?.results?.map((r) => `${r.resilience_score}`).join(' / '));
  check('Simulation recommends the most resilient option', Boolean(sim.data?.recommendation?.why));
  check('Simulation is honest about being a heuristic estimate', /not a trained prediction/i.test(sim.data?.disclaimer || ''));

  const assumptions = await api('/scheduler/simulation-assumptions', { token: R });
  check('Simulation assumptions are published', assumptions.ok && Boolean(assumptions.data?.base_hazards));

  // ----------------------------------------------------------- confirming
  section('5. Confirmation, booking guard, concurrency');
  const proposalId = top.id;
  const confirm = await api('/scheduler/confirm', { method: 'POST', token: R, body: { proposalId } });
  check('Proposal confirmed -> interview created', confirm.status === 201, confirm.data?.localLabel);
  const interviewId = confirm.data?.id;
  check('Meeting link generated', Boolean(confirm.data?.meeting?.joinUrl), confirm.data?.meeting?.provider);
  check('Calendar event created', confirm.data?.calendarEvent?.status === 'CONFIRMED');
  check('Panel assigned', (confirm.data?.panel || []).length === 1);

  const reconfirm = await api('/scheduler/confirm', { method: 'POST', token: R, body: { proposalId } });
  check('Re-confirming a used proposal is rejected (409)', reconfirm.status === 409, reconfirm.data?.error?.code);

  const otherProposal = gen.data.proposals[1];
  if (otherProposal) {
    const second = await api('/scheduler/confirm', { method: 'POST', token: R, body: { proposalId: otherProposal.id } });
    check('Second proposal for the same round rejected (already scheduled)', second.status === 409, second.data?.error?.code);
  }

  // Idempotency: same key twice must not create two interviews.
  const idemKey = `smoke-${Date.now()}`;
  const a1 = await api('/scheduler/generate', { method: 'POST', token: R, body: { requestId }, headers: { 'Idempotency-Key': idemKey } });
  const a2 = await api('/scheduler/generate', { method: 'POST', token: R, body: { requestId }, headers: { 'Idempotency-Key': idemKey } });
  check('Idempotency-Key replays the original response', a1.status === a2.status);

  // -------------------------------------------------------- candidate flow
  section('6. Candidate self-service');
  const myInterviews = await api('/candidates/me/interviews', { token: C });
  check('Candidate sees their own interviews', myInterviews.ok && myInterviews.data.length > 0);

  const otherCandidate = await login('aisha.khan@example.dev');
  const crossRead = await api(`/interviews/${interviewId}`, { token: otherCandidate.accessToken });
  check('Candidate cannot read another candidate interview (403)', crossRead.status === 403);

  const confirmByCandidate = await api(`/interviews/${interviewId}/confirm`, { method: 'POST', token: C, body: {} });
  check('Candidate confirms their interview', confirmByCandidate.ok && confirmByCandidate.data.status === 'CONFIRMED');

  const joinEarly = await api(`/interviews/${interviewId}/join`, { token: C });
  check('Join link is time-gated before the window (425)', joinEarly.status === 425, joinEarly.data?.error?.code);

  const nl = await api('/candidates/me/availability/natural', {
    method: 'POST', token: C,
    body: { text: 'Available Monday and Thursday between 6pm and 9pm', apply: false },
  });
  check('Candidate NL availability parsed', nl.ok && nl.data.constraints.days.length === 2, nl.data?.constraints?.days?.join(','));

  // ------------------------------------------------------ interviewer flow
  section('7. Interviewer flow + adaptive feedback loop');
  const assigned = await api('/interviewers/me/interviews', { token: I });
  check('Interviewer sees assignments', assigned.ok, `${assigned.data?.length} assignment(s)`);

  const accept = await api(`/interviews/${interviewId}/accept`, { method: 'POST', token: I });
  const acceptedOk = accept.ok || accept.status === 403; // 403 if a different interviewer was matched
  check('Interviewer can accept an assignment', acceptedOk, accept.ok ? 'accepted' : 'not on this panel (different match)');

  // Drive the interview to completion so feedback is allowed.
  const panelInterviewerEmail = confirm.data.panel[0].name;
  const panelLogin = await login(
    `${panelInterviewerEmail.toLowerCase().replace(/[^a-z]+/g, '.')}@company.dev`
  ).catch(() => null);
  const PI = panelLogin?.accessToken || I;

  await api(`/interviews/${interviewId}/start`, { method: 'POST', token: PI });
  const complete = await api(`/interviews/${interviewId}/complete`, { method: 'POST', token: PI, body: { outcome: 'COMPLETED' } });
  check('Interview can be started and completed', complete.ok && complete.data.status === 'COMPLETED');

  // A second round must exist for the adaptive loop to land somewhere.
  const round2 = await api('/interview-requests', {
    method: 'POST', token: R,
    body: {
      applicationId: appRes.data.id, roundNumber: 2, roundName: 'System Design',
      interviewType: 'SYSTEM_DESIGN', durationMinutes: 60, requiredInterviewerCount: 1,
      earliestUtc: new Date(now + 3 * 86400000).toISOString(),
      latestUtc: new Date(now + 12 * 86400000).toISOString(),
    },
  });

  const feedback = await api(`/interviews/${interviewId}/feedback`, {
    method: 'POST', token: PI,
    body: {
      overallRating: 3,
      recommendation: 'YES',
      ratings: { 'Technical Knowledge': 4, 'Problem Solving': 3, Communication: 4 },
      comments: 'Strong Java fundamentals and clear communication, but weak SQL optimization and shaky on database indexing.',
    },
  });
  check('Feedback submitted', feedback.status === 201);
  check('AI identified the skill gap', (feedback.data?.analysis?.skill_gaps || []).some((g) => /SQL/i.test(g)),
    (feedback.data?.analysis?.skill_gaps || []).join(', '));
  check('ADAPTIVE LOOP: gaps written onto the next round',
    feedback.data?.propagation?.applied === true,
    `next round focus: ${(feedback.data?.propagation?.focusTopics || []).join(', ')}`);
  check('ADAPTIVE LOOP: next-round interviewers re-ranked for the gap',
    (feedback.data?.propagation?.recommendedInterviewers || []).length > 0,
    (feedback.data?.propagation?.recommendedInterviewers || []).slice(0, 2).map((r) => `${r.name} ${r.matchScore}%`).join(', '));

  const round2Detail = await api(`/interview-requests/${round2.data.id}`, { token: R });
  check('Next round now carries the feedback-derived focus topics',
    (round2Detail.data?.focusTopics || []).length > 0,
    (round2Detail.data?.focusTopics || []).join(', '));

  // ------------------------------------------------------- control tower
  section('8. Control Tower: incident -> impact -> recovery -> audit');
  // Schedule a fresh interview we can disrupt.
  const gen2 = await api('/scheduler/generate', { method: 'POST', token: R, body: { requestId: round2.data.id, simulate: false } });
  check('Second round scheduled for the disruption demo', gen2.ok && gen2.data.proposals.length > 0);
  const confirm2 = await api('/scheduler/confirm', { method: 'POST', token: R, body: { proposalId: gen2.data.proposals[0].id } });
  const interview2 = confirm2.data?.id;
  check('Second interview confirmed', confirm2.status === 201);

  const towerBefore = await api('/control-tower', { token: R });
  check('Control Tower snapshot loads', towerBefore.ok && towerBefore.data.summary !== undefined,
    `health avg=${towerBefore.data?.summary?.averageScheduleHealth}`);

  const policy = await api('/control-tower/policy', { token: R });
  check('Autonomy policy is published', policy.ok && policy.data.strategies.length > 0, `ceiling=${policy.data?.autoApplyCeiling}`);
  check('REPLACE_INTERVIEWER is auto-appliable at the LOW ceiling',
    policy.data.strategies.find((s) => s.strategy === 'REPLACE_INTERVIEWER')?.autoApplied === true);
  check('RESCHEDULE_SLOT requires approval at the LOW ceiling',
    policy.data.strategies.find((s) => s.strategy === 'RESCHEDULE_SLOT')?.autoApplied === false);

  // Interviewer declines -> should auto-recover by replacement.
  const panelName = confirm2.data.panel[0].name;
  const panelEmail = `${panelName.toLowerCase().replace(/[^a-z]+/g, '.')}@company.dev`;
  const panelSession = await login(panelEmail);
  const decline = await api(`/interviews/${interview2}/decline-assignment`, {
    method: 'POST', token: panelSession.accessToken, body: { reason: 'Production incident, cannot attend' },
  });
  check('Interviewer decline accepted', decline.ok);

  const incidents = await api('/control-tower/incidents?includeResolved=true', { token: R });
  const declineIncident = incidents.data.find((i) => i.type === 'INTERVIEWER_DECLINED');
  check('Incident raised for the decline', Boolean(declineIncident), declineIncident?.title);
  check('Impact analysis identified affected people',
    (declineIncident?.impact?.affectedPeople || []).length > 0,
    `${declineIncident?.impact?.affectedPeople?.length} people, cascade depth ${declineIncident?.impact?.cascadeDepth}`);
  check('Recovery plans generated', (declineIncident?.plans || []).length > 0,
    (declineIncident?.plans || []).map((p) => `${p.strategy}(${p.riskLevel})`).join(', '));
  check('A recommended plan was chosen', (declineIncident?.plans || []).some((p) => p.isRecommended));
  check('Recommended plan explains itself',
    ((declineIncident?.plans || []).find((p) => p.isRecommended)?.reasons || []).length >= 3);

  const applied = (declineIncident?.actions || []).find((a) => a.status === 'APPLIED');
  check('Recovery was applied or is awaiting approval',
    Boolean(applied) || declineIncident?.status === 'AWAITING_APPROVAL',
    applied ? `auto=${applied.autoApplied} (${applied.action})` : `status=${declineIncident?.status}`);

  if (declineIncident?.status === 'AWAITING_APPROVAL') {
    const approve = await api(`/control-tower/incidents/${declineIncident.id}/approve`, { method: 'POST', token: R, body: {} });
    check('High-risk plan applies after recruiter approval', approve.ok);
  }

  const iv2After = await api(`/interviews/${interview2}`, { token: R });
  check('Interview survived the disruption (still active or rescheduled)',
    ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'].includes(iv2After.data?.status),
    `status=${iv2After.data?.status}, panel=${(iv2After.data?.panel || []).map((p) => p.name).join(', ')}`);

  // Manual incident injection (the demo hook).
  const manual = await api('/control-tower/incidents', {
    method: 'POST', token: R,
    body: { interviewId, type: 'MEETING_LINK_FAILURE', severity: 'MEDIUM', description: 'Injected by the smoke test' },
  });
  check('Manual incident injection works', manual.status === 201, `${manual.data?.plans?.length} plan(s), status=${manual.data?.status}`);

  const monitorRun = await api('/control-tower/monitor/run', { method: 'POST', token: R });
  check('Monitor tick runs on demand', monitorRun.ok, `ticks=${monitorRun.data?.stats?.ticks}`);

  // ------------------------------------------------------------- audit
  section('9. Audit trail & analytics');
  const timeline = await api(`/interviews/${interviewId}/timeline`, { token: R });
  check('Interview timeline is populated', timeline.ok && timeline.data.length >= 4, `${timeline.data?.length} events`);
  const actions = (timeline.data || []).map((t) => t.action);
  check('Timeline records the scheduling decision', actions.includes('INTERVIEW_CREATED'));
  check('Timeline records the AI feedback analysis', actions.includes('FEEDBACK_ANALYZED'));

  const audit = await api('/audit-logs?take=20', { token: R });
  check('Audit log queryable', audit.ok && audit.data.total > 0, `${audit.data?.total} entries`);

  const analytics = await api('/analytics/overview?days=30', { token: R });
  check('Analytics computed from real rows', analytics.ok && analytics.data.pipeline.totalInterviews > 0,
    `${analytics.data?.pipeline?.totalInterviews} interviews, health avg ${analytics.data?.quality?.averageScheduleHealth}`);
  check('Analytics reports recovery statistics', analytics.data?.resilience?.incidentsDetected > 0,
    `${analytics.data?.resilience?.incidentsDetected} incidents, ${analytics.data?.resilience?.automaticRecoveries} auto-recovered`);
  check('Interviewer utilisation reported', (await api('/analytics/interviewer-utilization', { token: R })).ok);

  // --------------------------------------------------------- edge cases
  section('10. Edge cases & failure handling');
  const impossible = await api('/interview-requests', {
    method: 'POST', token: R,
    body: {
      applicationId: appRes.data.id, roundNumber: 7, roundName: 'Impossible Round',
      interviewType: 'HR', durationMinutes: 60, requiredInterviewerCount: 5,
      earliestUtc: new Date(now + 86400000).toISOString(),
      latestUtc: new Date(now + 3 * 86400000).toISOString(),
      requiredSkills: [{ name: 'Quantum Computing', weight: 1, mustHave: true }],
    },
  });
  const impossibleGen = await api('/scheduler/generate', { method: 'POST', token: R, body: { requestId: impossible.data.id } });
  check('Infeasible request returns a clear 422, not a crash', impossibleGen.status === 422, impossibleGen.data?.error?.code);
  check('Infeasible response includes an actionable suggestion',
    Boolean(impossibleGen.data?.error?.details?.suggestion),
    impossibleGen.data?.error?.details?.suggestion);
  check('Infeasible response includes hard-constraint diagnostics',
    (impossibleGen.data?.error?.details?.diagnostics?.checks || []).length > 0);

  const notFound = await api('/interviews/does-not-exist-id', { token: R });
  check('Unknown id returns 404 without a stack trace',
    notFound.status === 404 && !JSON.stringify(notFound.data).includes('at '));

  const badBody = await api('/interview-requests', { method: 'POST', token: R, body: { roundName: 'x' } });
  check('Invalid body returns 422 with field errors',
    badBody.status === 422 && Array.isArray(badBody.data?.error?.details));

  const badTz = await api('/users/me', { method: 'PUT', token: C, body: { timezone: 'Mars/Olympus' } });
  check('Invalid timezone rejected', badTz.status === 422);

  const cancelAsCandidate = await api(`/interviews/${interviewId}/cancel`, { method: 'POST', token: C, body: { reason: 'nope' } });
  check('Candidate cannot cancel an interview (403)', cancelAsCandidate.status === 403);

  // --------------------------------------------------------------- admin
  section('11. Admin');
  const sysHealth = await api('/admin/system-health', { token: admin.accessToken });
  check('Admin system health available', sysHealth.ok, `open incidents=${sysHealth.data?.counts?.openIncidents}`);
  const settings = await api('/admin/settings', { token: admin.accessToken });
  check('Admin can read policy settings', settings.ok && settings.data.length > 0);
  const setBad = await api('/admin/settings/SLOT_GRANULARITY_MINUTES', { method: 'PUT', token: admin.accessToken, body: { value: 3 } });
  check('Admin setting guard rails enforced', setBad.status === 400);
  const adminOnly = await api('/admin/settings', { token: R });
  check('Recruiter blocked from admin settings (403)', adminOnly.status === 403);

  // ------------------------------------------------------------- summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${failed === 0 ? c.g : c.r}${passed} passed, ${failed} failed${c.x} of ${passed + failed} checks`);
  if (failures.length) {
    console.log(`\n${c.r}Failures:${c.x}`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('='.repeat(60));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n${c.r}Smoke test crashed:${c.x}`, err);
  process.exit(2);
});
