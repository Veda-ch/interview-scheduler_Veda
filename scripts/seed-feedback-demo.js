import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Seeding Feedback Demo Data ---');

  // 1. Find Ananya Sharma (Interviewer)
  const ananya = await prisma.user.findUnique({
    where: { email: 'ananya.sharma@company.dev' },
    include: { interviewerProfile: true },
  });
  if (!ananya || !ananya.interviewerProfile) {
    throw new Error('Ananya Sharma interviewer profile not found');
  }
  const interviewerId = ananya.interviewerProfile.id;
  const recruiterUser = await prisma.user.findFirst({ where: { role: 'RECRUITER' } });

  // 2. Find Candidate Kenji Watanabe
  const kenji = await prisma.candidateProfile.findFirst({
    where: { user: { name: 'Kenji Watanabe' } },
    include: { user: true, applications: { include: { job: true, requests: true } } },
  });
  if (!kenji || !kenji.applications.length) {
    throw new Error('Kenji Watanabe candidate application not found');
  }

  const kenjiApp = kenji.applications[0];
  let kenjiReq = kenjiApp.requests.find((r) => r.roundNumber === 1);
  if (!kenjiReq) {
    kenjiReq = await prisma.interviewRequest.create({
      data: {
        applicationId: kenjiApp.id,
        roundNumber: 1,
        roundName: 'Technical Screen & Coding',
        interviewType: 'TECHNICAL',
        durationMinutes: 45,
        requiredInterviewerCount: 1,
        bufferMinutes: 15,
        earliestUtc: new Date(Date.now() - 7 * 86400000),
        latestUtc: new Date(Date.now() + 7 * 86400000),
        requiredSkillsJson: JSON.stringify([
          { name: 'Java', weight: 1, mustHave: true },
          { name: 'Spring Boot', weight: 1, mustHave: true },
          { name: 'SQL', weight: 0.9, mustHave: true },
          { name: 'Microservices', weight: 0.8, mustHave: false },
        ]),
        status: 'COMPLETED',
        createdById: recruiterUser?.id || ananya.id,
      },
    });
  } else {
    await prisma.interviewRequest.update({
      where: { id: kenjiReq.id },
      data: { status: 'COMPLETED' },
    });
  }

  // Create a dependent round 2 for Kenji to showcase AI skill-gap propagation!
  let kenjiRound2 = await prisma.interviewRequest.findFirst({
    where: { applicationId: kenjiApp.id, roundNumber: 2 },
  });
  if (!kenjiRound2) {
    kenjiRound2 = await prisma.interviewRequest.create({
      data: {
        applicationId: kenjiApp.id,
        roundNumber: 2,
        roundName: 'System Architecture & Concurrency',
        interviewType: 'SYSTEM_DESIGN',
        durationMinutes: 60,
        requiredInterviewerCount: 1,
        bufferMinutes: 15,
        earliestUtc: new Date(Date.now() + 2 * 86400000),
        latestUtc: new Date(Date.now() + 8 * 86400000),
        requiredSkillsJson: JSON.stringify([
          { name: 'System Design', weight: 1, mustHave: true },
          { name: 'Microservices', weight: 0.8, mustHave: true },
        ]),
        dependsOnRequestId: kenjiReq.id,
        status: 'PENDING',
        createdById: recruiterUser?.id || ananya.id,
      },
    });
    console.log('Created Kenji dependent Round 2 (awaits AI gap propagation):', kenjiRound2.id);
  }

  // Ensure Kenji interview completed 2 hours ago, ready for feedback!
  const kenjiStart = new Date(Date.now() - 2.5 * 3600000);
  const kenjiEnd = new Date(Date.now() - 1.75 * 3600000);

  // Check if interview already exists for kenjiReq
  let kenjiIv = await prisma.interview.findFirst({
    where: { requestId: kenjiReq.id },
  });
  if (!kenjiIv) {
    kenjiIv = await prisma.interview.create({
      data: {
        requestId: kenjiReq.id,
        startUtc: kenjiStart,
        endUtc: kenjiEnd,
        status: 'COMPLETED',
        candidateResponse: 'ACCEPTED',
        scheduleScore: 94,
        riskScore: 0.05,
        reasonsJson: JSON.stringify(['Optimal skill match', 'Within declared hours', 'Low fatigue']),
        actualStartUtc: kenjiStart,
        actualEndUtc: new Date(+kenjiEnd + 5 * 60000),
        createdById: recruiterUser?.id || ananya.id,
      },
    });
  } else {
    // Make sure it is COMPLETED and has no feedback so user can test it!
    await prisma.feedback.deleteMany({ where: { interviewId: kenjiIv.id } });
    kenjiIv = await prisma.interview.update({
      where: { id: kenjiIv.id },
      data: {
        status: 'COMPLETED',
        startUtc: kenjiStart,
        endUtc: kenjiEnd,
        actualStartUtc: kenjiStart,
        actualEndUtc: new Date(+kenjiEnd + 5 * 60000),
      },
    });
  }

  // Ensure Ananya is panel member for Kenji's interview
  await prisma.interviewPanelMember.upsert({
    where: { interviewId_interviewerId: { interviewId: kenjiIv.id, interviewerId } },
    update: { responseStatus: 'ACCEPTED', role: 'PRIMARY', matchScore: 95 },
    create: {
      interviewId: kenjiIv.id,
      interviewerId,
      role: 'PRIMARY',
      responseStatus: 'ACCEPTED',
      matchScore: 95,
    },
  });
  console.log(`✓ Seeded Kenji Watanabe (Technical Screen) - COMPLETED, Feedback Pending: ${kenjiIv.id}`);

  // 3. Find Candidate Ethan Brooks for a 2nd Feedback-ready interview (Completed yesterday)
  const ethan = await prisma.candidateProfile.findFirst({
    where: { user: { name: 'Ethan Brooks' } },
    include: { user: true, applications: { include: { job: true, requests: true } } },
  });
  if (ethan && ethan.applications.length) {
    const ethanApp = ethan.applications[0];
    let ethanReq = ethanApp.requests.find((r) => r.roundNumber === 1);
    if (!ethanReq) {
      ethanReq = await prisma.interviewRequest.create({
        data: {
          applicationId: ethanApp.id,
          roundNumber: 1,
          roundName: 'Backend Core & APIs',
          interviewType: 'TECHNICAL',
          durationMinutes: 45,
          requiredInterviewerCount: 1,
          bufferMinutes: 15,
          earliestUtc: new Date(Date.now() - 3 * 86400000),
          latestUtc: new Date(Date.now() + 5 * 86400000),
          requiredSkillsJson: JSON.stringify([
            { name: 'Java', weight: 1, mustHave: true },
            { name: 'REST APIs', weight: 1, mustHave: true },
            { name: 'SQL', weight: 0.8, mustHave: false },
          ]),
          status: 'COMPLETED',
          createdById: recruiterUser?.id || ananya.id,
        },
      });
    } else {
      await prisma.interviewRequest.update({
        where: { id: ethanReq.id },
        data: { status: 'COMPLETED' },
      });
    }

    const ethanStart = new Date(Date.now() - 26 * 3600000); // 26h ago (yesterday)
    const ethanEnd = new Date(Date.now() - 25.25 * 3600000);

    let ethanIv = await prisma.interview.findFirst({ where: { requestId: ethanReq.id } });
    if (!ethanIv) {
      ethanIv = await prisma.interview.create({
        data: {
          requestId: ethanReq.id,
          startUtc: ethanStart,
          endUtc: ethanEnd,
          status: 'COMPLETED',
          candidateResponse: 'ACCEPTED',
          scheduleScore: 91,
          riskScore: 0.08,
          actualStartUtc: ethanStart,
          actualEndUtc: ethanEnd,
          createdById: recruiterUser?.id || ananya.id,
        },
      });
    } else {
      await prisma.feedback.deleteMany({ where: { interviewId: ethanIv.id } });
      ethanIv = await prisma.interview.update({
        where: { id: ethanIv.id },
        data: {
          status: 'COMPLETED',
          startUtc: ethanStart,
          endUtc: ethanEnd,
          actualStartUtc: ethanStart,
          actualEndUtc: ethanEnd,
        },
      });
    }

    await prisma.interviewPanelMember.upsert({
      where: { interviewId_interviewerId: { interviewId: ethanIv.id, interviewerId } },
      update: { responseStatus: 'ACCEPTED', role: 'PRIMARY', matchScore: 92 },
      create: {
        interviewId: ethanIv.id,
        interviewerId,
        role: 'PRIMARY',
        responseStatus: 'ACCEPTED',
        matchScore: 92,
      },
    });
    console.log(`✓ Seeded Ethan Brooks (Backend Core & APIs) - COMPLETED, Feedback Pending: ${ethanIv.id}`);
  }

  // 4. Ensure an Upcoming Interview for tomorrow exists for Ananya (Rahul Mehta)
  const rahul = await prisma.candidateProfile.findFirst({
    where: { user: { name: 'Rahul Mehta' } },
    include: { applications: { include: { requests: true } } },
  });
  if (rahul && rahul.applications.length) {
    const rahulApp = rahul.applications[0];
    const rahulReq = rahulApp.requests[0];
    if (rahulReq) {
      const tomorrowStart = DateTime.now().plus({ days: 1 }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      const tomorrowEnd = new Date(+tomorrowStart + 60 * 60000);

      // Check if scheduled interview exists
      const existingScheduled = await prisma.interview.findFirst({
        where: { requestId: rahulReq.id, status: 'SCHEDULED' },
      });
      if (existingScheduled) {
        await prisma.interview.update({
          where: { id: existingScheduled.id },
          data: { startUtc: tomorrowStart, endUtc: tomorrowEnd },
        });
        await prisma.interviewPanelMember.upsert({
          where: { interviewId_interviewerId: { interviewId: existingScheduled.id, interviewerId } },
          update: { responseStatus: 'ACCEPTED', role: 'PRIMARY' },
          create: {
            interviewId: existingScheduled.id,
            interviewerId,
            role: 'PRIMARY',
            responseStatus: 'ACCEPTED',
            matchScore: 89,
          },
        });
        console.log(`✓ Updated Upcoming Interview with Rahul Mehta for tomorrow: ${existingScheduled.id}`);
      }
    }
  }

  console.log('--- Seeding Completed Successfully ---');
}

main()
  .catch((err) => {
    console.error('Failed to seed feedback demo data:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
