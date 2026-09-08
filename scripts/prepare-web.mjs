import { access, readFile, writeFile } from 'node:fs/promises';

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

if (!html.includes(marker)) {
  const tag = '<script src="./resumate-ota-loader.js" defer></script>';
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${tag}\n</body>`);
  } else {
    html += `\n${tag}\n`;
  }
  await writeFile(entry, html, 'utf8');
  console.log('Injected stable ResuMate OTA loader.');
} else {
  console.log('ResuMate OTA loader already present.');
}

console.log(`Web bundle ready: ${entry}`);
