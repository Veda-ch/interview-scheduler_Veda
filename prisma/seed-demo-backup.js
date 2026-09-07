/**
 * Demo seed.
 *
 * The data is designed to *exercise the intelligent scheduler*, not merely to
 * fill tables. It deliberately contains:
 *   - strong AND weak skill matches for the same requirement
 *   - one deliberately overloaded interviewer (hits their weekly ceiling)
 *   - participants spread across 5 timezones, including a hard IST/PST pair
 *   - candidates with declared availability, with none, and with an explicit
 *     UNAVAILABLE blackout
 *   - a completed round with feedback, so the adaptive next-round loop has input
 *   - a cascading chain: round 2 depends on round 1
 *   - an interviewer who declines, to seed a Control Tower incident
 *
 * Everything is generated relative to "now", so the demo is always in the future.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password123';
const ROUNDS = 10;

// --------------------------------------------------------------------------- helpers

const hash = (pw) => bcrypt.hashSync(pw, ROUNDS);

/** Local wall-clock time on day N from today, in a zone, as a UTC Date. */
function at(dayOffset, hour, minute, zone) {
  return DateTime.now()
    .setZone(zone)
    .startOf('day')
    .plus({ days: dayOffset, hours: hour, minutes: minute })
    .toUTC()
    .toJSDate();
}

/** Next weekday-only offsets so demo slots never land on a weekend. */
function weekdayOffsets(count, startFrom = 1) {
  const out = [];
  let d = startFrom;
  while (out.length < count) {
    const wd = DateTime.now().plus({ days: d }).weekday;
    if (wd <= 5) out.push(d);
    d += 1;
  }
  return out;
}

const DAYS = weekdayOffsets(12);

