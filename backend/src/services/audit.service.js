/**
 * Audit trail. Every meaningful state change writes exactly one row here, which
 * is what powers the interview timeline in the UI and the transparency story
 * ("show me what the system did and why").
 *
 * Auditing must never break the operation it is describing, so failures are
 * logged and swallowed.
 */
import prisma from '../lib/prisma.js';
import logger from '../lib/logger.js';
import { stringifyJson, parseObject } from '../lib/json.js';

/**
 * @param {object} p
 * @param {string} [p.actorUserId] null for system/monitor actions
 * @param {string} [p.actorRole]
 * @param {string} p.action  one of AUDIT_ACTIONS
 * @param {string} p.entity  e.g. "Interview"
 * @param {string} [p.entityId]
 * @param {string} [p.summary] human sentence shown in the timeline UI
 * @param {object} [p.metadata]
 * @param {string} [p.ip]
 */
export async function recordAudit({
  actorUserId = null,
  actorRole = 'SYSTEM',
  action,
  entity,
  entityId = null,
  summary = '',
  metadata = {},
  ip = null,
}) {
  try {
    return await prisma.auditLog.create({
      data: {
        actorUserId,
        actorRole,
        action,
        entity,
        entityId,
        summary,
        metadataJson: stringifyJson(metadata),
        ip,
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', { action, entity, error: err.message });
    return null;
  }
}

/** Convenience wrapper for request handlers - pulls actor + ip off req. */
export const auditFromRequest = (req, payload) =>
  recordAudit({
    actorUserId: req.user?.id ?? null,
    actorRole: req.user?.role ?? 'ANONYMOUS',
    ip: req.ip,
    ...payload,
  });

export async function listAuditLogs({ entity, entityId, actorUserId, action, take = 100, skip = 0 } = {}) {
  const where = {};
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (actorUserId) where.actorUserId = actorUserId;
  if (action) where.action = action;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 500),
      skip,
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      summary: r.summary,
      metadata: parseObject(r.metadataJson),
      actor: r.actor ? { id: r.actor.id, name: r.actor.name, role: r.actor.role } : { name: 'System', role: r.actorRole },
      createdAt: r.createdAt,
    })),
  };
}

/** Timeline for one interview: its own rows plus rows for its request and incidents. */
export async function interviewTimeline(interviewId) {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    select: { id: true, requestId: true, incidents: { select: { id: true } } },
  });
  if (!interview) return [];

  const ids = [interview.id, interview.requestId, ...interview.incidents.map((i) => i.id)];
  const rows = await prisma.auditLog.findMany({
    where: { entityId: { in: ids } },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, role: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    action: r.action,
    entity: r.entity,
    summary: r.summary,
    metadata: parseObject(r.metadataJson),
    actor: r.actor?.name || 'System',
  }));
}
