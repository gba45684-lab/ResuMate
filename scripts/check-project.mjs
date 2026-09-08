import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'www/index.html',
  'www/resumate-ota-loader.js',
  'ota/resumate-runtime.js',
  'ota/version.json'
];

for (const file of requiredFiles) await access(file);

const html = await readFile('www/index.html', 'utf8');
const loader = await readFile('www/resumate-ota-loader.js', 'utf8');
const runtime = await readFile('ota/resumate-runtime.js', 'utf8');
const manifest = JSON.parse(await readFile('ota/version.json', 'utf8'));

if (!/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) throw new Error('Invalid HTML shell');
if (!html.includes('ResuMate')) throw new Error('ResuMate app marker missing');
if (!loader.includes('resumate:ota-status')) throw new Error('OTA status event missing');
if (!loader.includes('resumate-ota-update-toggle')) throw new Error('OTA update control missing');
if (!loader.includes('navigator.vibrate')) throw new Error('OTA haptic feedback missing');
if (!loader.includes('new Notification')) throw new Error('OTA notification support missing');
if (!loader.includes("cache: 'no-store'")) throw new Error('OTA cache-bypass missing');
if (!/resumate-ota-loader\\.js/.test(loader)) throw new Error('OTA loader replacement guard missing');
if (!loader.includes("DB_NAME = 'resumate-ota'")) throw new Error('OTA persistence database missing');
if (!loader.includes("dbGet('active')")) throw new Error('OTA restore path missing');
if (!loader.includes("dbPut('active'")) throw new Error('OTA persistence write missing');
if (!loader.includes('if (restoring) return;')) throw new Error('OTA startup restore gate missing');
if (!loader.includes('setInterval(function () { check(false); }, POLL_MS)')) throw new Error('OTA polling missing');
if (!runtime.includes('local-first')) throw new Error('Free-first AI runtime missing');
if (!runtime.includes('function analyze')) throw new Error('ATS analysis missing');
if (!runtime.includes('function matchJob')) throw new Error('Job matching missing');
if (!runtime.includes('function tailor')) throw new Error('Tailoring runtime missing');
if (!runtime.includes('function interview')) throw new Error('Interview coach runtime missing');
if (typeof manifest !== 'object' || manifest === null) throw new Error('Invalid OTA manifest');
if (manifest.enabled !== true) throw new Error('OTA manifest is not enabled');
if (!manifest.build || !manifest.version || !manifest.channel) throw new Error('OTA manifest fields missing');

console.log(`ResuMate project check passed (${html.length} HTML chars; OTA + AI checks passed).`);
