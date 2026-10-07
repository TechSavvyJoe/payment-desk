import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = new URL('../extensions/payment-desk-companion/', import.meta.url);
const destination = new URL('../extension-dist/payment-desk-companion/', import.meta.url);
const archive = new URL('../extension-dist/payment-desk-companion.zip', import.meta.url);
const files = ['manifest.json', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'captureListing.js', 'vehicleHandoff.js', 'README.md', ...[16, 32, 48, 128].map(size => `icons/icon-${size}.png`)];
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3.');
await mkdir(new URL('icons/', destination), { recursive: true });
for (const file of files) await copyFile(new URL(file, source), new URL(file, destination));
await rm(archive, { force: true });
execFileSync('zip', ['-X', '-q', fileURLToPath(archive), ...files], { cwd: fileURLToPath(destination) });
console.log(`Packaged ${manifest.name} v${manifest.version}: ${fileURLToPath(archive)}`);
