import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const app = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const seen = new Set(), entries = [];
async function packageDirectory(name, from) {
  let location = resolve(from);
  while (true) {
    const candidate = join(location, 'node_modules', name);
    try { await readFile(join(candidate, 'package.json')); return candidate; } catch { /* Try the next ancestor. */ }
    const parent = dirname(location);
    if (parent === location) throw new Error(`Cannot resolve runtime dependency: ${name}`);
    location = parent;
  }
}
async function collect(name, from) {
  const directory = await packageDirectory(name, from);
  if (seen.has(directory)) return;
  seen.add(directory);
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const names = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|copyrightnotice|notice|ofl)(?:\.|$)/i.test(file)).sort();
  if (!names.length) throw new Error(`Missing license text for ${pkg.name}@${pkg.version}`);
  const texts = await Promise.all(names.map(async file => `${file}\n${(await readFile(join(directory, file), 'utf8')).replace(/\r\n?/g, '\n')}`));
  entries.push({ name: pkg.name, version: pkg.version, text: texts.join('\n\n') });
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) await collect(dependency, directory);
}
for (const name of Object.keys(app.dependencies).sort()) await collect(name, root);
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const notice = ['Payment Desk third-party notices', 'Runtime dependency inventory including transitive packages. This does not grant a license to Payment Desk itself.',
  ...entries.map(entry => `\n${entry.name}@${entry.version}\n${'='.repeat(72)}\n${entry.text}`)].join('\n\n');
await writeFile(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), notice + '\n');
console.log(`Prepared notices for ${entries.length} runtime packages.`);
