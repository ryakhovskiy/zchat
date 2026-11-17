import { readFile } from 'node:fs/promises';

const paths = process.argv.slice(2);
const reports = await Promise.all((paths.length ? paths : ['../test-results/results.json'])
  .map(async path => JSON.parse(await readFile(path, 'utf8'))));
const rows = [];
async function walk(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) {
      const result = test.results.at(-1);
      rows.push({ project: test.projectName, status: result?.status || 'not run', title: spec.title });
      for (const attachment of result?.attachments || []) {
        if (!/^axe-|^payload-budget$|^slow-network$|^interop-delivery$|^shared-login$|^lite-presence$/.test(attachment.name)) continue;
        const body = attachment.body ? Buffer.from(attachment.body, 'base64').toString()
          : await readFile(attachment.path, 'utf8');
        const data = JSON.parse(body);
        console.log(`${test.projectName}: ${attachment.name}: ${attachment.name.startsWith('axe-')
          ? JSON.stringify({ violations: data.violations.length, incomplete: data.incomplete.length })
          : JSON.stringify(data)}`);
      }
    }
    await walk(suite.suites);
  }
}
for (const report of reports) await walk(report.suites);
for (const project of new Set(rows.map(row => row.project))) {
  const tests = rows.filter(row => row.project === project);
  console.log(`${project}: ${tests.filter(row => row.status === 'passed').length}/${tests.length} passed`);
}
for (const row of rows.filter(row => row.status !== 'passed')) console.log(`${row.status}: ${row.project}: ${row.title}`);
if (reports.some(report => report.errors?.length) || rows.some(row => row.status !== 'passed')) process.exitCode = 1;
