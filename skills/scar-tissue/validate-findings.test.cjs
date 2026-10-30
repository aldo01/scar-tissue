'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateReport, loadCatalog, renderText } = require('./validate-findings.cjs');

const SKILL_DIR = __dirname;
const RULES_PATH = path.join(SKILL_DIR, 'rules.json');
const catalog = loadCatalog(RULES_PATH);

function finding(overrides = {}) {
  return {
    id: 'ST-001',
    rule: 'idempotency.missing-key',
    severity: 'critical',
    confidence: 'confirmed',
    title: 'Charge endpoint has no idempotency key',
    location: { file: 'app/payments.py', line: 42 },
    evidence: 'stripe.Charge.create(amount=amount, customer=cid)',
    failure: {
      trigger: 'Client times out after 10s and retries the request',
      what_breaks: 'charge() runs twice and the card is billed twice',
      who_notices: 'The customer, on their card statement',
    },
    fix: 'Require an Idempotency-Key header and claim it under a unique constraint before charging.',
    ...overrides,
  };
}

function report(findings, extra = {}) {
  return { tool: 'scar-tissue', schema_version: 1, target: 'app/', findings, ...extra };
}

function errorsFor(r) {
  return validateReport(r, catalog).errors;
}

test('a well-formed report has no errors', () => {
  const r = report([finding()], { summary: { critical: 1, high: 0, medium: 0, low: 0, fix_first: 'ST-001' } });
  assert.deepEqual(errorsFor(r), []);
});

test('an empty findings list is valid', () => {
  assert.deepEqual(errorsFor(report([])), []);
});

test('rejects wrong tool name and schema version', () => {
  const errors = errorsFor({ tool: 'other', schema_version: 2, target: 'x', findings: [] });
  assert.ok(errors.some((e) => e.startsWith('tool:')));
  assert.ok(errors.some((e) => e.startsWith('schema_version:')));
});

test('rejects rule IDs that are not in the catalog', () => {
  const errors = errorsFor(report([finding({ rule: 'made.up-rule' })]));
  assert.ok(errors.some((e) => e.includes('unknown rule "made.up-rule"')));
});

test('rejects duplicate finding IDs', () => {
  const errors = errorsFor(report([finding(), finding({ rule: 'timeouts.missing', severity: 'high' })]));
  assert.ok(errors.some((e) => e.includes('duplicate id ST-001')));
});

test('rejects malformed finding IDs', () => {
  const errors = errorsFor(report([finding({ id: 'F1' })]));
  assert.ok(errors.some((e) => e.includes('must look like ST-001')));
});

test('rejects invalid severity and confidence', () => {
  const errors = errorsFor(report([finding({ severity: 'urgent', confidence: 'maybe' })]));
  assert.ok(errors.some((e) => e.includes('.severity')));
  assert.ok(errors.some((e) => e.includes('.confidence')));
});

test('requires an assumption when confidence is likely', () => {
  const errors = errorsFor(report([finding({ confidence: 'likely' })]));
  assert.ok(errors.some((e) => e.includes('.assumption')));
  assert.deepEqual(
    errorsFor(report([finding({ confidence: 'likely', assumption: 'Gateway timeout is shorter than 30s' })])),
    []
  );
});

test('requires a validation step when confidence is needs-validation', () => {
  const errors = errorsFor(report([finding({ confidence: 'needs-validation' })]));
  assert.ok(errors.some((e) => e.includes('.validation')));
});

test('rejects advice disguised as a failure scenario', () => {
  const advice = finding({
    failure: {
      trigger: 'Consider adding a timeout to this call',
      what_breaks: 'It is good practice and would be better for reliability',
      who_notices: 'Engineers',
    },
  });
  const errors = errorsFor(report([advice]));
  assert.ok(errors.some((e) => e.includes('failure.trigger') && e.includes('describes advice')));
});

test('does not flag a concrete failure that mentions what should have happened', () => {
  const concrete = finding({
    failure: {
      trigger: 'The publish to Kafka fails after the order commit',
      what_breaks: 'The order should have triggered fulfilment, but no event is ever sent',
      who_notices: 'The customer, whose order never ships',
    },
  });
  assert.deepEqual(errorsFor(report([concrete])), []);
});

