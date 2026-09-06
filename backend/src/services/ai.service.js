/**
 * Backend facade over the Python AI service.
 *
 * Every method returns a uniform envelope:
 *   { data, provider, degraded, fallbackUsed, warning }
 *
 * `fallbackUsed: true` means the Python service (or the LLM behind it) was
 * unavailable or returned something unusable and the deterministic JS extractor
 * below produced the answer instead. Callers persist that flag so the UI can
 * label AI-derived data honestly rather than pretending it came from a model.
 */
import { callAiService } from '../providers/aiClient.js';
import logger from '../lib/logger.js';
import { recordAudit } from './audit.service.js';
import { AUDIT_ACTIONS } from '../../../shared/constants.js';

// ---------------------------------------------------------------------------
// Deterministic fallbacks (no network, no model) - keyword + pattern based.
// ---------------------------------------------------------------------------

const SKILL_LEXICON = [
  'Java', 'Spring Boot', 'Spring', 'Hibernate', 'JPA', 'SQL', 'PostgreSQL', 'MySQL', 'MongoDB',
  'Redis', 'Kafka', 'REST APIs', 'GraphQL', 'Microservices', 'System Design', 'Docker',
  'Kubernetes', 'AWS', 'GCP', 'Azure', 'Terraform', 'CI/CD', 'Python', 'JavaScript', 'TypeScript',
  'React', 'Node.js', 'Angular', 'Vue', 'Go', 'Rust', 'C++', 'C#', '.NET', 'Data Structures',
  'Algorithms', 'Machine Learning', 'Linux', 'Git', 'Unit Testing', 'SQL Optimization',
  'Database Indexing', 'Database Optimization', 'Communication', 'Leadership', 'Mentoring',
];

const SOFT = new Set(['Communication', 'Leadership', 'Mentoring']);

function findSkills(text) {
  const hay = ` ${String(text || '').toLowerCase()} `;
  const found = [];
  for (const skill of SKILL_LEXICON) {
    const needle = skill.toLowerCase();
    // word-ish boundary match so "go" does not match "google"
    const re = new RegExp(`(^|[^a-z0-9+#.])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+#]|$)`, 'i');
    if (re.test(hay)) found.push(skill);
  }
  return found;
}

function fallbackAnalyzeJd(text) {
  const skills = findSkills(text);
  const expMatch = String(text).match(/(\d+)\s*(?:-|to|–)\s*(\d+)\s*(?:\+)?\s*years?/i);
  const singleExp = String(text).match(/(\d+)\s*\+?\s*years?/i);
  const lower = String(text).toLowerCase();

  let interviewType = 'TECHNICAL';
  if (/system design|architect|scalab/i.test(lower)) interviewType = 'SYSTEM_DESIGN';
  else if (/coding|algorithm|data structure/i.test(lower)) interviewType = 'CODING';
  else if (/manager|leadership|stakeholder/i.test(lower)) interviewType = 'MANAGERIAL';

  return {
    technical_skills: skills.filter((s) => !SOFT.has(s)).map((name) => ({ name, weight: 0.8, must_have: true })),
    soft_skills: skills.filter((s) => SOFT.has(s)).map((name) => ({ name, weight: 0.4, must_have: false })),
    experience_min: expMatch ? Number(expMatch[1]) : singleExp ? Number(singleExp[1]) : 0,
    experience_max: expMatch ? Number(expMatch[2]) : singleExp ? Number(singleExp[1]) + 3 : 10,
    interview_type: interviewType,
    topics: skills.slice(0, 6),
    seniority: /senior|lead|staff|principal/i.test(lower) ? 'SENIOR' : 'MID',
    summary: 'Extracted with the deterministic keyword extractor (AI service unavailable).',
  };
}

function fallbackAnalyzeResume(text) {
  const skills = findSkills(text);
  const yearsMatch = String(text).match(/(\d+(?:\.\d+)?)\s*\+?\s*years?/i);
  return {
    skills: skills.map((name) => ({ name, proficiency: 3, evidence: 'keyword match' })),
    years_experience: yearsMatch ? Number(yearsMatch[1]) : 0,
    highlights: [],
    summary: 'Extracted with the deterministic keyword extractor (AI service unavailable).',
  };
}

