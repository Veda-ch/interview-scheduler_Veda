/**
 * Safe resume upload.
 *
 * Threat model handled here:
 *   - path traversal      -> filename is regenerated, never taken from the client
 *   - executable upload   -> extension + MIME allowlist, and the static handler
 *                            serves everything as an attachment with nosniff
 *   - storage exhaustion  -> hard byte limit from config
 *   - content-type lies   -> extension AND declared MIME must both be allowed
 */
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import config from '../config/env.js';
import { badRequest } from '../lib/errors.js';

fs.mkdirSync(config.upload.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.upload.dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Filename is fully synthesised: <userId>-<random><ext>
    const safeUser = String(req.user?.id || 'anon').replace(/[^a-zA-Z0-9_-]/g, '');
    cb(null, `${safeUser}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.upload.allowedExtensions.includes(ext)) {
    return cb(badRequest(`Unsupported file type "${ext}". Allowed: ${config.upload.allowedExtensions.join(', ')}`));
  }
  if (file.mimetype && !config.upload.allowedMime.includes(file.mimetype)) {
    return cb(badRequest(`Unsupported content type "${file.mimetype}"`));
  }
  return cb(null, true);
}

export const resumeUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxBytes, files: 1 },
}).single('resume');

/** Wrap multer so its errors become our standard error envelope. */
export const uploadResume = (req, res, next) =>
  resumeUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(badRequest(`File too large. Maximum ${Math.round(config.upload.maxBytes / 1024)} KB.`));
    }
    return next(err.status ? err : badRequest(err.message));
  });

/**
 * Best-effort plain-text extraction.
 *
 * .txt/.md are read directly. For PDFs we pull readable literal strings out of
 * the content streams, which works for text-based PDFs and not for scanned or
 * fully-compressed ones - so the UI always offers a "paste your resume text"
 * box as the reliable path. We do not ship a heavyweight PDF parser for a
 * feature the user can satisfy with a paste.
 */
export function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.txt' || ext === '.md') {
      return fs.readFileSync(filePath, 'utf8').slice(0, 20000);
    }
    if (ext === '.pdf') {
      const raw = fs.readFileSync(filePath, 'latin1');
      const chunks = [...raw.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map((m) => m[1]);
      const text = chunks
        .join(' ')
        .replace(/\\[()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return text.length > 80 ? text.slice(0, 20000) : '';
    }
  } catch {
    return '';
  }
  return '';
}
