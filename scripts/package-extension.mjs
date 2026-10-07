import { copyFile, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = new URL('../extensions/payment-desk-companion/', import.meta.url);
const destination = new URL('../extension-dist/payment-desk-companion/', import.meta.url);
const archive = new URL('../extension-dist/payment-desk-companion.zip', import.meta.url);
const files = ['manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'captureListing.js', 'vehicleHandoff.js', 'README.md', ...[16, 32, 48, 128].map(size => `icons/icon-${size}.png`)];
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3.');
// Build the exact same worksheet as the website, with local scripts and fonts.
// No remote iframe, duplicated calculations, or broad site permissions.
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
await rm(destination, { recursive: true, force: true });
await mkdir(new URL('icons/', destination), { recursive: true });
for (const file of files) await copyFile(new URL(file, source), new URL(file, destination));
await mkdir(new URL('desk/', destination));
for (const entry of await readdir(new URL('../dist/', import.meta.url))) {
  if (entry.startsWith('_')) continue; // Hosting headers/redirects have no role in Chrome.
  await cp(new URL(`../dist/${entry}`, import.meta.url), new URL(`desk/${entry}`, destination), { recursive: true });
}
await rm(archive, { force: true });
execFileSync('zip', ['-X', '-q', '-r', fileURLToPath(archive), ...files, 'desk'], { cwd: fileURLToPath(destination) });
console.log(`Packaged ${manifest.name} v${manifest.version}: ${fileURLToPath(archive)}`);
