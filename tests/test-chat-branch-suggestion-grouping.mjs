#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const uiSource = readFileSync(join(repoRoot, 'static', 'frontend', 'session', 'transcript-ui.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist in ui.js`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
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
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(token));
    },
    contains(token) {
      return values.has(token);
    },
    setFromString(value) {
      values.clear();
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => values.add(token));
    },
    toString() {
      return [...values].join(' ');
    },
  };
}

function buildMatcher(selector) {
  const attrMatch = selector.match(/^\.([a-zA-Z0-9_-]+)(?:\[data-([a-zA-Z0-9_-]+)=\"([^\"]+)\"\])?$/);
  if (attrMatch) {
    const [, classToken, dataKey, dataValue] = attrMatch;
    return (node) => {
      if (!node.classList?.contains(classToken)) return false;
      if (!dataKey) return true;
      const camelKey = dataKey.replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
      return String(node.dataset?.[camelKey] || '') === dataValue;
    };
  }
  throw new Error(`Unsupported selector in test harness: ${selector}`);
}

function makeElement(tagName = 'div') {
  const listeners = new Map();
  let classNameValue = '';
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    dataset: {},
    style: {},
    children: [],
    parentNode: null,
    textContent: '',
    disabled: false,
    type: '',
    classList: makeClassList(),
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => {
        if (child && typeof child === 'object') element.appendChild(child);
      });
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    querySelector(selector) {
      const matcher = buildMatcher(selector);
      function walk(node) {
        for (const child of node.children || []) {
          if (matcher(child)) return child;
          const nested = walk(child);
          if (nested) return nested;
        }
        return null;
      }
      return walk(element);
    },
    querySelectorAll(selector) {
      const matcher = buildMatcher(selector);
      const matches = [];
      function walk(node) {
        for (const child of node.children || []) {
          if (matcher(child)) matches.push(child);
          walk(child);
        }
      }
      walk(element);
      return matches;
    },
  };

  Object.defineProperty(element, 'className', {
    get() {
      return classNameValue;
    },
    set(nextValue) {
      classNameValue = String(nextValue || '');
      element.classList.setFromString(classNameValue);
    },
  });

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return '';
    },
    set(_value) {
      element.children = [];
      element.textContent = '';
    },
  });

  Object.defineProperty(element, 'lastElementChild', {
    get() {
      return element.children.length ? element.children[element.children.length - 1] : null;
    },
  });

  return element;
}

const createBranchSuggestionHostSource = extractFunctionSource(uiSource, 'createBranchSuggestionHost');
const ensureBranchSuggestionGroupSource = extractFunctionSource(uiSource, 'ensureBranchSuggestionGroup');
const findBranchSuggestionHostSource = extractFunctionSource(uiSource, 'findBranchSuggestionHost');
const renderStatusIntoSource = extractFunctionSource(uiSource, 'renderStatusInto');

const messagesInner = makeElement('div');
const context = {
  console,
  document: {
    createElement: makeElement,
  },
  messagesInner,
  window: {
    MelodySyncWorkbench: {
      createBranchSuggestionItem(evt) {
        const item = makeElement('div');
        item.className = 'quest-branch-suggestion-item';
        if (evt?.autoSuggested !== false) {
          item.classList.add('quest-branch-suggestion-item-auto');
        }
        const title = makeElement('div');
        title.className = 'quest-branch-suggestion-title';
        title.textContent = evt.branchTitle;
        item.appendChild(title);
        return item;
      },
    },
  },
};
context.globalThis = context;

vm.runInNewContext(
  [
    createBranchSuggestionHostSource,
    ensureBranchSuggestionGroupSource,
    findBranchSuggestionHostSource,
    renderStatusIntoSource,
    'globalThis.renderStatusInto = renderStatusInto;',
  ].join('\n\n'),
  context,
  { filename: 'frontend/session/transcript-ui.js' },
);

const userWrap = makeElement('div');
userWrap.className = 'msg-user';
userWrap.dataset.sourceSeq = '7';
const userStack = makeElement('div');
userStack.className = 'msg-user-stack';
userWrap.appendChild(userStack);
messagesInner.appendChild(userWrap);

const assistantReply = makeElement('div');
assistantReply.className = 'msg-assistant';
messagesInner.appendChild(assistantReply);
assert.equal(
  assistantReply.querySelector('.quest-branch-suggestion-group'),
  null,
  'plain user replies should not pre-render a branch suggestion group before any branch candidate event arrives',
);

context.renderStatusInto(messagesInner, {
  type: 'status',
  statusKind: 'branch_candidate',
  branchTitle: '表现主义',
  branchReason: '这条线已经偏离电影史主线，适合单独展开。',
  sourceSeq: 7,
});

const groups = messagesInner.querySelectorAll('.quest-branch-suggestion-group');
assert.equal(groups.length, 1, 'auto suggestions should create exactly one grouped block for the matching source sequence');
const group = groups[0];

const rows = group.querySelectorAll('.quest-branch-suggestion-item');
assert.equal(rows.length, 1, 'group should only contain the auto-detected branch suggestion');
assert.deepEqual(
  rows.map((row) => row.querySelector('.quest-branch-suggestion-title')?.textContent),
  ['表现主义'],
  'auto-detected branch titles should render without a redundant manual placeholder row',
);

context.renderStatusInto(messagesInner, {
  type: 'status',
  statusKind: 'branch_candidate',
  branchTitle: '法国新浪潮',
  branchReason: '这条线也偏离电影史主线，适合单独展开。',
  sourceSeq: 7,
});

assert.equal(
  group.querySelectorAll('.quest-branch-suggestion-item').length,
  1,
  'historical duplicate auto suggestions should collapse to the first auto suggestion within the same message group',
);

console.log('test-chat-branch-suggestion-grouping: ok');
