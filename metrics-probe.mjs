import { readLatestCodexSessionMetrics } from './backend/codex-session-metrics.mjs';
const start = Date.now();
const metrics = await readLatestCodexSessionMetrics('019d597d-cbf5-7853-b28e-75ac85ec6e57');
console.log('found', !!metrics, 'ms', Date.now()-start, metrics?.contextTokens, metrics?.source);
