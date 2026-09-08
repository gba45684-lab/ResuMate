import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
pkg.devDependencies = pkg.devDependencies || {};
if (!pkg.devDependencies.typescript) pkg.devDependencies.typescript = '^5.9.3';
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
console.log('TypeScript dependency and lockfile synchronized.');
