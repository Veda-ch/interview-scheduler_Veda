/**
 * Demo seed - a scripted ten-minute walkthrough.
 *
 * Every persona here exists to force ONE branch of the scheduling pipeline to
 * be the only thing that can happen. Availability is deliberately scarce: if
 * everybody were free all week, every request would take the happy path and
 * the offer ladder, fallback B and the failure path would be unreachable by
 * clicking.
 *
 *   BEAT 2  Aisha  -> slots overlap Ananya's declared window  -> books instantly
 *   BEAT 3  the same request, seen read-only in the builder   -> ranking + scores
 *   BEAT 4  Rahul  -> afternoons, Priya is mornings-only      -> offer to rank 1
 *   BEAT 5  rank 1 and rank 2 decline                          -> fallback B
 *   BEAT 6  Grace  -> an HR round nobody is set up to conduct  -> FAILED
 *   BEAT 7  Yusuf  -> completed round, no feedback yet         -> AI analysis
 *   BEAT 8  Nadia  -> one auto-recovered + one awaiting approval
 *
 * Exported as seedDemo() so the recruiter's "Reset demo data" button can call
 * it in-process; also runnable as `npm run db:seed`.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { pathToFileURL } from 'node:url';
import { ensureDefaultSettings } from '../backend/src/services/settings.service.js';

export const DEMO_PASSWORD = 'Password123';

const IST = 'Asia/Kolkata';
const LON = 'Europe/London';
const LIS = 'Europe/Lisbon';

// ---------------------------------------------------------------------------
// Time helpers. Everything is relative to the moment the seed runs, so the
// demo never goes stale, and weekends are skipped so no slot looks like a bug.
// ---------------------------------------------------------------------------

/** The n-th weekday at or after `from` (n = 0 -> the first weekday from then). */
function weekdayAfter(from, n = 0) {
  let d = from.startOf('day');
  let seen = 0;
  for (let i = 0; i < 60; i += 1) {
    if (d.weekday <= 5) {
      if (seen === n) return d;
      seen += 1;
    }
    d = d.plus({ days: 1 });
  }
  return d;
}

/** The nearest weekday at or before `from` - used to place history. */
function weekdayBefore(from) {
  let d = from.startOf('day');
  while (d.weekday > 5) d = d.minus({ days: 1 });
  return d;
}

