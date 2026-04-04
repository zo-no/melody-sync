import { createSerialTaskQueue } from '../fs-utils.mjs';

const workbenchQueues = new Map();

export function workbenchQueue(scopeKey, fn) {
  if (typeof scopeKey === 'function') {
    if (!workbenchQueues.has('__global__')) {
      workbenchQueues.set('__global__', createSerialTaskQueue());
    }
    return workbenchQueues.get('__global__')(scopeKey);
  }
  const key = typeof scopeKey === 'string' && scopeKey ? scopeKey : '__global__';
  if (!workbenchQueues.has(key)) {
    workbenchQueues.set(key, createSerialTaskQueue());
  }
  return workbenchQueues.get(key)(fn);
}
