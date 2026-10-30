#!/usr/bin/env node
'use strict';

// Validates a scar-tissue-report.json against report-schema.json plus the
// semantic rules the schema cannot express: known rule IDs, unique finding
// IDs, concrete failure scenarios, confidence-specific fields, and summary
// counts that match the findings. No dependencies.

const fs = require('node:fs');
const path = require('node:path');

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const CONFIDENCES = ['confirmed', 'likely', 'needs-validation'];
const FINDING_FIELDS = new Set([
  'id', 'rule', 'severity', 'confidence', 'title', 'location', 'also_at',
  'evidence', 'failure', 'fix', 'assumption', 'validation',
]);
const REPORT_FIELDS = new Set(['tool', 'schema_version', 'target', 'generated_at', 'findings', 'summary']);

// A failure scenario describes what happens, not what someone should consider.
const ADVICE_PATTERNS = [
  /\bbest practices?\b/i,
  /\bconsider (adding|using|implementing)\b/i,
  /\bit (is|would be) (good|better|recommended)\b/i,
  /\bcould potentially\b/i,
];

function loadCatalog(rulesPath) {
  const parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  return new Set(parsed.rules.map((r) => r.id));
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkLocation(loc, where, errors) {
  if (loc === null || typeof loc !== 'object' || Array.isArray(loc)) {
    errors.push(`${where}: must be an object with "file" and "line"`);
    return;
  }
  for (const field of Object.keys(loc)) {
    if (!['file', 'line', 'end_line'].includes(field)) errors.push(`${where}: unknown field "${field}"`);
  }
  if (!isNonEmptyString(loc.file)) errors.push(`${where}.file: required non-empty string`);
  if (!Number.isInteger(loc.line) || loc.line < 1) errors.push(`${where}.line: must be an integer >= 1`);
  if (loc.end_line !== undefined) {
    if (!Number.isInteger(loc.end_line) || loc.end_line < 1) {
      errors.push(`${where}.end_line: must be an integer >= 1`);
    } else if (Number.isInteger(loc.line) && loc.end_line < loc.line) {
      errors.push(`${where}.end_line: must be >= line`);
    }
  }
}

function validateFinding(f, i, catalog, seenIds, errors, warnings) {
  const where = `findings[${i}]`;
  if (f === null || typeof f !== 'object' || Array.isArray(f)) {
    errors.push(`${where}: must be an object`);
    return;
  }

  for (const field of Object.keys(f)) {
    if (!FINDING_FIELDS.has(field)) errors.push(`${where}: unknown field "${field}"`);
  }

  if (!isNonEmptyString(f.id) || !/^ST-[0-9]{3,}$/.test(f.id)) {
    errors.push(`${where}.id: must look like ST-001`);
  } else if (seenIds.has(f.id)) {
    errors.push(`${where}.id: duplicate id ${f.id}`);
  } else {
    seenIds.add(f.id);
  }

  if (!isNonEmptyString(f.rule)) {
    errors.push(`${where}.rule: required`);
  } else if (!catalog.has(f.rule)) {
    errors.push(`${where}.rule: unknown rule "${f.rule}" (see rules.json)`);
  }

  if (!SEVERITIES.includes(f.severity)) errors.push(`${where}.severity: must be one of ${SEVERITIES.join(', ')}`);
  if (!CONFIDENCES.includes(f.confidence)) errors.push(`${where}.confidence: must be one of ${CONFIDENCES.join(', ')}`);
  if (!isNonEmptyString(f.title)) errors.push(`${where}.title: required non-empty string`);
  if (!isNonEmptyString(f.evidence)) errors.push(`${where}.evidence: required code excerpt`);

  if (f.location === undefined) errors.push(`${where}.location: required`);
  else checkLocation(f.location, `${where}.location`, errors);

  if (f.also_at !== undefined) {
    if (!Array.isArray(f.also_at)) errors.push(`${where}.also_at: must be an array`);
    else f.also_at.forEach((loc, j) => checkLocation(loc, `${where}.also_at[${j}]`, errors));
  }

  const failure = f.failure;
  if (failure === null || typeof failure !== 'object' || Array.isArray(failure)) {
    errors.push(`${where}.failure: required object with trigger, what_breaks, who_notices`);
  } else {
    for (const field of Object.keys(failure)) {
      if (!['trigger', 'what_breaks', 'who_notices'].includes(field)) errors.push(`${where}.failure: unknown field "${field}"`);
    }
    const minLengths = { trigger: 10, what_breaks: 10, who_notices: 3 };
    for (const [field, min] of Object.entries(minLengths)) {
      const value = failure[field];
      if (!isNonEmptyString(value) || value.trim().length < min) {
        errors.push(`${where}.failure.${field}: required, at least ${min} characters`);
        continue;
      }
      const advice = ADVICE_PATTERNS.find((p) => p.test(value));
      if (advice && field !== 'who_notices') {
        errors.push(
          `${where}.failure.${field}: describes advice, not a failure (matched ${advice}). ` +
            'State what happens in production; put recommendations in "fix".'
        );
      }
    }
  }

  if (!isNonEmptyString(f.fix) || f.fix.trim().length < 10) errors.push(`${where}.fix: required, at least 10 characters`);

  if (f.confidence === 'likely' && !isNonEmptyString(f.assumption)) {
    errors.push(`${where}.assumption: required when confidence is "likely" (name what you could not see)`);
  }
  if (f.confidence === 'needs-validation' && !isNonEmptyString(f.validation)) {
    errors.push(`${where}.validation: required when confidence is "needs-validation" (say what to test or check)`);
  }
  if (f.confidence === 'confirmed' && isNonEmptyString(f.assumption)) {
    warnings.push(`${where}: confirmed finding lists an assumption; consider confidence "likely"`);
  }
}

function validateReport(report, catalog) {
  const errors = [];
  const warnings = [];

  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return { errors: ['report: must be a JSON object'], warnings };
  }

  for (const field of Object.keys(report)) {
    if (!REPORT_FIELDS.has(field)) errors.push(`report: unknown field "${field}"`);
  }
  if (report.tool !== 'scar-tissue') errors.push('tool: must be "scar-tissue"');
  if (report.schema_version !== 1) errors.push('schema_version: must be 1');
  if (!isNonEmptyString(report.target)) errors.push('target: required non-empty string');

  if (!Array.isArray(report.findings)) {
    errors.push('findings: must be an array');
    return { errors, warnings };
  }

  const seenIds = new Set();
  report.findings.forEach((f, i) => validateFinding(f, i, catalog, seenIds, errors, warnings));

  // Findings should be ordered most severe first.
  const ranks = report.findings.map((f) => SEVERITIES.indexOf(f && f.severity)).filter((r) => r >= 0);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] < ranks[i - 1]) {
      warnings.push('findings: not ordered by severity (most severe first)');
      break;
    }
  }

  if (report.summary !== undefined) {
    const s = report.summary;
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      errors.push('summary: must be an object');
    } else {
      for (const field of Object.keys(s)) {
        if (![...SEVERITIES, 'fix_first'].includes(field)) errors.push(`summary: unknown field "${field}"`);
      }
      for (const sev of SEVERITIES) {
        const actual = report.findings.filter((f) => f && f.severity === sev).length;
        if (s[sev] !== actual) errors.push(`summary.${sev}: is ${s[sev]}, but findings contain ${actual}`);
      }
      if (s.fix_first !== undefined && !seenIds.has(s.fix_first)) {
        errors.push(`summary.fix_first: "${s.fix_first}" does not match any finding id`);
      }
    }
  }

  return { errors, warnings };
}

