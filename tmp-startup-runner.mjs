import { startDetachedRunObservers } from './backend/session-manager.mjs';
import { startPersistentSessionScheduler } from './backend/session-persistent/scheduler.mjs';

console.log('runner start');
await startDetachedRunObservers();
console.log('runner done');
startPersistentSessionScheduler();
