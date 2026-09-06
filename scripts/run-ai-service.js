#!/usr/bin/env node
/**
 * Cross-platform launcher for the Python AI service.
 * Prefers ai-service/.venv, falls back to the system interpreter, and prints an
 * actionable message instead of a stack trace when neither can run it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiDir = path.join(root, 'ai-service');

const venvPython =
  process.platform === 'win32'
    ? path.join(aiDir, '.venv', 'Scripts', 'python.exe')
    : path.join(aiDir, '.venv', 'bin', 'python');

const python = fs.existsSync(venvPython)
  ? venvPython
  : process.platform === 'win32'
    ? 'py'
    : 'python3';

const args = python === 'py' ? ['-3.12'] : [];
args.push('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', process.env.AI_SERVICE_PORT || '8000');
if (process.env.NODE_ENV !== 'production') args.push('--reload');

if (!fs.existsSync(venvPython)) {
  console.warn(
    '[ai-service] No virtualenv found at ai-service/.venv - falling back to the system Python.\n' +
      '            Create it with:  cd ai-service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt'
  );
}

const child = spawn(python, args, { cwd: aiDir, stdio: 'inherit', shell: false });

child.on('error', (err) => {
  console.error(`[ai-service] Could not start Python (${python}): ${err.message}`);
  console.error('[ai-service] The platform still runs without it - scheduling falls back to the JS engine.');
  process.exit(0); // do not take down `npm run dev`
});
child.on('exit', (code) => process.exit(code ?? 0));