function wrap(text, width, indent) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${' '.repeat(indent)}`);
}

function formatLocation(loc) {
  const file = path.basename(loc.file);
  return loc.end_line && loc.end_line !== loc.line ? `${file}:${loc.line}-${loc.end_line}` : `${file}:${loc.line}`;
}

// Renders a valid report as plain text for humans.
function renderText(report, { color = false, width = 88 } = {}) {
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const SEVERITY_COLOR = { critical: '1;31', high: '31', medium: '33', low: '36' };
  const out = [];

  for (const f of report.findings) {
    let head = `${paint(SEVERITY_COLOR[f.severity], `[${f.severity}]`)} ${paint('1', f.rule)}  ${formatLocation(f.location)}`;
    if (f.also_at && f.also_at.length > 0) head += `  (also ${f.also_at.map(formatLocation).join(', ')})`;
    out.push(`${paint('2', f.id)} ${head}`);
    out.push(wrap(f.title, width, 0));
    const fields = [
      ['Trigger', f.failure.trigger],
      ['What breaks', f.failure.what_breaks],
      ['Who notices', f.failure.who_notices],
      ['Fix', f.fix],
    ];
    if (f.assumption) fields.push(['Assumption', f.assumption]);
    if (f.validation) fields.push(['Validate', f.validation]);
    if (f.confidence !== 'confirmed') fields.push(['Confidence', f.confidence]);
    for (const [label, value] of fields) {
      const prefix = `  ${`${label}:`.padEnd(13)}`;
      out.push(`${paint('2', prefix)}${wrap(value, width - prefix.length, prefix.length)}`);
    }
    out.push('');
  }

  const s = report.summary;
  const counts = SEVERITIES.filter((sev) => s[sev] > 0).map((sev) => `${s[sev]} ${sev}`).join(', ');
  const total = report.findings.length;
  out.push(paint('1', `${total} finding${total === 1 ? '' : 's'}: ${counts || 'none'}.${s.fix_first ? ` Fix first: ${s.fix_first}.` : ''}`));
  return out.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node validate-findings.cjs <scar-tissue-report.json> [--rules <rules.json>] [--format text] [--color | --no-color]');
    console.log('  --format text   after validation, print the report in readable form');
    console.log('  --color         force color in text output (default: color only on a terminal)');
    console.log('  --no-color      disable color in text output');
    return args.length === 0 ? 2 : 0;
  }

  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const flagValues = new Set(['--rules', '--format'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
  const reportPath = args.find((a, i) => !a.startsWith('--') && !flagValues.has(i));
  const rulesPath = flagValue('--rules') || path.join(__dirname, 'rules.json');
  const format = flagValue('--format') || 'check';
  if (!reportPath || !['check', 'text'].includes(format)) {
    console.error('Usage: node validate-findings.cjs <scar-tissue-report.json> [--rules <rules.json>] [--format text] [--color | --no-color]');
    return 2;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${reportPath}: ${err.message}`);
    return 2;
  }

  const { errors, warnings } = validateReport(report, loadCatalog(rulesPath));
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\n${errors.length} error(s). Fix them before presenting the report.`);
    return 1;
  }

  const count = Array.isArray(report.findings) ? report.findings.length : 0;
  if (format === 'text') {
    const color = !args.includes('--no-color') && (args.includes('--color') || Boolean(process.stdout.isTTY));
    console.log(renderText(report, { color }));
    return 0;
  }
  console.log(`OK: ${count} finding(s) valid.`);
  return 0;
}

module.exports = { validateReport, loadCatalog, renderText };

if (require.main === module) {
  process.exitCode = main(process.argv);
}