async function reset() {
  // Order matters: children before parents.
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

// --------------------------------------------------------------------------- data

const SKILLS = [
  ['Java', 'TECHNICAL'], ['Spring Boot', 'TECHNICAL'], ['Hibernate', 'TECHNICAL'], ['JPA', 'TECHNICAL'],
  ['SQL', 'TECHNICAL'], ['SQL Optimization', 'TECHNICAL'], ['Database Indexing', 'TECHNICAL'],
  ['PostgreSQL', 'TECHNICAL'], ['MongoDB', 'TECHNICAL'], ['Redis', 'TECHNICAL'], ['Kafka', 'TECHNICAL'],
  ['REST APIs', 'TECHNICAL'], ['GraphQL', 'TECHNICAL'], ['Microservices', 'TECHNICAL'],
  ['System Design', 'TECHNICAL'], ['Docker', 'TOOL'], ['Kubernetes', 'TOOL'], ['AWS', 'TECHNICAL'],
  ['Terraform', 'TOOL'], ['CI/CD', 'TOOL'], ['Python', 'TECHNICAL'], ['JavaScript', 'TECHNICAL'],
  ['TypeScript', 'TECHNICAL'], ['React', 'TECHNICAL'], ['Node.js', 'TECHNICAL'],
  ['Data Structures', 'TECHNICAL'], ['Algorithms', 'TECHNICAL'], ['Machine Learning', 'TECHNICAL'],
  ['Linux', 'TOOL'], ['Git', 'TOOL'], ['Unit Testing', 'TECHNICAL'],
  ['Communication', 'SOFT'], ['Leadership', 'SOFT'], ['Mentoring', 'SOFT'], ['Ownership', 'SOFT'],
];

const INTERVIEWERS = [
  // name, tz, seniority, yrs, types, maxDay, maxWeek, work hours, skills[[name,prof,yrs]]
  ['Ananya Sharma', 'Asia/Kolkata', 'SENIOR', 9, 'TECHNICAL,CODING,SYSTEM_DESIGN', 3, 10, [540, 1080],
    [['Java', 5, 9], ['Spring Boot', 5, 7], ['SQL', 4, 8], ['SQL Optimization', 4, 5], ['REST APIs', 5, 8], ['Microservices', 4, 5], ['Hibernate', 4, 6]]],
  ['Rohit Verma', 'Asia/Kolkata', 'STAFF', 12, 'SYSTEM_DESIGN,TECHNICAL,MANAGERIAL', 2, 8, [600, 1140],
    [['System Design', 5, 10], ['Kafka', 4, 6], ['Microservices', 5, 8], ['AWS', 4, 7], ['Java', 4, 10], ['Leadership', 5, 6]]],
  ['Priya Nair', 'Asia/Kolkata', 'MID', 5, 'CODING,TECHNICAL', 4, 12, [540, 1020],
    [['Data Structures', 5, 5], ['Algorithms', 5, 5], ['Java', 4, 5], ['Python', 4, 4], ['Unit Testing', 4, 3]]],
  // Deliberately overloaded: low weekly ceiling, and the seed books him repeatedly.
  ['Vikram Singh', 'Asia/Kolkata', 'SENIOR', 8, 'TECHNICAL,CODING', 2, 3, [540, 1080],
    [['Java', 5, 8], ['Spring Boot', 4, 6], ['SQL', 5, 7], ['Database Indexing', 5, 4], ['PostgreSQL', 5, 6]]],
  ['Sarah Chen', 'America/Los_Angeles', 'SENIOR', 10, 'SYSTEM_DESIGN,TECHNICAL', 3, 9, [540, 1080],
    [['System Design', 5, 9], ['AWS', 5, 8], ['Kubernetes', 4, 5], ['Docker', 4, 6], ['Microservices', 4, 7], ['Terraform', 3, 3]]],
  ['Michael O’Brien', 'Europe/London', 'STAFF', 13, 'TECHNICAL,MANAGERIAL,SYSTEM_DESIGN', 2, 8, [540, 1050],
    [['Java', 5, 12], ['Spring Boot', 4, 8], ['System Design', 4, 9], ['Leadership', 5, 7], ['Mentoring', 5, 6]]],
  ['Elena Kowalski', 'Europe/Warsaw', 'MID', 6, 'CODING,TECHNICAL', 3, 10, [510, 1020],
    [['Python', 5, 6], ['Algorithms', 4, 5], ['Data Structures', 4, 5], ['SQL', 3, 4], ['Docker', 3, 3]]],
  ['David Okonkwo', 'Africa/Lagos', 'SENIOR', 8, 'TECHNICAL,CODING', 3, 10, [540, 1080],
    [['Node.js', 5, 7], ['TypeScript', 5, 6], ['React', 4, 5], ['REST APIs', 4, 6], ['MongoDB', 4, 5]]],
  ['Yuki Tanaka', 'Asia/Tokyo', 'MID', 5, 'TECHNICAL,CODING', 3, 10, [540, 1080],
    [['Java', 4, 5], ['Spring Boot', 3, 3], ['SQL', 3, 4], ['Git', 4, 5], ['Unit Testing', 4, 4]]],
  ['Meera Iyer', 'Asia/Kolkata', 'SENIOR', 7, 'HR,MANAGERIAL', 5, 15, [570, 1050],
    [['Communication', 5, 7], ['Leadership', 4, 5], ['Ownership', 4, 5], ['Mentoring', 4, 4]]],
  ['James Miller', 'America/New_York', 'PRINCIPAL', 15, 'SYSTEM_DESIGN,MANAGERIAL', 2, 6, [540, 1020],
    [['System Design', 5, 14], ['Leadership', 5, 10], ['Microservices', 5, 9], ['AWS', 4, 8], ['Kafka', 4, 6]]],
  ['Fatima Al-Rashid', 'Asia/Dubai', 'MID', 4, 'CODING,TECHNICAL', 4, 12, [540, 1080],
    [['Python', 4, 4], ['Machine Learning', 3, 2], ['SQL', 4, 4], ['Algorithms', 4, 4]]],
  // Weak match for backend Java roles - proves the matcher rejects on skills.
  ['Tom Bradley', 'Europe/Dublin', 'MID', 5, 'CODING', 3, 10, [540, 1020],
    [['React', 5, 5], ['JavaScript', 5, 5], ['TypeScript', 4, 4], ['Communication', 4, 4]]],
  ['Nisha Patel', 'Asia/Kolkata', 'JUNIOR', 2, 'CODING', 4, 12, [600, 1140],
    [['Java', 3, 2], ['Data Structures', 3, 2], ['Git', 3, 2]]],
  ['Carlos Mendes', 'America/Sao_Paulo', 'SENIOR', 9, 'TECHNICAL,SYSTEM_DESIGN', 3, 9, [540, 1080],
    [['Python', 5, 8], ['System Design', 4, 6], ['PostgreSQL', 5, 7], ['SQL Optimization', 5, 5], ['Redis', 4, 4]]],
];

const CANDIDATES = [
  // name, tz, headline, yrs, company, skills[[name,prof]], resumeText
  ['Rahul Mehta', 'Asia/Kolkata', 'Backend Engineer', 4, 'Infosys',
    [['Java', 4], ['Spring Boot', 4], ['SQL', 3], ['REST APIs', 4], ['Hibernate', 3], ['Git', 4]],
    'Backend engineer with 4 years of experience building Java and Spring Boot microservices. Designed REST APIs serving 2M requests/day. Worked extensively with Hibernate and JPA. Basic exposure to SQL query tuning. Led a small team migrating a monolith to microservices.'],
  ['Aisha Khan', 'Asia/Kolkata', 'Senior Backend Engineer', 6, 'Flipkart',
    [['Java', 5], ['Spring Boot', 5], ['SQL', 5], ['SQL Optimization', 4], ['Kafka', 4], ['Microservices', 4], ['AWS', 3]],
    'Senior backend engineer, 6 years. Expert in Java and Spring Boot. Built event-driven systems with Kafka. Extensive experience in SQL optimization and database indexing, reduced p99 latency by 60%. Improved AWS infrastructure costs by 30%.'],
  ['Daniel Weiss', 'Europe/Berlin', 'Platform Engineer', 5, 'SAP',
    [['Java', 4], ['Kubernetes', 4], ['Docker', 5], ['AWS', 4], ['Terraform', 3], ['System Design', 3]],
    'Platform engineer with 5 years focused on Kubernetes and Docker. Built CI/CD pipelines and migrated services to AWS with Terraform. Familiar with Java services.'],
  ['Sofia Rossi', 'Europe/Warsaw', 'Full Stack Developer', 3, 'Allegro',
    [['JavaScript', 4], ['React', 4], ['Node.js', 4], ['TypeScript', 3], ['MongoDB', 3]],
    'Full stack developer, 3 years. Built React and Node.js applications. Comfortable with TypeScript and MongoDB. Advanced React patterns.'],
  ['Arjun Reddy', 'Asia/Kolkata', 'Data Engineer', 5, 'Zomato',
    [['Python', 5], ['SQL', 5], ['SQL Optimization', 4], ['PostgreSQL', 4], ['Kafka', 3]],
    'Data engineer with 5 years. Expert Python and SQL. Designed data pipelines processing 500GB/day. Strong in SQL optimization and PostgreSQL performance tuning.'],
  ['Grace Adeyemi', 'Africa/Lagos', 'Backend Developer', 3, 'Paystack',
    [['Node.js', 4], ['TypeScript', 4], ['REST APIs', 4], ['PostgreSQL', 3]],
    'Backend developer, 3 years building payment APIs with Node.js and TypeScript. Familiar with PostgreSQL.'],
  ['Kenji Watanabe', 'Asia/Tokyo', 'Software Engineer', 4, 'Rakuten',
    [['Java', 4], ['Spring Boot', 3], ['SQL', 3], ['Unit Testing', 4]],
    'Software engineer with 4 years of Java development. Spring Boot services, strong testing discipline with JUnit.'],
  ['Laura Martins', 'America/Sao_Paulo', 'Senior Engineer', 7, 'Nubank',
    [['Python', 5], ['PostgreSQL', 5], ['System Design', 4], ['Redis', 4], ['Microservices', 4]],
    'Senior engineer, 7 years. Python and PostgreSQL expert. Designed distributed systems handling millions of transactions.'],
  ['Ethan Brooks', 'America/New_York', 'Backend Engineer', 4, 'Stripe',
    [['Java', 4], ['Microservices', 4], ['AWS', 3], ['REST APIs', 4], ['SQL', 3]],
    'Backend engineer, 4 years at a payments company. Java microservices on AWS, REST API design.'],
  ['Priyanka Joshi', 'Asia/Kolkata', 'Junior Developer', 1, 'TCS',
    [['Java', 2], ['SQL', 2], ['Git', 3]],
    'Junior developer with 1 year of experience. Learning Java and SQL fundamentals.'],
];

const JOBS = [
  {
    title: 'Senior Backend Engineer',
    department: 'Engineering',
    location: 'Bengaluru (Hybrid)',
    experienceMin: 4,
    experienceMax: 8,
    description:
      'We are hiring a Senior Backend Engineer to own critical services in our order platform.\n\n' +
      'Must have: Java, Spring Boot, SQL and REST APIs. You will design and optimise high-throughput services, ' +
      'own database performance including SQL optimization and database indexing, and mentor junior engineers.\n\n' +
      'Nice to have: Kafka, AWS, Kubernetes, Microservices architecture experience.\n\n' +
      '4-8 years of professional backend experience required. Strong communication skills expected.',
    skills: [
      { name: 'Java', weight: 1.0, mustHave: true },
      { name: 'Spring Boot', weight: 1.0, mustHave: true },
      { name: 'SQL', weight: 0.9, mustHave: true },
      { name: 'REST APIs', weight: 0.9, mustHave: true },
      { name: 'Kafka', weight: 0.4, mustHave: false },
      { name: 'AWS', weight: 0.4, mustHave: false },
    ],
  },
  {
    title: 'Platform / DevOps Engineer',
    department: 'Infrastructure',
    location: 'Remote (EU)',
    experienceMin: 3,
    experienceMax: 7,
    description:
      'Platform engineer to run our Kubernetes estate. Must have: Docker, Kubernetes, AWS, Terraform, CI/CD. ' +
      'You will own infrastructure as code and developer tooling. 3-7 years experience.',
    skills: [
      { name: 'Kubernetes', weight: 1.0, mustHave: true },
      { name: 'Docker', weight: 1.0, mustHave: true },
      { name: 'AWS', weight: 0.9, mustHave: true },
      { name: 'Terraform', weight: 0.7, mustHave: false },
      { name: 'CI/CD', weight: 0.7, mustHave: false },
    ],
  },
  {
    title: 'Data Engineer',
    department: 'Data',
    location: 'Bengaluru',
    experienceMin: 3,
    experienceMax: 6,
    description:
      'Data engineer to build and optimise our analytics pipelines. Must have: Python, SQL, PostgreSQL. ' +
      'Deep SQL optimization and database indexing skills essential. Nice to have: Kafka, Redis. 3-6 years.',
    skills: [
      { name: 'Python', weight: 1.0, mustHave: true },
      { name: 'SQL', weight: 1.0, mustHave: true },
      { name: 'SQL Optimization', weight: 0.9, mustHave: true },
      { name: 'PostgreSQL', weight: 0.8, mustHave: true },
      { name: 'Kafka', weight: 0.4, mustHave: false },
    ],
  },
];

// --------------------------------------------------------------------------- main

async function main() {
  console.log('Resetting database...');
  await reset();

  // ---- settings
  const { ensureDefaultSettings } = await import('../backend/src/services/settings.service.js');
  await ensureDefaultSettings();

  // ---- skills
  console.log('Seeding skills...');
  const skillMap = new Map();
  for (const [name, category] of SKILLS) {
    const s = await prisma.skill.create({ data: { name, category } });
    skillMap.set(name, s);
  }

  const passwordHash = hash(DEMO_PASSWORD);

  // ---- admin + recruiters
  console.log('Seeding users...');
  await prisma.user.create({
    data: { name: 'System Admin', email: 'admin@scheduler.dev', passwordHash, role: 'ADMIN', timezone: 'Asia/Kolkata', avatarSeed: 'admin' },
  });

  const recruiterUser = await prisma.user.create({
    data: {
      name: 'Kavya Raman', email: 'recruiter@scheduler.dev', passwordHash, role: 'RECRUITER',
      timezone: 'Asia/Kolkata', phone: '+91-9000000001', avatarSeed: 'kavya',
      recruiterProfile: { create: { department: 'Talent Acquisition', title: 'Lead Technical Recruiter' } },
    },
    include: { recruiterProfile: true },
  });

  const recruiter2 = await prisma.user.create({
    data: {
      name: 'Alex Turner', email: 'recruiter2@scheduler.dev', passwordHash, role: 'RECRUITER',
      timezone: 'Europe/London', avatarSeed: 'alex',
      recruiterProfile: { create: { department: 'Talent Acquisition', title: 'Technical Recruiter' } },
    },
    include: { recruiterProfile: true },
  });

  // ---- interviewers
  const interviewers = [];
  for (const [i, [name, tz, seniority, yrs, types, maxDay, maxWeek, hours, skills]] of INTERVIEWERS.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@company.dev`;
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role: 'INTERVIEWER', timezone: tz, avatarSeed: `iv${i}`,
        interviewerProfile: {
          create: {
            title: `${seniority === 'JUNIOR' ? 'Software' : seniority === 'MID' ? 'Senior Software' : 'Principal'} Engineer`,
            department: 'Engineering',
            seniority,
            yearsExperience: yrs,
            maxInterviewsPerDay: maxDay,
            maxInterviewsPerWeek: maxWeek,
            workStartMinute: hours[0],
            workEndMinute: hours[1],
            workDaysCsv: '1,2,3,4,5',
            interviewTypesCsv: types,
            bioText: `${yrs} years of experience. Conducts ${types.split(',').join(', ').toLowerCase()} interviews.`,
          },
        },
      },
      include: { interviewerProfile: true },
    });

    for (const [skillName, prof, sYrs] of skills) {
      await prisma.interviewerSkill.create({
        data: { interviewerId: user.interviewerProfile.id, skillId: skillMap.get(skillName).id, proficiency: prof, yearsExperience: sYrs },
      });
    }
    interviewers.push({ user, profile: user.interviewerProfile, tz, hours });
  }

  // ---- candidates
  const candidates = [];
  for (const [i, [name, tz, headline, yrs, company, skills, resumeText]] of CANDIDATES.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.dev`;
    const user = await prisma.user.create({
      data: {
        name, email, passwordHash, role: 'CANDIDATE', timezone: tz, avatarSeed: `cd${i}`,
        phone: i < 3 ? `+91-90000001${i}` : null,
        candidateProfile: {
          create: {
            headline, yearsExperience: yrs, currentCompany: company, resumeText,
            maxInterviewsPerDay: i === 0 ? 1 : 2,
            minBufferMinutes: 30,
            preferredStartMinute: i === 0 ? 1020 : 540, // Rahul prefers after 17:00
            preferredEndMinute: i === 0 ? 1320 : 1200,
            ...(i === 0
              ? {
                  availabilityNoteRaw:
                    "I'm free any weekday after 5 PM except Wednesday and I don't want two interviews on the same day.",
                  availabilityConstraintsJson: JSON.stringify({
                    days: ['monday', 'tuesday', 'thursday', 'friday'],
                    avoid_days: ['wednesday'],
                    start_time: '17:00',
                    end_time: '22:00',
                    max_interviews_per_day: 1,
                    notes: 'Parsed by the deterministic rule-based parser.',
                  }),
                }
              : {}),
          },
        },
      },
      include: { candidateProfile: true },
    });

    for (const [skillName, prof] of skills) {
      await prisma.candidateSkill.create({
        data: { candidateId: user.candidateProfile.id, skillId: skillMap.get(skillName).id, proficiency: prof, source: 'SELF' },
      });
    }
    candidates.push({ user, profile: user.candidateProfile, tz });
  }

  // ---- availability
  console.log('Seeding availability...');

  // Interviewers: declare availability across their working days.
  for (const iv of interviewers) {
    const windows = [];
    for (const day of DAYS.slice(0, 10)) {
      windows.push({
        userId: iv.user.id,
        startUtc: at(day, Math.floor(iv.hours[0] / 60), iv.hours[0] % 60, iv.tz),
        endUtc: at(day, Math.floor(iv.hours[1] / 60), iv.hours[1] % 60, iv.tz),
        kind: 'AVAILABLE',
        sourceTimezone: iv.tz,
      });
    }
    await prisma.availabilityWindow.createMany({ data: windows });
  }

  // Candidate 0 (Rahul): evenings only, no Wednesdays - matches his NL statement.
  const rahul = candidates[0];
  const rahulWindows = [];
  for (const day of DAYS.slice(0, 10)) {
    const weekday = DateTime.now().setZone(rahul.tz).plus({ days: day }).weekday;
    if (weekday === 3) continue; // no Wednesday
    rahulWindows.push({
      userId: rahul.user.id,
      startUtc: at(day, 17, 0, rahul.tz),
      endUtc: at(day, 22, 0, rahul.tz),
      kind: 'AVAILABLE',
      sourceTimezone: rahul.tz,
      note: 'Derived from natural-language availability',
    });
  }
  // An explicit blackout to prove UNAVAILABLE beats AVAILABLE.
  rahulWindows.push({
    userId: rahul.user.id,
    startUtc: at(DAYS[1], 0, 0, rahul.tz),
    endUtc: at(DAYS[1], 23, 59, rahul.tz),
    kind: 'UNAVAILABLE',
    sourceTimezone: rahul.tz,
    note: 'Personal commitment - full day blocked',
  });
  await prisma.availabilityWindow.createMany({ data: rahulWindows });

  // Candidates 1-6 declare normal daytime availability; 7-9 declare NOTHING
  // (so the scheduler must fall back to their stated preferred hours).
  for (const c of candidates.slice(1, 7)) {
    const windows = DAYS.slice(0, 8).map((day) => ({
      userId: c.user.id,
      startUtc: at(day, 10, 0, c.tz),
      endUtc: at(day, 19, 0, c.tz),
      kind: 'AVAILABLE',
      sourceTimezone: c.tz,
    }));
    // Mark a preferred sub-window for candidate 1 to exercise PREFERRED scoring.
    if (c === candidates[1]) {
      windows.push({
        userId: c.user.id,
        startUtc: at(DAYS[2], 14, 0, c.tz),
        endUtc: at(DAYS[2], 17, 0, c.tz),
        kind: 'PREFERRED',
        sourceTimezone: c.tz,
        note: 'Ideal window',
      });
    }
    await prisma.availabilityWindow.createMany({ data: windows });
  }

  // ---- jobs
  console.log('Seeding jobs...');
  const jobs = [];
  for (const [i, j] of JOBS.entries()) {
    const job = await prisma.job.create({
      data: {
        title: j.title,
        description: j.description,
        department: j.department,
        location: j.location,
        experienceMin: j.experienceMin,
        experienceMax: j.experienceMax,
        requiredSkillsJson: JSON.stringify(j.skills),
        recruiterId: (i === 1 ? recruiter2 : recruiterUser).recruiterProfile.id,
        status: 'OPEN',
      },
    });
    jobs.push(job);
  }

  // ---- applications
  const applications = [];
  const applicationPlan = [
    [0, 0], [0, 1], [0, 6], [0, 8], [0, 9], // backend role: strong, strong, medium, medium, weak
    [1, 2], [1, 3],                          // platform role
    [2, 4], [2, 7], [2, 5],                  // data role
  ];
  for (const [jobIdx, candIdx] of applicationPlan) {
    const app = await prisma.application.create({
      data: { jobId: jobs[jobIdx].id, candidateId: candidates[candIdx].profile.id },
    });
    applications.push({ app, jobIdx, candIdx });
  }

  // ---- interview requests
  console.log('Seeding interview requests...');
  const backendApps = applications.filter((a) => a.jobIdx === 0);
  const requests = [];

  for (const { app, jobIdx } of applications) {
    const skills = JSON.parse(jobs[jobIdx].requiredSkillsJson);
    const r1 = await prisma.interviewRequest.create({
      data: {
        applicationId: app.id,
        roundNumber: 1,
        roundName: 'Technical Screen',
        interviewType: 'TECHNICAL',
        durationMinutes: 45,
        requiredInterviewerCount: 1,
        bufferMinutes: 15,
        earliestUtc: at(DAYS[0], 0, 0, 'UTC'),
        latestUtc: at(DAYS[7], 23, 59, 'UTC'),
        requiredSkillsJson: JSON.stringify(skills),
        createdById: recruiterUser.id,
      },
    });
    requests.push(r1);
  }

  // A dependent round 2 for the first backend candidate: cascade demo.
  const round2 = await prisma.interviewRequest.create({
    data: {
      applicationId: backendApps[0].app.id,
      roundNumber: 2,
      roundName: 'System Design',
      interviewType: 'SYSTEM_DESIGN',
      durationMinutes: 60,
      requiredInterviewerCount: 1,
      bufferMinutes: 15,
      earliestUtc: at(DAYS[4], 0, 0, 'UTC'),
      latestUtc: at(DAYS[10], 23, 59, 'UTC'),
      requiredSkillsJson: JSON.stringify([
        { name: 'System Design', weight: 1.0, mustHave: true },
        { name: 'Microservices', weight: 0.8, mustHave: false },
      ]),
      dependsOnRequestId: requests[0].id,
      createdById: recruiterUser.id,
    },
  });

  // ---- a completed round WITH feedback (drives the adaptive pipeline demo)
  console.log('Seeding history: a completed interview with feedback...');
  const historyApp = applications.find((a) => a.jobIdx === 0 && a.candIdx === 1);
  const historyRequest = await prisma.interviewRequest.create({
    data: {
      applicationId: historyApp.app.id,
      roundNumber: 0,
      roundName: 'Recruiter Screen',
      interviewType: 'TECHNICAL',
      durationMinutes: 30,
      requiredInterviewerCount: 1,
      bufferMinutes: 15,
      earliestUtc: at(-6, 0, 0, 'UTC'),
      latestUtc: at(-2, 23, 59, 'UTC'),
      requiredSkillsJson: JSON.stringify([{ name: 'Java', weight: 1, mustHave: true }]),
      status: 'COMPLETED',
      createdById: recruiterUser.id,
    },
  });

  const pastStart = at(-3, 11, 0, 'Asia/Kolkata');
  const pastEnd = new Date(+pastStart + 30 * 60000);
  const pastInterview = await prisma.interview.create({
    data: {
      requestId: historyRequest.id,
      startUtc: pastStart,
      endUtc: pastEnd,
      status: 'COMPLETED',
      candidateResponse: 'ACCEPTED',
      scheduleScore: 91,
      riskScore: 0.08,
      resilienceScore: 88,
      reasonsJson: JSON.stringify(['Candidate preferred window', 'Low interviewer load', 'Same timezone']),
      actualStartUtc: pastStart,
      actualEndUtc: new Date(+pastEnd + 6 * 60000), // 6-minute overrun -> real analytics data
      createdById: recruiterUser.id,
    },
  });
  await prisma.interviewPanelMember.create({
    data: {
      interviewId: pastInterview.id,
      interviewerId: interviewers[0].profile.id,
      role: 'PRIMARY',
      responseStatus: 'ACCEPTED',
      matchScore: 92,
      respondedAt: at(-4, 10, 0, 'Asia/Kolkata'),
    },
  });
  await prisma.feedback.create({
    data: {
      interviewId: pastInterview.id,
      interviewerId: interviewers[0].profile.id,
      overallRating: 3,
      recommendation: 'YES',
      ratingsJson: JSON.stringify({ 'Technical Knowledge': 4, 'Problem Solving': 3, Communication: 4 }),
      comments:
        'Strong Java fundamentals and clear communication, but weak SQL optimization. Struggled to explain index selection for a slow query.',
      aiAnalysisJson: JSON.stringify({
        strengths: ['Java', 'Communication'],
        skill_gaps: ['SQL Optimization'],
        recommended_topics: ['SQL Optimization', 'Database Indexing', 'SQL'],
        next_round_focus: ['SQL Optimization', 'Database Indexing'],
        sentiment: 'MIXED',
        summary: 'Deterministic analysis: 2 strengths, 1 gap; overall rating 3/5.',
        providerUsed: 'deterministic',
      }),
      aiProviderUsed: 'deterministic',
      submittedAt: at(-3, 12, 0, 'Asia/Kolkata'),
    },
  });

  // The next round for that candidate already carries the feedback-derived focus.
  await prisma.interviewRequest.update({
    where: { id: requests[1].id },
    data: {
      focusTopicsJson: JSON.stringify(['SQL Optimization', 'Database Indexing']),
      requiredSkillsJson: JSON.stringify([
        ...JSON.parse(jobs[0].requiredSkillsJson),
        { name: 'SQL Optimization', weight: 0.7, mustHave: false, fromFeedback: true },
        { name: 'Database Indexing', weight: 0.7, mustHave: false, fromFeedback: true },
      ]),
    },
  });

  // ---- deliberately load Vikram Singh to his weekly ceiling (3/week)
  console.log('Seeding interviewer overload scenario...');
  const vikram = interviewers[3];
  const otherCandidates = candidates.slice(2, 5);
  for (const [i, c] of otherCandidates.entries()) {
    const start = at(DAYS[i], 11, 0, 'Asia/Kolkata');
    const end = new Date(+start + 45 * 60000);
    const app = applications.find((a) => a.candIdx === candidates.indexOf(c));
    if (!app) continue;
    const req = requests[applications.indexOf(app)];

    const iv = await prisma.interview.create({
      data: {
        requestId: req.id,
        startUtc: start,
        endUtc: end,
        status: 'SCHEDULED',
        candidateResponse: i === 0 ? 'ACCEPTED' : 'PENDING',
        scheduleScore: 84 - i * 3,
        riskScore: 0.12 + i * 0.03,
        reasonsJson: JSON.stringify(['Interviewer available', 'Within working hours', 'Buffer maintained']),
        createdById: recruiterUser.id,
      },
    });
    await prisma.interviewRequest.update({ where: { id: req.id }, data: { status: 'SCHEDULED' } });
    await prisma.interviewPanelMember.create({
      data: { interviewId: iv.id, interviewerId: vikram.profile.id, role: 'PRIMARY', responseStatus: i === 0 ? 'ACCEPTED' : 'PENDING', matchScore: 88 },
    });
    await prisma.booking.createMany({
      data: [
        { userId: c.user.id, interviewId: iv.id, startUtc: start, endUtc: end, kind: 'INTERVIEW' },
        { userId: vikram.user.id, interviewId: iv.id, startUtc: start, endUtc: end, kind: 'INTERVIEW' },
      ],
    });
    await prisma.meeting.create({
      data: {
        interviewId: iv.id, provider: 'GOOGLE_MEET', externalId: `gmeet-${iv.id.slice(-8)}`,
        joinUrl: `https://meet.google.com/abc-${iv.id.slice(-4)}-xyz`, status: 'ACTIVE',
      },
    });
    await prisma.calendarEventRecord.create({
      data: { interviewId: iv.id, provider: 'MOCK', externalId: `mock-evt-${iv.id.slice(-8)}`, status: 'CONFIRMED' },
    });
    await prisma.scheduleScore.create({
      data: {
        interviewId: iv.id,
        healthScore: 78 - i * 6,
        conflictRisk: 18 + i * 5,
        cascadeRisk: 22 + i * 8,
        interviewerLoad: 33 + i * 33,
        candidateInconvenience: 0,
        waitingRisk: 0,
        timezoneRisk: 0,
        bufferQuality: 85,
        breakdownJson: JSON.stringify({ note: 'Seeded baseline score', computedBy: 'seed' }),
      },
    });
  }

  // ---- one external commitment to create a genuine calendar conflict
  await prisma.booking.create({
    data: {
      userId: interviewers[0].user.id,
      startUtc: at(DAYS[0], 17, 0, 'Asia/Kolkata'),
      endUtc: at(DAYS[0], 18, 30, 'Asia/Kolkata'),
      kind: 'EXTERNAL',
    },
  });

  // ---- audit trail so the timeline is not empty on first load
  await prisma.auditLog.createMany({
    data: [
      { actorUserId: recruiterUser.id, actorRole: 'RECRUITER', action: 'JOB_CREATED', entity: 'Job', entityId: jobs[0].id, summary: `Job "${jobs[0].title}" created`, metadataJson: '{}' },
      { actorUserId: recruiterUser.id, actorRole: 'RECRUITER', action: 'REQUEST_CREATED', entity: 'InterviewRequest', entityId: requests[0].id, summary: 'Technical Screen requested for Rahul Mehta', metadataJson: '{}' },
      { actorRole: 'SYSTEM', action: 'FEEDBACK_ANALYZED', entity: 'Interview', entityId: pastInterview.id, summary: 'AI analysis (deterministic): strengths [Java, Communication], gaps [SQL Optimization]', metadataJson: '{}' },
      { actorRole: 'SYSTEM', action: 'NEXT_ROUND_RECOMMENDED', entity: 'InterviewRequest', entityId: requests[1].id, summary: 'Round 1 focus set from screen feedback: SQL Optimization, Database Indexing', metadataJson: '{}' },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    candidates: await prisma.candidateProfile.count(),
    interviewers: await prisma.interviewerProfile.count(),
    skills: await prisma.skill.count(),
    jobs: await prisma.job.count(),
    applications: await prisma.application.count(),
    requests: await prisma.interviewRequest.count(),
    interviews: await prisma.interview.count(),
    availabilityWindows: await prisma.availabilityWindow.count(),
    bookings: await prisma.booking.count(),
    feedback: await prisma.feedback.count(),
  };

  console.log('\nSeed complete:', counts);
  console.log(`
  DEMO CREDENTIALS  (password for every account: ${DEMO_PASSWORD})
  ---------------------------------------------------------------
  Recruiter    recruiter@scheduler.dev      (Kavya Raman, IST)
  Recruiter 2  recruiter2@scheduler.dev     (Alex Turner, London)
  Candidate    rahul.mehta@example.dev      (evenings only, no Wednesdays)
  Candidate    aisha.khan@example.dev       (has prior-round feedback)
  Interviewer  ananya.sharma@company.dev    (strong Java/SQL match)
  Interviewer  vikram.singh@company.dev     (deliberately at capacity)
  Interviewer  sarah.chen@company.dev       (US Pacific - timezone stress)
  Interviewer  tom.bradley@company.dev      (weak match for Java roles)
  Admin        admin@scheduler.dev
  `);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
