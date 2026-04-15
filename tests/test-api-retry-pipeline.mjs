#!/usr/bin/env node
/**
 * test-api-retry-pipeline.mjs
 *
 * 覆盖 api_retry 全链路：
 *   1. claude-adapter parseLine — system/api_retry → statusEvent
 *   2. sidecar 内联逻辑 — trackApiRetryEvent / hasApiRetryStall / pruneApiRetryEvents
 *   3. run-health — deriveStructuredRuntimeFailureReason 识别 api_retry 文本
 */
import assert from 'assert/strict';
import { createClaudeAdapter } from '../backend/runtime/providers/claude-adapter.mjs';
import { deriveStructuredRuntimeFailureReason } from '../backend/session/run-health.mjs';

// ─────────────────────────────────────────────
// 1. claude-adapter: system/init → "Session started (...)"
// ─────────────────────────────────────────────
{
  const adapter = createClaudeAdapter();
  const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test-123' });
  const events = adapter.parseLine(line);
  assert.equal(events.length, 1, 'init 应产生 1 个事件');
  assert.equal(events[0].type, 'status', 'init 应产生 status 事件');
  assert.ok(
    events[0].content.includes('Session started') && events[0].content.includes('test-123'),
    `init status 应包含 session_id，实际: ${events[0].content}`,
  );
  console.log('✓ 1a. system/init → statusEvent "Session started"');
}

// ─────────────────────────────────────────────
// 2. claude-adapter: system/api_retry → "System: api_retry"
// ─────────────────────────────────────────────
{
  const adapter = createClaudeAdapter();
  const line = JSON.stringify({ type: 'system', subtype: 'api_retry' });
  const events = adapter.parseLine(line);
  assert.equal(events.length, 1, 'api_retry 应产生 1 个事件');
  assert.equal(events[0].type, 'status', 'api_retry 应产生 status 事件');
  assert.ok(
    events[0].content.includes('api_retry'),
    `api_retry status 文本应包含 "api_retry"，实际: ${events[0].content}`,
  );
  console.log('✓ 1b. system/api_retry → statusEvent "System: api_retry"');
}

// ─────────────────────────────────────────────
// 3. claude-adapter: 未知 subtype → "System: <subtype>"
// ─────────────────────────────────────────────
{
  const adapter = createClaudeAdapter();
  const line = JSON.stringify({ type: 'system', subtype: 'some_other_event' });
  const events = adapter.parseLine(line);
  assert.equal(events.length, 1);
  assert.ok(events[0].content.includes('some_other_event'), '未知 subtype 应透传');
  console.log('✓ 1c. system/unknown_subtype → statusEvent 透传');
}

// ─────────────────────────────────────────────
// 4. claude-adapter: 多次 api_retry 每次各产生独立事件
// ─────────────────────────────────────────────
{
  const adapter = createClaudeAdapter();
  const retryLine = JSON.stringify({ type: 'system', subtype: 'api_retry' });
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const events = adapter.parseLine(retryLine);
    total += events.length;
  }
  assert.equal(total, 6, '6 次 api_retry 应各产生 1 个事件，共 6 个');
  console.log('✓ 1d. 6 × api_retry → 6 独立 statusEvent');
}