test('rejects failure scenarios that are too short to be concrete', () => {
  const errors = errorsFor(report([finding({ failure: { trigger: 'retry', what_breaks: 'bad', who_notices: 'x' } })]));
  assert.ok(errors.some((e) => e.includes('failure.trigger')));
  assert.ok(errors.some((e) => e.includes('failure.what_breaks')));
});

test('rejects invalid locations', () => {
  const bad = finding({ location: { file: '', line: 0 }, also_at: [{ file: 'a.py', line: 10, end_line: 5 }] });
  const errors = errorsFor(report([bad]));
  assert.ok(errors.some((e) => e.includes('location.file')));
  assert.ok(errors.some((e) => e.includes('location.line')));
  assert.ok(errors.some((e) => e.includes('also_at[0].end_line')));
});

test('rejects unknown fields', () => {
  const errors = errorsFor(report([finding({ priority: 'P0' })], { extra: true }));
  assert.ok(errors.some((e) => e.includes('unknown field "priority"')));
  assert.ok(errors.some((e) => e.includes('unknown field "extra"')));
});

test('summary counts must match the findings', () => {
  const r = report([finding()], { summary: { critical: 0, high: 1, medium: 0, low: 0 } });
  const errors = errorsFor(r);
  assert.ok(errors.some((e) => e.startsWith('summary.critical')));
  assert.ok(errors.some((e) => e.startsWith('summary.high')));
});

test('summary.fix_first must reference an existing finding', () => {
  const r = report([finding()], { summary: { critical: 1, high: 0, medium: 0, low: 0, fix_first: 'ST-999' } });
  assert.ok(errorsFor(r).some((e) => e.startsWith('summary.fix_first')));
});

test('warns when findings are not ordered by severity', () => {
  const r = report([
    finding({ id: 'ST-001', rule: 'database.n-plus-one', severity: 'medium' }),
    finding({ id: 'ST-002' }),
  ]);
  const { errors, warnings } = validateReport(r, catalog);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('ordered by severity')));
});

// --- Catalog and docs stay in sync -------------------------------------

