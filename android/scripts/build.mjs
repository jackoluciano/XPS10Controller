import { rm, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

// In this curated repo layout, UI + engine live in the project root.
// This script is executed from the "android/" folder.
const projectRoot = path.resolve(root, '..');
const uiDir = path.join(projectRoot, 'ui');
const engineDir = path.join(projectRoot, 'engine');
const wwwDir = path.join(root, 'www');

async function main() {
  if (!existsSync(uiDir)) {
    throw new Error(`Missing ui/ directory at ${uiDir}`);
  }
  if (!existsSync(engineDir)) {
    throw new Error(`Missing engine/ directory at ${engineDir}`);
  }

  await rm(wwwDir, { recursive: true, force: true });
  await mkdir(wwwDir, { recursive: true });

  // Copy UI files to web root so index.html can load style.css/app.js unchanged.
  await cp(uiDir, wwwDir, { recursive: true });

  // Copy engine assets under www/engine
  await mkdir(path.join(wwwDir, 'engine'), { recursive: true });
  await cp(engineDir, path.join(wwwDir, 'engine'), { recursive: true });

  console.log('Built www/ from ui/ + engine/');
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
