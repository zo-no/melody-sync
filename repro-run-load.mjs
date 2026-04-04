import { createToolInvocation } from './backend/process-runner.mjs';
import { readRunSpoolRecords, materializeRunSpoolLine, getRunManifest } from './backend/runs.mjs';

const runId = 'run_de7f76437d4137c8c34ee953';
const manifest = await getRunManifest(runId);
console.log('manifest tool', manifest?.tool);
const runtimeInvocation = await createToolInvocation(manifest?.tool, '', {
  model: manifest?.options?.model,
  effort: manifest?.options?.effort,
  thinking: manifest?.options?.thinking,
});
console.log('runtime', runtimeInvocation?.runtimeFamily, 'isCodex', runtimeInvocation?.isCodexFamily);
const records = await readRunSpoolRecords(runId);
console.log('records', records.length);
for (const [index, record] of records.entries()) {
  const start = Date.now();
  const line = await materializeRunSpoolLine(runId, record);
  const elapsed = Date.now() - start;
  console.log('line', index + 1, 'len', line?.length || -1, 'time', elapsed);
  const parsedEvents = runtimeInvocation.adapter.parseLine(line);
  console.log('events', parsedEvents.length);
}
console.log('done');
