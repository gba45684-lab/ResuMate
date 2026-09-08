import { mkdir, access, copyFile } from 'node:fs/promises';

await mkdir('www', { recursive: true });
try {
  await access('www/index.html');
} catch {
  throw new Error('www/index.html is missing');
}
await copyFile('www/index.html', 'www/index.html');
console.log('Web bundle ready: www/index.html');
