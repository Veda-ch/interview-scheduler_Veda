/**
 * Skill taxonomy.
 *
 * Skills are normalised on write (lowercased key, canonical display name,
 * alias table) so "Spring boot", "SpringBoot" and "Spring Boot" resolve to one
 * row. This matters because the whole matching layer keys off skill identity.
 */
import prisma from '../lib/prisma.js';
import { csvToArray } from '../lib/json.js';

/** Canonical display casing for common tech terms; anything else is title-cased. */
const CANONICAL = new Map(
  Object.entries({
    java: 'Java',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    sql: 'SQL',
    nosql: 'NoSQL',
    'spring boot': 'Spring Boot',
    springboot: 'Spring Boot',
    spring: 'Spring',
    'rest apis': 'REST APIs',
    'rest api': 'REST APIs',
    rest: 'REST APIs',
    aws: 'AWS',
    gcp: 'GCP',
    azure: 'Azure',
    docker: 'Docker',
    kubernetes: 'Kubernetes',
    k8s: 'Kubernetes',
    react: 'React',
    'react.js': 'React',
    reactjs: 'React',
    'node.js': 'Node.js',
    nodejs: 'Node.js',
    node: 'Node.js',
    postgresql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    mongodb: 'MongoDB',
    redis: 'Redis',
    kafka: 'Kafka',
    graphql: 'GraphQL',
    'system design': 'System Design',
    microservices: 'Microservices',
    'data structures': 'Data Structures',
    algorithms: 'Algorithms',
    'sql optimization': 'SQL Optimization',
    'database indexing': 'Database Indexing',
    'database optimization': 'Database Optimization',
    'ci/cd': 'CI/CD',
    cicd: 'CI/CD',
    terraform: 'Terraform',
    linux: 'Linux',
    git: 'Git',
    hibernate: 'Hibernate',
    jpa: 'JPA',
    'unit testing': 'Unit Testing',
    'machine learning': 'Machine Learning',
    ml: 'Machine Learning',
    'communication': 'Communication',
    leadership: 'Leadership',
    mentoring: 'Mentoring',
    ownership: 'Ownership',
  })
);

const SOFT_SKILLS = new Set(['communication', 'leadership', 'mentoring', 'ownership', 'collaboration', 'problem solving']);

export const normaliseSkillKey = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '');

export function canonicalName(name) {
  const key = normaliseSkillKey(name);
  if (CANONICAL.has(key)) return CANONICAL.get(key);
  return key
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

const categoryFor = (key) => (SOFT_SKILLS.has(key) ? 'SOFT' : 'TECHNICAL');

/**
 * Resolve a list of raw skill names to Skill rows, creating missing ones.
 * @param {object} client prisma client or transaction client
 * @returns {Promise<Map<string, {id: string, name: string}>>} keyed by normalised name
 */
export async function upsertSkillsByName(client, names) {
  const db = client || prisma;
  const keys = [...new Set((names || []).map(normaliseSkillKey).filter(Boolean))];
  const result = new Map();
  if (!keys.length) return result;

  const canonicals = keys.map(canonicalName);
  const existing = await db.skill.findMany({ where: { name: { in: canonicals } } });
  const byName = new Map(existing.map((s) => [normaliseSkillKey(s.name), s]));

  for (const key of keys) {
    const display = canonicalName(key);
    let row = byName.get(normaliseSkillKey(display));
    if (!row) {
      // Alias lookup before creating: "k8s" should find "Kubernetes".
      const aliasMatch = await db.skill.findFirst({ where: { aliasesCsv: { contains: key } } });
      row =
        aliasMatch ||
        (await db.skill.upsert({
          where: { name: display },
          update: {},
          create: { name: display, category: categoryFor(key), aliasesCsv: key === normaliseSkillKey(display) ? '' : key },
        }));
      byName.set(normaliseSkillKey(row.name), row);
    }
    result.set(key, row);
  }
  return result;
}

export async function listSkills({ search, take = 200 } = {}) {
  return prisma.skill.findMany({
    where: search ? { name: { contains: search } } : undefined,
    orderBy: { name: 'asc' },
    take: Math.min(take, 500),
  });
}

/** Skill rows with usage counts - powers the admin skills screen. */
export async function skillsWithUsage() {
  const skills = await prisma.skill.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { candidateSkills: true, interviewerSkills: true } } },
  });
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    aliases: csvToArray(s.aliasesCsv),
    candidateCount: s._count.candidateSkills,
    interviewerCount: s._count.interviewerSkills,
  }));
}
