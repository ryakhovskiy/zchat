import { readFile } from 'node:fs/promises';

const paths = process.argv.slice(2);
const reports = await Promise.all((paths.length ? paths : ['test-results/results.json']).map(async path => JSON.parse(await readFile(path, 'utf8'))));
const rows = [];
const failures = [];
const contrast = new Map();
let screenshots = 0;
let incomplete = 0;

async function walk(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests) {
        const result = test.results.at(-1);
        const theme = spec.title.match(/^(light|dark|tech-green|tech-red):/)?.[1];
        rows.push({ project: test.projectName, theme, status: result.status, title: spec.title });
        if (result.status !== 'passed') failures.push(`${test.projectName}: ${spec.title} (${result.status})`);
        for (const attachment of result.attachments || []) {
          if (attachment.contentType === 'image/png' && attachment.name !== 'screenshot') screenshots++;
          if (!attachment.name.endsWith('-contrast')) continue;
          const body = attachment.body ? Buffer.from(attachment.body, 'base64').toString() : await readFile(attachment.path, 'utf8');
          const scan = JSON.parse(body);
          incomplete += scan.incomplete.reduce((sum, rule) => sum + rule.nodes.length, 0);
          if (!theme) continue;
          const data = contrast.get(theme) || { body: Infinity, large: Infinity, measured: 0 };
          for (const rule of scan.passes) for (const node of rule.nodes) for (const check of [...node.any, ...node.all, ...node.none]) {
            if (!Number.isFinite(check.data?.contrastRatio)) continue;
            const type = String(check.data.expectedContrastRatio).includes('4.5') ? 'body' : 'large';
            data[type] = Math.min(data[type], check.data.contrastRatio);
            data.measured++;
          }
          contrast.set(theme, data);
        }
      }
    }
    await walk(suite.suites);
  }
}
for (const report of reports) await walk(report.suites);

console.log('| Viewport | Light | Dark | Tech Green | Tech Red |');
console.log('|---|---|---|---|---|');
for (const project of ['320x640', '360x740', '390x844', '430x932', '740x360', '768x1024', '1440x900']) {
  const cells = ['light', 'dark', 'tech-green', 'tech-red'].map(theme => {
    const cases = rows.filter(row => row.project === project && row.theme === theme);
    const pass = cases.filter(row => row.status === 'passed').length;
    return cases.length ? `${pass === cases.length ? 'PASS' : 'FAIL'} ${pass}/${cases.length}` : 'NOT RUN';
  });
  console.log(`| ${project} | ${cells.join(' | ')} |`);
}
console.log(`\n${rows.filter(row => row.status === 'passed').length}/${rows.length} tests passed; ${screenshots} screenshot attachments; ${incomplete} axe incomplete node results require review.`);
console.log('\nMeasured text contrast minima:');
for (const [theme, data] of contrast) console.log(`${theme}: normal ${data.body}:1; large ${Number.isFinite(data.large) ? data.large : 'not measured'}:1 (${data.measured} measured node checks).`);
if (failures.length) console.log(`\nFailures:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
