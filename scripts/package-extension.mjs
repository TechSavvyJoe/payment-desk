import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const source = new URL('../extensions/payment-desk-companion/', import.meta.url);
const destination = new URL('../extension-dist/payment-desk-companion/', import.meta.url);
const archive = new URL('../extension-dist/payment-desk-companion.zip', import.meta.url);
const files = ['manifest.json', 'background.js', 'sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'worksheetLoader.js', 'worksheet.css', 'captureListing.js', 'vehicleHandoff.js', 'inventoryModel.js', 'inventoryParser.js', 'inventoryBackground.js', 'inventoryPanel.js', 'inventoryWeb.js', 'inventory-offscreen.html', 'inventory-offscreen.js', 'README.md', 'INVENTORY.md', ...[16, 32, 48, 128].map(size => `icons/icon-${size}.png`)];
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3.');
// Build the exact same worksheet as the website, with local scripts and fonts.
// No remote iframe or duplicated calculations; website grants are optional.
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit' });
await rm(destination, { recursive: true, force: true });
await mkdir(new URL('icons/', destination), { recursive: true });
for (const file of files) await copyFile(new URL(file === 'INVENTORY.md' ? '../../docs/COMPANION-INVENTORY.md' : file, source), new URL(file, destination));
// Avoid serial module fetches during cold panel/worker startup. Each entry has
// one local script; keep captured listing functions intact when serialized by
// chrome.scripting.executeScript (no minifier or external helper imports).
for (const name of ['sidepanel', 'background', 'inventory-offscreen']) {
  await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
    outDir: fileURLToPath(destination), emptyOutDir: false, minify: false,
    target: 'chrome116', reportCompressedSize: false,
    lib: { entry: fileURLToPath(new URL(`${name}.js`, source)), formats: ['es'], fileName: () => `${name}.js` },
  } });
}
const readme = await readFile(new URL('README.md', destination), 'utf8');
await writeFile(new URL('README.md', destination), readme.replace('../../docs/COMPANION-INVENTORY.md', 'INVENTORY.md'));
await mkdir(new URL('desk/', destination));
for (const entry of await readdir(new URL('../dist/', import.meta.url))) {
  if (entry.startsWith('_')) continue; // Hosting headers/redirects have no role in Chrome.
  await cp(new URL(`../dist/${entry}`, import.meta.url), new URL(`desk/${entry}`, destination), { recursive: true });
}
const worksheetIndex = new URL('desk/index.html', destination);
const worksheetHtml = await readFile(worksheetIndex, 'utf8');
await writeFile(worksheetIndex, worksheetHtml.replace('</head>', '  <link rel="stylesheet" href="../worksheet.css">\n  </head>'));
// Chrome refuses unpacked packages containing reserved underscore names. Fail
// packaging here rather than leaving an archive that cannot be reloaded.
async function checkPackage(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) throw new Error(`Chrome-reserved package name: ${entry.name}`);
    if (entry.isDirectory()) await checkPackage(new URL(`${entry.name}/`, directory));
  }
}
await checkPackage(destination);
await rm(archive, { force: true });
execFileSync('zip', ['-X', '-q', '-r', fileURLToPath(archive), ...files, 'desk'], { cwd: fileURLToPath(destination) });
console.log(`Packaged ${manifest.name} v${manifest.version}: ${fileURLToPath(archive)}`);