const DAY_WORDS = {
  monday: 'monday', mon: 'monday', tuesday: 'tuesday', tue: 'tuesday', tues: 'tuesday',
  wednesday: 'wednesday', wed: 'wednesday', thursday: 'thursday', thu: 'thursday', thur: 'thursday',
  thurs: 'thursday', friday: 'friday', fri: 'friday', saturday: 'saturday', sat: 'saturday',
  sunday: 'sunday', sun: 'sunday',
};

function fallbackParseAvailability(text) {
  const lower = String(text || '').toLowerCase();
  const days = new Set();
  const avoid = new Set();

  // "except wednesday", "not on friday", "can't do wednesday"
  const negativeSegments = [...lower.matchAll(/(?:except|not on|no|can't do|cannot do|avoid)\s+([a-z ,and]+)/g)];
  for (const seg of negativeSegments) {
    for (const [word, day] of Object.entries(DAY_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(seg[1])) avoid.add(day);
    }
  }
  for (const [word, day] of Object.entries(DAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower) && !avoid.has(day)) days.add(day);
  }
  if (/weekday/.test(lower)) ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach((d) => days.add(d));

  const afterMatch = lower.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const beforeMatch = lower.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const to24 = (h, m, ap) => {
    let hour = Number(h);
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (!ap && hour <= 8) hour += 12; // "after 5" almost always means 17:00
    return `${String(hour).padStart(2, '0')}:${String(Number(m) || 0).padStart(2, '0')}`;
  };

  const maxPerDay = /two interviews|2 interviews|one interview a day|one per day|single interview/.test(lower)
    ? 1
    : null;

  return {
    days: [...days].filter((d) => !avoid.has(d)),
    avoid_days: [...avoid],
    start_time: afterMatch ? to24(afterMatch[1], afterMatch[2], afterMatch[3]) : '09:00',
    end_time: beforeMatch ? to24(beforeMatch[1], beforeMatch[2], beforeMatch[3]) : '18:00',
    unavailable_dates: [],
    max_interviews_per_day: maxPerDay,
    notes: 'Parsed with the deterministic rule-based parser (AI service unavailable).',
  };
}

function fallbackAnalyzeFeedback(payload) {
  const text = String(payload.comments || '');
  const skills = findSkills(text);
  const strengths = [];
  const gaps = [];

  // Split on contrast words: "strong X but weak Y"
  const contrast = text.split(/\b(?:but|however|although|though|whereas)\b/i);
  const positive = /strong|excellent|great|solid|good|deep|impressive/i;
  const negative = /weak|poor|lacking|struggled|limited|needs?|gap|shallow|unclear/i;

  contrast.forEach((segment) => {
    const segSkills = findSkills(segment);
    if (negative.test(segment)) gaps.push(...segSkills);
    else if (positive.test(segment)) strengths.push(...segSkills);
  });

  const unclassified = skills.filter((s) => !strengths.includes(s) && !gaps.includes(s));
  const ratings = payload.ratings || {};
  const lowRated = Object.entries(ratings).filter(([, v]) => Number(v) <= 2).map(([k]) => k);

  return {
    strengths: [...new Set(strengths.length ? strengths : unclassified.slice(0, 2))],
    skill_gaps: [...new Set([...gaps, ...lowRated])],
    recommended_topics: [...new Set(gaps)].slice(0, 4),
    sentiment: Number(payload.overall_rating) >= 4 ? 'POSITIVE' : Number(payload.overall_rating) <= 2 ? 'NEGATIVE' : 'MIXED',
    summary: 'Analysed with the deterministic contrast-phrase analyser (AI service unavailable).',
  };
}

function fallbackGenerateMessage({ template_type: type, context = {} }) {
  const name = context.recipient_name || 'there';
  const when = context.slot_label || 'the scheduled time';
  const role = context.job_title || 'the role';
  const bodies = {
    INTERVIEW_SCHEDULED: `Hi ${name},\n\nYour interview for ${role} is scheduled for ${when}.\nJoin link: ${context.join_url || 'will follow shortly'}.\n\nBest of luck!`,
    INTERVIEW_RESCHEDULED: `Hi ${name},\n\nYour interview for ${role} has moved to ${when}. Apologies for the change - the updated invite is on its way.`,
    INTERVIEW_CANCELLED: `Hi ${name},\n\nYour interview for ${role} scheduled for ${when} has been cancelled. We will be in touch about next steps.`,
    INTERVIEWER_ASSIGNED: `Hi ${name},\n\nYou have been assigned to an interview for ${role} at ${when}. Please accept or decline in the portal.`,
    INTERVIEW_REMINDER: `Hi ${name},\n\nReminder: your ${role} interview starts at ${when}.`,
  };
  return {
    subject: `${role} interview - ${when}`,
    body: bodies[type] || `Hi ${name},\n\nAn update about your ${role} interview at ${when}.`,
    tone: 'neutral',
    generated_by: 'template',
  };
}

// ---------------------------------------------------------------------------
// Public API - try the service, fall back deterministically.
// ---------------------------------------------------------------------------

async function withFallback(path, body, fallbackFn, { auditContext } = {}) {
  const res = await callAiService(path, body);

  if (res.ok && res.data && res.data.ok !== false) {
    return {
      data: res.data.result ?? res.data,
      provider: res.data.provider || 'ai-service',
      degraded: Boolean(res.data.degraded),
      fallbackUsed: Boolean(res.data.fallback_used),
      warning: res.data.warning,
      latencyMs: res.latencyMs,
    };
  }

  logger.warn('AI call fell back to the deterministic extractor', { path, reason: res.error });
  if (auditContext) {
    recordAudit({
      ...auditContext,
      action: AUDIT_ACTIONS.AI_FALLBACK_USED,
      summary: `AI service unavailable for ${path}; used deterministic extractor`,
      metadata: { path, reason: res.error, code: res.code },
    });
  }

  return {
    data: fallbackFn(body),
    provider: 'deterministic-fallback',
    degraded: true,
    fallbackUsed: true,
    warning: res.error || 'AI service unavailable',
    latencyMs: res.latencyMs,
  };
}

export const analyzeJobDescription = (text, opts) =>
  withFallback('/ai/analyze-jd', { text }, (b) => fallbackAnalyzeJd(b.text), opts);

export const analyzeResume = (text, jdSkills = [], opts) =>
  withFallback('/ai/analyze-resume', { text, jd_skills: jdSkills }, (b) => fallbackAnalyzeResume(b.text), opts);

export const parseAvailabilityText = (text, timezone = 'UTC', opts) =>
  withFallback('/ai/parse-availability', { text, timezone }, (b) => fallbackParseAvailability(b.text), opts);

export const analyzeFeedback = (payload, opts) =>
  withFallback('/ai/analyze-feedback', payload, fallbackAnalyzeFeedback, opts);

export const generateMessage = (payload, opts) =>
  withFallback('/ai/generate-message', payload, fallbackGenerateMessage, opts);

/** Skill-match score between a JD skill set and a candidate/interviewer skill set. */
export const semanticSkillMatch = (required, offered, opts) =>
  withFallback(
    '/match/skills',
    { required, offered },
    (b) => {
      // Jaccard-ish deterministic overlap.
      const need = new Set(b.required.map((s) => (s.name || s).toLowerCase()));
      const have = new Set(b.offered.map((s) => (s.name || s).toLowerCase()));
      const hits = [...need].filter((n) => have.has(n));
      const score = need.size ? (hits.length / need.size) * 100 : 0;
      return {
        overall: Math.round(score),
        per_skill: [...need].map((n) => ({ skill: n, score: have.has(n) ? 100 : 0, matched_with: have.has(n) ? n : null })),
        method: 'exact-overlap',
      };
    },
    opts
  );

export { fallbackAnalyzeJd, fallbackParseAvailability, fallbackAnalyzeFeedback, findSkills };
