'use strict';

// Generates RULES.md from skills/scar-tissue/rules.json.
// Usage: node scripts/generate-rules-index.cjs

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = 'skills/scar-tissue';
const OUT = path.join(ROOT, 'RULES.md');

function areaName(file) {
  const words = file.replace(/\.md$/, '').toLowerCase().split('-');
  if (words[0] === 'security') {
    return `Security: ${words.slice(1).join(' ')}`;
  }
  const name = words.join(' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// GitHub heading anchors drop dots and keep hyphens.
function anchor(id) {
  return id.toLowerCase().replace(/[^a-z0-9 -]/g, '');
}

function render(rules) {
  const byFile = new Map();
  for (const rule of rules) {
    if (!byFile.has(rule.file)) byFile.set(rule.file, []);
    byFile.get(rule.file).push(rule);
  }

  const lines = [
    '# Rules',
    '',
    '<!-- Generated from skills/scar-tissue/rules.json by scripts/generate-rules-index.cjs. Do not edit by hand. -->',
    '',
    `scar-tissue has ${rules.length} rules in ${byFile.size} areas. Each links to its full description: what to look for, when it is not a finding, the failure, the fix, how to verify it, and severity.`,
    '',
  ];

  for (const [file, fileRules] of byFile) {
    lines.push(`## ${areaName(file)}`, '');
    lines.push('| Rule | Severity | What it catches |', '| --- | --- | --- |');
    for (const rule of fileRules) {
      const link = `${SKILL_DIR}/${file}#${anchor(rule.id)}`;
      lines.push(`| [\`${rule.id}\`](${link}) | ${rule.typical_severity} | ${rule.title} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function loadRules() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, SKILL_DIR, 'rules.json'), 'utf8')).rules;
}

if (require.main === module) {
  fs.writeFileSync(OUT, render(loadRules()));
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
}

module.exports = { render, loadRules, OUT };