// ─────────────────────────────────────────────
// 5. sidecar 内联逻辑：trackApiRetryEvent / hasApiRetryStall / pruneApiRetryEvents
//    （从 sidecar.mjs 提取出来的纯函数，用相同参数测试）
// ─────────────────────────────────────────────
{
  const DEFAULT_API_RETRY_COUNT_LIMIT = 8;
  const DEFAULT_API_RETRY_STALL_MS = 25000;

  const apiRetryEvents = [];

  const pruneApiRetryEvents = (now) => {
    while (apiRetryEvents.length > 0 && (now - apiRetryEvents[0]) > DEFAULT_API_RETRY_STALL_MS) {
      apiRetryEvents.shift();
    }
  };

  const trackApiRetryEvent = (line, now = Date.now()) => {
    if (!line || typeof line !== 'string') return;
    if (!/api_retry/i.test(line)) return;
    apiRetryEvents.push(now);
    pruneApiRetryEvents(now);
  };

  const hasApiRetryStall = () => apiRetryEvents.length >= DEFAULT_API_RETRY_COUNT_LIMIT;

  // 5a. 非 api_retry 行不计入
  trackApiRetryEvent('{"type":"system","subtype":"init"}');
  assert.equal(apiRetryEvents.length, 0, '非 api_retry 行不应计入');
  console.log('✓ 2a. 非 api_retry 行不计入');

  // 5b. 7 次不触发 stall（默认阈值 8）
  const t0 = Date.now();
  for (let i = 0; i < 7; i++) trackApiRetryEvent('System: api_retry', t0 + i * 100);
  assert.equal(hasApiRetryStall(), false, '7 次应未达阈值 8');
  console.log('✓ 2b. 7 × api_retry → hasApiRetryStall() = false');

  // 5c. 第 8 次触发 stall
  trackApiRetryEvent('System: api_retry', t0 + 700);
  assert.equal(hasApiRetryStall(), true, '8 次应触发 stall');
  console.log('✓ 2c. 8 × api_retry → hasApiRetryStall() = true');

  // 5d. 过期事件被 prune 后不再触发 stall
  apiRetryEvents.length = 0;
  const oldT = Date.now() - DEFAULT_API_RETRY_STALL_MS - 1000;
  for (let i = 0; i < 8; i++) apiRetryEvents.push(oldT + i * 100);
  pruneApiRetryEvents(Date.now());
  assert.equal(hasApiRetryStall(), false, '全部过期后 stall 应解除');
  console.log('✓ 2d. 全部过期 → pruneApiRetryEvents 清空 → hasApiRetryStall() = false');

  // 5e. 混合：旧事件过期 + 新事件不足阈值
  apiRetryEvents.length = 0;
  const now2 = Date.now();
  for (let i = 0; i < 5; i++) apiRetryEvents.push(oldT + i * 100); // 5 个过期
  for (let i = 0; i < 3; i++) apiRetryEvents.push(now2 + i * 100); // 3 个新的
  pruneApiRetryEvents(now2 + 300);
  assert.equal(apiRetryEvents.length, 3, '过期的 5 个应被清除，剩 3 个');
  assert.equal(hasApiRetryStall(), false, '3 个新事件不足阈值 8');
  console.log('✓ 2e. 过期 5 + 新 3 → prune 后剩 3 → stall = false');
}

// ─────────────────────────────────────────────
// 6. run-health: deriveStructuredRuntimeFailureReason 识别 api_retry
// ─────────────────────────────────────────────
{
  // 直接传 previewText，跳过磁盘读取
  const reason = await deriveStructuredRuntimeFailureReason(
    'fake-run-id',
    'System: api_retry',
  );
  assert.ok(
    reason.includes('api_retry'),
    `api_retry 预览文本应被识别，实际: ${reason}`,
  );
  assert.ok(
    reason.toLowerCase().includes('provider'),
    `错误原因应包含 "provider"，实际: ${reason}`,
  );
  console.log(`✓ 3a. deriveStructuredRuntimeFailureReason("api_retry") → "${reason}"`);
}

// ─────────────────────────────────────────────
// 7. run-health: 其他错误文本不被误判为 api_retry
// ─────────────────────────────────────────────
{
  const reason = await deriveStructuredRuntimeFailureReason(
    'fake-run-id',
    'socket hang up',
  );
  assert.ok(
    !reason.toLowerCase().includes('api_retry'),
    `socket hang up 不应被识别为 api_retry，实际: ${reason}`,
  );
  assert.ok(
    reason.toLowerCase().includes('transport'),
    `socket hang up 应被识别为 transport 错误，实际: ${reason}`,
  );
  console.log(`✓ 3b. socket hang up 不被误判为 api_retry → "${reason}"`);
}

// ─────────────────────────────────────────────
// 8. claude-adapter: 正常 assistant 消息不受 api_retry 影响
// ─────────────────────────────────────────────
{
  const adapter = createClaudeAdapter();
  // 先发 6 次 api_retry
  const retryLine = JSON.stringify({ type: 'system', subtype: 'api_retry' });
  for (let i = 0; i < 6; i++) adapter.parseLine(retryLine);
  // 再发正常 assistant 消息
  const msgLine = JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Hello after retries' }],
      usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  const events = adapter.parseLine(msgLine);
  assert.ok(events.some(e => e.type === 'message' && e.content === 'Hello after retries'),
    '重试后的正常 assistant 消息应正确解析');
  console.log('✓ 4. 6 × api_retry 后正常 assistant 消息仍可解析');
}

console.log('\ntest-api-retry-pipeline: all ok');
