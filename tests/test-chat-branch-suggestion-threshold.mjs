#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'frontend', 'workbench', 'controller.js'), 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = code.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = code.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(token));
    },
    contains(token) {
      return values.has(token);
    },
    setFromString(value) {
      values.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => values.add(token));
    },
  };
}

function matchesClassSelector(node, selector) {
  const token = String(selector || '').replace(/^\./, '').trim();
  return Boolean(token) && node.classList?.contains(token);
}

function makeElement(tag = 'div') {
  let classNameValue = '';
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    textContent: '',
    disabled: false,
    type: '',
    classList: makeClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    querySelector(selector) {
      function walk(node) {
        for (const child of node.children || []) {
          if (matchesClassSelector(child, selector)) return child;
          const nested = walk(child);
          if (nested) return nested;
        }
        return null;
      }
      return walk(this);
    },
  };

  Object.defineProperty(element, 'className', {
    get() {
      return classNameValue;
    },
    set(value) {
      classNameValue = String(value || '');
      element.classList.setFromString(classNameValue);
    },
  });

  return element;
}

const createBranchSuggestionItemSource = extractFunctionSource(source, 'createBranchSuggestionItem');

const context = {
  console,
  document: {
    createElement: makeElement,
  },
  getCurrentSessionSafe() {
    return { id: 'session-main' };
  },
  isSuppressed() {
    return false;
  },
  enterBranchFromCurrentSession: async () => null,
};
context.globalThis = context;

vm.runInNewContext(
  `${createBranchSuggestionItemSource}\nglobalThis.createBranchSuggestionItem = createBranchSuggestionItem;`,
  context,
  { filename: 'frontend/workbench/controller.js' },
);

const suppressedAuto = context.createBranchSuggestionItem({
  branchTitle: '绘画探索',
  branchReason: '可以单独整理成一个画风方向。',
  autoSuggested: true,
  intentShift: false,
  independentGoal: false,
});
assert.equal(suppressedAuto, null, 'same-goal follow-ups should stay silent by default');

const visibleAuto = context.createBranchSuggestionItem({
  branchTitle: '表现主义',
  branchReason: '这条线已经偏离当前主线，适合单独展开。',
  autoSuggested: true,
  intentShift: true,
  independentGoal: true,
});
assert.ok(visibleAuto, 'multi-candidate auto suggestions should still render');
assert.equal(
  visibleAuto.querySelector('.quest-branch-suggestion-title')?.textContent,
  '表现主义',
  'rendered auto suggestion should keep the branch title visible',
);
assert.equal(
  visibleAuto.querySelector('.quest-branch-btn')?.textContent,
  '开启支线',
  'auto suggestion action should use the same branch-entry wording as the task map',
);

const manualSuggestion = context.createBranchSuggestionItem({
  branchTitle: '单独整理参考风格',
  autoSuggested: false,
});
assert.ok(manualSuggestion, 'manual suggestions should still remain available');

console.log('test-chat-branch-suggestion-threshold: ok');
