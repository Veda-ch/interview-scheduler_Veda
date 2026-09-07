/**
 * Warm everything the demo's first thirty seconds depend on.
 *
 * Two separate problems this solves:
 *
 *  1. COLD MODEL. The first call after an idle period pays ~20s to load
 *     llama3.1:8b into memory. Warm, the same call is under a second. Beat 2 is
 *     an AI call forty seconds into the demo.
 *
 *  2. COLD CACHE. Ranking a panel judges every interviewer against the role,
 *     and booking a round ranks more than once. The AI service caches each
 *     judgement for 30 minutes, so warming the exact pairs the demo will ask
 *     about turns a ~14s ranking into an instant one.
 *
 * Run this immediately before presenting. It changes no data.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const AI_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const TOKEN = process.env.AI_SERVICE_TOKEN || '';

async function post(path, body) {
  const res = await fetch(AI_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-token': TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function main() {
  const started = Date.now();
  console.log(`Warming ${AI_URL} ...`);

  // Health first: a clear message beats a confusing timeout later.
  const health = await fetch(`${AI_URL}/health`).then((r) => r.json());
  if (!health.ai_available) {
    console.warn('  ! The AI provider reports unavailable. Every AI beat will show its');
    console.warn('    deterministic fallback. Check that Ollama is running.');
  }
  console.log(`  provider: ${health.ai_provider} (llm=${health.ai_is_llm})`);

  // Availability parsing - beat 2's opening move.
  const t0 = Date.now();
  await post('/parse/availability', { text: 'Tuesday and Wednesday mornings next week' });
  console.log(`  availability parsing warm in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Every (role, interviewer) pair the demo will actually rank. This is the
  // one that matters: it front-loads the whole ranking screen.
  const jobs = await prisma.job.findMany({ select: { title: true, requiredSkillsJson: true } });
  const interviewers = await prisma.interviewerProfile.findMany({
    include: { user: { select: { name: true } }, skills: { include: { skill: true } } },
  });

  let pairs = 0;
  for (const job of jobs) {
    let required = [];
    try {
      required = JSON.parse(job.requiredSkillsJson || '[]');
    } catch {
      continue;
    }
    if (!required.length) continue;

    const t = Date.now();
    await Promise.all(
      interviewers.map((iv) =>
        post('/match/skills', {
          required,
          offered: iv.skills.map((s) => ({
            name: s.skill.name,
            proficiency: s.proficiency,
            years: s.yearsExperience,
          })),
        }).catch((err) => console.warn(`    (${job.title} x ${iv.user.name}: ${err.message})`))
      )
    );
    pairs += interviewers.length;
    console.log(`  ${job.title}: ${interviewers.length} judgements in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  console.log(
    `\nWarm. ${pairs} skill judgements cached in ${((Date.now() - started) / 1000).toFixed(1)}s.\n` +
      'They stay cached for 30 minutes - present within that window.\n'
  );
}

main()
  .catch((err) => {
    console.error('Prewarm failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
