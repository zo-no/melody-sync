#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readWorkbenchFrontendSource(filename) {
  const candidates = [
    join(repoRoot, 'frontend-src', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const source = readWorkbenchFrontendSource('status-card-ui.js');

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

const context = {
  console,
  document: {
    createElement: makeElement,
  },
  window: {
    MelodySyncWorkbenchStatusCardUi: {
      createRenderer({ documentRef, getCurrentSessionSafe, isSuppressed }) {
        return {
          createBranchSuggestionItem(evt) {
            const session = getCurrentSessionSafe();
            if (!session?.id || !evt?.branchTitle || isSuppressed(session.id, evt.branchTitle)) {
              return null;
            }
            const isAutoSuggested = evt?.autoSuggested !== false;
            const intentShift = evt?.intentShift === true;
            const independentGoal = evt?.independentGoal === true;
            if (isAutoSuggested && (!intentShift || !independentGoal)) {
              return null;
            }

            const row = documentRef.createElement('div');
            row.className = 'quest-branch-suggestion-item';
            if (isAutoSuggested) {
              row.classList.add('quest-branch-suggestion-item-auto');
            }
            const title = documentRef.createElement('div');
            title.className = 'quest-branch-suggestion-title';
            title.textContent = evt.branchTitle;
            row.appendChild(title);
            const button = documentRef.createElement('button');
            button.className = 'quest-branch-btn';
            button.textContent = '开启';
            row.appendChild(button);
            return row;
          },
        };
      },
    },
  },
  getCurrentSessionSafe() {
    return { id: 'session-main' };
  },
  isSuppressed() {
    return false;
  },
  enterBranchFromCurrentSession: async () => null,
  window: {},
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: 'frontend-src/workbench/status-card-ui.js' });

const renderer = context.window.MelodySyncWorkbenchStatusCardUi.createRenderer({
  documentRef: context.document,
  getCurrentSessionSafe: context.getCurrentSessionSafe,
  isSuppressed: context.isSuppressed,
  enterBranchFromCurrentSession: context.enterBranchFromCurrentSession,
});

const suppressedAuto = renderer.createBranchSuggestionItem({
  branchTitle: '绘画探索',
  branchReason: '可以单独整理成一个画风方向。',
  autoSuggested: true,
  intentShift: false,
  independentGoal: false,
});
assert.equal(suppressedAuto, null, 'same-goal follow-ups should stay silent by default');

const visibleAuto = renderer.createBranchSuggestionItem({
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
  '开启',
  'auto suggestion action should use the same branch-entry wording as the task map',
);

const manualSuggestion = renderer.createBranchSuggestionItem({
  branchTitle: '单独整理参考风格',
  autoSuggested: false,
});
assert.ok(manualSuggestion, 'manual suggestions should still remain available');

console.log('test-chat-branch-suggestion-threshold: ok');
