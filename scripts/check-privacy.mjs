import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Report locations and categories, never matching secret or personal values.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const people = [...new Set(execFileSync('git', ['log', '--format=%an'], { encoding: 'utf8' }).split('\n'))]
  .filter(name => /^[\p{L}][\p{L} .'-]+ [\p{L}][\p{L} .'-]+$/u.test(name) && !/bot|contributors|github|openai/i.test(name));
const rules = [
  ['private-key literal', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider credential literal', /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk_[A-Za-z0-9]{24,})\b/],
  ['JWT literal', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['legacy session literal', /(?:SCDID_S|PHPSESSID|MRHSession)[=:'" ]{1,8}(?!SYNTHETIC)[A-Za-z0-9_$#-]{24,}/],
];
let findings = 0;
for (const file of [...new Set(files)]) {
  if (/\.(png|jpg|jpeg|ico|woff2?|gif|pdf|zip)$/.test(file) || /(?:^|\/)(?:package-lock\.json|yarn\.lock)$/.test(file)) continue;
  let source;
  try { source = readFileSync(file, 'utf8'); } catch { continue; }
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const [category, pattern] of rules) if (pattern.test(line)) { console.error(`${file}:${index + 1}: ${category}`); findings++; }
    if (people.some(name => line.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) { console.error(`${file}:${index + 1}: personal author name outside Git metadata`); findings++; }
    for (const match of line.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
      if (!/^(?:example\.(?:com|edu|org|net)|[^.]+\.example)$/i.test(match[1])) { console.error(`${file}:${index + 1}: non-example email address`); findings++; }
    }
  }
}
if (findings) process.exitCode = 1;
else console.log(`Privacy pattern check passed for ${files.length} current files. Manual review is still required for unknown names and contextual identifiers.`);