function at(day, hour, minute = 0) {
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

/**
 * Declared availability windows for the next `days` days, in the person's own
 * zone. A booking inside one of these is consent - that is what makes
 * auto-accept legitimate, versus merely landing inside assumed working hours.
 */
function declaredWindows({ zone, startHour, endHour, days = 28, isoDays = [1, 2, 3, 4, 5] }) {
  const out = [];
  let cursor = DateTime.now().setZone(zone).startOf('day').plus({ days: 1 });
  for (let i = 0; i < days; i += 1) {
    if (isoDays.includes(cursor.weekday)) {
      out.push({
        startUtc: at(cursor, startHour).toUTC().toJSDate(),
        endUtc: at(cursor, endHour).toUTC().toJSDate(),
      });
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const SKILLS = [
  ['Java', 'TECHNICAL'], ['Spring Boot', 'TECHNICAL'], ['Hibernate', 'TECHNICAL'],
  ['SQL', 'TECHNICAL'], ['SQL Optimization', 'TECHNICAL'], ['PostgreSQL', 'TECHNICAL'],
  ['MongoDB', 'TECHNICAL'], ['Redis', 'TECHNICAL'], ['Kafka', 'TECHNICAL'],
  ['REST APIs', 'TECHNICAL'], ['GraphQL', 'TECHNICAL'], ['Microservices', 'TECHNICAL'],
  ['System Design', 'TECHNICAL'], ['Docker', 'TOOL'], ['Kubernetes', 'TOOL'], ['AWS', 'TECHNICAL'],
  ['Terraform', 'TOOL'], ['Python', 'TECHNICAL'], ['JavaScript', 'TECHNICAL'], ['TypeScript', 'TECHNICAL'],
  ['React', 'TECHNICAL'], ['Node.js', 'TECHNICAL'], ['Data Structures', 'TECHNICAL'],
  ['Algorithms', 'TECHNICAL'], ['Linux', 'TOOL'], ['Git', 'TOOL'], ['Unit Testing', 'TECHNICAL'],
  ['Data Pipelines', 'TECHNICAL'], ['Airflow', 'TOOL'],
  ['Communication', 'SOFT'], ['Leadership', 'SOFT'], ['Mentoring', 'SOFT'],
];

const RECRUITERS = [
  {
    key: 'kavya',
    name: 'Kavya Raman',
    email: 'recruiter@scheduler.dev',
    department: 'Talent Acquisition',
    title: 'Lead Technical Recruiter',
    timezone: IST,
  },
  {
    // Owns the historical rounds only, so the analytics are not single-user.
    key: 'daniel',
    name: 'Daniel Osei',
    email: 'daniel.osei@scheduler.dev',
    department: 'Engineering Hiring',
    title: 'Senior Technical Recruiter',
    timezone: LON,
  },
];

/**
 * Five interviewers, each shaped by AVAILABILITY rather than by skill alone.
 * The scarcity is the point: Priya only does mornings, Leila only Tue/Thu
 * afternoons, and Marcus has declared nothing at all.
 *
 * Note that nobody lists HR in interviewTypesCsv. That is what makes Grace's
 * round fail honestly instead of matching her with someone unqualified.
 */
const INTERVIEWERS = [
  {
    key: 'ananya',
    name: 'Ananya Sharma',
    email: 'ananya.sharma@company.dev',
    title: 'Senior Staff Engineer',
    department: 'Core Platform',
    seniority: 'SENIOR',
    yearsExperience: 9,
    timezone: IST,
    // No SYSTEM_DESIGN on purpose. Her calendar is wide open, so if she were
    // eligible for the data round she would win it outright and the offer
    // ladder would be unreachable by clicking.
    interviewTypesCsv: 'TECHNICAL,CODING',
    autoAcceptEnabled: true,
    // Wide open: the happy path needs someone a candidate can actually hit.
    availability: { zone: IST, startHour: 9, endHour: 18 },
    skills: [
      { name: 'Java', proficiency: 5, yearsExperience: 9 },
      { name: 'Spring Boot', proficiency: 5, yearsExperience: 7 },
      { name: 'Kafka', proficiency: 4, yearsExperience: 5 },
      { name: 'PostgreSQL', proficiency: 4, yearsExperience: 6 },
      { name: 'Microservices', proficiency: 5, yearsExperience: 6 },
      { name: 'REST APIs', proficiency: 5, yearsExperience: 8 },
    ],
  },
  {
    key: 'priya',
    name: 'Priya Nair',
    email: 'priya.nair@company.dev',
    title: 'Staff Data Engineer',
    department: 'Data & Analytics',
    seniority: 'STAFF',
    yearsExperience: 8,
    timezone: IST,
    interviewTypesCsv: 'TECHNICAL,CODING,SYSTEM_DESIGN',
    // ON deliberately: she is also the fallback-B host, and a pending seat
    // would leave that last beat looking half-finished.
    autoAcceptEnabled: true,
    // Mornings only. Rahul wants afternoons, so the ladder is unavoidable.
    availability: { zone: IST, startHour: 9, endHour: 11 },
    skills: [
      { name: 'Python', proficiency: 5, yearsExperience: 8 },
      { name: 'PostgreSQL', proficiency: 5, yearsExperience: 7 },
      { name: 'Kafka', proficiency: 4, yearsExperience: 5 },
      { name: 'Airflow', proficiency: 4, yearsExperience: 4 },
      { name: 'SQL Optimization', proficiency: 5, yearsExperience: 6 },
      { name: 'Data Pipelines', proficiency: 5, yearsExperience: 6 },
    ],
  },
  {
    key: 'leila',
    name: 'Leila Haddad',
    email: 'leila.haddad@company.dev',
    title: 'Senior Data Engineer',
    department: 'Data & Analytics',
    seniority: 'SENIOR',
    yearsExperience: 6,
    timezone: IST,
    interviewTypesCsv: 'TECHNICAL,CODING,SYSTEM_DESIGN',
    autoAcceptEnabled: true,
    // Two early mornings a week: enough to rank second on the data role, never
    // enough to be bookable for an afternoon request.
    availability: { zone: IST, startHour: 8, endHour: 10, isoDays: [2, 4] },
    skills: [
      { name: 'Python', proficiency: 4, yearsExperience: 6 },
      { name: 'SQL', proficiency: 4, yearsExperience: 5 },
      { name: 'Data Pipelines', proficiency: 3, yearsExperience: 3 },
      { name: 'Docker', proficiency: 3, yearsExperience: 3 },
    ],
  },
  {
    key: 'marcus',
    name: 'Marcus Chen',
    email: 'marcus.chen@company.dev',
    title: 'Platform Engineer',
    department: 'Infrastructure',
    seniority: 'MID',
    yearsExperience: 5,
    timezone: IST,
    interviewTypesCsv: 'TECHNICAL,CODING',
    autoAcceptEnabled: true,
    // Nothing declared. Any booking of his lands in ASSUMED working hours, so
    // it must NOT auto-accept - he is the live test of the consent rule.
    availability: null,
    skills: [
      { name: 'Java', proficiency: 3, yearsExperience: 4 },
      { name: 'Spring Boot', proficiency: 3, yearsExperience: 3 },
      { name: 'REST APIs', proficiency: 4, yearsExperience: 5 },
      { name: 'Docker', proficiency: 4, yearsExperience: 4 },
      { name: 'Linux', proficiency: 4, yearsExperience: 5 },
      { name: 'Git', proficiency: 4, yearsExperience: 5 },
    ],
  },
  {
    key: 'carlos',
    name: 'Carlos Mendes',
    email: 'carlos.mendes@company.dev',
    title: 'Principal Frontend Engineer',
    department: 'Product Engineering',
    seniority: 'PRINCIPAL',
    yearsExperience: 11,
    timezone: LIS,
    interviewTypesCsv: 'TECHNICAL,CODING,MANAGERIAL',
    // OFF: the spare persona for the consent beat if the demo has room.
    autoAcceptEnabled: false,
    availability: { zone: LIS, startHour: 9, endHour: 18 },
    skills: [
      { name: 'React', proficiency: 5, yearsExperience: 8 },
      { name: 'TypeScript', proficiency: 5, yearsExperience: 7 },
      { name: 'Node.js', proficiency: 4, yearsExperience: 6 },
      { name: 'GraphQL', proficiency: 4, yearsExperience: 4 },
      { name: 'JavaScript', proficiency: 5, yearsExperience: 11 },
      { name: 'Mentoring', proficiency: 4, yearsExperience: 6 },
    ],
  },
];

/**
 * Jobs. Two requirement names - "Distributed Messaging" and "Relational
 * Databases" - deliberately match nobody's skill list literally. Ananya holds
 * Kafka and PostgreSQL, so the AI adjacency scores them where lexical matching
 * returns zero. That contrast is visible on the ranking screen in beat 3.
 */
const JOBS = [
  {
    key: 'backend',
    recruiter: 'kavya',
    title: 'Senior Backend Engineer',
    department: 'Core Platform',
    description:
      'Own the transactional core of the platform: Java services, event-driven integration ' +
      'and the data model underneath them.',
    required: [
      { name: 'Java', weight: 1.0, mustHave: true },
      { name: 'Spring Boot', weight: 0.9, mustHave: true },
      { name: 'Distributed Messaging', weight: 0.8, mustHave: false },
      { name: 'Relational Databases', weight: 0.7, mustHave: false },
    ],
  },
  {
    key: 'data',
    recruiter: 'kavya',
    title: 'Lead Data Engineer',
    department: 'Data & Analytics',
    description:
      'Lead the batch and streaming pipelines that feed reporting, and the orchestration ' +
      'layer that keeps them honest.',
    required: [
      { name: 'Python', weight: 1.0, mustHave: true },
      { name: 'Distributed Messaging', weight: 0.8, mustHave: false },
      { name: 'Workflow Orchestration', weight: 0.8, mustHave: false },
      { name: 'SQL Optimization', weight: 0.7, mustHave: false },
    ],
  },
  {
    key: 'mainframe',
    recruiter: 'kavya',
    title: 'Mainframe Modernization Engineer',
    department: 'Legacy Systems',
    description:
      'Migrate a COBOL/DB2 estate onto the new platform. Deep legacy experience required.',
    required: [
      { name: 'COBOL', weight: 1.0, mustHave: true },
      { name: 'JCL', weight: 0.8, mustHave: true },
      { name: 'DB2', weight: 0.8, mustHave: true },
    ],
  },
  {
    key: 'frontend',
    recruiter: 'kavya',
    title: 'Senior Frontend Engineer',
    department: 'Product Engineering',
    description: 'Build the recruiter and candidate surfaces in React and TypeScript.',
    required: [
      { name: 'React', weight: 1.0, mustHave: true },
      { name: 'TypeScript', weight: 0.9, mustHave: true },
    ],
  },
  {
    key: 'platform',
    recruiter: 'kavya',
    title: 'Platform Engineer',
    department: 'Infrastructure',
    description: 'Container platform, build pipelines and the Linux estate underneath them.',
    required: [
      { name: 'Docker', weight: 1.0, mustHave: true },
      { name: 'Linux', weight: 0.8, mustHave: false },
      { name: 'Kubernetes', weight: 0.7, mustHave: false },
    ],
  },
  // Daniel's roles exist only to carry the completed history.
  {
    key: 'backend2',
    recruiter: 'daniel',
    title: 'Backend Engineer II',
    department: 'Core Platform',
    description: 'Mid-level backend role on the services team.',
    required: [
      { name: 'Java', weight: 1.0, mustHave: true },
      { name: 'REST APIs', weight: 0.8, mustHave: false },
    ],
  },
  {
    key: 'analyst',
    recruiter: 'daniel',
    title: 'Data Analyst',
    department: 'Data & Analytics',
    description: 'Reporting, SQL and stakeholder-facing analysis.',
    required: [
      { name: 'SQL', weight: 1.0, mustHave: true },
      { name: 'Python', weight: 0.7, mustHave: false },
    ],
  },
];

/** The five candidates the demo actually walks through. */
const CANDIDATES = [
  {
    key: 'aisha',
    candidateNumber: 'CND-1001',
    name: 'Aisha Khan',
    email: 'aisha.khan@example.dev',
    job: 'backend',
    headline: 'Java & Microservices Engineer',
    experience: 7.5,
    location: 'London, UK',
    timezone: LON,
    skills: ['Java', 'Spring Boot', 'SQL', 'Microservices', 'REST APIs'],
  },
  {
    key: 'rahul',
    candidateNumber: 'CND-1002',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@example.dev',
    job: 'data',
    headline: 'Streaming & Pipelines Engineer',
    experience: 6.0,
    location: 'Mumbai, India',
    timezone: IST,
    skills: ['Python', 'SQL Optimization', 'Kafka', 'Airflow', 'Data Pipelines'],
  },
  {
    key: 'grace',
    candidateNumber: 'CND-1003',
    name: 'Grace Adeyemi',
    email: 'grace.adeyemi@example.dev',
    job: 'mainframe',
    headline: 'Legacy Systems Specialist',
    experience: 12.0,
    location: 'Manchester, UK',
    timezone: LON,
    skills: ['SQL', 'Linux'],
  },
  {
    key: 'yusuf',
    candidateNumber: 'CND-1004',
    name: 'Yusuf Demir',
    email: 'yusuf.demir@example.dev',
    job: 'frontend',
    headline: 'React & Design Systems Engineer',
    experience: 5.5,
    location: 'Pune, India',
    timezone: IST,
    skills: ['React', 'TypeScript', 'JavaScript', 'Node.js'],
  },
  {
    key: 'nadia',
    candidateNumber: 'CND-1005',
    name: 'Nadia Rahman',
    email: 'nadia.rahman@example.dev',
    job: 'platform',
    headline: 'Containers & CI Engineer',
    experience: 4.5,
    location: 'Hyderabad, India',
    timezone: IST,
    skills: ['Docker', 'Linux', 'Git'],
  },
];

/** Four more who exist only so the dashboard and charts have history. */
const HISTORY_CANDIDATES = [
  { key: 'h1', candidateNumber: 'CND-1006', name: 'Ibrahim Tunde', email: 'ibrahim.tunde@example.dev', job: 'backend2', timezone: LON, skills: ['Java', 'REST APIs'] },
  { key: 'h2', candidateNumber: 'CND-1007', name: 'Sofia Rossi', email: 'sofia.rossi@example.dev', job: 'backend2', timezone: LIS, skills: ['Java', 'Spring Boot'] },
  { key: 'h3', candidateNumber: 'CND-1008', name: 'Wei Zhang', email: 'wei.zhang@example.dev', job: 'analyst', timezone: IST, skills: ['SQL', 'Python'] },
  { key: 'h4', candidateNumber: 'CND-1009', name: 'Fatima Noor', email: 'fatima.noor@example.dev', job: 'analyst', timezone: IST, skills: ['SQL'] },
];

const ROUND_NAMES = ['Technical Round 1', 'Technical Round 2', 'System Design Round'];

/** Pre-written analyses on the historical feedback. Beat 7 generates a live one. */
const PAST_ANALYSES = [
  {
    strengths: ['Clear articulation of trade-offs', 'Strong grasp of transactional boundaries'],
    skill_gaps: ['Limited exposure to event-driven design'],
    recommended_topics: ['Message ordering guarantees', 'Idempotent consumers'],
    sentiment: 'POSITIVE',
    summary: 'Solid engineer with strong fundamentals; probe event-driven design next round.',
  },
  {
    strengths: ['Practical debugging approach', 'Good testing instincts'],
    skill_gaps: ['Query tuning at scale', 'Index strategy'],
    recommended_topics: ['Execution plans', 'Partitioning'],
    sentiment: 'NEUTRAL',
    summary: 'Competent day to day, but scaling questions exposed gaps worth a follow-up.',
  },
  {
    strengths: ['Excellent communication', 'Structured problem breakdown'],
    skill_gaps: [],
    recommended_topics: ['Ownership of a larger surface'],
    sentiment: 'POSITIVE',
    summary: 'Strong across the board; no reservations from this round.',
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const TABLES = [
  'recoveryAction', 'recoveryPlan', 'incident', 'scheduleScore',
  'feedback', 'meeting', 'calendarEventRecord', 'booking', 'interviewPanelMember',
  'interview', 'slotProposal', 'slotOffer', 'interviewRequest', 'application', 'job',
  'notification', 'auditLog', 'availabilityWindow', 'idempotencyKey', 'refreshToken',
  'calendarConnection', 'candidateSkill', 'interviewerSkill', 'skill',
  'candidateProfile', 'interviewerProfile', 'recruiterProfile', 'user', 'systemSetting',
];

async function wipe(prisma, log) {
  for (const t of TABLES) {
    if (!prisma[t]) continue;
    try {
      await prisma[t].deleteMany({});
    } catch (err) {
      log(`  (skip ${t}: ${err.message.split('\n')[0]})`);
    }
  }
}

/**
 * Rebuild the entire demo dataset from scratch.
 *
 * Destructive: every table listed in TABLES is emptied first, which includes
 * users and refresh tokens. Any open session is invalid afterwards.
 */
export async function seedDemo({ client = null, log = console.log } = {}) {
  const prisma = client ?? new PrismaClient();
  const ownsClient = !client;

  try {
    log('Resetting database...');
    await wipe(prisma, log);

    log('Initializing system settings...');
    await ensureDefaultSettings();

    log('Seeding skill definitions...');
    const skillMap = {};
    for (const [name, category] of SKILLS) {
      const s = await prisma.skill.create({ data: { name, category } });
      skillMap[name] = s.id;
    }

    const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

    // --- Admin: without one, the whole /api/admin surface is unreachable.
    const admin = await prisma.user.create({
      data: {
        email: 'admin@scheduler.dev',
        passwordHash,
        name: 'System Admin',
        role: 'ADMIN',
        timezone: IST,
        avatarSeed: 'admin',
      },
    });

    // --- Recruiters
    log(`Creating ${RECRUITERS.length} recruiters...`);
    const recruiters = {};
    for (const r of RECRUITERS) {
      const user = await prisma.user.create({
        data: {
          email: r.email,
          passwordHash,
          name: r.name,
          role: 'RECRUITER',
          timezone: r.timezone,
          avatarSeed: r.key,
          recruiterProfile: { create: { department: r.department, title: r.title } },
        },
        include: { recruiterProfile: true },
      });
      recruiters[r.key] = { user, profile: user.recruiterProfile };
    }

    // --- Interviewers
    log(`Creating ${INTERVIEWERS.length} interviewers...`);
    const interviewers = {};
    for (const iv of INTERVIEWERS) {
      const user = await prisma.user.create({
        data: {
          email: iv.email,
          passwordHash,
          name: iv.name,
          role: 'INTERVIEWER',
          timezone: iv.timezone,
          avatarSeed: iv.key,
          interviewerProfile: {
            create: {
              title: iv.title,
              department: iv.department,
              seniority: iv.seniority,
              yearsExperience: iv.yearsExperience,
              maxInterviewsPerDay: 3,
              maxInterviewsPerWeek: 10,
              workStartMinute: 540,
              workEndMinute: 1080,
              interviewTypesCsv: iv.interviewTypesCsv,
              autoAcceptEnabled: iv.autoAcceptEnabled,
            },
          },
        },
        include: { interviewerProfile: true },
      });
      interviewers[iv.key] = { user, profile: user.interviewerProfile, def: iv };

      for (const sk of iv.skills) {
        if (!skillMap[sk.name]) continue;
        await prisma.interviewerSkill.create({
          data: {
            interviewerId: user.interviewerProfile.id,
            skillId: skillMap[sk.name],
            proficiency: sk.proficiency,
            yearsExperience: sk.yearsExperience,
          },
        });
      }

      if (iv.availability) {
        const windows = declaredWindows(iv.availability);
        await prisma.availabilityWindow.createMany({
          data: windows.map((w) => ({
            userId: user.id,
            startUtc: w.startUtc,
            endUtc: w.endUtc,
            kind: 'AVAILABLE',
            sourceTimezone: iv.availability.zone,
            note: 'Declared interviewing hours',
          })),
        });
      }
    }

    // --- Jobs
    log(`Creating ${JOBS.length} jobs...`);
    // Anchored to the start of today in UTC, not "tomorrow local": a London
    // candidate's next weekday morning can otherwise fall before an IST-local
    // boundary and be rejected as outside the window. Proposal generation
    // clamps its range to now, so a window that opens in the past is safe.
    const windowStart = DateTime.utc().startOf('day').toJSDate();
    const windowEnd = DateTime.utc().plus({ days: 28 }).endOf('day').toJSDate();
    const jobs = {};
    for (const j of JOBS) {
      jobs[j.key] = await prisma.job.create({
        data: {
          title: j.title,
          department: j.department,
          description: j.description,
          recruiterId: recruiters[j.recruiter].profile.id,
          requiredSkillsJson: JSON.stringify(j.required),
          interviewWindowStart: windowStart,
          interviewWindowEnd: windowEnd,
        },
      });
    }

    // --- Candidates + applications
    async function makeCandidate(c) {
      const user = await prisma.user.create({
        data: {
          email: c.email,
          passwordHash,
          name: c.name,
          role: 'CANDIDATE',
          timezone: c.timezone,
          avatarSeed: c.key,
          candidateProfile: {
            create: {
              candidateNumber: c.candidateNumber,
              headline: c.headline ?? null,
              yearsExperience: c.experience ?? 5,
              location: c.location ?? null,
              resumeUrl: `https://example.com/resumes/${c.candidateNumber.toLowerCase()}.pdf`,
            },
          },
        },
        include: { candidateProfile: true },
      });

      for (const name of c.skills) {
        if (!skillMap[name]) continue;
        await prisma.candidateSkill.create({
          data: {
            candidateId: user.candidateProfile.id,
            skillId: skillMap[name],
            proficiency: 4,
            source: 'RECRUITER',
          },
        });
      }

      const application = await prisma.application.create({
        data: {
          jobId: jobs[c.job].id,
          candidateId: user.candidateProfile.id,
          status: 'ACTIVE',
          stage: 'INTERVIEWING',
          matchScore: 88,
        },
      });

      return { user, profile: user.candidateProfile, application };
    }

    log(`Creating ${CANDIDATES.length} demo candidates...`);
    const candidates = {};
    for (const c of CANDIDATES) candidates[c.key] = await makeCandidate(c);

    log(`Creating ${HISTORY_CANDIDATES.length} history candidates...`);
    const history = {};
    for (const c of HISTORY_CANDIDATES) history[c.key] = await makeCandidate(c);

    // --- Interview requests
    function requestData({ application, job, roundName, interviewType, status, slots = [], round = 1 }) {
      return {
        applicationId: application.id,
        roundNumber: round,
        roundName,
        interviewType,
        durationMinutes: 60,
        requiredInterviewerCount: 1,
        bufferMinutes: 15,
        earliestUtc: job.interviewWindowStart,
        latestUtc: job.interviewWindowEnd,
        requiredSkillsJson: job.requiredSkillsJson,
        candidateSlotsJson: JSON.stringify(slots),
        status,
        createdById: recruiters.kavya.user.id,
      };
    }

    log('Creating the four open requests (beats 2, 4, 6 and the scheduled round)...');

    // BEAT 2 - Aisha. Left PENDING: you submit her slots live.
    const reqAisha = await prisma.interviewRequest.create({
      data: requestData({
        application: candidates.aisha.application,
        job: jobs.backend,
        roundName: 'Technical Round 1',
        interviewType: 'TECHNICAL',
        status: 'PENDING',
      }),
    });

    // BEAT 4/5 - Rahul. Also PENDING: his afternoon slots go in live and miss
    // Priya's mornings, which is what opens the ladder.
    const reqRahul = await prisma.interviewRequest.create({
      data: requestData({
        application: candidates.rahul.application,
        job: jobs.data,
        roundName: 'System Design Round',
        interviewType: 'SYSTEM_DESIGN',
        status: 'PENDING',
      }),
    });

    // BEAT 6 - Grace. An HR round; nobody lists HR in interviewTypesCsv, so
    // the ranking returns nobody and the request fails with a real reason.
    const reqGrace = await prisma.interviewRequest.create({
      data: requestData({
        application: candidates.grace.application,
        job: jobs.mainframe,
        roundName: 'HR & Culture Round',
        interviewType: 'HR',
        status: 'PENDING',
      }),
    });

    // --- Helper: a fully-formed interview with panel, bookings and meeting.
    async function makeInterview({
      request,
      candidateUser,
      interviewerKey,
      startUtc,
      status,
      candidateResponse = 'ACCEPTED',
      panelResponse = 'ACCEPTED',
      matchScore = 86,
      health = 82,
    }) {
      const iv = interviewers[interviewerKey];
      const endUtc = new Date(startUtc.getTime() + 60 * 60000);

      const interview = await prisma.interview.create({
        data: {
          requestId: request.id,
          startUtc,
          endUtc,
          status,
          candidateResponse,
          scheduleScore: health,
          riskScore: Math.round(100 - health),
          reasonsJson: JSON.stringify([
            'Inside the interviewer\'s declared availability',
            'No adjacent booking within the buffer',
          ]),
          engineUsed: 'ORTOOLS',
          createdById: recruiters.kavya.user.id,
        },
      });

      await prisma.interviewPanelMember.create({
        data: {
          interviewId: interview.id,
          interviewerId: iv.profile.id,
          role: 'PRIMARY',
          responseStatus: panelResponse,
          matchScore,
          matchReasonsJson: JSON.stringify(['Covers the must-have skills for this role']),
          respondedAt: panelResponse === 'PENDING' ? null : new Date(),
        },
      });

      for (const userId of [candidateUser.id, iv.user.id]) {
        await prisma.booking.create({
          data: { userId, interviewId: interview.id, startUtc, endUtc, kind: 'INTERVIEW' },
        });
      }

      await prisma.meeting.create({
        data: {
          interviewId: interview.id,
          provider: 'JITSI',
          externalId: `sis-${interview.id.slice(-10)}`,
          joinUrl: `https://meet.jit.si/sis-${interview.id.slice(-10)}`,
          status: 'ACTIVE',
        },
      });

      await prisma.scheduleScore.create({
        data: {
          interviewId: interview.id,
          healthScore: health,
          conflictRisk: 12,
          cascadeRisk: 8,
          interviewerLoad: 40,
          candidateInconvenience: 15,
          waitingRisk: 10,
          timezoneRisk: 20,
          bufferQuality: 90,
          breakdownJson: JSON.stringify({ note: 'Seeded demo score' }),
        },
      });

      return interview;
    }

    // BEAT 7 - Yusuf: completed yesterday, no feedback yet.
    log('Creating the completed round awaiting feedback (beat 7)...');
    const yesterday = weekdayBefore(DateTime.now().setZone(IST).minus({ days: 1 }));
    const reqYusuf = await prisma.interviewRequest.create({
      data: requestData({
        application: candidates.yusuf.application,
        job: jobs.frontend,
        roundName: 'Technical Round 1',
        interviewType: 'TECHNICAL',
        status: 'COMPLETED',
        slots: [{ startUtc: at(yesterday, 11).toUTC().toISO(), endUtc: at(yesterday, 13).toUTC().toISO() }],
      }),
    });
    await makeInterview({
      request: reqYusuf,
      candidateUser: candidates.yusuf.user,
      interviewerKey: 'carlos',
      startUtc: at(yesterday, 11).toUTC().toJSDate(),
      status: 'COMPLETED',
      matchScore: 91,
      health: 88,
    });

    // BEAT 8 - Nadia: scheduled three weekdays out, and the incident pair.
    log('Creating the scheduled round and Control Tower incidents (beat 8)...');
    const inThree = weekdayAfter(DateTime.now().setZone(IST), 2);
    const nadiaStart = at(inThree, 14).toUTC().toJSDate();
    const reqNadia = await prisma.interviewRequest.create({
      data: requestData({
        application: candidates.nadia.application,
        job: jobs.platform,
        roundName: 'Technical Round 1',
        interviewType: 'TECHNICAL',
        status: 'SCHEDULED',
        slots: [{ startUtc: at(inThree, 14).toUTC().toISO(), endUtc: at(inThree, 17).toUTC().toISO() }],
      }),
    });
    const nadiaInterview = await makeInterview({
      request: reqNadia,
      candidateUser: candidates.nadia.user,
      interviewerKey: 'marcus',
      startUtc: nadiaStart,
      status: 'SCHEDULED',
      matchScore: 79,
      health: 74,
    });

    // Incident 1: fixed itself. REGENERATE_MEETING is LOW risk, so it sits
    // under the LOW autonomy ceiling and never needed a human.
    const incResolved = await prisma.incident.create({
      data: {
        interviewId: nadiaInterview.id,
        type: 'MEETING_LINK_FAILURE',
        severity: 'MEDIUM',
        status: 'RESOLVED',
        title: 'Meeting link could not be created',
        description:
          'The meeting provider rejected the first request. A replacement link was generated automatically.',
        detectedBy: 'SYSTEM',
        impactJson: JSON.stringify({ interviews: 1, people: ['Nadia Rahman', 'Marcus Chen'] }),
        detectedAt: DateTime.now().minus({ hours: 6 }).toJSDate(),
        resolvedAt: DateTime.now().minus({ hours: 6 }).plus({ seconds: 4 }).toJSDate(),
        dedupeKey: 'demo:meeting-link:nadia',
      },
    });
    const planResolved = await prisma.recoveryPlan.create({
      data: {
        incidentId: incResolved.id,
        strategy: 'REGENERATE_MEETING',
        description: 'Discard the failed link and request a new one from the provider.',
        riskLevel: 'LOW',
        payloadJson: JSON.stringify({}),
        reasonsJson: JSON.stringify(['No participant impact', 'Reversible', 'Under the autonomy ceiling']),
        isRecommended: true,
        status: 'APPLIED',
      },
    });
    await prisma.recoveryAction.create({
      data: {
        incidentId: incResolved.id,
        planId: planResolved.id,
        action: 'REGENERATE_MEETING',
        status: 'APPLIED',
        requiresApproval: false,
        autoApplied: true,
        appliedAt: DateTime.now().minus({ hours: 6 }).plus({ seconds: 4 }).toJSDate(),
        reason: 'Risk LOW is at or below the configured autonomy ceiling',
        resultJson: JSON.stringify({ provider: 'JITSI', regenerated: true }),
      },
    });

    // Incident 2: stops for a human. SHIFT_TIME is MEDIUM risk, above the
    // ceiling, so it waits. This is the one you approve on camera.
    const incAwaiting = await prisma.incident.create({
      data: {
        interviewId: nadiaInterview.id,
        type: 'SCHEDULING_CONFLICT',
        severity: 'HIGH',
        status: 'AWAITING_APPROVAL',
        title: 'Interviewer double-booked at the scheduled time',
        description:
          'Marcus Chen has an external commitment overlapping this round. Moving the round one hour later ' +
          'clears the conflict and keeps the same day and the same interviewer.',
        detectedBy: 'MONITOR',
        impactJson: JSON.stringify({ interviews: 1, people: ['Nadia Rahman', 'Marcus Chen'], cascadeDepth: 0 }),
        detectedAt: DateTime.now().minus({ minutes: 25 }).toJSDate(),
        dedupeKey: 'demo:conflict:nadia',
      },
    });
    await prisma.recoveryPlan.create({
      data: {
        incidentId: incAwaiting.id,
        strategy: 'SHIFT_TIME',
        description: 'Move the round 60 minutes later on the same day.',
        riskLevel: 'MEDIUM',
        payloadJson: JSON.stringify({ minutes: 60 }),
        reasonsJson: JSON.stringify([
          'Same day, same interviewer - no re-matching needed',
          'Candidate is told about the change',
          'Risk MEDIUM is above the LOW autonomy ceiling, so a recruiter must approve',
        ]),
        isRecommended: true,
        status: 'PROPOSED',
      },
    });
    await prisma.recoveryAction.create({
      data: {
        incidentId: incAwaiting.id,
        action: 'SHIFT_TIME',
        status: 'AWAITING_APPROVAL',
        requiresApproval: true,
        autoApplied: false,
        reason: 'Risk MEDIUM exceeds the configured autonomy ceiling (LOW)',
      },
    });

    // Incident 3: texture in the list.
    const incOverload = await prisma.incident.create({
      data: {
        type: 'INTERVIEWER_OVERLOAD',
        severity: 'LOW',
        status: 'RESOLVED',
        title: 'Interviewer approaching weekly capacity',
        description: 'Ananya Sharma is at 8 of 10 interviews this week. The matcher will deprioritise her.',
        detectedBy: 'MONITOR',
        impactJson: JSON.stringify({ people: ['Ananya Sharma'] }),
        detectedAt: DateTime.now().minus({ days: 1 }).toJSDate(),
        resolvedAt: DateTime.now().minus({ days: 1 }).plus({ minutes: 2 }).toJSDate(),
        dedupeKey: 'demo:overload:ananya',
      },
    });
    const planNotify = await prisma.recoveryPlan.create({
      data: {
        incidentId: incOverload.id,
        strategy: 'NOTIFY_ONLY',
        description: 'Tell the recruiter; no schedule change.',
        riskLevel: 'LOW',
        payloadJson: JSON.stringify({}),
        reasonsJson: JSON.stringify(['Nothing is broken yet', 'Load balances itself next week']),
        isRecommended: true,
        status: 'APPLIED',
      },
    });
    await prisma.recoveryAction.create({
      data: {
        incidentId: incOverload.id,
        planId: planNotify.id,
        action: 'NOTIFY_ONLY',
        status: 'APPLIED',
        requiresApproval: false,
        autoApplied: true,
        appliedAt: DateTime.now().minus({ days: 1 }).plus({ minutes: 2 }).toJSDate(),
        resultJson: JSON.stringify({ notified: ['Kavya Raman'] }),
      },
    });

    // --- History: completed rounds so nothing opens empty.
    log('Creating completed history...');
    const rotation = ['ananya', 'carlos', 'leila', 'marcus', 'priya'];
    const daysAgo = [56, 52, 49, 45, 42, 38, 35, 31, 28, 24, 21, 17];
    const histKeys = ['h1', 'h1', 'h1', 'h2', 'h2', 'h2', 'h3', 'h3', 'h3', 'h4', 'h4', 'h4'];
    const recs = ['STRONG_YES', 'YES', 'NEUTRAL', 'YES', 'STRONG_YES', 'NO', 'YES', 'NEUTRAL', 'YES', 'STRONG_YES', 'YES', 'NEUTRAL'];

    for (let i = 0; i < daysAgo.length; i += 1) {
      const key = histKeys[i];
      const cand = history[key];
      const round = (i % 3) + 1;
      const day = weekdayBefore(DateTime.now().setZone(IST).minus({ days: daysAgo[i] }));
      const start = at(day, 10 + (i % 4)).toUTC().toJSDate();
      const ivKey = rotation[i % rotation.length];

      const jobKey = HISTORY_CANDIDATES.find((h) => h.key === key).job;
      const request = await prisma.interviewRequest.create({
        data: {
          ...requestData({
            application: cand.application,
            job: jobs[jobKey],
            roundName: ROUND_NAMES[round - 1],
            interviewType: round === 3 ? 'SYSTEM_DESIGN' : 'TECHNICAL',
            status: 'COMPLETED',
            round,
          }),
          earliestUtc: DateTime.fromJSDate(start).minus({ days: 7 }).toJSDate(),
          latestUtc: DateTime.fromJSDate(start).plus({ days: 7 }).toJSDate(),
          createdById: recruiters.daniel.user.id,
        },
      });

      const interview = await makeInterview({
        request,
        candidateUser: cand.user,
        interviewerKey: ivKey,
        startUtc: start,
        status: 'COMPLETED',
        matchScore: 72 + ((i * 5) % 25),
        health: 68 + ((i * 7) % 28),
      });

      const analysis = PAST_ANALYSES[i % PAST_ANALYSES.length];
      await prisma.feedback.create({
        data: {
          interviewId: interview.id,
          interviewerId: interviewers[ivKey].profile.id,
          overallRating: 3 + (i % 3),
          recommendation: recs[i],
          ratingsJson: JSON.stringify({
            'Technical Knowledge': 3 + (i % 3),
            'Problem Solving': 3 + ((i + 1) % 3),
            Communication: 4,
          }),
          comments:
            'Worked through the exercise methodically and explained the reasoning at each step. ' +
            'Some hesitation on the scaling follow-up.',
          aiAnalysisJson: JSON.stringify(analysis),
          aiProviderUsed: 'ollama',
          submittedAt: DateTime.fromJSDate(start).plus({ hours: 2 }).toJSDate(),
        },
      });

      await prisma.auditLog.create({
        data: {
          actorUserId: recruiters.daniel.user.id,
          actorRole: 'RECRUITER',
          action: 'INTERVIEW_CREATED',
          entity: 'Interview',
          entityId: interview.id,
          summary: `${ROUND_NAMES[round - 1]} booked with ${interviewers[ivKey].def.name}`,
          metadataJson: JSON.stringify({ seeded: true }),
          createdAt: DateTime.fromJSDate(start).minus({ days: 2 }).toJSDate(),
        },
      });
    }

    // --- Notifications: a live badge without being a distraction.
    log('Creating notifications...');
    const notifications = [
      {
        userId: candidates.aisha.user.id,
        type: 'SLOTS_PROPOSED',
        title: 'We need your availability',
        body: 'Technical Round 1 for Senior Backend Engineer is waiting on your preferred times.',
        relatedEntity: 'InterviewRequest',
        relatedId: reqAisha.id,
      },
      {
        userId: candidates.rahul.user.id,
        type: 'SLOTS_PROPOSED',
        title: 'We need your availability',
        body: 'Technical Round 1 for Lead Data Engineer is waiting on your preferred times.',
        relatedEntity: 'InterviewRequest',
        relatedId: reqRahul.id,
      },
      {
        userId: candidates.grace.user.id,
        type: 'SLOTS_PROPOSED',
        title: 'We need your availability',
        body: 'HR & Culture Round for Mainframe Modernization Engineer is waiting on your times.',
        relatedEntity: 'InterviewRequest',
        relatedId: reqGrace.id,
      },
      {
        userId: candidates.nadia.user.id,
        type: 'INTERVIEW_SCHEDULED',
        title: 'Your interview is booked',
        body: 'Technical Round 1 for Platform Engineer is confirmed with Marcus Chen.',
        relatedEntity: 'Interview',
        relatedId: nadiaInterview.id,
      },
      {
        userId: interviewers.carlos.user.id,
        type: 'FEEDBACK_REQUESTED',
        title: 'Feedback needed',
        body: 'Yusuf Demir - Technical Round 1 completed yesterday and is awaiting your feedback.',
        relatedEntity: 'InterviewRequest',
        relatedId: reqYusuf.id,
      },
      {
        userId: recruiters.kavya.user.id,
        type: 'APPROVAL_REQUIRED',
        title: 'Recovery needs your approval',
        body: 'A scheduling conflict on Nadia Rahman\'s round has a proposed fix awaiting approval.',
        relatedEntity: 'Incident',
        relatedId: incAwaiting.id,
      },
    ];
    for (const n of notifications) {
      await prisma.notification.create({
        data: { ...n, channel: 'IN_APP', status: 'SENT', sentAt: new Date() },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorRole: 'ADMIN',
        action: 'SETTINGS_UPDATED',
        entity: 'System',
        summary: 'Demo dataset rebuilt',
        metadataJson: JSON.stringify({ seeded: true }),
      },
    });

    const summary = {
      recruiters: RECRUITERS.length,
      interviewers: INTERVIEWERS.length,
      candidates: CANDIDATES.length + HISTORY_CANDIDATES.length,
      jobs: JOBS.length,
      openRequests: 3,
      completedInterviews: daysAgo.length + 1,
      incidents: 3,
      password: DEMO_PASSWORD,
    };

    log('\nDemo data ready. Password for every account: ' + DEMO_PASSWORD);
    return summary;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

// --- CLI entry point -------------------------------------------------------
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seedDemo()
    .then((s) => {
      console.table([
        { role: 'ADMIN', name: 'System Admin', email: 'admin@scheduler.dev' },
        ...RECRUITERS.map((r) => ({ role: 'RECRUITER', name: r.name, email: r.email })),
        ...INTERVIEWERS.map((i) => ({
          role: 'INTERVIEWER',
          name: i.name,
          email: i.email,
          availability: i.availability
            ? `${i.availability.startHour}:00-${i.availability.endHour}:00 ${i.availability.zone}`
            : 'none declared',
          autoAccept: i.autoAcceptEnabled,
        })),
        ...CANDIDATES.map((c) => ({ role: 'CANDIDATE', name: c.name, email: c.email })),
      ]);
      console.log(summaryLine(s));
      process.exit(0);
    })
    .catch((e) => {
      console.error('Seed failed:', e);
      process.exit(1);
    });
}

function summaryLine(s) {
  return (
    `\n${s.jobs} jobs, ${s.candidates} candidates, ${s.openRequests} open requests, ` +
    `${s.completedInterviews} completed interviews, ${s.incidents} incidents.\n`
  );
}
