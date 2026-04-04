import { getRunManifest } from './backend/runs.mjs';
import { readRunSpoolRecords, materializeRunSpoolLine } from './backend/runs.mjs';
import { createToolInvocation } from './backend/process-runner.mjs';
import { parseTaskCardFromAssistantContent, stripTaskCardFromAssistantContent } from './backend/session-task-card.mjs';

const runId='run_de7f76437d4137c8c34ee953';
const manifest = await getRunManifest(runId);
const runtimeInvocation = await createToolInvocation(manifest.tool, '', manifest.options || {});
const records = await readRunSpoolRecords(runId);
for (const record of records) {
  const line = await materializeRunSpoolLine(runId, record);
  const events = runtimeInvocation.adapter.parseLine(line);
  for (const event of events) {
    if (event.type === 'message' && event.role === 'assistant') {
      const s = event.content || '';
      const t0 = Date.now();
      const tcard = parseTaskCardFromAssistantContent(s);
      const stripped = stripTaskCardFromAssistantContent(s);
      const t1 = Date.now();
      console.log('assistant len', s.length, 'taskcard', !!tcard, 'stripped len', stripped.length, 'ms', t1-t0);
      if (tcard) {
        console.log('keys', Object.keys(tcard));
      }
    } else {
      console.log('non assistant', event.type, event.role || '');
    }
  }
}
