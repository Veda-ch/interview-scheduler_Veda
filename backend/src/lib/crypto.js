/**
 * Symmetric encryption for OAuth tokens at rest.
 *
 * Key is derived from JWT_ACCESS_SECRET (already a required, environment-only
 * secret) via scrypt, so there is no extra key to manage for the demo while the
 * ciphertext is still AES-256-GCM with a per-record IV and auth tag.
 * A dedicated ENCRYPTION_KEY env var takes precedence when present.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';

const KEY = crypto.scryptSync(
  process.env.ENCRYPTION_KEY || config.jwt.accessSecret,
  'interview-scheduler-token-encryption',
  32
);

export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, iv, tag, data] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered ciphertext - treat as "no token", never throw.
    return null;
  }
}
