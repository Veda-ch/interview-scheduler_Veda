/**
 * Demo seed for the full recruiter -> candidate -> interviewer loop.
 *
 * Creates 3 of each persona so every step of the flow has real choices:
 *   - 3 recruiters, each owning one open role
 *   - 3 candidates (CND-1001..1003) already applied to those roles
 *   - 3 interviewers whose skills align with exactly one role each, so
 *     skill-based matching produces a visibly correct answer
 *
 * Interviewers start with declared availability (that is what makes
 * auto-accept possible). Candidates deliberately start with NONE, so the
 * intended flow - recruiter raises a request, candidate offers slots, recruiter
 * matches and books - is exercised from a clean state.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { ensureDefaultSettings } from '../backend/src/services/settings.service.js';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Password123';
const ROUNDS = 10;

const hash = (pw) => bcrypt.hashSync(pw, ROUNDS);

async function reset() {
  const tables = [
    'recoveryAction', 'recoveryPlan', 'incident', 'scheduleSimulation', 'scheduleScore',
    'feedback', 'meeting', 'calendarEventRecord', 'booking', 'interviewPanelMember',
    'interview', 'slotProposal', 'interviewRequest', 'application', 'job',
    'notification', 'auditLog', 'availabilityWindow', 'idempotencyKey', 'refreshToken',
    'calendarConnection', 'candidateSkill', 'interviewerSkill', 'skill',
    'candidateProfile', 'interviewerProfile', 'recruiterProfile', 'user', 'systemSetting',
  ];
  for (const t of tables) {
    try {
      await prisma[t].deleteMany({});
    } catch (err) {
      console.warn(`  (skip ${t}: ${err.message.split('\n')[0]})`);
    }
  }
}

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
    name: 'Kavya Raman',
    email: 'recruiter@scheduler.dev',
    department: 'Talent Acquisition',
    title: 'Lead Technical Recruiter',
    timezone: 'Asia/Kolkata',
  },
  {
    name: 'Daniel Osei',
    email: 'daniel.osei@scheduler.dev',
    department: 'Engineering Hiring',
    title: 'Senior Technical Recruiter',
    timezone: 'Europe/London',
  },
  {
    name: 'Mei Lin',
    email: 'mei.lin@scheduler.dev',
    department: 'Platform & Infrastructure Hiring',
    title: 'Technical Sourcer',
    timezone: 'Asia/Singapore',
  },
];

// Each interviewer covers one role's skill profile strongly, so the matcher's
// ranking is easy to sanity-check by eye during a demo.
const INTERVIEWERS = [
  {
    name: 'Ananya Sharma',
    email: 'ananya.sharma@company.dev',
    title: 'Senior Staff Engineer',
    department: 'Core Platform',
    seniority: 'SENIOR',
    yearsExperience: 9,
    timezone: 'Asia/Kolkata',
    interviewTypesCsv: 'TECHNICAL,CODING,SYSTEM_DESIGN',
    autoAcceptEnabled: true,
    skills: [
      { name: 'Java', proficiency: 5, yearsExperience: 9 },
      { name: 'Spring Boot', proficiency: 5, yearsExperience: 7 },
      { name: 'Microservices', proficiency: 5, yearsExperience: 6 },
      { name: 'System Design', proficiency: 4, yearsExperience: 5 },
      { name: 'REST APIs', proficiency: 5, yearsExperience: 8 },
      { name: 'SQL', proficiency: 4, yearsExperience: 7 },
    ],
  },
  {
    name: 'Carlos Mendes',
    email: 'carlos.mendes@company.dev',
    title: 'Principal Frontend Engineer',
    department: 'Product Engineering',
    seniority: 'PRINCIPAL',
    yearsExperience: 11,
    timezone: 'Europe/Lisbon',
    interviewTypesCsv: 'TECHNICAL,CODING,MANAGERIAL',
    autoAcceptEnabled: true,
    skills: [
      { name: 'React', proficiency: 5, yearsExperience: 8 },
      { name: 'TypeScript', proficiency: 5, yearsExperience: 7 },
      { name: 'Node.js', proficiency: 4, yearsExperience: 6 },
      { name: 'GraphQL', proficiency: 4, yearsExperience: 4 },
      { name: 'JavaScript', proficiency: 5, yearsExperience: 11 },
      { name: 'Mentoring', proficiency: 4, yearsExperience: 6 },
    ],
  },
  {
    // autoAccept OFF on purpose: this is the persona that demonstrates the
    // explicit accept/decline path and the Control Tower recovery it triggers.
    name: 'Priya Nair',
    email: 'priya.nair@company.dev',
    title: 'Staff Data Engineer',
    department: 'Data & Analytics',
    seniority: 'STAFF',
    yearsExperience: 8,
    timezone: 'Asia/Kolkata',
    interviewTypesCsv: 'TECHNICAL,CODING,SYSTEM_DESIGN',
    autoAcceptEnabled: false,
    skills: [
      { name: 'Python', proficiency: 5, yearsExperience: 8 },
      { name: 'SQL Optimization', proficiency: 5, yearsExperience: 6 },
      { name: 'Kafka', proficiency: 4, yearsExperience: 5 },
      { name: 'PostgreSQL', proficiency: 5, yearsExperience: 7 },
      { name: 'Data Pipelines', proficiency: 5, yearsExperience: 6 },
      { name: 'Airflow', proficiency: 4, yearsExperience: 4 },
    ],
  },
];

const CANDIDATES = [
  {
    candidateNumber: 'CND-1001',
    name: 'Aisha Khan',
    email: 'aisha.khan@example.dev',
    role: 'Senior Backend Engineer',
    department: 'Core Platform',
    headline: 'Java & Microservices Architect',
    experience: 7.5,
    location: 'Bengaluru, India',
    timezone: 'Asia/Kolkata',
    recruiterIndex: 0,
    skills: [
      { name: 'Java', proficiency: 5 },
      { name: 'Spring Boot', proficiency: 5 },
      { name: 'SQL', proficiency: 4 },
      { name: 'Microservices', proficiency: 4 },
      { name: 'REST APIs', proficiency: 5 },
    ],
  },
  {
    candidateNumber: 'CND-1002',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@example.dev',
    role: 'Senior Full Stack Developer',
    department: 'Product Engineering',
    headline: 'React & Node.js Engineer',
    experience: 6.0,
    location: 'Mumbai, India',
    timezone: 'Asia/Kolkata',
    recruiterIndex: 1,
    skills: [
      { name: 'React', proficiency: 5 },
      { name: 'Node.js', proficiency: 4 },
      { name: 'TypeScript', proficiency: 4 },
      { name: 'SQL', proficiency: 4 },
      { name: 'GraphQL', proficiency: 3 },
    ],
  },
  {
    candidateNumber: 'CND-1003',
    name: 'Grace Adeyemi',
    email: 'grace.adeyemi@example.dev',
    role: 'Lead Data Engineer',
    department: 'Data & Analytics',
    headline: 'Distributed Systems & Data Pipeline Lead',
    experience: 8.0,
    location: 'London, UK',
    timezone: 'Europe/London',
    recruiterIndex: 2,
    skills: [
      { name: 'Python', proficiency: 5 },
      { name: 'SQL Optimization', proficiency: 5 },
      { name: 'Kafka', proficiency: 4 },
      { name: 'PostgreSQL', proficiency: 4 },
      { name: 'Data Pipelines', proficiency: 4 },
    ],
  },
];

/**
 * Working-day availability for the next `days` days, in the person's own zone.
 * These are real declared windows, so a booking inside one auto-accepts for an
 * interviewer who has opted in.
 */
