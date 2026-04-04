#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-rich-view-ui.js'),
  'utf8',
);

function makeElement(tagName = 'div') {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    children: [],
    attributes: new Map(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      this[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
  };
}

const context = {
  console,
  document: {
    createElement(tagName) {
      return makeElement(tagName);
    },
  },
  window: {
    marked: {
      parse(value) {
        return `<p>${String(value || '').trim()}</p>`;
      },
    },
  },
};
context.globalThis = context;
context.window.window = context.window;

vm.runInNewContext(source, context, { filename: 'workbench/node-rich-view-ui.js' });

const api = context.window.MelodySyncWorkbenchNodeRichViewUi;
assert.ok(api, 'node rich view api should be exposed on window');
assert.equal(typeof api.createRenderer, 'function');

const renderer = api.createRenderer({
  documentRef: context.document,
  windowRef: context.window,
});

const markdownShell = renderer.createRichViewSurface(
  { title: 'Markdown 节点', summary: '回退摘要' },
  { type: 'markdown', content: '## 复盘' },
);
assert.equal(markdownShell.className, 'quest-task-flow-node-rich quest-task-flow-node-rich-markdown');
assert.equal(markdownShell.children.length, 1);
assert.equal(markdownShell.children[0].className, 'quest-task-flow-node-rich-body quest-task-flow-node-rich-markdown');
assert.equal(markdownShell.children[0].innerHTML, '<p>## 复盘</p>');

const inlineHtmlShell = renderer.createRichViewSurface(
  { title: 'HTML 节点' },
  { type: 'html', renderMode: 'inline', content: '<strong>Inline</strong>' },
);
assert.equal(inlineHtmlShell.children[0].className, 'quest-task-flow-node-rich-body quest-task-flow-node-rich-html');
assert.equal(inlineHtmlShell.children[0].innerHTML, '<strong>Inline</strong>');

const htmlFrameShell = renderer.createRichViewSurface(
  { title: 'HTML 视图' },
  { type: 'html', content: '<main>Frame</main>' },
);
assert.equal(htmlFrameShell.children[0].tagName, 'IFRAME');
assert.equal(htmlFrameShell.children[0].className, 'quest-task-flow-node-rich-frame panzoom-exclude');
assert.equal(htmlFrameShell.children[0].title, 'HTML 视图');
assert.equal(htmlFrameShell.children[0].loading, 'lazy');
assert.equal(htmlFrameShell.children[0].sandbox, 'allow-same-origin allow-scripts');
assert.equal(htmlFrameShell.children[0].srcdoc, '<main>Frame</main>');

const iframeShell = renderer.createRichViewSurface(
  { title: '嵌入页面' },
  { type: 'iframe', src: 'https://example.com/embed' },
);
assert.equal(iframeShell.children[0].tagName, 'IFRAME');
assert.equal(iframeShell.children[0].src, 'https://example.com/embed');
assert.equal(iframeShell.children[0].title, '嵌入页面');

console.log('test-workbench-node-rich-view-ui: ok');
