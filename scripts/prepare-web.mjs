import { access, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const entry = 'www/index.html';
const loader = 'www/resumate-ota-loader.js';

try {
  await access(entry);
  await access(loader);
} catch {
  throw new Error('www/index.html or www/resumate-ota-loader.js is missing');
}

let html = await readFile(entry, 'utf8');
const marker = 'resumate-ota-loader.js';

// Stamp the exact source revision into the bundled web shell. GitHub Actions
// exposes GITHUB_SHA for the commit that triggered the build; local builds use
// the checked-out HEAD when available. The OTA loader uses this marker to
// distinguish the APK's bundled revision from a newer remote revision.
let buildId = process.env.GITHUB_SHA || '';
if (!buildId) {
  try { buildId = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) {}
}
if (!buildId) buildId = 'local';
const buildMarker = `<script>window.__RESUMATE_BUNDLED_BUILD__=${JSON.stringify(buildId)};</script>`;
html = html.replace(/<script[^>]*>\s*window\.__RESUMATE_BUNDLED_BUILD__\s*=.*?<\/script>/gis, '');
if (html.includes('</head>')) html = html.replace('</head>', `${buildMarker}\n</head>`);
else html = `${buildMarker}\n${html}`;

if (!html.includes(marker)) {
  const tag = '<script src="./resumate-ota-loader.js" defer></script>';
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${tag}\n</body>`);
  } else {
    html += `\n${tag}\n`;
  }
  console.log('Injected stable ResuMate OTA loader.');
} else {
  console.log('ResuMate OTA loader already present.');
}

await writeFile(entry, html, 'utf8');
console.log(`Web bundle ready: ${entry} (bundled build ${buildId})`);