function ruleHeadings() {
  const ids = new Map();
  for (const file of fs.readdirSync(SKILL_DIR).filter((f) => f.endsWith('.md') && f !== 'SKILL.md')) {
    const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
    for (const match of text.matchAll(/^## ([a-z]+\.[a-z0-9-]+)\s*$/gm)) ids.set(match[1], file);
  }
  return ids;
}

test('every rule heading in the reference files is in rules.json, and vice versa', () => {
  const headings = ruleHeadings();
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')).rules;
  const catalogIds = new Set(rules.map((r) => r.id));

  const missingFromCatalog = [...headings.keys()].filter((id) => !catalogIds.has(id));
  const missingFromDocs = [...catalogIds].filter((id) => !headings.has(id));
  assert.deepEqual(missingFromCatalog, [], 'documented rules missing from rules.json');
  assert.deepEqual(missingFromDocs, [], 'rules.json entries with no documentation');

  for (const rule of rules) {
    assert.equal(headings.get(rule.id), rule.file, `${rule.id} should be documented in ${rule.file}`);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(rule.typical_severity), `${rule.id} typical_severity`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'rules.json has duplicate IDs');
});

const REQUIRED_SECTIONS = ['Look for', 'Not a finding when', 'Failure', 'Fix', 'Verify', 'Severity'];

function referenceFiles() {
  return fs.readdirSync(SKILL_DIR).filter((f) => f.endsWith('.md') && f !== 'SKILL.md');
}

function ruleSections(text) {
  // Split a reference file into { id, body } chunks, one per "## rule.id" heading.
  const parts = text.split(/^## /m).slice(1);
  return parts
    .map((part) => {
      const newline = part.indexOf('\n');
      return { id: part.slice(0, newline).trim(), body: part.slice(newline + 1) };
    })
    .filter((s) => /^[a-z]+\.[a-z0-9-]+$/.test(s.id));
}

test('every rule has all six sections, in order', () => {
  for (const file of referenceFiles()) {
    const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
    for (const { id, body } of ruleSections(text)) {
      let last = -1;
      for (const section of REQUIRED_SECTIONS) {
        const at = body.indexOf(`**${section}**`);
        assert.ok(at >= 0, `${file} ${id}: missing **${section}**`);
        assert.ok(at > last, `${file} ${id}: **${section}** is out of order`);
        last = at;
      }
    }
  }
});

test('every reference file has a Contents list matching its rules', () => {
  for (const file of referenceFiles()) {
    const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
    const contents = text.match(/^## Contents\n\n((?:- .+\n)+)/m);
    assert.ok(contents, `${file}: missing "## Contents" list`);
    const listed = contents[1].trim().split('\n').map((line) => line.replace(/^- /, '').trim());
    const rules = ruleSections(text).map((s) => s.id);
    assert.deepEqual(listed, rules, `${file}: Contents does not match the rule headings`);
  }
});

test('reference files do not link to other reference files', () => {
  // Keep references one level deep from SKILL.md: cross-refer by rule ID, not by link.
  for (const file of referenceFiles()) {
    const text = fs.readFileSync(path.join(SKILL_DIR, file), 'utf8');
    const links = [...text.matchAll(/\]\(([A-Za-z0-9_-]+\.md)\)/g)].map((m) => m[1]);
    assert.deepEqual(links, [], `${file} links to ${links.join(', ')}`);
  }
});

test('every file linked from SKILL.md exists', () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const links = [...skill.matchAll(/\]\(([A-Za-z0-9_.-]+\.(?:md|json))\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 10, 'expected SKILL.md to link the reference files');
  for (const link of links) assert.ok(fs.existsSync(path.join(SKILL_DIR, link)), `missing ${link}`);
});

test('SKILL.md frontmatter has a name and description', () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const front = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(front, 'missing frontmatter');
  assert.match(front[1], /^name: scar-tissue$/m);
  assert.match(front[1], /^description: .{50,}$/m);
});

test('the example report is valid', () => {
  const examplePath = path.join(SKILL_DIR, '..', '..', 'examples', 'payment-api', 'scar-tissue-report.json');
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  const { errors, warnings } = validateReport(example, catalog);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// --- CLI --------------------------------------------------------------

test('CLI exits 0 for a valid report and 1 for an invalid one', (t) => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'scar-tissue-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const good = path.join(tmp, 'good.json');
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(good, JSON.stringify(report([finding()])));
  fs.writeFileSync(bad, JSON.stringify(report([finding({ rule: 'nope.nope' })])));

  const cli = path.join(SKILL_DIR, 'validate-findings.cjs');
  assert.equal(spawnSync(process.execPath, [cli, good]).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, bad]).status, 1);
  assert.equal(spawnSync(process.execPath, [cli]).status, 2);
});

test('RULES.md is up to date with rules.json', () => {
  const { render, loadRules, OUT } = require('../../scripts/generate-rules-index.cjs');
  const actual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  assert.equal(actual, render(loadRules()), 'RULES.md is stale. Run: npm run rules');
});

test('renderText prints each finding and a summary line', () => {
  const report = {
    tool: 'scar-tissue',
    schema_version: 1,
    findings: [finding({ also_at: [{ file: 'app/refunds.py', line: 7 }] })],
    summary: { critical: 1, high: 0, medium: 0, low: 0, fix_first: 'ST-001' },
  };
  const text = renderText(report);
  assert.match(text, /^ST-001 \[critical\] idempotency\.missing-key {2}payments\.py:42 {2}\(also refunds\.py:7\)/);
  assert.match(text, /Trigger: +Client times out/);
  assert.match(text, /Fix: +Require an Idempotency-Key header/);
  assert.match(text, /1 finding: 1 critical\. Fix first: ST-001\.$/);
  assert.doesNotMatch(text, /\x1b\[/, 'no color codes unless asked');
});

test('CLI --format text prints the report and accepts flags in any order', () => {
  const examplePath = path.join(SKILL_DIR, '..', '..', 'examples', 'payment-api', 'scar-tissue-report.json');
  const cli = path.join(SKILL_DIR, 'validate-findings.cjs');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

  const after = run(examplePath, '--format', 'text');
  assert.equal(after.status, 0);
  assert.match(after.stdout, /12 findings: 6 critical, 5 high, 1 medium\. Fix first: ST-001\./);

  assert.equal(run('--format', 'text', examplePath).status, 0);
  assert.equal(run(examplePath, '--format', 'html').status, 2);
});
