import { Router } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { requireAuth, requireRole, requireCandidateAccess, loadOwnProfile } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadResume, extractTextFromFile } from '../middleware/upload.js';
import {
  getCandidateById,
  getCandidateByUserId,
  listCandidates,
  updateCandidate,
  attachResume,
  applyResumeAnalysis,
  saveAvailabilityConstraints,
  candidateInterviews,
} from '../services/candidate.service.js';
import {
  listAvailability,
  setAvailability,
  deleteAvailabilityWindow,
  applyParsedConstraints,
} from '../services/availability.service.js';
import { analyzeResume, parseAvailabilityText } from '../services/ai.service.js';
import { auditFromRequest } from '../services/audit.service.js';
import { AUDIT_ACTIONS, ROLES, AVAILABILITY_KIND_VALUES } from '../../../shared/constants.js';
import { isValidZone } from '../lib/time.js';
import { badRequest, notFound } from '../lib/errors.js';
import prisma from '../lib/prisma.js';
import { shapeInterview } from '../services/interview.shape.js';

const router = Router();
router.use(requireAuth);

/** Resolve :id where "me" is allowed as an alias for the caller's own profile. */
async function resolveCandidateId(req) {
  if (req.params.id === 'me') {
    const own = await loadOwnProfile(req);
    if (!own) throw notFound('You do not have a candidate profile');
    req.params.id = own.id;
  }
  return req.params.id;
}

const meAlias = asyncHandler(async (req, _res, next) => {
  await resolveCandidateId(req);
  next();
});

router.get(
  '/',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateQuery(
    z.object({
      search: z.string().trim().max(80).optional(),
      skill: z.string().trim().max(60).optional(),
      take: z.coerce.number().min(1).max(200).default(50),
      skip: z.coerce.number().min(0).default(0),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(await listCandidates(req.validatedQuery));
  })
);

router.get(
  '/:id',
  meAlias,
  requireCandidateAccess(),
  asyncHandler(async (req, res) => {
    res.json(await getCandidateById(req.params.id));
  })
);

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().refine(isValidZone, 'Unknown IANA timezone').optional(),
  phone: z.string().trim().max(24).nullable().optional(),
  headline: z.string().trim().max(140).nullable().optional(),
  currentCompany: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  yearsExperience: z.coerce.number().min(0).max(60).optional(),
  maxInterviewsPerDay: z.coerce.number().int().min(1).max(6).optional(),
  minBufferMinutes: z.coerce.number().int().min(0).max(240).optional(),
  preferredStartMinute: z.coerce.number().int().min(0).max(1439).optional(),
  preferredEndMinute: z.coerce.number().int().min(1).max(1440).optional(),
  skills: z
    .array(z.object({ name: z.string().trim().min(1).max(60), proficiency: z.coerce.number().int().min(1).max(5).default(3) }))
    .max(60)
    .optional(),
});

router.put(
  '/:id',
  meAlias,
  requireCandidateAccess({ writable: true }),
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    if (
      req.body.preferredStartMinute != null &&
      req.body.preferredEndMinute != null &&
      req.body.preferredEndMinute <= req.body.preferredStartMinute
    ) {
      throw badRequest('Preferred end time must be after the preferred start time');
    }
    const updated = await updateCandidate(req.params.id, req.body);
    await auditFromRequest(req, {
      action: 'CANDIDATE_UPDATED',
      entity: 'CandidateProfile',
      entityId: req.params.id,
      summary: `${updated.name} profile updated`,
    });
    res.json(updated);
  })
);

// --------------------------------------------------------------- resume ----

router.post(
  '/:id/resume',
  meAlias,
  requireCandidateAccess({ writable: true }),
  uploadResume,
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No resume file was uploaded (field name must be "resume")');

    const resumeUrl = `/uploads/${path.basename(req.file.path)}`;
    const extracted = extractTextFromFile(req.file.path);
    const candidate = await attachResume(req.params.id, { resumeUrl, resumeText: extracted });

    await auditFromRequest(req, {
      action: 'RESUME_UPLOADED',
      entity: 'CandidateProfile',
      entityId: req.params.id,
      summary: `Resume uploaded (${Math.round(req.file.size / 1024)} KB)`,
      metadata: { extractedChars: extracted.length },
    });

    res.status(201).json({
      candidate,
      extractedTextLength: extracted.length,
      note: extracted
        ? 'Text extracted successfully.'
        : 'We could not extract text from this file (scanned or compressed PDF). Paste your resume text to enable AI analysis.',
    });
  })
);

/** Store raw resume text directly - the reliable path for AI analysis. */
router.post(
  '/:id/resume-text',
  meAlias,
  requireCandidateAccess({ writable: true }),
  validateBody(z.object({ text: z.string().trim().min(30).max(20000) })),
  asyncHandler(async (req, res) => {
    const candidate = await attachResume(req.params.id, { resumeUrl: undefined, resumeText: req.body.text });
    res.json(candidate);
  })
);

/** Run AI resume analysis and merge the validated result into the profile. */
router.post(
  '/:id/analyze-resume',
  meAlias,
  requireCandidateAccess({ writable: true }),
  validateBody(z.object({ text: z.string().trim().min(30).max(20000).optional(), jobId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
    const text = req.body.text || profile?.resumeText;
    if (!text) throw badRequest('No resume text on file. Upload a text-based resume or paste the text first.');

    let jdSkills = [];
    if (req.body.jobId) {
      const job = await prisma.job.findUnique({ where: { id: req.body.jobId } });
      if (job) jdSkills = JSON.parse(job.requiredSkillsJson || '[]');
    }

    const result = await analyzeResume(text, jdSkills, {
      auditContext: { actorUserId: req.user.id, actorRole: req.user.role, entity: 'CandidateProfile', entityId: req.params.id },
    });
    const candidate = await applyResumeAnalysis(req.params.id, result.data, result.provider);

    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.RESUME_ANALYZED,
      entity: 'CandidateProfile',
      entityId: req.params.id,
      summary: `Resume analysed via ${result.provider}${result.fallbackUsed ? ' (deterministic fallback)' : ''}`,
      metadata: { skillCount: result.data?.skills?.length ?? 0, provider: result.provider },
    });

    res.json({ candidate, analysis: result.data, ai: { provider: result.provider, fallbackUsed: result.fallbackUsed, warning: result.warning } });
  })
);

