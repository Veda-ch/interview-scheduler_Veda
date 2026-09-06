/**
 * Direct AI endpoints.
 *
 * These are thin: they call the AI facade, return the validated structured
 * output, and always report which provider produced it. Nothing here writes a
 * scheduling decision - persisting AI output happens on the domain routes
 * (candidates, jobs, feedback) where it can be validated in context.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  analyzeJobDescription,
  analyzeResume,
  parseAvailabilityText,
  analyzeFeedback,
  generateMessage,
  semanticSkillMatch,
} from '../services/ai.service.js';
import { aiServiceHealth, breakerState } from '../providers/aiClient.js';
import { auditFromRequest } from '../services/audit.service.js';
import config from '../config/env.js';
import { AUDIT_ACTIONS, ROLES, INTERVIEW_TYPE_VALUES } from '../../../shared/constants.js';
import { isValidZone } from '../lib/time.js';

const router = Router();
router.use(requireAuth);

const envelope = (result) => ({
  result: result.data,
  ai: {
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
    degraded: result.degraded,
    warning: result.warning,
    latencyMs: result.latencyMs,
    disclosure: result.fallbackUsed
      ? 'Produced by the deterministic extractor, not a language model.'
      : 'Produced by a language model and validated against a strict schema.',
  },
});

router.post(
  '/analyze-jd',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(z.object({ text: z.string().trim().min(20).max(20000) })),
  asyncHandler(async (req, res) => {
    const result = await analyzeJobDescription(req.body.text, {
      auditContext: { actorUserId: req.user.id, actorRole: req.user.role, entity: 'Job' },
    });
    await auditFromRequest(req, {
      action: AUDIT_ACTIONS.JD_ANALYZED,
      entity: 'Job',
      summary: `Ad-hoc JD analysis via ${result.provider}`,
    });
    res.json(envelope(result));
  })
);

router.post(
  '/analyze-resume',
  validateBody(
    z.object({
      text: z.string().trim().min(30).max(20000),
      jdSkills: z.array(z.object({ name: z.string(), weight: z.number().optional(), mustHave: z.boolean().optional() })).max(50).default([]),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(envelope(await analyzeResume(req.body.text, req.body.jdSkills)));
  })
);

router.post(
  '/parse-availability',
  validateBody(
    z.object({
      text: z.string().trim().min(3).max(2000),
      timezone: z.string().refine(isValidZone, 'Unknown IANA timezone').default('UTC'),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(envelope(await parseAvailabilityText(req.body.text, req.body.timezone)));
  })
);

router.post(
  '/analyze-feedback',
  requireRole(ROLES.INTERVIEWER, ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(
    z.object({
      comments: z.string().trim().min(5).max(6000),
      ratings: z.record(z.string(), z.coerce.number().min(1).max(5)).default({}),
      overallRating: z.coerce.number().int().min(1).max(5).default(3),
      interviewType: z.enum(INTERVIEW_TYPE_VALUES).default('TECHNICAL'),
      requiredSkills: z.array(z.string()).max(40).default([]),
    })
  ),
  asyncHandler(async (req, res) => {
    const b = req.body;
    res.json(
      envelope(
        await analyzeFeedback({
          comments: b.comments,
          ratings: b.ratings,
          overall_rating: b.overallRating,
          interview_type: b.interviewType,
          required_skills: b.requiredSkills,
        })
      )
    );
  })
);

router.post(
  '/generate-message',
  requireRole(ROLES.RECRUITER, ROLES.ADMIN),
  validateBody(
    z.object({
      templateType: z.string().trim().min(3).max(60),
      context: z.record(z.string(), z.any()).default({}),
      tone: z.string().max(40).default('professional'),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(
      envelope(
        await generateMessage({ template_type: req.body.templateType, context: req.body.context, tone: req.body.tone })
      )
    );
  })
);

router.post(
  '/skill-match',
  validateBody(
    z.object({
      required: z.array(z.object({ name: z.string(), weight: z.number().optional(), mustHave: z.boolean().optional() })).max(50),
      offered: z.array(z.object({ name: z.string(), proficiency: z.number().optional() })).max(100),
    })
  ),
  asyncHandler(async (req, res) => {
    res.json(envelope(await semanticSkillMatch(req.body.required, req.body.offered)));
  })
);

/**
 * AI transparency endpoint. Powers the "how AI is used here" panel in the UI -
 * a hackathon requirement we treat as a first-class feature, not a footnote.
 */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const health = await aiServiceHealth();
    res.json({
      configuredProvider: config.providers.ai,
      serviceReachable: health.ok,
      activeProvider: health.ai_provider ?? 'unreachable',
      usesLanguageModel: Boolean(health.ai_is_llm),
      embeddingProvider: health.embedding_provider ?? 'unknown',
      embeddingIsNeural: Boolean(health.embedding_is_neural),
      solver: health.solver ?? 'unavailable',
      circuitBreaker: breakerState(),
      demoMode: config.demoMode,
      responsibilities: {
        languageModel: [
          'Job description parsing',
          'Resume parsing',
          'Natural-language availability parsing',
          'Interview feedback analysis',
          'Notification copy drafting',
        ],
        deterministic: [
          'All hard scheduling constraints',
          'Conflict and double-booking prevention',
          'Timezone and working-hours arithmetic',
          'Skill matching (ontology + embeddings)',
          'Recovery execution and the autonomy policy',
        ],
        optimizer: 'OR-Tools CP-SAT over a pre-validated feasible space',
        simulator: 'Monte-Carlo over stated hazard assumptions (no trained model)',
      },
      guarantees: [
        'Every LLM response is validated against a strict schema before use.',
        'A malformed response is retried once, then replaced by a deterministic extractor.',
        'No LLM output can create, move or cancel a booking on its own.',
        'Outputs are labelled with the provider that produced them.',
      ],
    });
  })
);

export default router;