function weekdayWindows({ timezone, days = 21, startHour = 9, endHour = 18 }) {
  const out = [];
  let cursor = DateTime.now().setZone(timezone).startOf('day').plus({ days: 1 });
  for (let i = 0; i < days; i += 1) {
    if (cursor.weekday <= 5) {
      const start = cursor.set({ hour: startHour, minute: 0, second: 0, millisecond: 0 });
      const end = cursor.set({ hour: endHour, minute: 0, second: 0, millisecond: 0 });
      out.push({ startUtc: start.toUTC().toJSDate(), endUtc: end.toUTC().toJSDate() });
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

async function main() {
  console.log('Resetting database...');
  await reset();

  console.log('Initializing system settings...');
  await ensureDefaultSettings();

  console.log('Seeding skill definitions...');
  const skillMap = {};
  for (const [name, category] of SKILLS) {
    const s = await prisma.skill.create({ data: { name, category } });
    skillMap[name] = s.id;
  }

  const passwordHash = hash(DEMO_PASSWORD);

  // Without an ADMIN the whole /api/admin surface (users, settings, skills,
  // system health) is unreachable, since those routes are role-guarded.
  console.log('Creating admin...');
  await prisma.user.create({
    data: {
      email: 'admin@scheduler.dev',
      passwordHash,
      name: 'System Admin',
      role: 'ADMIN',
      timezone: 'Asia/Kolkata',
      avatarSeed: 'admin',
    },
  });

  console.log(`Creating ${RECRUITERS.length} recruiters...`);
  const recruiterProfiles = [];
  for (const r of RECRUITERS) {
    const user = await prisma.user.create({
      data: {
        email: r.email,
        passwordHash,
        name: r.name,
        role: 'RECRUITER',
        timezone: r.timezone,
        recruiterProfile: { create: { department: r.department, title: r.title } },
      },
      include: { recruiterProfile: true },
    });
    recruiterProfiles.push(user.recruiterProfile);
  }

  console.log(`Creating ${INTERVIEWERS.length} interviewers (with declared availability)...`);
  for (const iv of INTERVIEWERS) {
    const user = await prisma.user.create({
      data: {
        email: iv.email,
        passwordHash,
        name: iv.name,
        role: 'INTERVIEWER',
        timezone: iv.timezone,
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

    for (const sk of iv.skills) {
      const skillId = skillMap[sk.name];
      if (!skillId) continue;
      await prisma.interviewerSkill.create({
        data: {
          interviewerId: user.interviewerProfile.id,
          skillId,
          proficiency: sk.proficiency,
          yearsExperience: sk.yearsExperience,
        },
      });
    }

    const windows = weekdayWindows({ timezone: iv.timezone });
    await prisma.availabilityWindow.createMany({
      data: windows.map((w) => ({
        userId: user.id,
        startUtc: w.startUtc,
        endUtc: w.endUtc,
        kind: 'AVAILABLE',
        sourceTimezone: iv.timezone,
        note: 'Standard working hours',
      })),
    });
  }

  console.log(`Creating ${CANDIDATES.length} candidates + jobs + applications...`);
  for (const c of CANDIDATES) {
    const recruiterId = recruiterProfiles[c.recruiterIndex % recruiterProfiles.length].id;

    const job = await prisma.job.create({
      data: {
        title: c.role,
        department: c.department,
        description:
          `We are hiring a ${c.role} for the ${c.department} team. ` +
          `The role focuses on ${c.skills.map((s) => s.name).join(', ')}.`,
        recruiterId,
        requiredSkillsJson: JSON.stringify(
          c.skills.map((s) => ({ name: s.name, weight: 0.8, mustHave: true }))
        ),
      },
    });

    const user = await prisma.user.create({
      data: {
        email: c.email,
        passwordHash,
        name: c.name,
        role: 'CANDIDATE',
        timezone: c.timezone,
        candidateProfile: {
          create: {
            candidateNumber: c.candidateNumber,
            headline: c.headline,
            yearsExperience: c.experience,
            location: c.location,
            resumeUrl: `https://example.com/resumes/${c.candidateNumber.toLowerCase()}.pdf`,
          },
        },
      },
      include: { candidateProfile: true },
    });

    for (const sk of c.skills) {
      const skillId = skillMap[sk.name];
      if (!skillId) continue;
      await prisma.candidateSkill.create({
        data: {
          candidateId: user.candidateProfile.id,
          skillId,
          proficiency: sk.proficiency,
          source: 'RECRUITER',
        },
      });
    }

    await prisma.application.create({
      data: {
        jobId: job.id,
        candidateId: user.candidateProfile.id,
        status: 'ACTIVE',
        stage: 'SCREENING',
        matchScore: 92.5,
      },
    });
  }

  console.log('\nSeed complete. All accounts use the password: Password123\n');
  console.table([
    ...RECRUITERS.map((r) => ({ role: 'RECRUITER', name: r.name, email: r.email })),
    ...INTERVIEWERS.map((i) => ({
      role: 'INTERVIEWER',
      name: i.name,
      email: i.email,
      autoAccept: i.autoAcceptEnabled,
    })),
    ...CANDIDATES.map((c) => ({ role: 'CANDIDATE', name: c.name, email: c.email })),
    { role: 'ADMIN', name: 'System Admin', email: 'admin@scheduler.dev' },
  ]);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