// --------------------------------------------------------- availability ----

router.get(
  '/:id/availability',
  meAlias,
  requireCandidateAccess(),
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) throw notFound('Candidate not found');
    res.json(await listAvailability(profile.userId, req.query));
  })
);

const windowSchema = z.object({
  startUtc: z.string().datetime({ offset: true }),
  endUtc: z.string().datetime({ offset: true }),
  kind: z.enum(AVAILABILITY_KIND_VALUES).default('AVAILABLE'),
  timezone: z.string().optional(),
  note: z.string().max(200).optional(),
});

router.post(
  '/:id/availability',
  meAlias,
  requireCandidateAccess({ writable: true }),
  validateBody(
    z.object({
      windows: z.array(windowSchema).min(1).max(100),
      mode: z.enum(['append', 'replace']).default('append'),
    })
  ),
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!profile) throw notFound('Candidate not found');

    const rows = await setAvailability(profile.userId, req.body.windows, {
      mode: req.body.mode,
      timezone: profile.user.timezone,
    });
    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.AVAILABILITY_UPDATED,
      entity: 'CandidateProfile',
      entityId: req.params.id,
      summary: `Availability updated (${rows.length} windows)`,
    });
    res.status(201).json(rows);
  })
);

router.delete(
  '/:id/availability/:windowId',
  meAlias,
  requireCandidateAccess({ writable: true }),
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) throw notFound('Candidate not found');
    res.json(await deleteAvailabilityWindow(profile.userId, req.params.windowId));
  })
);

/**
 * Natural-language availability. The LLM only produces structured constraints;
 * turning them into rows is deterministic (availability.service).
 */
router.post(
  '/:id/availability/natural',
  meAlias,
  requireCandidateAccess({ writable: true }),
  validateBody(z.object({ text: z.string().trim().min(5).max(1000), apply: z.boolean().default(true) })),
  asyncHandler(async (req, res) => {
    const profile = await prisma.candidateProfile.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!profile) throw notFound('Candidate not found');

    const result = await parseAvailabilityText(req.body.text, profile.user.timezone, {
      auditContext: { actorUserId: req.user.id, actorRole: req.user.role, entity: 'CandidateProfile', entityId: req.params.id },
    });

    await saveAvailabilityConstraints(req.params.id, req.body.text, result.data);

    let windows = [];
    if (req.body.apply) {
      windows = await applyParsedConstraints(profile.userId, result.data, { timezone: profile.user.timezone });
    }

    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.AVAILABILITY_PARSED,
      entity: 'CandidateProfile',
      entityId: req.params.id,
      summary: `Natural-language availability parsed via ${result.provider}`,
      metadata: { constraints: result.data, applied: req.body.apply, windowCount: windows.length },
    });

    res.json({
      constraints: result.data,
      windows,
      ai: { provider: result.provider, fallbackUsed: result.fallbackUsed, warning: result.warning },
    });
  })
);

// ------------------------------------------------------------ interviews ----

router.get(
  '/:id/interviews',
  meAlias,
  requireCandidateAccess(),
  asyncHandler(async (req, res) => {
    const rows = await candidateInterviews(req.params.id);
    const me = await prisma.candidateProfile.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { timezone: true } } },
    });
    res.json(rows.map((r) => shapeInterview(r, { viewerTimezone: me?.user?.timezone })));
  })
);

/** Slot proposals awaiting this candidate's choice. */
router.get(
  '/:id/proposals',
  meAlias,
  requireCandidateAccess(),
  asyncHandler(async (req, res) => {
    const proposals = await prisma.slotProposal.findMany({
      where: {
        status: 'OPEN',
        request: { status: 'PROPOSED', application: { candidateId: req.params.id } },
      },
      include: {
        request: { include: { application: { include: { job: true } } } },
      },
      orderBy: [{ requestId: 'asc' }, { rank: 'asc' }],
    });

    const interviewerIds = [...new Set(proposals.flatMap((p) => p.interviewerIdsCsv.split(',').filter(Boolean)))];
    const interviewers = await prisma.interviewerProfile.findMany({
      where: { id: { in: interviewerIds } },
      include: { user: { select: { name: true, timezone: true } } },
    });
    const nameById = new Map(interviewers.map((i) => [i.id, { name: i.user.name, title: i.title }]));

    res.json(
      proposals.map((p) => ({
        id: p.id,
        requestId: p.requestId,
        roundName: p.request.roundName,
        interviewType: p.request.interviewType,
        jobTitle: p.request.application.job.title,
        rank: p.rank,
        startUtc: p.startUtc,
        endUtc: p.endUtc,
        durationMinutes: p.request.durationMinutes,
        score: p.score,
        riskScore: p.riskScore,
        resilienceScore: p.resilienceScore,
        reasons: JSON.parse(p.reasonsJson || '[]'),
        engineUsed: p.engineUsed,
        expiresAt: p.expiresAt,
        interviewers: p.interviewerIdsCsv.split(',').filter(Boolean).map((id) => nameById.get(id) || { name: 'Interviewer' }),
      }))
    );
  })
);

export default router;
