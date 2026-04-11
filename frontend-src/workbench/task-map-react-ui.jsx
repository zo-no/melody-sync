import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeToolbar,
  Position,
  ReactFlowProvider,
  ReactFlow,
  getBezierPath,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import reactFlowCss from '@xyflow/react/dist/style.css';
import {
  applyTaskMapLayoutOverrides,
  createTaskMapLayoutStorageKey,
  filterTaskMapLayoutPositions,
  readTaskMapLayoutPositions,
  writeTaskMapLayoutPositions,
} from './task-map-layout-persistence.js';
import { getTaskMapInteractionConfig } from './task-map-interaction-config.js';

const STYLE_ELEMENT_ID = 'melodysync-task-map-react-ui-style';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const TASK_MAP_VIEWPORT_MEMORY_MAX_ENTRIES = 120;
const taskMapViewportMemory = new Map();
const REACT_FLOW_EXTRA_CSS = `
.quest-task-flow-react-shell {
  position: relative;
}

.quest-task-flow-react-scroll {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  background:
    radial-gradient(circle at 14% 12%, color-mix(in srgb, var(--accent-soft) 18%, transparent) 0%, transparent 34%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg) 96%, transparent) 0%,
      color-mix(in srgb, var(--bg-secondary, var(--bg)) 92%, var(--bg) 8%) 100%
    );
}

.quest-task-flow-react-canvas {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.quest-task-flow-react-canvas::before {
  content: "";
  position: absolute;
  inset: 10px;
  z-index: 0;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 10%, var(--border));
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--border) 14%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--border) 12%, transparent) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.48;
  pointer-events: none;
}

.quest-task-flow-react-global-actions {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 9;
  display: grid;
  justify-items: end;
  gap: 8px;
  pointer-events: none;
}

.quest-task-flow-react-global-actions > * {
  pointer-events: auto;
}

.quest-task-flow-react-global-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.quest-task-flow-react-global-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--notice) 16%, transparent);
  color: var(--notice);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.quest-task-flow-react-global-panel {
  width: min(320px, calc(100vw - 32px));
  padding: 10px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 18%, var(--border));
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 94%, transparent);
  box-shadow: 0 18px 42px color-mix(in srgb, #0b1520 14%, transparent);
  backdrop-filter: blur(16px);
}

.quest-task-flow-react-global-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.quest-task-flow-react-global-panel-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.quest-task-flow-react-global-panel-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.quest-task-flow-react-global-list {
  display: grid;
  gap: 8px;
}

.quest-task-flow-react-global-item {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 14%, var(--border));
  background: color-mix(in srgb, var(--bg) 92%, transparent);
}

.quest-task-flow-react-global-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.quest-task-flow-react-global-item-title {
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.quest-task-flow-react-global-item-title-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quest-task-flow-react-global-item-kind {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.quest-task-flow-react-global-item-reason {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.quest-task-flow-react-global-item-actions {
  display: flex;
  justify-content: flex-end;
}

.quest-task-flow-react-canvas .react-flow,
.quest-task-flow-react-canvas .react-flow__renderer,
.quest-task-flow-react-canvas .react-flow__container,
.quest-task-flow-react-canvas .react-flow__pane,
.quest-task-flow-react-canvas .react-flow__viewport {
  width: 100%;
  height: 100%;
}

.quest-task-flow-react-canvas .react-flow__pane {
  cursor: grab;
}

.quest-task-flow-react-canvas .react-flow__pane.dragging {
  cursor: grabbing;
}

.quest-task-flow-react-canvas .react-flow__node-melody-node {
  cursor: grab;
  overflow: visible;
  pointer-events: all;
}

.quest-task-flow-react-canvas .react-flow__node-melody-node.dragging {
  cursor: grabbing;
}

.quest-task-flow-react-canvas .react-flow__attribution {
  display: none;
}

.quest-task-flow-react-node-shell {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.quest-task-flow-react-node-shell .quest-task-flow-node {
  position: relative;
  left: auto !important;
  top: auto !important;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 100%;
  transform: none !important;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease,
    color 140ms ease !important;
}

.quest-task-flow-react-node-shell .quest-task-flow-node:hover,
.quest-task-flow-react-node-shell .quest-task-flow-node.is-current,
.quest-task-flow-react-node-shell .quest-task-flow-node.is-current-path:not(.is-current),
.quest-task-flow-react-node-shell .quest-task-flow-node.is-canvas-selected {
  transform: none !important;
}

.quest-task-flow-react-node-shell .quest-task-flow-node.is-draft-branch {
  display: grid;
  gap: 10px;
  align-content: start;
  padding: 14px 14px 12px;
  border-style: dashed;
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border-strong));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--accent-soft) 14%, var(--bg)) 0%,
      color-mix(in srgb, var(--bg) 96%, transparent) 100%
    );
  box-shadow:
    0 18px 42px color-mix(in srgb, #0b1520 10%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--accent-soft) 14%, transparent);
}

.quest-task-flow-react-node-shell .quest-task-flow-node.is-draft-branch .quest-task-flow-node-summary {
  min-height: 0;
}

.quest-task-flow-draft-hint {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.quest-task-flow-node.is-resolved .quest-task-flow-node-title,
.quest-task-flow-node.is-resolved .quest-task-flow-node-summary {
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
}

.quest-task-flow-react-node-actions {
  display: grid;
  gap: 6px;
  width: max-content;
  max-width: min(220px, 92vw);
}

.quest-task-flow-react-node-action-strip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 16%, var(--border));
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  box-shadow: 0 10px 24px color-mix(in srgb, #0b1520 10%, transparent);
}

.quest-task-flow-react-node-actions .quest-task-flow-node-action,
.quest-task-flow-react-node-actions .quest-task-flow-branch-composer,
.quest-task-flow-react-node-actions .quest-task-flow-reparent-composer {
  width: 100%;
}

.quest-task-flow-react-node-actions .quest-task-flow-node-action {
  width: auto;
}

.quest-task-flow-react-node-action-compact {
  min-width: 32px;
  width: 32px !important;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  justify-content: center;
  font-size: 20px;
  line-height: 1;
}

.quest-task-flow-react-node-shell .quest-task-flow-node-action,
.quest-task-flow-react-node-shell .quest-task-flow-branch-composer,
.quest-task-flow-react-node-shell .quest-task-flow-reparent-composer {
  pointer-events: auto;
}

.quest-task-flow-react-shell.is-mobile .react-flow__node-melody-node,
.quest-task-flow-react-shell.is-mobile .react-flow__pane {
  -webkit-tap-highlight-color: transparent;
}

.quest-task-flow-react-shell.is-mobile .react-flow__pane {
  touch-action: manipulation;
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-node-action,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-branch-composer,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-reparent-composer,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-branch-input,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-reparent-option {
  touch-action: manipulation;
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-node-action,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-branch-actions .quest-branch-btn,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-reparent-confirm .quest-branch-btn,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-reparent-option {
  min-height: 36px;
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-react-node-actions {
  width: max-content;
  max-width: min(220px, calc(100vw - 32px));
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-react-node-action-strip {
  gap: 8px;
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-react-node-actions .quest-task-flow-node-action,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-react-node-actions .quest-task-flow-branch-composer,
.quest-task-flow-react-shell.is-mobile .quest-task-flow-react-node-actions .quest-task-flow-reparent-composer {
  width: 100%;
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle {
  position: absolute;
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 0;
  z-index: 3;
  border: 0;
  background: transparent;
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 160ms ease,
    filter 160ms ease;
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle::after {
  content: attr(data-label);
  position: absolute;
  top: 50%;
  left: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 18%, var(--border));
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 94%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 10px 24px color-mix(in srgb, #0b1520 10%, transparent);
  transform: translate(0, -50%);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-source::after {
  content: '';
  width: 20px;
  min-width: 20px;
  height: 20px;
  padding: 0;
  border-width: 2px;
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border-strong));
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 92%, white 8%);
  box-shadow:
    0 10px 24px color-mix(in srgb, #0b1520 10%, transparent),
    0 0 0 3px color-mix(in srgb, var(--bg-elevated, var(--bg)) 88%, transparent);
  transform: translate(10px, -50%);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-source.is-active::after {
  background: color-mix(in srgb, var(--accent-soft) 28%, var(--bg-elevated, var(--bg)));
  box-shadow:
    0 12px 28px color-mix(in srgb, var(--accent) 10%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-source.is-busy::after {
  content: attr(data-label);
  width: auto;
  min-width: 48px;
  height: 28px;
  padding: 0 10px;
  border-width: 1px;
  color: var(--text-secondary);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-target::after {
  border-style: dashed;
  color: var(--text);
  transform: translate(calc(-100% - 14px), -50%);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-target.is-highlight::after {
  border-color: color-mix(in srgb, var(--accent) 26%, var(--border-strong));
  background: color-mix(in srgb, var(--accent-soft) 18%, var(--bg-elevated, var(--bg)));
  color: var(--accent);
}

.quest-task-flow-react-node-shell .quest-task-flow-connect-handle.is-target.is-highlight:hover::after {
  filter: brightness(1.02);
}

.quest-task-flow-react-node-shell .quest-task-flow-node-quick-actions {
  position: absolute;
  top: 50%;
  right: -82px;
  z-index: 6;
  display: grid;
  justify-items: center;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.quest-task-flow-react-node-shell .quest-task-flow-node-quick-actions.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%) translateX(0);
}

.quest-task-flow-react-node-shell .quest-task-flow-node-quick-add {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 999px;
  box-shadow: 0 10px 24px color-mix(in srgb, #0b1520 12%, transparent);
}

.quest-task-flow-react-shell.is-mobile .quest-task-flow-node-quick-actions {
  display: none;
}

.quest-task-flow-react-empty {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 8;
  max-width: 240px;
}

.quest-task-flow-react-canvas .react-flow__edge-path.quest-task-flow-edge {
  fill: none;
}
`;

function normalizeTaskMapViewport(viewport = null) {
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) {
    return null;
  }
  const x = Number(viewport.x);
  const y = Number(viewport.y);
  const zoom = Number(viewport.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    zoom: Math.round(zoom * 1000) / 1000,
  };
}

function readTaskMapViewportMemory(memoryKey = '') {
  const normalizedMemoryKey = trimText(memoryKey);
  if (!normalizedMemoryKey) return null;
  const storedViewport = taskMapViewportMemory.get(normalizedMemoryKey);
  return normalizeTaskMapViewport(storedViewport);
}

function writeTaskMapViewportMemory(memoryKey = '', viewport = null) {
  const normalizedMemoryKey = trimText(memoryKey);
  if (!normalizedMemoryKey) return false;
  const normalizedViewport = normalizeTaskMapViewport(viewport);
  if (!normalizedViewport) {
    taskMapViewportMemory.delete(normalizedMemoryKey);
    return true;
  }
  if (taskMapViewportMemory.has(normalizedMemoryKey)) {
    taskMapViewportMemory.delete(normalizedMemoryKey);
  }
  taskMapViewportMemory.set(normalizedMemoryKey, normalizedViewport);
  while (taskMapViewportMemory.size > TASK_MAP_VIEWPORT_MEMORY_MAX_ENTRIES) {
    const oldestKey = taskMapViewportMemory.keys().next().value;
    if (!oldestKey) break;
    taskMapViewportMemory.delete(oldestKey);
  }
  return true;
}

function ensureCompatElement(element, documentRef = document) {
  if (!element || typeof element !== 'object') return element;
  if (typeof element.nodeType !== 'number') {
    element.nodeType = 1;
  }
  if (!element.nodeName) {
    element.nodeName = String(element.tagName || 'div').toUpperCase();
  }
  if (!element.ownerDocument) {
    element.ownerDocument = documentRef || globalThis?.document || null;
  }
  if (!element.namespaceURI) {
    element.namespaceURI = HTML_NAMESPACE;
  }
  if (typeof element.appendChild !== 'function') {
    element.children = Array.isArray(element.children) ? element.children : [];
    element.appendChild = function appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.push(child);
      return child;
    };
  }
  if (typeof element.insertBefore !== 'function') {
    element.insertBefore = function insertBefore(child, beforeChild) {
      if (!child) return child;
      child.parentNode = this;
      const currentChildren = Array.isArray(this.children) ? this.children : (this.children = []);
      const index = beforeChild ? currentChildren.indexOf(beforeChild) : -1;
      if (index < 0) {
        currentChildren.push(child);
      } else {
        currentChildren.splice(index, 0, child);
      }
      return child;
    };
  }
  if (typeof element.removeChild !== 'function') {
    element.removeChild = function removeChild(child) {
      if (!child || !Array.isArray(this.children)) return child;
      this.children = this.children.filter((entry) => entry !== child);
      if (child.parentNode === this) child.parentNode = null;
      return child;
    };
  }
  if (typeof element.getAttribute !== 'function') {
    element.getAttribute = function getAttribute(name) {
      return this[name];
    };
  }
  if (typeof element.hasAttribute !== 'function') {
    element.hasAttribute = function hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this, name);
    };
  }
  if (typeof element.removeAttribute !== 'function') {
    element.removeAttribute = function removeAttribute(name) {
      delete this[name];
    };
  }
  return element;
}

function createCompatTextNode(documentRef = document, text = '') {
  return {
    nodeType: 3,
    nodeName: '#text',
    ownerDocument: documentRef || globalThis?.document || null,
    parentNode: null,
    nodeValue: String(text),
    textContent: String(text),
    remove() {
      if (!this.parentNode?.removeChild) return;
      this.parentNode.removeChild(this);
    },
  };
}

function ensureReactDocumentCompat(documentRef = document) {
  const doc = documentRef || globalThis?.document || null;
  if (!doc || typeof doc !== 'object' || doc.__melodysyncReactCompatPatched === true) {
    return doc;
  }
  const originalCreateElement = typeof doc.createElement === 'function'
    ? doc.createElement.bind(doc)
    : null;
  if (originalCreateElement) {
    doc.createElement = function patchedCreateElement(...args) {
      return ensureCompatElement(originalCreateElement(...args), doc);
    };
  }
  const originalCreateElementNs = typeof doc.createElementNS === 'function'
    ? doc.createElementNS.bind(doc)
    : null;
  if (originalCreateElementNs) {
    doc.createElementNS = function patchedCreateElementNS(namespaceUri, ...args) {
      const element = ensureCompatElement(originalCreateElementNs(namespaceUri, ...args), doc);
      if (namespaceUri && !element.namespaceURI) {
        element.namespaceURI = namespaceUri;
      }
      return element;
    };
  }
  if (typeof doc.createTextNode !== 'function') {
    doc.createTextNode = function patchedCreateTextNode(text) {
      return createCompatTextNode(doc, text);
    };
  }
  if (!doc.documentElement && originalCreateElement) {
    doc.documentElement = ensureCompatElement(originalCreateElement('html'), doc);
  }
  if (!doc.head && originalCreateElement) {
    doc.head = ensureCompatElement(originalCreateElement('head'), doc);
  }
  if (!doc.body && originalCreateElement) {
    doc.body = ensureCompatElement(originalCreateElement('body'), doc);
  }
  if (!doc.defaultView) {
    doc.defaultView = globalThis?.window || null;
  }
  doc.__melodysyncReactCompatPatched = true;
  return doc;
}

function ensureReactFlowStyles(documentRef = document) {
  const doc = ensureReactDocumentCompat(documentRef || globalThis?.document);
  if (!doc?.createElement) return;
  if (doc.getElementById?.(STYLE_ELEMENT_ID)) return;
  const styleEl = doc.createElement('style');
  styleEl.id = STYLE_ELEMENT_ID;
  styleEl.textContent = `${reactFlowCss}\n${REACT_FLOW_EXTRA_CSS}`;
  const target = doc.head || doc.documentElement || doc.body;
  target?.appendChild?.(styleEl);
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value) {
  return trimText(value).replace(/\s+/g, ' ');
}

function clipText(value, max = 96) {
  const text = normalizeText(value);
  if (!text) return '';
  if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdownToHtml(windowRef = window, documentRef = document, markdown = '') {
  const text = String(markdown || '');
  const tempNode = documentRef?.createElement?.('div') || null;

  if (tempNode && typeof windowRef?.renderMarkdownIntoNode === 'function') {
    windowRef.renderMarkdownIntoNode(tempNode, text);
    return typeof tempNode.innerHTML === 'string' && tempNode.innerHTML
      ? tempNode.innerHTML
      : escapeHtml(tempNode.textContent || text);
  }

  if (tempNode && typeof globalThis?.renderMarkdownIntoNode === 'function') {
    globalThis.renderMarkdownIntoNode(tempNode, text);
    return typeof tempNode.innerHTML === 'string' && tempNode.innerHTML
      ? tempNode.innerHTML
      : escapeHtml(tempNode.textContent || text);
  }

  if (typeof windowRef?.marked?.parse === 'function') {
    return windowRef.marked.parse(text);
  }

  return escapeHtml(text);
}

function resolveNodeCanvasView(node = null, view = null) {
  const raw = view && typeof view === 'object'
    ? view
    : (node?.view && typeof node.view === 'object' ? node.view : { type: 'flow-node' });
  const type = trimText(raw.type).toLowerCase() || 'flow-node';
  return {
    type,
    content: typeof raw.content === 'string' ? raw.content : '',
    src: typeof raw.src === 'string' ? raw.src : '',
    renderMode: trimText(raw.renderMode).toLowerCase(),
    width: Number.isFinite(raw.width) ? raw.width : null,
    height: Number.isFinite(raw.height) ? raw.height : null,
  };
}

function getNodeCanvasShellClassName(viewType = 'flow-node') {
  return `quest-task-flow-node-rich quest-task-flow-node-rich-${viewType}`;
}

function RichViewContent({
  node = {},
  view = null,
  documentRef = document,
  windowRef = window,
}) {
  const resolvedView = resolveNodeCanvasView(node, view);
  const viewType = trimText(resolvedView?.type || 'flow-node') || 'flow-node';

  if (viewType === 'markdown') {
    const html = renderMarkdownToHtml(windowRef, documentRef, resolvedView.content || node.summary || '');
    return (
      <div
        className="quest-task-flow-node-rich-body quest-task-flow-node-rich-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (viewType === 'html') {
    if (resolvedView.renderMode === 'inline') {
      return (
        <div
          className="quest-task-flow-node-rich-body quest-task-flow-node-rich-html"
          dangerouslySetInnerHTML={{ __html: String(resolvedView.content || '') }}
        />
      );
    }
    return (
      <iframe
        className="quest-task-flow-node-rich-frame panzoom-exclude"
        title={String(node.title || 'HTML 视图')}
        loading="lazy"
        sandbox="allow-same-origin allow-scripts"
        src={resolvedView.src || undefined}
        srcDoc={resolvedView.src ? undefined : String(resolvedView.content || '')}
      />
    );
  }

  if (viewType === 'iframe') {
    return (
      <iframe
        className="quest-task-flow-node-rich-frame panzoom-exclude"
        title={String(node.title || '嵌入视图')}
        loading="lazy"
        sandbox="allow-same-origin allow-scripts"
        src={resolvedView.src || undefined}
        srcDoc={resolvedView.src ? undefined : String(resolvedView.content || '')}
      />
    );
  }

  return null;
}

function createRichViewRenderer({
  documentRef = document,
  windowRef = window,
} = {}) {
  ensureReactDocumentCompat(documentRef);
  return Object.freeze({
    renderMarkdownContent(target, markdown) {
      if (!target) return;
      const html = renderMarkdownToHtml(windowRef, documentRef, markdown);
      if ('innerHTML' in target) {
        target.innerHTML = html;
        return;
      }
      target.textContent = String(markdown || '');
    },
    createRichViewSurface(node = {}, view = null) {
      const resolvedView = resolveNodeCanvasView(node, view);
      const container = ensureCompatElement(documentRef.createElement('div'), documentRef);
      container.className = getNodeCanvasShellClassName(resolvedView.type);
      const root = createRoot(container);
      root.render(
        <RichViewContent
          node={node}
          view={resolvedView}
          documentRef={documentRef}
          windowRef={windowRef}
        />,
      );
      container.__melodysyncCleanup = () => {
        root.unmount();
      };
      return container;
    },
  });
}

function createNodeCanvasController({
  railContainerEl = null,
  railEl = null,
  headerEl = null,
  titleEl = null,
  summaryEl = null,
  bodyEl = null,
  expandBtn = null,
  closeBtn = null,
  documentRef = document,
  windowRef = window,
  onClose = null,
} = {}) {
  const richViewRenderer = createRichViewRenderer({
    documentRef,
    windowRef,
  });

  function hasCanvasView(node = null) {
    return resolveNodeCanvasView(node).type !== 'flow-node';
  }

  let expanded = false;
  let dragState = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function setStyleValue(target, propertyName, value) {
    if (!target?.style) return;
    if (typeof target.style.setProperty === 'function') {
      target.style.setProperty(propertyName, value);
      return;
    }
    target.style[propertyName] = value;
  }

  function clearStyleValue(target, propertyName) {
    if (!target?.style) return;
    if (typeof target.style.removeProperty === 'function') {
      target.style.removeProperty(propertyName);
      return;
    }
    target.style[propertyName] = '';
  }

  function updateDragPosition() {
    setStyleValue(railEl, '--task-canvas-drag-x', `${Math.round(dragOffsetX)}px`);
    setStyleValue(railEl, '--task-canvas-drag-y', `${Math.round(dragOffsetY)}px`);
  }

  function resetDragPosition() {
    dragOffsetX = 0;
    dragOffsetY = 0;
    clearStyleValue(railEl, '--task-canvas-drag-x');
    clearStyleValue(railEl, '--task-canvas-drag-y');
  }

  function setExpanded(nextExpanded, { resetPosition = false } = {}) {
    expanded = nextExpanded === true;
    railEl?.classList?.toggle?.('is-expanded', expanded);
    railContainerEl?.classList?.toggle?.('is-canvas-expanded', expanded);
    headerEl?.classList?.toggle?.('is-draggable', expanded);
    expandBtn?.classList?.toggle?.('is-active', expanded);
    if (expandBtn) {
      expandBtn.textContent = expanded ? '收起' : '展开';
      expandBtn.setAttribute?.('aria-pressed', expanded ? 'true' : 'false');
      expandBtn.setAttribute?.('aria-label', expanded ? '收起节点画布' : '展开节点画布');
      expandBtn.title = expanded ? '收起节点画布' : '展开节点画布';
    }
    if (!expanded || resetPosition) {
      resetDragPosition();
    } else {
      updateDragPosition();
    }
  }

  function finishDrag() {
    if (!dragState) return;
    dragState = null;
    railEl?.classList?.remove?.('is-dragging');
    headerEl?.classList?.remove?.('is-dragging');
  }

  function isHeaderInteractiveTarget(target) {
    if (!target || target === headerEl) return false;
    if (String(target?.tagName || '').toUpperCase() === 'BUTTON') return true;
    if (typeof target?.closest === 'function') {
      return Boolean(target.closest('button'));
    }
    return false;
  }

  function bindExpandedDrag() {
    const moveTarget = windowRef?.addEventListener ? windowRef : documentRef;
    if (!headerEl?.addEventListener || !moveTarget?.addEventListener) return;

    const startDrag = (clientX, clientY, target) => {
      if (!expanded || isHeaderInteractiveTarget(target)) return;
      dragState = {
        startX: Number(clientX || 0),
        startY: Number(clientY || 0),
        startOffsetX: dragOffsetX,
        startOffsetY: dragOffsetY,
      };
      railEl?.classList?.add?.('is-dragging');
      headerEl?.classList?.add?.('is-dragging');
    };

    const moveDrag = (clientX, clientY) => {
      if (!dragState || !expanded) return;
      dragOffsetX = dragState.startOffsetX + (Number(clientX || 0) - dragState.startX);
      dragOffsetY = dragState.startOffsetY + (Number(clientY || 0) - dragState.startY);
      updateDragPosition();
    };

    headerEl.addEventListener('mousedown', (event) => {
      startDrag(event?.clientX, event?.clientY, event?.target);
    });
    headerEl.addEventListener('touchstart', (event) => {
      const touch = event?.touches?.[0];
      startDrag(touch?.clientX, touch?.clientY, event?.target);
    }, { passive: true });
    moveTarget.addEventListener('mousemove', (event) => {
      moveDrag(event?.clientX, event?.clientY);
    });
    moveTarget.addEventListener('mouseup', () => {
      finishDrag();
    });
    moveTarget.addEventListener('touchmove', (event) => {
      const touch = event?.touches?.[0];
      moveDrag(touch?.clientX, touch?.clientY);
    }, { passive: true });
    moveTarget.addEventListener('touchend', () => {
      finishDrag();
    });
    moveTarget.addEventListener('touchcancel', () => {
      finishDrag();
    });
  }

  function setOpen(open) {
    const nextOpen = open === true;
    if (!railEl) return;
    railEl.hidden = !nextOpen;
    railEl.classList?.toggle?.('is-open', nextOpen);
  }

  function clearBody() {
    if (!bodyEl) return;
    const children = Array.from(bodyEl.children || []);
    for (const child of children) {
      const cleanup = child?.__melodysyncCleanup;
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }
    bodyEl.innerHTML = '';
  }

  function clear() {
    if (titleEl) titleEl.textContent = '';
    if (summaryEl) {
      summaryEl.textContent = '';
      summaryEl.hidden = true;
    }
    clearBody();
    finishDrag();
    setExpanded(false, { resetPosition: true });
    setOpen(false);
  }

  function renderNode(node = null) {
    if (!node || !hasCanvasView(node) || !richViewRenderer) {
      clear();
      return false;
    }

    const summary = trimText(node?.summary);
    if (titleEl) {
      titleEl.textContent = trimText(node?.title) || '节点画布';
    }
    if (summaryEl) {
      summaryEl.hidden = !summary;
      summaryEl.textContent = summary;
    }
    if (bodyEl) {
      clearBody();
      bodyEl.appendChild(richViewRenderer.createRichViewSurface(node, resolveNodeCanvasView(node)));
    }
    setOpen(true);
    return true;
  }

  expandBtn?.addEventListener?.('click', () => {
    setExpanded(!expanded);
  });

  closeBtn?.addEventListener?.('click', () => {
    clear();
    if (typeof onClose === 'function') onClose();
  });

  bindExpandedDrag();
  clear();

  return Object.freeze({
    renderNode,
    clear,
    isOpen() {
      return railEl?.hidden !== true;
    },
    isExpanded() {
      return expanded;
    },
    hasCanvasView,
    resolveNodeView: resolveNodeCanvasView,
  });
}

function TrackerStatusContent({ visualStatus = null }) {
  return (
    <>
      <span className={`quest-tracker-status-dot${visualStatus?.dotClassName ? ` ${visualStatus.dotClassName}` : ''}`} />
      <span className="quest-tracker-status-text">{String(visualStatus?.label || '')}</span>
    </>
  );
}

function TrackerDetailList({ items = [] }) {
  return (
    <>
      {items.map((entry) => (
        <div key={entry} className="quest-tracker-detail-item">{entry}</div>
      ))}
    </>
  );
}

function TrackerCandidateBranchActionsContent({
  candidateBranches = [],
  onEnter = null,
}) {
  return (
    <>
      {candidateBranches.map((branchTitle) => (
        <div key={branchTitle} className="quest-branch-suggestion-item">
          <BranchSuggestionItemChildren
            branchTitle={branchTitle}
            branchReason=""
            onEnter={() => onEnter?.(branchTitle)}
          />
        </div>
      ))}
    </>
  );
}

function TrackerPersistentActionsContent({ buttons = [] }) {
  return (
    <>
      {buttons.map((button, index) => (
        <button
          key={`${button.label}-${index}`}
          type="button"
          className={`quest-tracker-btn${button.secondary ? ' quest-tracker-btn-secondary' : ''}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            button.onClick?.();
          }}
        >
          {button.label}
        </button>
      ))}
    </>
  );
}

function createHandoffTargetOptionLabel(target = {}) {
  const title = trimText(target?.title || '') || '未命名任务';
  const detail = trimText(target?.displayPath || target?.path || '');
  if (!detail || detail === title) return title;
  return `${title} · ${detail}`;
}

function TrackerHandoffActionsContent({
  sessionId = '',
  targets = [],
  buildPreview = null,
  onHandoff = null,
}) {
  const normalizedSessionId = trimText(sessionId || '');
  const validTargets = Array.isArray(targets)
    ? targets.filter((entry) => trimText(entry?.sessionId || ''))
    : [];
  const [selectedTargetId, setSelectedTargetId] = useState(() => trimText(validTargets[0]?.sessionId || ''));
  const [handoffBusy, setHandoffBusy] = useState(false);

  useEffect(() => {
    if (!validTargets.length) {
      if (selectedTargetId) setSelectedTargetId('');
      return;
    }
    if (validTargets.some((entry) => trimText(entry?.sessionId || '') === trimText(selectedTargetId))) {
      return;
    }
    setSelectedTargetId(trimText(validTargets[0]?.sessionId || ''));
  }, [validTargets, selectedTargetId]);

  const selectedTarget = validTargets.find((entry) => trimText(entry?.sessionId || '') === trimText(selectedTargetId)) || null;
  const preview = normalizedSessionId && selectedTargetId && typeof buildPreview === 'function'
    ? buildPreview(selectedTargetId, { detailLevel: 'balanced' })
    : null;
  const previewText = trimText(preview?.summary || '')
    || (selectedTarget ? `将把当前阶段信息传给「${trimText(selectedTarget.title || selectedTarget.path || '目标任务')}」` : '');

  async function handleHandoff(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedTargetId || handoffBusy || typeof onHandoff !== 'function') return;
    setHandoffBusy(true);
    try {
      await onHandoff(selectedTargetId, { detailLevel: 'balanced' });
    } finally {
      setHandoffBusy(false);
    }
  }

  return (
    <>
      <div className="quest-tracker-handoff-row">
        <select
          className="quest-tracker-handoff-select"
          aria-label="选择传递目标"
          value={selectedTargetId}
          onChange={(event) => setSelectedTargetId(trimText(event.target.value || ''))}
          disabled={handoffBusy || validTargets.length === 0}
        >
          {validTargets.map((target) => (
            <option key={trimText(target?.sessionId || '')} value={trimText(target?.sessionId || '')}>
              {createHandoffTargetOptionLabel(target)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="quest-tracker-btn"
          onClick={handleHandoff}
          disabled={handoffBusy || !selectedTargetId}
        >
          {handoffBusy ? '传递中…' : '传递信息'}
        </button>
      </div>
      {previewText ? <div className="quest-tracker-handoff-preview">{previewText}</div> : null}
    </>
  );
}

function getTrackerLongTermState(session) {
  const longTerm = session?.sessionState?.longTerm;
  if (!longTerm || typeof longTerm !== 'object' || Array.isArray(longTerm)) return null;
  const suggestion = longTerm?.suggestion && typeof longTerm.suggestion === 'object' && !Array.isArray(longTerm.suggestion)
    ? longTerm.suggestion
    : null;
  return {
    lane: trimText(longTerm?.lane || '').toLowerCase() === 'long-term' ? 'long-term' : 'sessions',
    role: trimText(longTerm?.role || '').toLowerCase(),
    rootSessionId: trimText(longTerm?.rootSessionId || ''),
    suggestionRootSessionId: trimText(suggestion?.rootSessionId || ''),
  };
}

function getTrackerPersistentActionButtons(session, {
  onPromote = null,
  onRun = null,
  onToggle = null,
  onConfigure = null,
  onAttachToLongTerm = null,
  onDismissLongTermSuggestion = null,
  isMobile = false,
} = {}) {
  const kind = String(session?.persistent?.kind || '').trim().toLowerCase();
  const longTermState = getTrackerLongTermState(session);
  if (!session?.id || session?.archived === true) {
    return [];
  }
  if (!kind && longTermState?.suggestionRootSessionId) {
    return [
      { label: isMobile ? '归入长期项' : '归入长期任务', onClick: () => onAttachToLongTerm?.(longTermState.suggestionRootSessionId), secondary: false },
      { label: '稍后', onClick: () => onDismissLongTermSuggestion?.(longTermState.suggestionRootSessionId), secondary: true },
    ];
  }
  if (!kind && longTermState?.lane === 'long-term' && longTermState?.role === 'member') {
    return [];
  }
  if (!kind) {
    return [
      { label: isMobile ? '长期项' : '沉淀为长期项', onClick: onPromote, secondary: false },
    ];
  }
  if (isMobile) {
    return [
      { label: '长期项设置', onClick: onConfigure, secondary: false },
    ];
  }
  if (kind === 'recurring_task') {
    return [
      { label: '立即执行', onClick: onRun, secondary: false },
      {
        label: String(session?.persistent?.state || '').trim().toLowerCase() === 'paused' ? '恢复周期' : '暂停周期',
        onClick: onToggle,
        secondary: true,
      },
      { label: '设置', onClick: onConfigure, secondary: true },
    ];
  }
  if (kind === 'scheduled_task') {
    return [
      { label: '立即执行', onClick: onRun, secondary: false },
      {
        label: String(session?.persistent?.state || '').trim().toLowerCase() === 'paused' ? '恢复定时' : '暂停定时',
        onClick: onToggle,
        secondary: true,
      },
      { label: '设置', onClick: onConfigure, secondary: true },
    ];
  }
  if (kind === 'waiting_task') {
    return [
      { label: '立即执行', onClick: onRun, secondary: false },
      { label: '设置', onClick: onConfigure, secondary: true },
    ];
  }
  if (kind === 'skill') {
    return [
      { label: '触发AI快捷按钮', onClick: onRun, secondary: false },
      { label: '设置', onClick: onConfigure, secondary: true },
    ];
  }
  return [];
}

function formatMemoryCandidateMeta(candidate = {}) {
  const type = trimText(candidate?.type || '').toLowerCase();
  const target = trimText(candidate?.target || '');
  const confidence = Number(candidate?.confidence);
  const typeLabel = (
    type === 'profile' ? '习惯'
      : type === 'skill' ? '技能'
        : type === 'corpus' ? '语料'
          : type === 'project' ? '项目'
            : type === 'episode' ? '过程'
              : trimText(candidate?.type || '')
  );
  const confidenceLabel = Number.isFinite(confidence)
    ? `置信 ${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
    : '';
  return [typeLabel, target, confidenceLabel].filter(Boolean).join(' · ');
}

function TrackerMemoryCandidateActionItem({
  candidate = {},
  session = null,
  onReview = null,
}) {
  const [pendingStatus, setPendingStatus] = React.useState('');

  async function handleReview(status) {
    if (!candidate?.id || pendingStatus) return;
    setPendingStatus(status);
    try {
      await onReview?.(candidate, status, session);
    } finally {
      setPendingStatus('');
    }
  }

  return (
    <div className="quest-memory-candidate-item">
      <div className="quest-memory-candidate-main">
        <div className="quest-memory-candidate-text">{String(candidate?.text || '')}</div>
        {formatMemoryCandidateMeta(candidate) ? (
          <div className="quest-memory-candidate-meta">{formatMemoryCandidateMeta(candidate)}</div>
        ) : null}
      </div>
      <div className="quest-memory-candidate-actions">
        <button
          type="button"
          className="quest-branch-btn quest-branch-btn-primary"
          disabled={Boolean(pendingStatus)}
          onClick={() => handleReview('approved')}
        >
          {pendingStatus === 'approved' ? '处理中…' : '采纳'}
        </button>
        <button
          type="button"
          className="quest-branch-btn quest-branch-btn-secondary"
          disabled={Boolean(pendingStatus)}
          onClick={() => handleReview('rejected')}
        >
          {pendingStatus === 'rejected' ? '处理中…' : '忽略'}
        </button>
      </div>
    </div>
  );
}

function TrackerMemoryCandidateActionsContent({
  memoryCandidates = [],
  session = null,
  onReview = null,
}) {
  return (
    <>
      {memoryCandidates.map((candidate) => (
        <TrackerMemoryCandidateActionItem
          key={String(candidate?.id || candidate?.text || '')}
          candidate={candidate}
          session={session}
          onReview={onReview}
        />
      ))}
    </>
  );
}

function createTrackerRenderer({
  documentRef = document,
  trackerStatusEl = null,
  trackerDetailEl = null,
  trackerDetailToggleBtn = null,
  trackerGoalRowEl = null,
  trackerGoalValEl = null,
  trackerConclusionsRowEl = null,
  trackerConclusionsListEl = null,
  trackerMemoryRowEl = null,
  trackerMemoryListEl = null,
  trackerMemoryCandidateRowEl = null,
  trackerMemoryCandidateListEl = null,
  trackerCandidateBranchesRowEl = null,
  trackerCandidateBranchesListEl = null,
  getPersistentActionsEl = () => null,
  getHandoffActionsEl = () => null,
  getCurrentSessionSafe = () => null,
  getPendingMemoryCandidates = () => [],
  reviewMemoryCandidate = async () => null,
  isSuppressed = () => false,
  enterBranchFromCurrentSession = async () => null,
  clipText: clipTextImpl = (value) => String(value || '').trim(),
  toConciseGoal = (value) => String(value || '').trim(),
  isMobileQuestTracker = () => false,
  isRedundantTrackerText = () => false,
  getCurrentTaskSummary = () => '',
  getBranchDisplayName = (session) => String(session?.name || '').trim(),
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
    ensureCompatElement(host, documentRef);
    if (host.__melodysyncReactRoot) return host.__melodysyncReactRoot;
    host.__melodysyncReactRoot = createRoot(host);
    return host.__melodysyncReactRoot;
  }

  function getTrackerVisualStatus(state) {
    if (!state?.hasSession || !state?.session) {
      return { key: '', label: '', dotClassName: '', summary: '' };
    }
    if (state?.taskMapVisualStatus?.label) {
      return {
        key: String(state.taskMapVisualStatus.key || '').trim(),
        label: String(state.taskMapVisualStatus.label || '').trim(),
        dotClassName: String(state.taskMapVisualStatus.dotClassName || '').trim(),
        summary: String(state.taskMapVisualStatus.summary || '').trim(),
      };
    }
    const taskRunStatus = getTaskRunStatusApi(window)?.getTaskRunStatusPresentation?.({
      status: state?.branchStatus || '',
      workflowState: state?.session?.workflowState || '',
      activityState: state?.session?.activity?.run?.state || '',
      activity: state?.session?.activity || null,
      busy: state?.session?.busy === true,
      isCurrent: true,
      showIdle: true,
    }) || getTaskRunStatusApi(window)?.getTaskRunStatusUi?.({
      status: state?.branchStatus || '',
      workflowState: state?.session?.workflowState || '',
      activityState: state?.session?.activity?.run?.state || '',
      activity: state?.session?.activity || null,
      busy: state?.session?.busy === true,
      isCurrent: true,
      showIdle: true,
    }) || { key: '', label: '', summary: '', dotClassName: '' };
    const label = String(taskRunStatus?.label || '').trim();
    if (!label) {
      return { key: '', label: '', dotClassName: '', summary: '' };
    }
    return {
      key: String(taskRunStatus?.key || '').trim(),
      label,
      dotClassName: String(taskRunStatus?.dotClassName || '').trim(),
      summary: String(taskRunStatus?.summary || '').trim(),
    };
  }

  function renderStatus(state) {
    if (!trackerStatusEl) return;
    if (!state?.hasSession || !state?.session) {
      trackerStatusEl.hidden = true;
      ensureRoot(trackerStatusEl)?.render(null);
      return;
    }
    const visualStatus = getTrackerVisualStatus(state);
    trackerStatusEl.hidden = !visualStatus.label;
    ensureRoot(trackerStatusEl)?.render(<TrackerStatusContent visualStatus={visualStatus} />);
  }

  function getPrimaryTitle(state) {
    if (!state?.hasSession) return '当前任务';
    const baseTitle = state.isBranch
      ? (state.currentGoal || getBranchDisplayName(state.session) || state.mainGoal || state.session?.name)
      : (state.currentGoal || state.mainGoal || state.session?.name);
    return toConciseGoal(baseTitle, isMobileQuestTracker() ? 44 : 64) || '当前任务';
  }

function getPrimaryDetail(state) {
  if (!state?.hasSession) return '';
  const summary = clipTextImpl(getCurrentTaskSummary(state), isMobileQuestTracker() ? 72 : 96);
  if (summary && !isRedundantTrackerText(summary, state.currentGoal, state.mainGoal)) {
    return summary;
  }
    const visualSummary = clipTextImpl(
      String(getTrackerVisualStatus(state)?.summary || ''),
      isMobileQuestTracker() ? 72 : 96,
    );
    if (visualSummary && !isRedundantTrackerText(visualSummary, summary, state.currentGoal, state.mainGoal)) {
      return visualSummary;
    }
    return '';
  }

  function getSecondaryDetail(state, primaryDetail = '') {
    return '';
  }

  function renderDetailList(host, items) {
    if (!host) return;
    ensureRoot(host)?.render(<TrackerDetailList items={items} />);
  }

  function listVisibleCandidateBranches(taskCard, session = null) {
    const sourceSession = session?.id ? session : getCurrentSessionSafe();
    const sessionId = trimText(sourceSession?.id || '');
    return Array.isArray(taskCard?.candidateBranches)
      ? taskCard.candidateBranches
        .filter((entry) => typeof entry === 'string' && trimText(entry))
        .filter((entry) => !sessionId || !isSuppressed(sessionId, entry))
      : [];
  }

  function renderCandidateBranchActions(host, candidateBranches = []) {
    if (!host) return;
    ensureRoot(host)?.render(
      candidateBranches.length > 0 ? (
        <TrackerCandidateBranchActionsContent
          candidateBranches={candidateBranches}
          onEnter={(branchTitle) => enterBranchFromCurrentSession(branchTitle, {
            checkpointSummary: branchTitle,
          })}
        />
      ) : null,
    );
  }

  function renderMemoryCandidateActions(host, memoryCandidates = [], session = null) {
    if (!host) return;
    ensureRoot(host)?.render(
      memoryCandidates.length > 0 ? (
        <TrackerMemoryCandidateActionsContent
          memoryCandidates={memoryCandidates}
          session={session}
          onReview={reviewMemoryCandidate}
        />
      ) : null,
    );
  }

  function renderDetail(taskCard, expanded, session = null, context = {}) {
    if (!trackerDetailEl) return;
    const primaryDetail = clipTextImpl(context?.primaryDetail || '', isMobileQuestTracker() ? 72 : 96);
    const resumePoint = clipTextImpl(
      String(taskCard?.checkpoint || '').trim()
      || (Array.isArray(taskCard?.nextSteps) ? String(taskCard.nextSteps.find((entry) => trimText(entry)) || '').trim() : '')
      || String(taskCard?.goal || '').trim(),
      isMobileQuestTracker() ? 84 : 112,
    );
    const showResumePoint = Boolean(resumePoint)
      && !isRedundantTrackerText(resumePoint, taskCard?.goal, taskCard?.mainGoal);
    const showDistinctResumePoint = showResumePoint
      && !isRedundantTrackerText(resumePoint, primaryDetail);
    if (trackerGoalValEl) trackerGoalValEl.textContent = showDistinctResumePoint ? resumePoint : '';
    if (trackerGoalRowEl) trackerGoalRowEl.hidden = !showDistinctResumePoint;

    const conclusions = Array.isArray(taskCard?.knownConclusions)
      ? taskCard.knownConclusions.filter((entry) => typeof entry === 'string' && trimText(entry))
      : [];
    renderDetailList(trackerConclusionsListEl, conclusions);
    if (trackerConclusionsRowEl) trackerConclusionsRowEl.hidden = conclusions.length === 0;

    renderDetailList(trackerMemoryListEl, []);
    if (trackerMemoryRowEl) trackerMemoryRowEl.hidden = true;

    renderMemoryCandidateActions(trackerMemoryCandidateListEl, [], session);
    if (trackerMemoryCandidateRowEl) trackerMemoryCandidateRowEl.hidden = true;

    renderCandidateBranchActions(trackerCandidateBranchesListEl, []);
    if (trackerCandidateBranchesRowEl) trackerCandidateBranchesRowEl.hidden = true;

    const hasAny = showDistinctResumePoint || conclusions.length > 0;
    if (trackerDetailToggleBtn) {
      trackerDetailToggleBtn.hidden = !hasAny;
      trackerDetailToggleBtn.textContent = expanded ? '详情 ▾' : '详情 ▸';
    }
    trackerDetailEl.hidden = !hasAny || !expanded;
  }

  function renderHandoffActions(session = null, {
    targets = [],
    buildPreview = null,
    onHandoff = null,
  } = {}) {
    const host = getHandoffActionsEl?.();
    if (!host) return;
    const validTargets = Array.isArray(targets)
      ? targets.filter((entry) => trimText(entry?.sessionId || ''))
      : [];
    const hidden = !trimText(session?.id || '') || session?.archived === true || validTargets.length === 0 || typeof onHandoff !== 'function';
    host.hidden = hidden;
    ensureRoot(host)?.render(
      hidden ? null : (
        <TrackerHandoffActionsContent
          sessionId={trimText(session?.id || '')}
          targets={validTargets}
          buildPreview={buildPreview}
          onHandoff={onHandoff}
        />
      )
    );
  }

  function renderPersistentActions(session, {
    onPromote = null,
    onRun = null,
    onToggle = null,
    onConfigure = null,
    onAttachToLongTerm = null,
    onDismissLongTermSuggestion = null,
  } = {}) {
    const host = getPersistentActionsEl?.();
    if (!host) return;
    const buttons = getTrackerPersistentActionButtons(session, {
      onPromote,
      onRun,
      onToggle,
      onConfigure,
      onAttachToLongTerm,
      onDismissLongTermSuggestion,
      isMobile: isMobileQuestTracker(),
    });

    host.hidden = buttons.length === 0;
    ensureRoot(host)?.render(buttons.length ? <TrackerPersistentActionsContent buttons={buttons} /> : null);
  }

  return {
    getPrimaryDetail,
    getPrimaryTitle,
    getSecondaryDetail,
    renderDetail,
    renderHandoffActions,
    renderPersistentActions,
    renderStatus,
  };
}

function TaskListBoardHost({ board = null }) {
  const hostRef = useRef(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = '';
    if (board) {
      host.appendChild(board);
    }
    return () => {
      if (!host || !board) return;
      if (board.parentNode === host && typeof board.remove === 'function') {
        board.remove();
      }
    };
  }, [board]);

  return <div className="quest-task-list-react-host" ref={hostRef} />;
}

function createTaskListController({
  documentRef = document,
  trackerTaskListEl = null,
  taskMapRail = null,
  isMobileQuestTracker = () => false,
  isTaskMapExpanded = () => true,
  syncTaskMapDrawerUi = () => {},
  getTaskMapProjection = () => null,
  taskMapFlowRenderer = null,
} = {}) {
  ensureReactDocumentCompat(documentRef);

  let lastRenderKey = '';
  let currentBoard = null;
  const reactRoot = trackerTaskListEl
    ? createRoot(ensureCompatElement(trackerTaskListEl, documentRef))
    : null;

  const flowRenderer = taskMapFlowRenderer && typeof taskMapFlowRenderer.renderFlowBoard === 'function'
    ? taskMapFlowRenderer
    : {
      renderFlowBoard() {
        const empty = documentRef.createElement('div');
        empty.className = 'task-map-empty';
        empty.textContent = '暂无任务地图。';
        return empty;
      },
    };

  function destroyRenderedBoard() {
    const cleanup = currentBoard?.__melodysyncCleanup;
    if (typeof cleanup === 'function') {
      cleanup();
    }
    currentBoard = null;
  }

  function clearHost() {
    destroyRenderedBoard();
    if (reactRoot) {
      reactRoot.render(null);
      return;
    }
    if (trackerTaskListEl) {
      trackerTaskListEl.innerHTML = '';
    }
  }

  function renderBoard(board = null) {
    if (board && currentBoard === board) {
      return;
    }
    destroyRenderedBoard();
    currentBoard = board;
    if (reactRoot) {
      reactRoot.render(<TaskListBoardHost board={board} />);
      return;
    }
    if (!trackerTaskListEl) return;
    trackerTaskListEl.innerHTML = '';
    if (board) {
      trackerTaskListEl.appendChild(board);
    }
  }

  function invalidate() {
    lastRenderKey = '';
  }

  function renderProjectedTaskList(state, activeQuest) {
    const nodeMap = new Map(
      (Array.isArray(activeQuest?.nodes) ? activeQuest.nodes : [])
        .filter((node) => node?.id)
        .map((node) => [node.id, node]),
    );
    const rootNode = nodeMap.get(`session:${activeQuest?.rootSessionId || ''}`) || null;
    const hasMapNodes = nodeMap.size > 0;
    const desktopTaskMap = !isMobileQuestTracker();
    const shouldMount = Boolean(
      state?.hasSession
      && (desktopTaskMap || hasMapNodes)
    );
    if (taskMapRail) taskMapRail.hidden = !shouldMount;
    trackerTaskListEl?.classList?.toggle?.('is-flow-board', shouldMount);
    syncTaskMapDrawerUi(shouldMount);
    if (!shouldMount) {
      clearHost();
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      invalidate();
      return;
    }
    if (!isMobileQuestTracker() && !isTaskMapExpanded()) {
      clearHost();
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      invalidate();
      return;
    }

    const nodeEntries = Array.isArray(activeQuest?.nodes)
      ? activeQuest.nodes.map((node) => [
        node?.id || '',
        node?.parentNodeId || '',
        node?.status || '',
        node?.kind || '',
        node?.title || '',
      ].join(':'))
      : [];
    const edgeEntries = Array.isArray(activeQuest?.edges)
      ? activeQuest.edges.map((edge) => [
        edge?.id || '',
        edge?.fromNodeId || edge?.from || '',
        edge?.toNodeId || edge?.to || '',
        edge?.type || edge?.variant || '',
      ].join(':'))
      : [];
    const renderKey = [
      state?.session?.id || '',
      activeQuest?.id || '',
      activeQuest?.currentNodeId || '',
      nodeEntries.join('|'),
      edgeEntries.join('|'),
      String(flowRenderer.getRenderStateKey?.() || '').trim(),
    ].join('||');
    if (
      trackerTaskListEl
      && !trackerTaskListEl.hidden
      && currentBoard
      && renderKey === lastRenderKey
    ) {
      return;
    }
    lastRenderKey = renderKey;

    if (!rootNode) {
      const emptyState = documentRef.createElement('div');
      emptyState.className = 'task-map-empty';
      emptyState.textContent = '暂无任务地图。';
      renderBoard(emptyState);
      if (trackerTaskListEl) trackerTaskListEl.hidden = false;
      return;
    }

    renderBoard(flowRenderer.renderFlowBoard({
      activeQuest,
      nodeMap,
      rootNode,
      state,
    }));
    if (trackerTaskListEl) trackerTaskListEl.hidden = !currentBoard;
  }

  function render(state) {
    if (!trackerTaskListEl) return;
    const activeQuest = getTaskMapProjection()?.activeMainQuest || null;
    if (!activeQuest) {
      clearHost();
      trackerTaskListEl.hidden = true;
      invalidate();
      return;
    }
    renderProjectedTaskList(state, activeQuest);
  }

  return {
    invalidate,
    render,
  };
}

function BranchSuggestionItemChildren({
  branchTitle = '',
  branchReason = '',
  onEnter = null,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleEnter() {
    if (isSubmitting || typeof onEnter !== 'function') return;
    setIsSubmitting(true);
    try {
      await onEnter();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="quest-branch-suggestion-main">
        <div className="quest-branch-suggestion-title">{branchTitle}</div>
        {branchReason ? (
          <div className="quest-branch-suggestion-summary">{branchReason}</div>
        ) : null}
      </div>
      <div className="quest-branch-suggestion-actions">
        <button
          type="button"
          className="quest-branch-btn quest-branch-btn-primary"
          disabled={isSubmitting}
          onClick={handleEnter}
        >
          开启
        </button>
      </div>
    </>
  );
}

function MergeNoteCardChildren({
  mergeType = '',
  branchTitle = '',
  content = '',
  nextStep = '',
  clipText: clipTextImpl = clipText,
}) {
  return (
    <>
      <div className="quest-merge-note-label">
        {mergeType === 'conclusion' ? '相关任务结论已同步' : '相关任务线索已同步'}
      </div>
      <div className="quest-merge-note-title">{branchTitle || '关联任务'}</div>
      <div className="quest-merge-note-summary">{clipTextImpl(content, 180)}</div>
      {nextStep ? (
        <div className="quest-merge-note-next">{`下一步：${nextStep}`}</div>
      ) : null}
    </>
  );
}

function BranchEnteredCardChildren({
  branchTitle = '',
  branchFrom = '',
}) {
  return (
    <>
      <div className="quest-merge-note-label">已开启</div>
      <div className="quest-merge-note-title">{branchTitle}</div>
      {branchFrom ? (
        <div className="quest-merge-note-summary">{`关联自：${branchFrom}`}</div>
      ) : null}
    </>
  );
}

function createStatusCardRenderer({
  documentRef = document,
  getCurrentSessionSafe = () => null,
  isSuppressed = () => false,
  enterBranchFromCurrentSession = async () => null,
  clipText: clipTextImpl = clipText,
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(ensureCompatElement(host, documentRef));
    root.render(element);
    host.__melodysyncCleanup = () => {
      root.unmount();
    };
    return host;
  }

  function createBranchSuggestionItem(evt) {
    const session = getCurrentSessionSafe?.();
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

    return mountIntoHost(
      row,
      <BranchSuggestionItemChildren
        branchTitle={evt.branchTitle}
        branchReason={evt.branchReason}
        onEnter={() => enterBranchFromCurrentSession(evt.branchTitle, {
          branchReason: evt.branchReason || '',
        })}
      />,
    );
  }

  function createMergeNoteCard(evt) {
    if (!evt) return null;
    const card = documentRef.createElement('div');
    card.className = 'quest-merge-note';
    return mountIntoHost(
      card,
      <MergeNoteCardChildren
        mergeType={evt.mergeType}
        branchTitle={evt.branchTitle}
        content={evt.broughtBack || evt.content || ''}
        nextStep={evt.nextStep}
        clipText={clipTextImpl}
      />,
    );
  }

  function createBranchEnteredCard(evt) {
    if (!evt?.branchTitle) return null;
    const card = documentRef.createElement('div');
    card.className = 'quest-merge-note quest-branch-entered-note';
    return mountIntoHost(
      card,
      <BranchEnteredCardChildren
        branchTitle={evt.branchTitle}
        branchFrom={evt.branchFrom}
      />,
    );
  }

  return Object.freeze({
    createBranchSuggestionItem,
    createMergeNoteCard,
    createBranchEnteredCard,
  });
}

function PersistentEditorField({
  label = '',
  note = '',
  children = null,
}) {
  return (
    <label className="operation-record-persistent-field">
      <span className="operation-record-persistent-field-label">{label}</span>
      {children}
      {note ? (
        <span className="operation-record-persistent-field-note">{note}</span>
      ) : null}
    </label>
  );
}

function PersistentRuntimeSection({
  title = '',
  mode = '',
  allowedModes = [],
  runtime = null,
  note = '',
  onModeChange = null,
  onPinCurrent = null,
  formatRuntimeSummary = (value) => String(value?.tool || '').trim() || '未固定',
}) {
  const options = [
    { value: 'follow_current', label: '跟随当前服务' },
    { value: 'session_default', label: '使用该会话默认服务' },
    { value: 'pinned', label: '固定为指定服务' },
  ].filter((entry) => allowedModes.includes(entry.value));

  return (
    <div className="operation-record-persistent-section">
      <div className="operation-record-persistent-section-title">{title}</div>
      {note ? (
        <div className="operation-record-persistent-field-note">{note}</div>
      ) : null}
      <PersistentEditorField label="执行服务">
        <select
          className="operation-record-persistent-select"
          value={allowedModes.includes(mode) ? mode : allowedModes[0]}
          onChange={(event) => onModeChange?.(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </PersistentEditorField>
      {mode === 'pinned' ? (
        <div className="operation-record-persistent-runtime-row">
          <div className="operation-record-persistent-runtime-summary">{formatRuntimeSummary(runtime)}</div>
          <button
            type="button"
            className="operation-record-action-btn is-secondary"
            onClick={() => onPinCurrent?.()}
          >
            使用当前服务
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PersistentEditorModal({
  draft = null,
  isLoading = false,
  currentRuntime = null,
  onClose = null,
  onSave = null,
  cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value))),
  formatRuntimeSummary = (value) => String(value?.tool || '').trim() || '未固定',
  normalizeRecurringCadence = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'hourly') return 'hourly';
    if (normalized === 'weekly') return 'weekly';
    return 'daily';
  },
  normalizeTimeOfDay = (value, fallback = '09:00') => {
    const text = String(value || '').trim();
    return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
  },
  normalizeWeekdays = (value) => (Array.isArray(value) ? value : []),
  normalizeDateTimeLocal = (value) => {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? text : '';
  },
}) {
  const [, setVersion] = useState(0);

  function rerender() {
    setVersion((value) => value + 1);
  }

  function getDefaultScheduledRunAtLocal() {
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(0);
    next.setHours(next.getHours() + 1);
    const year = next.getFullYear();
    const month = String(next.getMonth() + 1).padStart(2, '0');
    const day = String(next.getDate()).padStart(2, '0');
    const hour = String(next.getHours()).padStart(2, '0');
    const minute = String(next.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  function pinRuntime(targetKey) {
    if (!draft || !currentRuntime?.tool) return;
    draft[targetKey] = cloneJson(currentRuntime);
    rerender();
  }

  function updateKind(nextKind) {
    if (!draft) return;
    draft.kind = nextKind;
    if (nextKind !== 'skill') {
      if (draft.scheduleMode !== 'pinned' && draft.scheduleMode !== 'session_default') {
        draft.scheduleMode = currentRuntime?.tool ? 'pinned' : 'session_default';
      }
      if (draft.scheduleMode === 'pinned' && !draft.scheduleRuntime?.tool && currentRuntime?.tool) {
        draft.scheduleRuntime = cloneJson(currentRuntime);
      }
    }
    draft.scheduledEnabled = nextKind === 'scheduled_task' ? true : Boolean(draft.scheduledEnabled);
    if (!draft.scheduled || typeof draft.scheduled !== 'object') {
      draft.scheduled = { runAtLocal: '', timezone: '' };
    }
    if (nextKind === 'scheduled_task' && !draft.scheduled?.runAtLocal) {
      draft.scheduled.runAtLocal = getDefaultScheduledRunAtLocal();
    }
    draft.recurringEnabled = nextKind === 'recurring_task' ? true : Boolean(draft.recurringEnabled);
    if (draft.mode !== 'configure') {
      draft.editorStep = 'details';
    }
    rerender();
  }

  function toggleWeekday(day) {
    if (!draft) return;
    const current = new Set(normalizeWeekdays(draft.recurring?.weekdays));
    if (current.has(day)) {
      current.delete(day);
    } else {
      current.add(day);
    }
    draft.recurring.weekdays = Array.from(current).sort((a, b) => a - b);
    rerender();
  }

  const cadence = normalizeRecurringCadence(draft?.recurring?.cadence);
  const editorStep = draft?.editorStep === 'details' ? 'details' : 'pick_kind';
  const dialogTitle = draft?.mode === 'configure' ? '长期项设置' : '沉淀为长期项';
  if (draft?.kind !== 'skill' && (!draft.loop || typeof draft.loop !== 'object')) {
    draft.loop = {
      collect: { sources: [], instruction: '' },
      organize: { instruction: '' },
      use: { instruction: '' },
      prune: { instruction: '' },
    };
  }
  const leadText = draft
    ? (draft.mode === 'configure'
      ? '只保留类型、名称、摘要和提示词。'
      : (editorStep === 'details'
        ? '沉淀后会出现在任务列表顶部的长期区。'
        : '先选择要沉淀成哪种长期能力。'))
    : '正在整理当前会话内容…';
  const kindOptions = [
    {
      kind: 'recurring_task',
      label: '长期任务',
      description: '按循环节奏持续执行，适合巡检、整理和长期维护。',
    },
    {
      kind: 'scheduled_task',
      label: '短期任务',
      description: '在指定时间执行一次，适合到点处理的任务。',
    },
    {
      kind: 'waiting_task',
      label: '等待任务',
      description: '主要等待人类处理，但仍可一键触发梳理上下文。',
    },
    {
      kind: 'skill',
      label: 'AI快捷按钮',
      description: '手动点击后触发，由 AI 执行一段可复用动作。',
    },
  ];

  return (
    <section className="operation-record-persistent-editor persistent-editor-popover" role="group" aria-label={dialogTitle}>
      <div className="operation-record-persistent-editor-header persistent-editor-modal-header">
        <div className="operation-record-persistent-editor-title persistent-editor-modal-title">{dialogTitle}</div>
        <button
          type="button"
          className="modal-close"
          aria-label="关闭"
          onClick={() => onClose?.()}
        >
          ×
        </button>
      </div>
      <div className="operation-record-persistent-editor-lead persistent-editor-modal-lead">{leadText}</div>
      <div className="persistent-editor-modal-body">
        {isLoading || !draft ? (
          <div className="persistent-editor-modal-loading">正在加载…</div>
        ) : (
          draft.mode !== 'configure' && editorStep !== 'details' ? (
            <div className="persistent-editor-kind-grid">
              {kindOptions.map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  className="persistent-editor-kind-card"
                  onClick={() => updateKind(entry.kind)}
                >
                  <span className="persistent-editor-kind-card-title">{entry.label}</span>
                  <span className="persistent-editor-kind-card-description">{entry.description}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="persistent-editor-modal-form">
              <PersistentEditorField label="类型">
                <div className="operation-record-persistent-kind-row persistent-editor-modal-kind-row">
                  {kindOptions.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      className={`operation-record-kind-btn${draft.kind === entry.kind ? ' is-active' : ''}`}
                      onClick={() => updateKind(entry.kind)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </PersistentEditorField>

              <PersistentEditorField label="名称">
                <input
                  type="text"
                  className="operation-record-persistent-input"
                  defaultValue={draft.digestTitle}
                  placeholder="给这个长期项起个名字"
                  onInput={(event) => {
                    draft.digestTitle = event.currentTarget.value;
                  }}
                />
              </PersistentEditorField>

              <PersistentEditorField label="摘要">
                <textarea
                  className="operation-record-persistent-textarea"
                  rows={3}
                  defaultValue={draft.digestSummary}
                  placeholder="保留这次会话沉淀下来的核心摘要"
                  onInput={(event) => {
                    draft.digestSummary = event.currentTarget.value;
                  }}
                />
              </PersistentEditorField>

              <PersistentEditorField label={draft.kind === 'skill' ? '触发动作' : '执行动作'}>
                <textarea
                  className="operation-record-persistent-textarea"
                  rows={4}
                  defaultValue={draft.runPrompt}
                  placeholder={draft.kind === 'skill' ? '点击后默认交给 AI 执行什么' : '执行时默认要做什么'}
                  onInput={(event) => {
                    draft.runPrompt = event.currentTarget.value;
                  }}
                />
              </PersistentEditorField>

              <PersistentEditorField
                label="执行方式"
                note="创建支线时，本轮执行会进入新的任务分支，原任务只保留调度状态。"
              >
                <select
                  className="operation-record-persistent-select"
                  value={draft.executionMode === 'spawn_session' ? 'spawn_session' : 'in_place'}
                  onChange={(event) => {
                    draft.executionMode = event.currentTarget.value === 'spawn_session' ? 'spawn_session' : 'in_place';
                    rerender();
                  }}
                >
                  <option value="in_place">当前会话执行</option>
                  <option value="spawn_session">创建支线执行</option>
                </select>
              </PersistentEditorField>

              {draft.kind !== 'skill' ? (
                <>
                  <PersistentEditorField
                    label="知识库路径"
                    note="默认指向这条任务所属的本地文件路径。"
                  >
                    <input
                      type="text"
                      className="operation-record-persistent-input"
                      defaultValue={String(draft.knowledgeBasePath || '')}
                      placeholder="知识库对应的底层文件路径"
                      onInput={(event) => {
                        draft.knowledgeBasePath = event.currentTarget.value;
                      }}
                    />
                  </PersistentEditorField>

                  <PersistentEditorField
                    label="定时触发"
                    note="在指定时间自动执行一次。"
                  >
                    <div className="operation-record-persistent-kind-row persistent-editor-modal-kind-row">
                      <button
                        type="button"
                        className={`operation-record-kind-btn${draft.scheduledEnabled === true ? ' is-active' : ''}`}
                        onClick={() => {
                          draft.scheduledEnabled = draft.scheduledEnabled !== true;
                          rerender();
                        }}
                      >
                        {draft.scheduledEnabled === true ? '已开启' : '未开启'}
                      </button>
                    </div>
                  </PersistentEditorField>

                  {draft.scheduledEnabled === true ? (
                    <PersistentEditorField label="定时时间">
                      <input
                        type="datetime-local"
                        className="operation-record-persistent-input"
                        value={normalizeDateTimeLocal(draft.scheduled?.runAtLocal || '')}
                        onChange={(event) => {
                          draft.scheduled.runAtLocal = normalizeDateTimeLocal(event.currentTarget.value);
                          rerender();
                        }}
                      />
                    </PersistentEditorField>
                  ) : null}

                  <PersistentEditorField
                    label="循环触发"
                    note="按固定周期反复执行。"
                  >
                    <div className="operation-record-persistent-kind-row persistent-editor-modal-kind-row">
                      <button
                        type="button"
                        className={`operation-record-kind-btn${draft.recurringEnabled === true ? ' is-active' : ''}`}
                        onClick={() => {
                          draft.recurringEnabled = draft.recurringEnabled !== true;
                          rerender();
                        }}
                      >
                        {draft.recurringEnabled === true ? '已开启' : '未开启'}
                      </button>
                    </div>
                  </PersistentEditorField>

                  {draft.recurringEnabled === true ? (
                    <>
                      <PersistentEditorField label="触发周期">
                        <select
                          className="operation-record-persistent-select"
                          value={cadence}
                          onChange={(event) => {
                            draft.recurring.cadence = event.target.value;
                            rerender();
                          }}
                        >
                          <option value="hourly">每小时</option>
                          <option value="daily">每天</option>
                          <option value="weekly">每周</option>
                        </select>
                      </PersistentEditorField>

                      <PersistentEditorField label={cadence === 'hourly' ? '触发分钟' : '触发时间'}>
                        <input
                          type="time"
                          className="operation-record-persistent-input"
                          defaultValue={normalizeTimeOfDay(draft.recurring?.timeOfDay)}
                          onInput={(event) => {
                            draft.recurring.timeOfDay = normalizeTimeOfDay(event.currentTarget.value);
                          }}
                        />
                      </PersistentEditorField>

                      {cadence === 'weekly' ? (
                        <PersistentEditorField label="每周日期">
                          <div className="operation-record-weekday-row">
                            {['日', '一', '二', '三', '四', '五', '六'].map((label, day) => {
                              const active = normalizeWeekdays(draft.recurring?.weekdays).includes(day);
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  className={`operation-record-weekday-btn${active ? ' is-active' : ''}`}
                                  onClick={() => toggleWeekday(day)}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </PersistentEditorField>
                      ) : null}
                    </>
                  ) : null}

                  <div className="operation-record-persistent-section">
                    <div className="operation-record-persistent-section-title">长期闭环</div>
                    <div className="operation-record-persistent-field-note">
                      每个 GTD 任务都可以维护一圈：收集、整理、使用，以及复盘后的冗余减枝。
                    </div>
                    <PersistentEditorField
                      label="数据收集"
                      note="先定义长期任务持续看哪些输入信号。"
                    >
                      <textarea
                        className="operation-record-persistent-textarea"
                        rows={3}
                        defaultValue={Array.isArray(draft.loop?.collect?.sources) ? draft.loop.collect.sources.join('\n') : ''}
                        placeholder="每行一个数据来源，例如：运行日志、用户反馈、任务完成记录"
                        onInput={(event) => {
                          draft.loop.collect.sources = String(event.currentTarget.value || '')
                            .split(/\n+/)
                            .map((entry) => String(entry || '').trim())
                            .filter(Boolean);
                        }}
                      />
                    </PersistentEditorField>

                    <PersistentEditorField label="收集要求">
                      <textarea
                        className="operation-record-persistent-textarea"
                        rows={2}
                        defaultValue={draft.loop?.collect?.instruction || ''}
                        placeholder="采集时要特别关注什么"
                        onInput={(event) => {
                          draft.loop.collect.instruction = event.currentTarget.value;
                        }}
                      />
                    </PersistentEditorField>

                    <PersistentEditorField label="数据整理">
                      <textarea
                        className="operation-record-persistent-textarea"
                        rows={2}
                        defaultValue={draft.loop?.organize?.instruction || ''}
                        placeholder="如何把原始数据整理成可用信息"
                        onInput={(event) => {
                          draft.loop.organize.instruction = event.currentTarget.value;
                        }}
                      />
                    </PersistentEditorField>

                    <PersistentEditorField label="数据使用">
                      <textarea
                        className="operation-record-persistent-textarea"
                        rows={2}
                        defaultValue={draft.loop?.use?.instruction || ''}
                        placeholder="整理后的数据要拿来驱动什么动作或判断"
                        onInput={(event) => {
                          draft.loop.use.instruction = event.currentTarget.value;
                        }}
                      />
                    </PersistentEditorField>

                    <PersistentEditorField label="冗余减枝">
                      <textarea
                        className="operation-record-persistent-textarea"
                        rows={2}
                        defaultValue={draft.loop?.prune?.instruction || ''}
                        placeholder="复盘后哪些重复、低信号、过期内容要被剪掉"
                        onInput={(event) => {
                          draft.loop.prune.instruction = event.currentTarget.value;
                        }}
                      />
                    </PersistentEditorField>
                  </div>
                </>
              ) : null}

              <PersistentRuntimeSection
                title="手动触发"
                mode={draft.manualMode}
                allowedModes={['follow_current', 'session_default', 'pinned']}
                runtime={draft.manualRuntime}
                onModeChange={(value) => {
                  draft.manualMode = value;
                  if (value === 'pinned' && !draft.manualRuntime?.tool && currentRuntime?.tool) {
                    draft.manualRuntime = cloneJson(currentRuntime);
                  }
                  rerender();
                }}
                onPinCurrent={() => pinRuntime('manualRuntime')}
                formatRuntimeSummary={formatRuntimeSummary}
              />

              {draft.kind !== 'skill' ? (
                <PersistentRuntimeSection
                  title="自动触发"
                  mode={draft.scheduleMode}
                  allowedModes={['session_default', 'pinned']}
                  runtime={draft.scheduleRuntime}
                  onModeChange={(value) => {
                    draft.scheduleMode = value;
                    if (value === 'pinned' && !draft.scheduleRuntime?.tool && currentRuntime?.tool) {
                      draft.scheduleRuntime = cloneJson(currentRuntime);
                    }
                    rerender();
                  }}
                  onPinCurrent={() => pinRuntime('scheduleRuntime')}
                  formatRuntimeSummary={formatRuntimeSummary}
                />
              ) : null}
            </div>
          )
        )}
      </div>
      <div className="operation-record-persistent-editor-footer persistent-editor-modal-footer">
        {!isLoading && draft ? (
          <>
            <button type="button" className="modal-btn" onClick={() => onClose?.()}>
              取消
            </button>
            {draft.mode !== 'configure' && editorStep === 'details' ? (
              <button
                type="button"
                className="modal-btn"
                onClick={() => {
                  draft.editorStep = 'pick_kind';
                  rerender();
                }}
              >
                返回
              </button>
            ) : null}
            {draft.mode === 'configure' || editorStep === 'details' ? (
              <button type="button" className="modal-btn primary" onClick={() => onSave?.()}>
                {draft.mode === 'configure' ? '保存' : '保存为长期项'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function createPersistentEditorRenderer({
  documentRef = document,
  cloneJson = (value) => (value == null ? value : JSON.parse(JSON.stringify(value))),
  formatRuntimeSummary = (value) => String(value?.tool || '').trim() || '未固定',
  normalizeRecurringCadence = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'hourly') return 'hourly';
    if (normalized === 'weekly') return 'weekly';
    return 'daily';
  },
  normalizeTimeOfDay = (value, fallback = '09:00') => {
    const text = String(value || '').trim();
    return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
  },
  normalizeWeekdays = (value) => (Array.isArray(value) ? value : []),
  normalizeDateTimeLocal = (value) => {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? text : '';
  },
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
    ensureCompatElement(host, documentRef);
    if (host.__melodysyncReactRoot) return host.__melodysyncReactRoot;
    host.__melodysyncReactRoot = createRoot(host);
    return host.__melodysyncReactRoot;
  }

  function clearPersistentEditorModal(host) {
    if (!host) return;
    host.hidden = true;
    ensureRoot(host)?.render(null);
  }

  function renderPersistentEditorModal(host, props = {}) {
    if (!host) return;
    host.hidden = false;
    ensureRoot(host)?.render(
      <PersistentEditorModal
        key={`${props?.draft?.sessionId || 'loading'}:${props?.draft?.mode || ''}:${props?.draft?.kind || ''}:${props?.isLoading ? 'loading' : 'ready'}`}
        draft={props?.draft || null}
        isLoading={props?.isLoading === true}
        currentRuntime={props?.currentRuntime || null}
        onClose={props?.onClose || null}
        onSave={props?.onSave || null}
        cloneJson={cloneJson}
        formatRuntimeSummary={formatRuntimeSummary}
        normalizeRecurringCadence={normalizeRecurringCadence}
        normalizeTimeOfDay={normalizeTimeOfDay}
        normalizeWeekdays={normalizeWeekdays}
        normalizeDateTimeLocal={normalizeDateTimeLocal}
      />,
    );
  }

  return Object.freeze({
    clearPersistentEditorModal,
    renderPersistentEditorModal,
  });
}

function OperationRecordHeaderChildren({
  data = {},
  clipText: clipTextImpl = clipText,
  onPromote = null,
  onRun = null,
  onToggle = null,
  onConfigure = null,
}) {
  const kind = String(data?.persistent?.kind || '').trim().toLowerCase();
  const state = String(data?.persistent?.state || '').trim().toLowerCase();
  const buttons = [];

  if (kind === 'recurring_task') {
    buttons.push({ label: '立即执行', secondary: false, onClick: onRun });
    buttons.push({ label: state === 'paused' ? '恢复周期' : '暂停周期', secondary: true, onClick: onToggle });
    buttons.push({ label: '设置', secondary: true, onClick: onConfigure });
  } else if (kind === 'scheduled_task') {
    buttons.push({ label: '立即执行', secondary: false, onClick: onRun });
    buttons.push({ label: state === 'paused' ? '恢复定时' : '暂停定时', secondary: true, onClick: onToggle });
    buttons.push({ label: '设置', secondary: true, onClick: onConfigure });
  } else if (kind === 'waiting_task') {
    buttons.push({ label: '立即执行', secondary: false, onClick: onRun });
    buttons.push({ label: '设置', secondary: true, onClick: onConfigure });
  } else if (kind === 'skill') {
    buttons.push({ label: '触发AI快捷按钮', secondary: false, onClick: onRun });
    buttons.push({ label: '设置', secondary: true, onClick: onConfigure });
  } else {
    buttons.push({ label: '沉淀为长期项', secondary: false, onClick: onPromote });
  }

  return (
    <>
      <span className="operation-record-session-title">{clipTextImpl(data?.name || '当前任务', 40)}</span>
      {buttons.length > 0 ? (
        <div className="operation-record-actions">
          {buttons.map((button, index) => (
            <button
              key={`${button.label}-${index}`}
              type="button"
              className={`operation-record-action-btn${button.secondary ? ' is-secondary' : ''}`}
              onClick={() => button.onClick?.()}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function OperationRecordDigestCardChildren({
  data = {},
  clipText: clipTextImpl = clipText,
}) {
  const persistent = data?.persistent || null;
  const digest = persistent?.digest || data?.persistentPreview || null;
  if (!digest) return null;
  const digestTitle = clipTextImpl(digest.title || data?.name || '', 72);
  const summary = clipTextImpl(digest.summary || '', 180);
  const keyPoints = Array.isArray(digest.keyPoints) ? digest.keyPoints.filter(Boolean).slice(0, 3) : [];
  const loop = persistent?.loop || null;
  const loopLabels = [
    ((loop?.collect?.sources || []).length > 0 || loop?.collect?.instruction) ? '收集' : '',
    loop?.organize?.instruction ? '整理' : '',
    loop?.use?.instruction ? '使用' : '',
    loop?.prune?.instruction ? '减枝' : '',
  ].filter(Boolean);
  if (!digestTitle && !summary && keyPoints.length === 0 && loopLabels.length === 0) return null;

  return (
    <>
      <div className="operation-record-persistent-summary">{persistent ? '长期摘要' : '系统摘要预览'}</div>
      {digestTitle ? (
        <div className="operation-record-persistent-list">{`名称：${digestTitle}`}</div>
      ) : null}
      {summary ? (
        <div className="operation-record-persistent-summary">{summary}</div>
      ) : null}
      {keyPoints.length > 0 ? (
        <div className="operation-record-persistent-list">{`核心记录：${keyPoints.join(' · ')}`}</div>
      ) : null}
      {loopLabels.length > 0 ? (
        <div className="operation-record-persistent-list">{`闭环：${loopLabels.join(' · ')}`}</div>
      ) : null}
    </>
  );
}

function createOperationRecordSummaryRenderer({
  documentRef = document,
  clipText: clipTextImpl = clipText,
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(ensureCompatElement(host, documentRef));
    root.render(element);
    host.__melodysyncCleanup = () => {
      root.unmount();
    };
    return host;
  }

  function buildPersistentHeader(data = {}, handlers = {}) {
    const host = documentRef.createElement('div');
    host.className = 'operation-record-session-header';
    return mountIntoHost(
      host,
      <OperationRecordHeaderChildren
        data={data}
        clipText={clipTextImpl}
        onPromote={handlers?.onPromote || null}
        onRun={handlers?.onRun || null}
        onToggle={handlers?.onToggle || null}
        onConfigure={handlers?.onConfigure || null}
      />,
    );
  }

  function buildPersistentDigestCard(data = {}) {
    const persistent = data?.persistent || null;
    const digest = persistent?.digest || data?.persistentPreview || null;
    if (!digest) return null;
    const host = documentRef.createElement('div');
    host.className = 'operation-record-persistent-card';
    return mountIntoHost(
      host,
      <OperationRecordDigestCardChildren
        data={data}
        clipText={clipTextImpl}
      />,
    );
  }

  return Object.freeze({
    buildPersistentHeader,
    buildPersistentDigestCard,
  });
}

function OperationRecordCommitItem({
  commit = {},
  targetSessionId = '',
  currentSessionId = '',
  formatTrackerTime = () => '',
  attachSession = null,
  getFocusedSessionId = () => '',
  documentRef = document,
  windowRef = window,
}) {
  function openCommit() {
    attachSession?.(targetSessionId, null);
    const doScroll = () => {
      const msgEl = documentRef.querySelector?.(`.msg-user[data-source-seq="${commit.seq}"]`);
      if (msgEl) msgEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    if (targetSessionId === getFocusedSessionId?.()) {
      doScroll();
      return;
    }
    const schedule = windowRef?.setTimeout || globalThis.setTimeout;
    schedule?.(doScroll, 400);
  }

  return (
    <div
      className={`operation-record-commit${targetSessionId === currentSessionId ? ' is-current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={openCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openCommit();
        }
      }}
    >
      <span className="operation-record-commit-seq">{formatTrackerTime(commit.timestamp) || `#${commit.seq}`}</span>
      <span className="operation-record-commit-preview">{commit.preview || '(message)'}</span>
    </div>
  );
}

function OperationRecordBranchCard({
  item = {},
  currentSessionId = '',
  expanded = new Map(),
  refresh = () => {},
  formatTrackerTime = () => '',
  attachSession = null,
  getFocusedSessionId = () => '',
  documentRef = document,
  windowRef = window,
}) {
  const isExpanded = expanded.get(item.branchSessionId) === true;
  const isActive = item.branchSessionId === currentSessionId;
  const isMerged = item.status === 'merged';

  const branchLabel = item?.branchSessionId === currentSessionId
    ? '当前'
    : (item?.status === 'merged'
      ? '已收束'
      : (item?.status === 'parked'
        ? '已挂起'
        : (item?.status === 'resolved' ? '已完成' : '任务')));

  return (
    <div
      className={`operation-record-branch-card${isExpanded ? ' is-expanded' : ''}${isActive ? ' is-current' : ''}${isMerged ? ' is-merged' : ''}`}
    >
      <div
        className="operation-record-branch-card-header"
        role="button"
        tabIndex={0}
        onClick={() => {
          expanded.set(item.branchSessionId, !isExpanded);
          refresh();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            expanded.set(item.branchSessionId, !isExpanded);
            refresh();
          }
        }}
      >
        <span className="operation-record-branch-arrow">{isExpanded ? '▾' : '▸'}</span>
        <span className="operation-record-branch-label">{branchLabel}</span>
        <span
          className="operation-record-branch-name"
          onClick={(event) => {
            event.stopPropagation();
            attachSession?.(item.branchSessionId, null);
          }}
        >
          {clipText(item.name, 36)}
        </span>
      </div>

      {item.broughtBack ? (
        <div className={`operation-record-branch-summary${isMerged ? ' is-merged' : ''}`}>{item.broughtBack}</div>
      ) : null}

      <div className="operation-record-branch-commits" hidden={!isExpanded}>
        {Array.isArray(item.commits) && item.commits.length > 0 ? (
          item.commits.map((commit) => (
            <OperationRecordCommitItem
              key={`${item.branchSessionId}:${commit.seq}:${commit.timestamp || ''}`}
              commit={commit}
              targetSessionId={item.branchSessionId}
              currentSessionId={currentSessionId}
              formatTrackerTime={formatTrackerTime}
              attachSession={attachSession}
              getFocusedSessionId={getFocusedSessionId}
              documentRef={documentRef}
              windowRef={windowRef}
            />
          ))
        ) : (
          <div className="operation-record-empty">暂无消息</div>
        )}
      </div>

      {Array.isArray(item.subBranches) && item.subBranches.length > 0 ? (
        <div className="operation-record-children">
          {item.subBranches.map((subBranch) => (
            <OperationRecordBranchCard
              key={subBranch.branchSessionId}
              item={subBranch}
              currentSessionId={currentSessionId}
              expanded={expanded}
              refresh={refresh}
              formatTrackerTime={formatTrackerTime}
              attachSession={attachSession}
              getFocusedSessionId={getFocusedSessionId}
              documentRef={documentRef}
              windowRef={windowRef}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OperationRecordItemsList({
  items = [],
  currentSessionId = '',
  expanded = new Map(),
  formatTrackerTime = () => '',
  attachSession = null,
  getFocusedSessionId = () => '',
  documentRef = document,
  windowRef = window,
}) {
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((value) => value + 1);

  return (
    <>
      {items.map((item, index) => {
        if (item?.type === 'commit') {
          return (
            <OperationRecordCommitItem
              key={`commit:${index}:${item.seq}:${item.timestamp || ''}`}
              commit={item}
              targetSessionId={item.sessionId || currentSessionId}
              currentSessionId={currentSessionId}
              formatTrackerTime={formatTrackerTime}
              attachSession={attachSession}
              getFocusedSessionId={getFocusedSessionId}
              documentRef={documentRef}
              windowRef={windowRef}
            />
          );
        }
        if (item?.type === 'branch') {
          return (
            <OperationRecordBranchCard
              key={`branch:${item.branchSessionId || index}`}
              item={item}
              currentSessionId={currentSessionId}
              expanded={expanded}
              refresh={refresh}
              formatTrackerTime={formatTrackerTime}
              attachSession={attachSession}
              getFocusedSessionId={getFocusedSessionId}
              documentRef={documentRef}
              windowRef={windowRef}
            />
          );
        }
        return null;
      })}
    </>
  );
}

function createOperationRecordListRenderer({
  documentRef = document,
  windowRef = window,
  formatTrackerTime = () => '',
  attachSession = null,
  getFocusedSessionId = () => '',
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(ensureCompatElement(host, documentRef));
    root.render(element);
    host.__melodysyncCleanup = () => {
      root.unmount();
    };
    return host;
  }

  function buildItemsList({ items = [], currentSessionId = '', expanded = new Map() } = {}) {
    const host = documentRef.createElement('div');
    host.className = 'operation-record-items';
    return mountIntoHost(
      host,
      <OperationRecordItemsList
        items={Array.isArray(items) ? items : []}
        currentSessionId={currentSessionId}
        expanded={expanded}
        formatTrackerTime={formatTrackerTime}
        attachSession={attachSession}
        getFocusedSessionId={getFocusedSessionId}
        documentRef={documentRef}
        windowRef={windowRef}
      />,
    );
  }

  return Object.freeze({
    buildItemsList,
  });
}

function SessionListItemMount({
  createSessionItem = null,
  session = null,
  archived = false,
  renderKey = '',
}) {
  const hostRef = useRef(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.innerHTML = '';
    const node = typeof createSessionItem === 'function'
      ? createSessionItem(session, archived ? { archived: true } : {})
      : null;
    if (node) host.appendChild(node);
    return () => {
      if (!node || node.parentNode !== host) return;
      if (typeof node.remove === 'function') {
        node.remove();
        return;
      }
      host.removeChild(node);
    };
  }, [archived, createSessionItem, renderKey, session]);

  return <div className="melodysync-session-list-slot" style={{ display: 'contents' }} ref={hostRef} />;
}

function SessionListChevron({ className = '', iconHtml = '' }) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: String(iconHtml || '') }}
    />
  );
}

function SessionListPinnedSection({
  pinnedSessions = [],
  pinnedLabel = '',
  createSessionItem = null,
  getSessionRenderKey = null,
}) {
  if (!Array.isArray(pinnedSessions) || pinnedSessions.length === 0) return null;
  return (
    <div className="pinned-section">
      <div className="pinned-section-header">
        <span className="pinned-label">{pinnedLabel}</span>
        <span className="folder-count">{pinnedSessions.length}</span>
      </div>
      <div className="pinned-items">
        {pinnedSessions.map((session) => (
          <SessionListItemMount
            key={`pinned:${session?.id || Math.random()}`}
            createSessionItem={createSessionItem}
            session={session}
            renderKey={typeof getSessionRenderKey === 'function' ? getSessionRenderKey(session) : ''}
          />
        ))}
      </div>
    </div>
  );
}

function SessionListBucketSection({
  groupKey = '',
  bucketEntry = null,
  isCollapsed = false,
  onToggleGroup = null,
  createSessionItem = null,
  getSessionRenderKey = null,
  chevronIconHtml = '',
}) {
  const bucketKey = `${groupKey}:${bucketEntry?.key || ''}`;
  const bucketSessions = Array.isArray(bucketEntry?.sessions) ? bucketEntry.sessions : [];
  if (bucketSessions.length === 0) return null;
  const isSkillBucket = bucketEntry?.key === 'skill';
  const toggleBucket = () => onToggleGroup?.(bucketKey, !isCollapsed);
  return (
    <div className={`folder-group folder-group-bucket${isSkillBucket ? ' folder-group-bucket-skill' : ''}`}>
      <div
        className={`folder-group-header folder-group-bucket-header${isCollapsed ? ' collapsed' : ''}${isSkillBucket ? ' folder-group-bucket-skill-header' : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={isCollapsed ? 'false' : 'true'}
        onClick={toggleBucket}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleBucket();
        }}
      >
        {isSkillBucket
          ? <span className="folder-bucket-skill-icon">⚡</span>
          : <SessionListChevron className="folder-chevron" iconHtml={chevronIconHtml} />
        }
        <span className="folder-name">{String(bucketEntry?.label || '')}</span>
        <span className="folder-count">{bucketSessions.length}</span>
      </div>
      <div className="folder-group-items folder-group-bucket-items" hidden={isCollapsed}>
        {bucketSessions.map((session) => (
          <SessionListItemMount
            key={`bucket:${bucketKey}:${session?.id || Math.random()}`}
            createSessionItem={createSessionItem}
            session={session}
            renderKey={typeof getSessionRenderKey === 'function' ? getSessionRenderKey(session) : ''}
          />
        ))}
      </div>
    </div>
  );
}

function SessionListProjectPanel({ projectSession = null }) {
  if (!projectSession) return null;
  const persistent = projectSession?.persistent || null;
  const title = String(persistent?.digest?.title || projectSession?.name || '').trim();
  const summary = String(persistent?.digest?.summary || projectSession?.description || '').trim();
  const isPaused = String(persistent?.state || '').trim().toLowerCase() === 'paused';
  const kind = String(persistent?.kind || '').trim().toLowerCase();
  const cadence = persistent?.recurring?.cadence || '';
  const timeOfDay = persistent?.recurring?.timeOfDay || '';

  let scheduleLabel = '';
  if (kind === 'recurring_task' && cadence) {
    const cadenceMap = { daily: '每天', weekly: '每周', hourly: '每小时' };
    scheduleLabel = cadenceMap[cadence] || cadence;
    if (timeOfDay) scheduleLabel += ` ${timeOfDay}`;
  } else if (kind === 'scheduled_task') {
    scheduleLabel = '一次性定时';
  } else if (kind === 'waiting_task') {
    scheduleLabel = '等待触发';
  }

  // Don't render if there's nothing meaningful to show
  if (!summary && !scheduleLabel) return null;

  return (
    <div className="lt-project-panel">
      {summary ? <div className="lt-project-panel-summary">{summary}</div> : null}
      <div className="lt-project-panel-chips">
        <span className={`lt-project-panel-chip lt-project-panel-chip-status${isPaused ? ' is-paused' : ' is-active'}`}>
          {isPaused ? '已暂停' : '维护中'}
        </span>
        {scheduleLabel ? (
          <span className="lt-project-panel-chip">{scheduleLabel}</span>
        ) : null}
      </div>
    </div>
  );
}

function SessionListGroupSection({
  groupEntry = null,
  showGroupHeaders = false,
  isCollapsed = false,
  onToggleGroup = null,
  onRemoveGroup = null,
  createSessionItem = null,
  getSessionRenderKey = null,
  chevronIconHtml = '',
  deleteIconHtml = '',
  deleteFolderLabel = '删除文件夹',
  isGroupCollapsed = () => false,
}) {
  const sessions = Array.isArray(groupEntry?.sessions) ? groupEntry.sessions : [];
  const isLongTermProject = groupEntry?.type === 'long-term-project';

  const toggleGroup = () => {
    if (isLongTermProject) {
      const willCollapse = !isCollapsed;
      onToggleGroup?.(groupEntry?.key || '', willCollapse);
      if (willCollapse && typeof window.hideLongTermProjectPanel === 'function') {
        window.hideLongTermProjectPanel();
      }
    } else {
      onToggleGroup?.(groupEntry?.key || '', !isCollapsed);
    }
  };

  const openProjectPanel = (event) => {
    event.stopPropagation();
    if (!isCollapsed) {
      onToggleGroup?.(groupEntry?.key || '', false);
    }
    if (typeof window.showLongTermProjectPanel === 'function') {
      window.showLongTermProjectPanel(groupEntry?.projectId || '');
    }
  };

  // For long-term projects: count only member sessions (not the project root itself)
  const memberCount = isLongTermProject
    ? Object.values(groupEntry?.buckets || {}).reduce((sum, b) => sum + (Array.isArray(b?.sessions) ? b.sessions.length : 0), 0)
    : sessions.length;

  // For long-term projects, extract summary and schedule from projectSession
  let projectSummary = '';
  let projectSchedule = '';
  if (isLongTermProject && groupEntry?.projectSession) {
    const ps = groupEntry.projectSession;
    const persistent = ps?.persistent || null;
    projectSummary = String(persistent?.digest?.summary || ps?.description || '').trim();
    const kind = String(persistent?.kind || '').trim().toLowerCase();
    const cadence = persistent?.recurring?.cadence || '';
    const timeOfDay = persistent?.recurring?.timeOfDay || '';
    if (kind === 'recurring_task' && cadence) {
      const cadenceMap = { daily: '每天', weekly: '每周', hourly: '每小时' };
      projectSchedule = cadenceMap[cadence] || cadence;
      if (timeOfDay) projectSchedule += ` ${timeOfDay}`;
    } else if (kind === 'scheduled_task') {
      projectSchedule = '一次性定时';
    } else if (kind === 'waiting_task') {
      projectSchedule = '等待触发';
    }
  }

  return (
    <div className={`folder-group${showGroupHeaders ? '' : ' is-ungrouped'}${isLongTermProject ? ' is-long-term-project-group' : ''}`}>
      {showGroupHeaders ? (
        isLongTermProject ? (
          // Long-term project: single card wrapping title + content
          <div className={`lt-project-card${isCollapsed ? ' collapsed' : ''}`}>
            {/* Title row: chevron + name + count — click to collapse/expand */}
            <div
              className="lt-project-card-top"
              role="button"
              tabIndex={0}
              aria-expanded={isCollapsed ? 'false' : 'true'}
              onClick={toggleGroup}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleGroup();
              }}
            >
              <SessionListChevron className="lt-project-card-chevron" iconHtml={chevronIconHtml} />
              <span className="lt-project-card-title" title={String(groupEntry?.title || '')}>{String(groupEntry?.label || '')}</span>
              <span className="lt-project-card-count">{memberCount}</span>
            </div>
            {/* Collapsible content: panel entry + task buckets */}
            <div className="lt-project-card-content" hidden={isCollapsed}>
              {/* Panel entry row — same visual weight as a bucket, click to open panel */}
              <div
                className="lt-project-card-body"
                role="button"
                tabIndex={0}
                title="打开控制面板"
                onClick={openProjectPanel}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  openProjectPanel(event);
                }}
              >
                <div className="lt-project-card-body-text">
                  {projectSummary
                    ? <div className="lt-project-card-desc">{projectSummary}</div>
                    : <div className="lt-project-card-panel-hint">控制面板</div>}
                </div>
                <span className="lt-project-card-panel-icon" aria-hidden="true">›</span>
              </div>
              {/* Bucket sub-folders */}
              {Object.values(groupEntry?.buckets || {})
                .sort((a, b) => (a?.order ?? 99) - (b?.order ?? 99))
                .map((bucketEntry) => (
                  <SessionListBucketSection
                    key={`bucket-section:${groupEntry?.key}:${bucketEntry?.key}`}
                    groupKey={groupEntry?.key || ''}
                    bucketEntry={bucketEntry}
                    isCollapsed={isGroupCollapsed(`${groupEntry?.key}:${bucketEntry?.key}`) === true}
                    onToggleGroup={onToggleGroup}
                    createSessionItem={createSessionItem}
                    getSessionRenderKey={getSessionRenderKey}
                    chevronIconHtml={chevronIconHtml}
                  />
                ))
              }
            </div>
          </div>
        ) : (
          <>
            <div
              className={`folder-group-header${isCollapsed ? ' collapsed' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={isCollapsed ? 'false' : 'true'}
              onClick={toggleGroup}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleGroup();
              }}
            >
              <SessionListChevron className="folder-chevron" iconHtml={chevronIconHtml} />
              <span className="folder-name" title={String(groupEntry?.title || '')}>{String(groupEntry?.label || '')}</span>
              <span className="folder-count">{memberCount}</span>
              {groupEntry?.canDelete ? (
                <button
                  type="button"
                  className="folder-group-delete"
                  title={deleteFolderLabel}
                  aria-label={deleteFolderLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveGroup?.(groupEntry?.label || '');
                  }}
                >
                  <span dangerouslySetInnerHTML={{ __html: String(deleteIconHtml || '') }} />
                </button>
              ) : null}
            </div>
            <div className="folder-group-items" hidden={isCollapsed}>
              {sessions.map((session) => (
                <SessionListItemMount
                  key={`group:${groupEntry?.key || 'ungrouped'}:${session?.id || Math.random()}`}
                  createSessionItem={createSessionItem}
                  session={session}
                  renderKey={typeof getSessionRenderKey === 'function' ? getSessionRenderKey(session) : ''}
                />
              ))}
            </div>
          </>
        )
      ) : (
        <div className="folder-group-items">
          {sessions.map((session) => (
            <SessionListItemMount
              key={`group:${groupEntry?.key || 'ungrouped'}:${session?.id || Math.random()}`}
              createSessionItem={createSessionItem}
              session={session}
              renderKey={typeof getSessionRenderKey === 'function' ? getSessionRenderKey(session) : ''}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionListCreateFolderSection({
  showCreateFolder = false,
  createFolderLabel = '新建文件夹',
  createFolderPlaceholder = '输入文件夹名称',
  createFolderHint = 'Enter 保存，Esc 取消',
  saveFailedLabel = '文件夹保存失败。',
  isCreatingFolder = false,
  onOpenCreate = null,
  onCloseCreate = null,
  onCreateFolder = null,
  translate = (key) => key,
}) {
  const inputRef = useRef(null);
  const [draftValue, setDraftValue] = useState('');
  const [note, setNote] = useState(createFolderHint);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    if (!isCreatingFolder) {
      setDraftValue('');
      setNote(createFolderHint);
      setSaving(false);
      return;
    }
    setNote(createFolderHint);
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    });
    return () => cancelAnimationFrame(frameId);
  }, [createFolderHint, isCreatingFolder]);

  if (!showCreateFolder) return null;

  async function commitCreate() {
    if (saving) return;
    setSaving(true);
    const result = await onCreateFolder?.(draftValue);
    if (result?.ok) {
      setDraftValue('');
      setNote(createFolderHint);
      setSaving(false);
      return;
    }
    setSaving(false);
    setNote(result?.reason || saveFailedLabel);
    requestAnimationFrame(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    });
  }

  return (
    <div className="session-grouping-create-section">
      {isCreatingFolder ? (
        <div className="session-grouping-create-draft">
          <input
            ref={inputRef}
            type="text"
            className="session-grouping-create-input"
            value={draftValue}
            placeholder={createFolderPlaceholder}
            aria-label={createFolderLabel}
            disabled={saving}
            onInput={(event) => {
              setDraftValue(event?.currentTarget?.value || '');
              if (note !== createFolderHint) {
                setNote(createFolderHint);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitCreate();
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCloseCreate?.();
              }
            }}
          />
          <div className="session-grouping-create-note">
            {saving ? `${translate('action.save') || '保存'}…` : note}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="session-grouping-create-btn"
          onClick={() => onOpenCreate?.()}
        >
          {`+ ${createFolderLabel}`}
        </button>
      )}
    </div>
  );
}

function SessionListEmptyState({
  show = false,
  label = '',
}) {
  if (!show || !label) return null;
  return <div className="session-list-empty">{label}</div>;
}

function ArchivedSessionSection({
  shouldRenderSection = false,
  isCollapsed = false,
  count = 0,
  archivedSessions = [],
  archivedSessionsLoading = false,
  archivedSessionsLoaded = false,
  archivedTotal = 0,
  archivedLabel = '已归档',
  loadingLabel = '加载中',
  emptyText = '',
  onToggleArchived = null,
  onEnsureArchivedLoaded = null,
  createSessionItem = null,
  getSessionRenderKey = null,
  chevronIconHtml = '',
}) {
  const sessions = Array.isArray(archivedSessions) ? archivedSessions : [];
  const initialLoadRequestedRef = useRef(false);

  useEffect(() => {
    if (!shouldRenderSection || isCollapsed) {
      initialLoadRequestedRef.current = false;
      return;
    }
    if (archivedSessionsLoaded || archivedSessionsLoading || sessions.length > 0) {
      initialLoadRequestedRef.current = false;
      return;
    }
    const availableCount = Number.isFinite(archivedTotal) ? archivedTotal : count;
    if (availableCount <= 0 || initialLoadRequestedRef.current) return;
    initialLoadRequestedRef.current = true;
    onEnsureArchivedLoaded?.();
  }, [
    archivedSessionsLoaded,
    archivedSessionsLoading,
    archivedTotal,
    count,
    isCollapsed,
    onEnsureArchivedLoaded,
    sessions.length,
    shouldRenderSection,
  ]);

  if (!shouldRenderSection) return null;

  const showLoading = archivedSessionsLoading && sessions.length === 0;
  const showEmpty = !showLoading && sessions.length === 0;

  return (
    <div id="archivedSection" className="archived-section">
      <button
        type="button"
        className={`archived-section-header${isCollapsed ? ' collapsed' : ''}`}
        aria-expanded={isCollapsed ? 'false' : 'true'}
        onClick={() => onToggleArchived?.(!isCollapsed)}
      >
        <SessionListChevron className="folder-chevron" iconHtml={chevronIconHtml} />
        <span className="archived-label">{archivedLabel}</span>
        <span className="folder-count">{count}</span>
      </button>
      <div className="archived-items" hidden={isCollapsed}>
        {showLoading ? (
          <div className="archived-empty">{loadingLabel}</div>
        ) : null}
        {showEmpty ? (
          <div className="archived-empty">{emptyText}</div>
        ) : null}
        {!showLoading && !showEmpty
          ? sessions.map((session) => (
            <SessionListItemMount
              key={`archived:${session?.id || Math.random()}`}
              createSessionItem={createSessionItem}
              session={session}
              archived
              renderKey={typeof getSessionRenderKey === 'function' ? getSessionRenderKey(session) : ''}
            />
          ))
          : null}
      </div>
    </div>
  );
}

function SessionListCollections({
  pinnedSessions = [],
  orderedGroups = [],
  showGroupHeaders = false,
  isGroupCollapsed = () => false,
  onToggleGroup = null,
  onRemoveGroup = null,
  createSessionItem = null,
  getSessionRenderKey = null,
  chevronIconHtml = '',
  deleteIconHtml = '',
  pinnedLabel = '',
  grouping = null,
  emptyState = null,
  translate = (key) => key,
  archived = null,
}) {
  return (
    <>
      <SessionListPinnedSection
        pinnedSessions={Array.isArray(pinnedSessions) ? pinnedSessions : []}
        pinnedLabel={pinnedLabel}
        createSessionItem={createSessionItem}
        getSessionRenderKey={getSessionRenderKey}
      />
      {(Array.isArray(orderedGroups) ? orderedGroups : []).map((groupEntry) => (
        <SessionListGroupSection
          key={`session-group:${groupEntry?.key || Math.random()}`}
          groupEntry={groupEntry}
          showGroupHeaders={showGroupHeaders}
          isCollapsed={isGroupCollapsed(groupEntry?.key || '') === true}
          isGroupCollapsed={isGroupCollapsed}
          onToggleGroup={onToggleGroup}
          onRemoveGroup={onRemoveGroup}
          createSessionItem={createSessionItem}
          getSessionRenderKey={getSessionRenderKey}
          chevronIconHtml={chevronIconHtml}
          deleteIconHtml={deleteIconHtml}
          deleteFolderLabel={String(grouping?.deleteFolderLabel || '')}
        />
      ))}
      <SessionListEmptyState
        show={emptyState?.show === true}
        label={String(emptyState?.label || '')}
      />
      <SessionListCreateFolderSection
        showCreateFolder={grouping?.showCreateFolder === true}
        createFolderLabel={String(grouping?.createFolderLabel || '')}
        createFolderPlaceholder={String(grouping?.createFolderPlaceholder || '')}
        createFolderHint={String(grouping?.createFolderHint || '')}
        saveFailedLabel={String(grouping?.saveFailedLabel || '')}
        isCreatingFolder={grouping?.isCreatingFolder === true}
        onOpenCreate={grouping?.onOpenCreate}
        onCloseCreate={grouping?.onCloseCreate}
        onCreateFolder={grouping?.onCreateFolder}
        translate={translate}
      />
      <ArchivedSessionSection
        shouldRenderSection={archived?.shouldRenderSection === true}
        isCollapsed={archived?.isCollapsed === true}
        count={Number.isFinite(archived?.count) ? archived.count : 0}
        archivedSessions={Array.isArray(archived?.archivedSessions) ? archived.archivedSessions : []}
        archivedSessionsLoading={archived?.archivedSessionsLoading === true}
        archivedSessionsLoaded={archived?.archivedSessionsLoaded === true}
        archivedTotal={Number.isFinite(archived?.archivedTotal) ? archived.archivedTotal : 0}
        archivedLabel={String(archived?.archivedLabel || '')}
        loadingLabel={String(archived?.loadingLabel || '')}
        emptyText={String(archived?.emptyText || '')}
        onToggleArchived={archived?.onToggleArchived}
        onEnsureArchivedLoaded={archived?.onEnsureArchivedLoaded}
        createSessionItem={createSessionItem}
        getSessionRenderKey={getSessionRenderKey}
        chevronIconHtml={chevronIconHtml}
      />
    </>
  );
}

function createSessionListRenderer({
  documentRef = document,
  windowRef = window,
  t: translate = (key) => key,
  renderUiIcon = () => '',
  createSessionItem = null,
} = {}) {
  ensureReactDocumentCompat(documentRef);

  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
    ensureCompatElement(host, documentRef);
    if (host.__melodysyncReactRoot) return host.__melodysyncReactRoot;
    host.innerHTML = '';
    host.__melodysyncReactRoot = createRoot(host);
    return host.__melodysyncReactRoot;
  }

  const chevronIconHtml = renderUiIcon('chevron-down');
  const deleteIconHtml = renderUiIcon('trash');

  function renderSessionCollections({
    listEl = null,
    pinnedSessions = [],
    orderedGroups = [],
    showGroupHeaders = false,
    isGroupCollapsed = () => false,
    onToggleGroup = null,
    onRemoveGroup = null,
    createSessionItem: createSessionItemOverride = null,
    getSessionRenderKey = null,
    grouping = null,
    emptyState = null,
    archived = null,
  } = {}) {
    if (!listEl) return;
    ensureRoot(listEl)?.render(
      <SessionListCollections
        pinnedSessions={pinnedSessions}
        orderedGroups={orderedGroups}
        showGroupHeaders={showGroupHeaders}
        isGroupCollapsed={isGroupCollapsed}
        onToggleGroup={onToggleGroup}
        onRemoveGroup={onRemoveGroup}
        createSessionItem={createSessionItemOverride || createSessionItem}
        getSessionRenderKey={getSessionRenderKey}
        chevronIconHtml={chevronIconHtml}
        deleteIconHtml={deleteIconHtml}
        pinnedLabel={String(translate('sidebar.pinned') || '')}
        grouping={grouping}
        emptyState={emptyState}
        translate={translate}
        archived={archived}
      />,
    );
  }

  return Object.freeze({
    renderSessionList(payload = {}) {
      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      const archived = payload?.archived || null;
      const archivedStorageKey = String(archived?.storageKey || 'folder:archived');
      renderSessionCollections({
        listEl: payload?.sessionListEl || null,
        pinnedSessions: Array.isArray(payload?.pinnedSessions) ? payload.pinnedSessions : [],
        orderedGroups: groups,
        showGroupHeaders: payload?.showGroupHeaders === true,
        isGroupCollapsed(groupKey) {
          // Top-level group
          const topGroup = groups.find((groupEntry) => groupEntry?.key === groupKey);
          if (topGroup) return topGroup.collapsed === true;
          // Bucket key: "group:long-term-project:xxx:bucket_key"
          // Find the parent group and look inside its buckets
          for (const groupEntry of groups) {
            if (!groupEntry?.buckets) continue;
            const bucket = groupEntry.buckets.find((b) => `${groupEntry.key}:${b?.key}` === groupKey);
            if (bucket) return bucket.collapsed === true;
          }
          return false;
        },
        onToggleGroup(groupKey, collapsed) {
          payload?.actions?.setGroupCollapsed?.(groupKey, collapsed);
        },
        onRemoveGroup(groupLabel) {
          payload?.actions?.removeTemplateFolder?.(groupLabel);
        },
        createSessionItem: payload?.helpers?.createSessionItem,
        getSessionRenderKey: payload?.helpers?.getSessionRenderKey,
        grouping: {
          ...(payload?.grouping || {}),
          onOpenCreate() {
            payload?.actions?.openGroupingCreate?.();
          },
          onCloseCreate() {
            payload?.actions?.closeGroupingCreate?.();
          },
          onCreateFolder(label) {
            return payload?.actions?.createTemplateFolder?.(label);
          },
        },
        emptyState: payload?.emptyState || null,
        archived: archived
          ? {
              shouldRenderSection: archived?.shouldRenderSection === true,
              isCollapsed: archived?.isCollapsed === true,
              count: Number.isFinite(archived?.count) ? archived.count : 0,
              archivedSessions: Array.isArray(archived?.sessions) ? archived.sessions : [],
              archivedSessionsLoading: archived?.loading === true,
              archivedSessionsLoaded: archived?.loaded === true,
              archivedTotal: Number.isFinite(archived?.total) ? archived.total : 0,
              archivedLabel: String(translate('sidebar.archive') || ''),
              loadingLabel: String(translate('sidebar.loadingArchived') || ''),
              emptyText: String(archived?.emptyText || ''),
              onToggleArchived(nextCollapsed) {
                payload?.actions?.setGroupCollapsed?.(archivedStorageKey, nextCollapsed);
                if (!nextCollapsed) {
                  payload?.actions?.ensureArchivedLoaded?.();
                }
              },
              onEnsureArchivedLoaded() {
                payload?.actions?.ensureArchivedLoaded?.();
              },
            }
          : null,
      });
      return true;
    },
    renderSessionCollections,
  });
}

function renderSessionList(payload = {}) {
  const sessionListEl = payload?.sessionListEl || null;
  const documentRef = sessionListEl?.ownerDocument || document;
  const windowRef = documentRef?.defaultView || window;
  return createSessionListRenderer({
    documentRef,
    windowRef,
    t: typeof payload?.helpers?.t === 'function' ? payload.helpers.t : ((key) => key),
    renderUiIcon: typeof payload?.helpers?.renderUiIcon === 'function' ? payload.helpers.renderUiIcon : (() => ''),
    createSessionItem: typeof payload?.helpers?.createSessionItem === 'function' ? payload.helpers.createSessionItem : null,
  }).renderSessionList(payload);
}

function getNodeEffectsApi(windowRef = window) {
  return windowRef?.MelodySyncWorkbenchNodeEffects
    || windowRef?.window?.MelodySyncWorkbenchNodeEffects
    || null;
}

function getNodeCapabilitiesApi(windowRef = window) {
  return windowRef?.MelodySyncWorkbenchNodeCapabilities
    || windowRef?.window?.MelodySyncWorkbenchNodeCapabilities
    || null;
}

function getTaskRunStatusApi(windowRef = window) {
  return windowRef?.MelodySyncTaskRunStatus
    || windowRef?.window?.MelodySyncTaskRunStatus
    || null;
}

function getNodeEffect(windowRef, node) {
  return getNodeEffectsApi(windowRef)?.getNodeEffect?.(node) || node?.kindEffect || null;
}

function getNodeLayoutVariant(windowRef, node) {
  return getNodeEffect(windowRef, node)?.layoutVariant || 'default';
}

function getNodeActionLabel(windowRef, node) {
  return getNodeEffect(windowRef, node)?.actionLabel || '开启';
}

function getNodeView(windowRef, node) {
  return getNodeEffectsApi(windowRef)?.getNodeView?.(node) || {
    type: 'flow-node',
    renderMode: '',
    content: '',
    src: '',
    width: null,
    height: null,
  };
}

function getNodeViewLabel(nodeView = null) {
  switch (String(nodeView?.type || '').trim().toLowerCase()) {
    case 'markdown':
      return '在右侧画布查看 Markdown';
    case 'html':
      return '在右侧画布查看 HTML';
    case 'iframe':
      return '在右侧画布查看嵌入内容';
    default:
      return '在右侧画布查看内容';
  }
}

function getTaskFlowNodeStatusUi(windowRef, node) {
  return getNodeEffectsApi(windowRef)?.getNodeTaskRunStatusUi?.(node) || { key: '', label: '', summary: '' };
}

function getProjectedTaskFlowConfig(isMobileQuestTracker = () => false) {
  const mobile = isMobileQuestTracker() === true;
  return {
    nodeWidth: mobile ? 128 : 182,
    rootWidth: mobile ? 150 : 216,
    richNodeWidth: mobile ? 140 : 204,
    nodeHeight: mobile ? 88 : 96,
    rootHeight: mobile ? 102 : 112,
    candidateHeight: mobile ? 100 : 116,
    richNodeHeight: mobile ? 112 : 124,
    levelGap: mobile ? 56 : 72,
    siblingGap: mobile ? 10 : 16,
    graphColumnGap: mobile ? 92 : 116,
    graphBandGap: mobile ? 104 : 118,
    paddingX: mobile ? 18 : 72,
    paddingY: mobile ? 36 : 56,
  };
}

function getProjectedTaskFlowNodeList(nodeMap) {
  if (!nodeMap || typeof nodeMap.values !== 'function') return [];
  return Array.from(nodeMap.values()).filter((node) => trimText(node?.id));
}

function getProjectedTaskFlowNodeWidth(windowRef, node, metrics) {
  const nodeView = getNodeView(windowRef, node);
  if (nodeView?.type && nodeView.type !== 'flow-node') return metrics.richNodeWidth;
  return node?.parentNodeId ? metrics.nodeWidth : metrics.rootWidth;
}

function getProjectedTaskFlowNodeHeight(windowRef, node, metrics) {
  const nodeView = getNodeView(windowRef, node);
  if (nodeView?.type && nodeView.type !== 'flow-node') return metrics.richNodeHeight;
  if (!node?.parentNodeId) return metrics.rootHeight;
  if (getNodeLayoutVariant(windowRef, node) === 'compact') return metrics.candidateHeight;
  return metrics.nodeHeight;
}

function buildProjectedTaskFlowGraph(rootNodeId, nodeMap, activeQuest = null) {
  const nodes = getProjectedTaskFlowNodeList(nodeMap);
  const edgeByPair = new Map();
  const outgoing = new Map();
  const incoming = new Map();

  function ensureAdjacency(nodeId) {
    const normalizedNodeId = trimText(nodeId);
    if (!normalizedNodeId) return;
    if (!outgoing.has(normalizedNodeId)) outgoing.set(normalizedNodeId, []);
    if (!incoming.has(normalizedNodeId)) incoming.set(normalizedNodeId, []);
  }

  function registerEdge(edge = {}, fallbackType = 'structural') {
    const fromNodeId = trimText(edge.fromNodeId || edge.from || '');
    const toNodeId = trimText(edge.toNodeId || edge.to || '');
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return null;
    if (!nodeMap.has(fromNodeId) || !nodeMap.has(toNodeId)) return null;
    const pairKey = `${fromNodeId}->${toNodeId}`;
    if (edgeByPair.has(pairKey)) return edgeByPair.get(pairKey);
    const normalizedEdge = {
      id: trimText(edge.id || `edge:${fromNodeId}:${toNodeId}`),
      fromNodeId,
      toNodeId,
      type: trimText(edge.type || edge.variant || fallbackType) || fallbackType,
    };
    edgeByPair.set(pairKey, normalizedEdge);
    ensureAdjacency(fromNodeId);
    ensureAdjacency(toNodeId);
    outgoing.get(fromNodeId).push(normalizedEdge);
    incoming.get(toNodeId).push(normalizedEdge);
    return normalizedEdge;
  }

  for (const node of nodes) {
    ensureAdjacency(node.id);
  }

  for (const edge of Array.isArray(activeQuest?.edges) ? activeQuest.edges : []) {
    registerEdge(edge, trimText(edge?.type || edge?.variant || 'structural') || 'structural');
  }

  for (const node of nodes) {
    const nodeId = trimText(node?.id || '');
    const parentNodeId = trimText(node?.parentNodeId || '');
    if (parentNodeId) {
      registerEdge({
        id: `edge:${parentNodeId}:${nodeId}`,
        fromNodeId: parentNodeId,
        toNodeId: nodeId,
        type: node?.kindEffect?.edgeVariant || 'structural',
      }, node?.kindEffect?.edgeVariant || 'structural');
    }
    for (const childNodeId of Array.isArray(node?.childNodeIds) ? node.childNodeIds : []) {
      registerEdge({
        id: `edge:${nodeId}:${childNodeId}`,
        fromNodeId: nodeId,
        toNodeId: trimText(childNodeId),
        type: nodeMap.get(trimText(childNodeId))?.kindEffect?.edgeVariant || 'structural',
      }, nodeMap.get(trimText(childNodeId))?.kindEffect?.edgeVariant || 'structural');
    }
  }

  return {
    rootNodeId: trimText(rootNodeId),
    nodes,
    edges: Array.from(edgeByPair.values()),
    outgoing,
    incoming,
  };
}

function edgeAffectsPrimaryFlow(edge = {}) {
  const variant = trimText(edge?.type || edge?.variant || 'structural') || 'structural';
  return variant !== 'related';
}

function getProjectedTaskFlowGraphLevels(graph, rootNodeId) {
  const levelById = new Map();
  const predecessorById = new Map();
  const queue = [];
  const normalizedRootNodeId = trimText(rootNodeId || graph?.rootNodeId || '');

  if (normalizedRootNodeId && (graph?.outgoing?.has(normalizedRootNodeId) || graph?.incoming?.has(normalizedRootNodeId))) {
    levelById.set(normalizedRootNodeId, 0);
    queue.push(normalizedRootNodeId);
  }

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    const currentLevel = levelById.get(currentNodeId) || 0;
    for (const edge of graph?.outgoing?.get(currentNodeId) || []) {
      if (!edgeAffectsPrimaryFlow(edge)) continue;
      const nextLevel = currentLevel + 1;
      const existingLevel = levelById.get(edge.toNodeId);
      if (Number.isInteger(existingLevel) && existingLevel <= nextLevel) continue;
      levelById.set(edge.toNodeId, nextLevel);
      predecessorById.set(edge.toNodeId, currentNodeId);
      queue.push(edge.toNodeId);
    }
  }

  const unresolvedNodes = graph?.nodes?.filter((node) => !levelById.has(node.id)) || [];
  let passes = 0;
  while (unresolvedNodes.length > 0 && passes < (graph?.nodes?.length || 0) + 2) {
    let progress = false;
    for (let index = unresolvedNodes.length - 1; index >= 0; index -= 1) {
      const node = unresolvedNodes[index];
      const parentNodeId = trimText(node?.parentNodeId || '');
      if (parentNodeId && levelById.has(parentNodeId)) {
        levelById.set(node.id, (levelById.get(parentNodeId) || 0) + 1);
        predecessorById.set(node.id, parentNodeId);
        unresolvedNodes.splice(index, 1);
        progress = true;
        continue;
      }
      const knownIncomingEdge = (graph?.incoming?.get(node.id) || []).find(
        (edge) => edgeAffectsPrimaryFlow(edge) && levelById.has(edge.fromNodeId),
      );
      if (!knownIncomingEdge) continue;
      levelById.set(node.id, (levelById.get(knownIncomingEdge.fromNodeId) || 0) + 1);
      predecessorById.set(node.id, knownIncomingEdge.fromNodeId);
      unresolvedNodes.splice(index, 1);
      progress = true;
    }
    if (!progress) break;
    passes += 1;
  }

  let fallbackLevel = Math.max(
    0,
    ...Array.from(levelById.values()).filter((value) => Number.isInteger(value)),
  );
  for (const node of graph?.nodes || []) {
    if (levelById.has(node.id)) continue;
    const nodeDepth = Number.isFinite(node?.depth) && node.depth >= 0 ? node.depth : null;
    const parentNodeId = trimText(node?.parentNodeId || '');
    if (parentNodeId && levelById.has(parentNodeId)) {
      levelById.set(node.id, (levelById.get(parentNodeId) || 0) + 1);
      predecessorById.set(node.id, parentNodeId);
      continue;
    }
    if (nodeDepth !== null) {
      levelById.set(node.id, nodeDepth);
      continue;
    }
    fallbackLevel += 1;
    levelById.set(node.id, fallbackLevel);
  }

  return {
    levelById,
    predecessorById,
  };
}

function getProjectedTaskFlowNodePriority(windowRef, node) {
  const layoutVariant = trimText(getNodeLayoutVariant(windowRef, node) || '');
  switch (layoutVariant) {
    case 'root':
      return 0;
    case 'default':
      return 1;
    case 'panel':
      return 2;
    case 'compact':
      return 3;
    default:
      return 4;
  }
}

function getProjectedTaskFlowPreferredBand(windowRef, node, anchorBand, slotIndex) {
  const layoutVariant = trimText(getNodeLayoutVariant(windowRef, node) || '');
  const startsBelow = node?.kind === 'candidate' || layoutVariant === 'compact';
  const step = Math.floor(slotIndex / 2) + 1;
  const direction = slotIndex % 2 === 0
    ? (startsBelow ? 1 : -1)
    : (startsBelow ? -1 : 1);
  return anchorBand + (direction * step);
}

function resolveProjectedTaskFlowBand(preferredBand, usedBands = new Set()) {
  if (!usedBands.has(preferredBand)) return preferredBand;
  for (let distance = 1; distance <= 64; distance += 1) {
    const lowerBand = preferredBand - distance;
    if (!usedBands.has(lowerBand)) return lowerBand;
    const higherBand = preferredBand + distance;
    if (!usedBands.has(higherBand)) return higherBand;
  }
  return preferredBand;
}

function getProjectedTaskFlowBands(windowRef, graph, levels, rootNodeId, activeQuest = null) {
  const bandById = new Map();
  const focusNodeIds = new Set(
    [
      trimText(rootNodeId),
      trimText(activeQuest?.currentNodeId || ''),
      ...(Array.isArray(activeQuest?.currentPathNodeIds) ? activeQuest.currentPathNodeIds : []),
      ...((graph?.nodes || []).filter((node) => node?.isCurrent || node?.isCurrentPath).map((node) => node.id)),
    ].map((value) => trimText(value)).filter(Boolean),
  );

  if (trimText(rootNodeId)) {
    bandById.set(trimText(rootNodeId), 0);
  }

  const nodesByLevel = new Map();
  for (const node of graph?.nodes || []) {
    const level = levels?.levelById?.get(node.id) || 0;
    if (!nodesByLevel.has(level)) nodesByLevel.set(level, []);
    nodesByLevel.get(level).push(node);
  }

  const sortedLevels = Array.from(nodesByLevel.keys()).sort((left, right) => left - right);
  for (const level of sortedLevels) {
    if (level === 0) continue;
    const usedBands = new Set();
    const anchorSlotCounts = new Map();
    const nodes = [...(nodesByLevel.get(level) || [])].sort((left, right) => {
      const leftAnchorId = trimText(left?.parentNodeId || levels?.predecessorById?.get(left.id) || rootNodeId);
      const rightAnchorId = trimText(right?.parentNodeId || levels?.predecessorById?.get(right.id) || rootNodeId);
      const leftAnchorBand = bandById.get(leftAnchorId) || 0;
      const rightAnchorBand = bandById.get(rightAnchorId) || 0;
      if (Math.abs(leftAnchorBand) !== Math.abs(rightAnchorBand)) {
        return Math.abs(leftAnchorBand) - Math.abs(rightAnchorBand);
      }
      if (leftAnchorBand !== rightAnchorBand) return leftAnchorBand - rightAnchorBand;

      const leftPriority = getProjectedTaskFlowNodePriority(windowRef, left);
      const rightPriority = getProjectedTaskFlowNodePriority(windowRef, right);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      return String(left?.title || left?.id || '').localeCompare(
        String(right?.title || right?.id || ''),
        'zh-Hans-CN',
      );
    });

    for (const node of nodes) {
      const anchorId = trimText(node?.parentNodeId || levels?.predecessorById?.get(node.id) || rootNodeId);
      const anchorBand = bandById.get(anchorId) || 0;
      const slotIndex = anchorSlotCounts.get(anchorId) || 0;
      anchorSlotCounts.set(anchorId, slotIndex + 1);
      const preferredBand = getProjectedTaskFlowPreferredBand(windowRef, node, anchorBand, slotIndex);
      const band = resolveProjectedTaskFlowBand(preferredBand, usedBands);
      usedBands.add(band);
      bandById.set(node.id, band);
    }
  }

  return {
    bandById,
    focusNodeIds,
  };
}

function buildProjectedTaskFlowEntries(windowRef, graph, levels, bands, metrics) {
  const entries = (graph?.nodes || []).map((node) => ({
    node,
    level: levels?.levelById?.get(node.id) || 0,
    band: bands?.bandById?.get(node.id) || 0,
    nodeWidth: getProjectedTaskFlowNodeWidth(windowRef, node, metrics),
    nodeHeight: getProjectedTaskFlowNodeHeight(windowRef, node, metrics),
    x: 0,
    y: 0,
  }));
  if (entries.length === 0) return entries;

  const levelWidths = new Map();
  for (const entry of entries) {
    const existingWidth = levelWidths.get(entry.level) || 0;
    levelWidths.set(entry.level, Math.max(existingWidth, entry.nodeWidth));
  }

  const levelOffsets = new Map();
  let cursorX = metrics.paddingX;
  for (const level of Array.from(levelWidths.keys()).sort((left, right) => left - right)) {
    levelOffsets.set(level, cursorX);
    cursorX += (levelWidths.get(level) || 0) + metrics.graphColumnGap;
  }

  const minBand = Math.min(...entries.map((entry) => entry.band));
  const bandOriginY = metrics.paddingY + (minBand < 0 ? Math.abs(minBand) * metrics.graphBandGap : 0);
  for (const entry of entries) {
    const levelWidth = levelWidths.get(entry.level) || entry.nodeWidth;
    entry.x = (levelOffsets.get(entry.level) || metrics.paddingX) + Math.max(0, (levelWidth - entry.nodeWidth) / 2);
    entry.y = bandOriginY + (entry.band * metrics.graphBandGap);
  }

  return entries;
}

function collectProjectedTaskFlowEdges(graph, focusNodeIds = new Set()) {
  const focusSet = focusNodeIds instanceof Set ? focusNodeIds : new Set();
  return (graph?.edges || []).map((edge) => ({
    id: trimText(edge?.id || `edge:${edge?.fromNodeId || ''}:${edge?.toNodeId || ''}`),
    fromNodeId: trimText(edge?.fromNodeId || ''),
    toNodeId: trimText(edge?.toNodeId || ''),
    current: focusSet.has(trimText(edge?.fromNodeId || '')) && focusSet.has(trimText(edge?.toNodeId || '')),
    variant: trimText(edge?.type || edge?.variant || 'structural') || 'structural',
  })).filter((edge) => edge.fromNodeId && edge.toNodeId);
}

function getProjectedTaskFlowNodeMeta(windowRef, node) {
  const nodeEffect = getNodeEffect(windowRef, node);
  const nodeStatusUi = getTaskFlowNodeStatusUi(windowRef, node);
  const nodeStatusLabel = String(nodeStatusUi?.label || '').trim();
  const metaLabel = String(getNodeEffectsApi(windowRef)?.getNodeMetaLabel?.(node) || '').trim();
  if (metaLabel) return metaLabel;
  if (nodeEffect?.metaVariant === 'candidate') return '可选';
  if (nodeEffect?.metaVariant === 'done') return '已收束';
  return nodeStatusLabel;
}

function getProjectedTaskFlowNodeSummary(windowRef, node, activeQuest, clipTextImpl) {
  const summary = getNodeEffectsApi(windowRef)?.getNodeSummaryText?.(node, activeQuest, { clipText: clipTextImpl });
  if (typeof summary === 'string') return summary;
  if (!node) return '';
  const nodeEffect = getNodeEffect(windowRef, node);
  if (!node.parentNodeId) {
    const rootSummary = clipTextImpl(node.summary || activeQuest?.summary || '', 72);
    if (rootSummary) return rootSummary;
    const currentNodeTitle = clipTextImpl(activeQuest?.currentNodeTitle || '', 40);
    if (currentNodeTitle && currentNodeTitle !== clipTextImpl(node.title || '', 40)) {
      return `当前焦点：${currentNodeTitle}`;
    }
    return '';
  }
  if (nodeEffect?.interaction === 'create-branch') {
    return clipTextImpl(node.summary || nodeEffect.fallbackSummary || nodeEffect.defaultSummary || '', 72);
  }
  return clipTextImpl(node.summary || nodeEffect?.fallbackSummary || '', 72);
}

function getGraphOpsUi(windowRef = window) {
  return windowRef?.MelodySyncGraphOpsUi
    || windowRef?.window?.MelodySyncGraphOpsUi
    || null;
}

function getGraphProposalForNode(windowRef, sessionId = '', node = null) {
  const normalizedSessionId = trimText(sessionId);
  if (!normalizedSessionId || !node) return null;
  return getGraphOpsUi(windowRef)?.getLatestProposalForNode?.(normalizedSessionId, node) || null;
}

function clipTaskMapUiText(value, maxChars = 80) {
  const text = trimText(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) return text;
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function getGraphProposalRefLabel(ref) {
  if (!ref) return '';
  if (typeof ref === 'string') return trimText(ref);
  return trimText(ref?.title || ref?.ref || ref?.sessionId || ref?.id || '');
}

function getGraphProposalKindLabel(operation) {
  const type = trimText(operation?.type).toLowerCase();
  if (type === 'attach') return '建议连接';
  if (type === 'archive') return '建议减枝';
  if (type === 'expand') return '建议拓展';
  if (type === 'promote_main') return '建议独立';
  return '建议调整';
}

function getGraphProposalReasonText(proposal) {
  const operation = proposal?.matchedOperation || proposal?.graphOps?.operations?.[0] || null;
  const reason = clipTaskMapUiText(operation?.reason || '', 84);
  if (reason) return reason;
  const type = trimText(operation?.type).toLowerCase();
  if (type === 'expand') {
    const branchTitle = clipTaskMapUiText(
      operation?.title
        || operation?.goal
        || operation?.target?.title
        || operation?.target?.ref
        || '',
      48,
    );
    return branchTitle ? `建议继续展开成「${branchTitle}」` : '建议把当前任务继续展开成独立支线';
  }
  if (type === 'attach') {
    const targetLabel = getGraphProposalRefLabel(operation?.target);
    return targetLabel ? `建议连接到「${targetLabel}」` : '建议连接到更合适的任务';
  }
  if (type === 'archive') {
    return '建议对明显重复或低价值的任务做减枝';
  }
  if (type === 'promote_main') {
    return '建议提升为独立任务';
  }
  return '建议调整当前任务图结构';
}

function collectPendingGraphSuggestions(flowNodes = []) {
  const suggestions = new Map();
  for (const flowNode of Array.isArray(flowNodes) ? flowNodes : []) {
    const proposal = flowNode?.data?.graphProposal;
    const proposalKey = trimText(proposal?.proposalKey || '');
    if (!proposal || !proposalKey || suggestions.has(proposalKey)) continue;
    suggestions.set(proposalKey, {
      proposalKey,
      proposal,
      nodeId: trimText(flowNode?.id || ''),
      nodeTitle: trimText(flowNode?.data?.rawTitle || flowNode?.data?.title || ''),
      kindLabel: getGraphProposalKindLabel(proposal?.matchedOperation),
      reasonText: getGraphProposalReasonText(proposal),
    });
  }
  return [...suggestions.values()];
}

function createFallbackNodeActionController({
  collapseTaskMapAfterAction = null,
  enterBranchFromSession = null,
  getSessionRecord = null,
  attachSession = null,
  reparentSession = null,
  connectSessions = null,
} = {}) {
  return {
    hasNodeCapability(node, capability) {
      const normalizedCapability = trimText(capability).toLowerCase();
      if (!normalizedCapability) return false;
      const capabilities = getNodeEffectsApi(window)?.getNodeCapabilities?.(node) || [];
      return capabilities.includes(normalizedCapability);
    },
    resolvePrimaryAction(node, { isRichView = false, isDone = false } = {}) {
      if (isRichView || isDone) return 'none';
      const effectInteraction = trimText(getNodeEffect(window, node)?.interaction || '');
      if (this.hasNodeCapability(node, 'create-branch') || effectInteraction === 'create-branch') return 'create-branch';
      if ((this.hasNodeCapability(node, 'open-session') || effectInteraction === 'open-session' || trimText(node?.sessionId)) && node?.sessionId) {
        return 'open-session';
      }
      return 'none';
    },
    isNodeDirectlyInteractive(node, options = {}) {
      return this.resolvePrimaryAction(node, options) === 'open-session';
    },
    canCreateManualBranch(node, { isRichView = false, isDone = false } = {}) {
      if (!node || isRichView || isDone) return false;
      return Boolean(node?.sourceSessionId || node?.sessionId);
    },
    canReparentSession(node, { isRichView = false, isDone = false } = {}) {
      if (!node || isRichView || isDone) return false;
      return Boolean(node?.sourceSessionId || node?.sessionId);
    },
    canConnectSession(node, { isRichView = false, isDone = false } = {}) {
      if (!node || isRichView || isDone) return false;
      return Boolean(node?.sourceSessionId || node?.sessionId);
    },
    async executeManualBranch(node, branchTitle, options = {}) {
      const sourceSessionId = trimText(node?.sourceSessionId || node?.sessionId);
      const normalizedTitle = trimText(branchTitle);
      if (!sourceSessionId || !normalizedTitle || typeof enterBranchFromSession !== 'function') return false;
      collapseTaskMapAfterAction?.({ render: false });
      await enterBranchFromSession(sourceSessionId, normalizedTitle, {
        branchReason: trimText(options?.branchReason) || `从「${trimText(node?.title) || '当前任务'}」继续展开关联任务`,
        checkpointSummary: trimText(options?.checkpointSummary) || trimText(node?.title),
      });
      return true;
    },
    async executeReparentSession(node, targetSessionId = '', options = {}) {
      const sourceSessionId = trimText(node?.sourceSessionId || node?.sessionId);
      if (!sourceSessionId || typeof reparentSession !== 'function') return false;
      await reparentSession(sourceSessionId, {
        targetSessionId: trimText(targetSessionId),
        branchReason: trimText(options?.branchReason),
      });
      return true;
    },
    async executeConnectSession(node, targetSessionId = '', options = {}) {
      const sourceSessionId = trimText(node?.sourceSessionId || node?.sessionId);
      const normalizedTargetSessionId = trimText(targetSessionId);
      if (!sourceSessionId || !normalizedTargetSessionId || typeof connectSessions !== 'function') return false;
      await connectSessions(sourceSessionId, {
        targetSessionId: normalizedTargetSessionId,
        graphEdgeType: trimText(options?.graphEdgeType) || 'related',
      });
      return true;
    },
    async executePrimaryAction(node, { state = null, nodeMap = new Map(), isRichView = false, isDone = false } = {}) {
      const action = this.resolvePrimaryAction(node, { isRichView, isDone });
      if (action === 'create-branch') {
        const sourceSessionId = trimText(node?.sessionId || node?.sourceSessionId);
        if (!sourceSessionId || typeof enterBranchFromSession !== 'function') return false;
        collapseTaskMapAfterAction?.({ render: false });
        await enterBranchFromSession(sourceSessionId, node.title, {
          branchReason: node?.parentNodeId
            ? `从「${nodeMap.get(node.parentNodeId)?.title || '当前节点'}」继续展开关联任务`
            : '从当前任务继续展开关联任务',
          checkpointSummary: node.title,
        });
        return true;
      }
      if (action === 'open-session' && node?.sessionId) {
        const sessionRecord = getSessionRecord?.(node.sessionId) || state?.parentSession || state?.cluster?.mainSession || null;
        collapseTaskMapAfterAction?.({ render: false });
        attachSession?.(node.sessionId, sessionRecord);
        return true;
      }
      return false;
    },
    async executeGraphProposal(proposal, { sessionId = '' } = {}) {
      const normalizedSessionId = trimText(sessionId);
      if (!normalizedSessionId || !proposal?.graphOps) return false;
      await getGraphOpsUi(window)?.applyProposal?.({
        sessionId: normalizedSessionId,
        sourceSeq: proposal?.sourceSeq,
        graphOps: proposal.graphOps,
      });
      return true;
    },
  };
}

function getNodeActionController(windowRef, options = {}) {
  const api = getNodeCapabilitiesApi(windowRef);
  if (typeof api?.createController === 'function') {
    return api.createController(options);
  }
  return createFallbackNodeActionController(options);
}

function createTaskHandoffController({
  buildTaskHandoffPreview = null,
  handoffSessionTaskData = null,
} = {}) {
  return Object.freeze({
    canHandoff(edgeData = null) {
      return Boolean(
        edgeData
        && trimText(edgeData?.sourceSessionId || '')
        && trimText(edgeData?.targetSessionId || '')
        && trimText(edgeData?.sourceSessionId || '') !== trimText(edgeData?.targetSessionId || '')
        && typeof handoffSessionTaskData === 'function'
      );
    },
    buildPreview(edgeData = null, direction = 'forward', options = {}) {
      if (!this.canHandoff(edgeData) || typeof buildTaskHandoffPreview !== 'function') return null;
      const reverse = trimText(direction).toLowerCase() === 'reverse';
      const sourceSessionId = reverse
        ? trimText(edgeData?.targetSessionId || '')
        : trimText(edgeData?.sourceSessionId || '');
      const targetSessionId = reverse
        ? trimText(edgeData?.sourceSessionId || '')
        : trimText(edgeData?.targetSessionId || '');
      return buildTaskHandoffPreview(sourceSessionId, targetSessionId, {
        sourceTitle: reverse ? edgeData?.targetTitle : edgeData?.sourceTitle,
        targetTitle: reverse ? edgeData?.sourceTitle : edgeData?.targetTitle,
        detailLevel: trimText(options?.detailLevel || ''),
      });
    },
    async executeHandoff(edgeData = null, direction = 'forward', options = {}) {
      if (!this.canHandoff(edgeData) || typeof handoffSessionTaskData !== 'function') return null;
      const reverse = trimText(direction).toLowerCase() === 'reverse';
      const sourceSessionId = reverse
        ? trimText(edgeData?.targetSessionId || '')
        : trimText(edgeData?.sourceSessionId || '');
      const targetSessionId = reverse
        ? trimText(edgeData?.sourceSessionId || '')
        : trimText(edgeData?.targetSessionId || '');
      return handoffSessionTaskData(sourceSessionId, {
        targetSessionId,
        detailLevel: resolveEdgeHandoffDetailLevel(options?.detailLevel),
      });
    },
  });
}

function buildBoardSnapshot({
  activeQuest = null,
  nodeMap = new Map(),
  rootNode = null,
  state = null,
  rendererApi = null,
  positionOverrides = null,
} = {}) {
  const windowRef = rendererApi?.windowRef || window;
  const clipTextImpl = typeof rendererApi?.clipText === 'function' ? rendererApi.clipText : clipText;
  if (!rootNode?.id) {
    return {
      nodes: [],
      edges: [],
      hasOnlyRoot: false,
      focusNodeIds: [],
    };
  }

  const metrics = getProjectedTaskFlowConfig(rendererApi?.isMobileQuestTracker);
  const graph = buildProjectedTaskFlowGraph(rootNode.id, nodeMap, activeQuest);
  const levels = getProjectedTaskFlowGraphLevels(graph, rootNode.id);
  const bands = getProjectedTaskFlowBands(windowRef, graph, levels, rootNode.id, activeQuest);
  const entries = buildProjectedTaskFlowEntries(windowRef, graph, levels, bands, metrics);
  const edges = collectProjectedTaskFlowEdges(graph, bands.focusNodeIds);
  const taskRunStatusApi = getTaskRunStatusApi(windowRef);
  const selectedTaskCanvasNodeId = trimText(rendererApi?.getSelectedTaskCanvasNodeId?.() || '');

  const flowNodes = applyTaskMapLayoutOverrides(entries.map((entry) => {
    const node = entry.node;
    const nodeView = getNodeView(windowRef, node);
    const nodeStatusUi = getTaskFlowNodeStatusUi(windowRef, node);
    const nodeStatusClassName = trimText(nodeStatusUi?.nodeClassName || '');
    const isDone = getNodeEffect(windowRef, node)?.metaVariant === 'done';
    const isRichView = nodeView.type !== 'flow-node';
    const primaryAction = rendererApi?.nodeActionController?.resolvePrimaryAction?.(node, { isRichView, isDone }) || 'none';
    const canCreateManualBranch = rendererApi?.nodeActionController?.canCreateManualBranch?.(node, { isRichView, isDone }) === true;
    const canConnectSession = rendererApi?.nodeActionController?.canConnectSession?.(node, { isRichView, isDone }) === true;
    const graphProposal = getGraphProposalForNode(
      windowRef,
      rendererApi?.getCurrentSessionId?.() || '',
      node,
    );
    const statusAliasClassName = trimText(
      node?.parentNodeId
        ? (taskRunStatusApi?.getTaskRunStatusResolvedNodeClassName?.(nodeStatusUi?.key || '', 'is-') || '')
        : '',
    );
    const nodeClasses = ['quest-task-flow-node'];
    if (isRichView) nodeClasses.push('is-rich-view', `is-view-${nodeView.type}`);
    if (isRichView) nodeClasses.push('is-canvas-selectable');
    if (!node.parentNodeId) nodeClasses.push('is-root');
    if (rendererApi?.nodeActionController?.hasNodeCapability?.(node, 'create-branch')) nodeClasses.push('is-candidate');
    if (node.isCurrentPath) nodeClasses.push('is-current-path');
    if (node.isCurrent) nodeClasses.push('is-current');
    if (nodeStatusClassName) nodeClasses.push(nodeStatusClassName);
    if (statusAliasClassName) nodeClasses.push(statusAliasClassName);
    if (isRichView && selectedTaskCanvasNodeId === trimText(node?.id || '')) nodeClasses.push('is-canvas-selected');

    const summary = isRichView
      ? (getProjectedTaskFlowNodeSummary(windowRef, node, activeQuest, clipTextImpl) || getNodeViewLabel(nodeView))
      : getProjectedTaskFlowNodeSummary(windowRef, node, activeQuest, clipTextImpl);

    return {
      id: trimText(node?.id || ''),
      type: 'melody-node',
      position: {
        x: entry.x,
        y: entry.y,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      selectable: false,
      connectable: false,
      focusable: false,
      style: {
        width: `${Math.ceil(entry.nodeWidth)}px`,
        height: `${Math.ceil(entry.nodeHeight)}px`,
        minHeight: `${Math.ceil(entry.nodeHeight)}px`,
      },
      data: {
        node,
        state,
        nodeMap,
        rendererApi,
        nodeView,
        badgeLabel: getProjectedTaskFlowNodeMeta(windowRef, node),
        title: clipTextImpl(node.title || '当前任务', getNodeLayoutVariant(windowRef, node) === 'compact' ? 22 : 28),
        rawTitle: trimText(node.title || ''),
        summary,
        primaryAction,
        canCreateManualBranch,
        canConnectSession,
        graphProposal,
        isDone,
        isRichView,
        className: nodeClasses.join(' '),
        badgeClassName: [
          'quest-task-flow-node-badge',
          nodeStatusUi?.key === 'completed' ? 'is-complete' : '',
          node?.status === 'merged' ? 'is-merged' : '',
          nodeStatusUi?.key === 'parked' ? 'is-parked' : '',
          nodeStatusClassName,
        ].filter(Boolean).join(' '),
        actionLabel: getNodeActionLabel(windowRef, node),
      },
    };
  }).filter((node) => node.id), positionOverrides);

  const flowEdges = edges
    .filter((edge) => edge.fromNodeId && edge.toNodeId)
    .map((edge) => {
      const sourceNode = nodeMap.get(trimText(edge.fromNodeId || '')) || null;
      const targetNode = nodeMap.get(trimText(edge.toNodeId || '')) || null;
      const sourceSessionId = trimText(sourceNode?.sessionId || '');
      const targetSessionId = trimText(targetNode?.sessionId || '');
      return {
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        type: 'melody-edge',
        selectable: false,
        focusable: false,
        data: {
          current: edge.current === true,
          variant: trimText(edge.variant || 'structural') || 'structural',
          sourceNodeId: trimText(edge.fromNodeId || ''),
          targetNodeId: trimText(edge.toNodeId || ''),
          sourceSessionId,
          targetSessionId,
          sourceTitle: trimText(sourceNode?.title || ''),
          targetTitle: trimText(targetNode?.title || ''),
          canHandoff: Boolean(
            sourceSessionId
            && targetSessionId
            && sourceSessionId !== targetSessionId
            && rendererApi?.taskHandoffController?.canHandoff?.({
              sourceSessionId,
              targetSessionId,
            }) === true
          ),
          rendererApi,
        },
      };
    });

  const pathNodeIds = flowNodes
    .filter((node) => node?.data?.node?.isCurrentPath)
    .map((node) => node.id);
  const focusNodeIds = flowNodes
    .filter((node) => node?.data?.node?.isCurrent)
    .map((node) => node.id);

  return {
    nodes: flowNodes,
    edges: flowEdges,
    hasOnlyRoot: entries.length <= 1,
    focusNodeIds: pathNodeIds.length > 0
      ? pathNodeIds
      : (focusNodeIds.length > 0 ? focusNodeIds : [trimText(rootNode.id)]),
  };
}

function stopEvent(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function stopPropagation(event) {
  event?.stopPropagation?.();
}

function resolveFlowEntrySessionId(entry = null) {
  return trimText(
    entry?.data?.node?.sourceSessionId
      || entry?.data?.node?.sessionId
      || entry?.sourceSessionId
      || entry?.sessionId
      || '',
  );
}

function buildDraftBranchComposerEntry({
  snapshotNodes = [],
  activeComposer = null,
  rendererApi = null,
  state = null,
  nodeMap = new Map(),
} = {}) {
  if (trimText(activeComposer?.type) !== 'manual') return null;
  const sourceNodeId = trimText(activeComposer?.nodeId || '');
  if (!sourceNodeId) return null;
  const sourceEntry = (Array.isArray(snapshotNodes) ? snapshotNodes : [])
    .find((entry) => trimText(entry?.id || '') === sourceNodeId);
  if (!sourceEntry?.data?.node) return null;

  const sourceWidth = Number.parseFloat(sourceEntry?.style?.width || '') || 228;
  const sourceHeight = Number.parseFloat(sourceEntry?.style?.height || '') || 128;
  const draftNodeId = `draft:manual:${sourceNodeId}`;
  const draftNode = {
    id: draftNodeId,
    kind: 'note',
    title: '新建 fork',
    summary: '输入标题后创建新支线',
    sourceSessionId: resolveFlowEntrySessionId(sourceEntry),
  };

  return {
    node: {
      id: draftNodeId,
      type: 'melody-node',
      position: {
        x: Math.round(sourceEntry.position.x + sourceWidth + 96),
        y: Math.round(sourceEntry.position.y + Math.max(-10, (sourceHeight - 154) / 2)),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      style: {
        width: '240px',
        height: '154px',
        minHeight: '154px',
      },
      data: {
        node: draftNode,
        draftSourceNode: sourceEntry.data.node,
        state,
        nodeMap,
        rendererApi,
        nodeView: { type: 'flow-node' },
        badgeLabel: 'fork',
        title: '新建 fork',
        rawTitle: '新建 fork',
        summary: '输入标题后直接创建一条 fork 任务',
        primaryAction: 'none',
        canCreateManualBranch: false,
        canConnectSession: false,
        graphProposal: null,
        isDone: false,
        isRichView: false,
        isDraftBranchComposer: true,
        className: 'quest-task-flow-node is-draft-branch is-current-path',
        badgeClassName: 'quest-task-flow-node-badge',
        actionLabel: '',
      },
    },
    edge: {
      id: `edge:draft:manual:${sourceNodeId}`,
      source: sourceNodeId,
      target: draftNodeId,
      type: 'melody-edge',
      selectable: false,
      focusable: false,
      data: {
        current: true,
        variant: 'suggestion',
        sourceNodeId: sourceNodeId,
        targetNodeId: draftNodeId,
        sourceSessionId: resolveFlowEntrySessionId(sourceEntry),
        targetSessionId: '',
        sourceTitle: trimText(sourceEntry?.data?.rawTitle || sourceEntry?.data?.title || ''),
        targetTitle: '新建 fork',
        canHandoff: false,
        rendererApi,
      },
    },
  };
}

function getEdgeHandoffDirectionLabel(preview = null) {
  const sourceTitle = clipText(trimText(preview?.sourceTitle || '源任务'), 20) || '源任务';
  const targetTitle = clipText(trimText(preview?.targetTitle || '目标任务'), 20) || '目标任务';
  return `${sourceTitle} -> ${targetTitle}`;
}

const EDGE_HANDOFF_DETAIL_LEVEL_OPTIONS = Object.freeze([
  Object.freeze({ value: 'focused', label: '聚焦' }),
  Object.freeze({ value: 'balanced', label: '平衡' }),
  Object.freeze({ value: 'full', label: '完整' }),
]);

function resolveEdgeHandoffDetailLevel(value) {
  const normalized = trimText(value).toLowerCase();
  return EDGE_HANDOFF_DETAIL_LEVEL_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : 'balanced';
}

function EdgeHandoffPreviewContent({
  preview = null,
  detailLevel = 'balanced',
  onSelectDetailLevel = null,
}) {
  const sections = Array.isArray(preview?.sections) ? preview.sections : [];
  const summary = trimText(preview?.summary || '');
  const selectedLevel = resolveEdgeHandoffDetailLevel(detailLevel);
  return (
    <>
      {summary ? (
        <div className="quest-task-flow-edge-handoff-summary">{summary}</div>
      ) : null}
      <div className="quest-task-flow-edge-handoff-detail-levels">
        {EDGE_HANDOFF_DETAIL_LEVEL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`quest-task-flow-edge-handoff-detail-level nodrag nopan${option.value === selectedLevel ? ' is-active' : ''}`}
            onPointerDown={stopEvent}
            onClick={(event) => {
              stopEvent(event);
              onSelectDetailLevel?.(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="quest-task-flow-edge-handoff-preview">
        {sections.length > 0 ? sections.map((section) => (
          <div key={section.key || section.label} className="quest-task-flow-edge-handoff-section">
            <div className="quest-task-flow-edge-handoff-section-title">{String(section.label || '')}</div>
            <div className="quest-task-flow-edge-handoff-section-body">
              {(Array.isArray(section.items) ? section.items : []).map((item) => (
                <div key={item} className="quest-task-flow-edge-handoff-item">{String(item || '')}</div>
              ))}
            </div>
          </div>
        )) : (
          <div className="quest-task-flow-edge-handoff-empty">当前没有可传递的结构化上下文。</div>
        )}
      </div>
    </>
  );
}

function MelodyEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}) {
  const className = [
    'react-flow__edge-path',
    'quest-task-flow-edge',
    data?.current === true ? 'is-current' : '',
    data?.variant === 'related' ? 'is-related' : '',
    data?.variant === 'suggestion' ? 'is-candidate' : '',
  ].filter(Boolean).join(' ');
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.32,
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [direction, setDirection] = useState('forward');
  const [detailLevel, setDetailLevel] = useState('balanced');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const handoffController = data?.rendererApi?.taskHandoffController || null;
  const canHandoff = data?.canHandoff === true && handoffController?.canHandoff?.(data) === true;
  const showHandoffTrigger = canHandoff && (composerOpen || data?.current === true);
  const resolvedDetailLevel = resolveEdgeHandoffDetailLevel(detailLevel);
  const forwardPreview = canHandoff ? handoffController.buildPreview(data, 'forward', { detailLevel: resolvedDetailLevel }) : null;
  const reversePreview = canHandoff ? handoffController.buildPreview(data, 'reverse', { detailLevel: resolvedDetailLevel }) : null;
  const selectedPreview = trimText(direction).toLowerCase() === 'reverse' ? reversePreview : forwardPreview;

  async function confirmHandoff(event) {
    stopEvent(event);
    if (!canHandoff || handoffBusy) return;
    setHandoffBusy(true);
    try {
      const outcome = await handoffController.executeHandoff(data, direction, {
        detailLevel: resolvedDetailLevel,
      });
      if (outcome) {
        setComposerOpen(false);
      }
    } finally {
      setHandoffBusy(false);
    }
  }

  return (
    <>
      <g>
        <BaseEdge
          className={className}
          path={edgePath}
        />
      </g>
      {showHandoffTrigger ? (
        <EdgeLabelRenderer>
          <div
            className={`quest-task-flow-edge-action-shell nodrag nopan${composerOpen ? ' is-open' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <button
              type="button"
              className="quest-task-flow-edge-handoff-btn nodrag nopan"
              onPointerDown={stopEvent}
              onClick={(event) => {
                stopEvent(event);
                setComposerOpen(!composerOpen);
              }}
            >
              传递
            </button>
            {composerOpen ? (
              <div
                className="quest-task-flow-edge-handoff-popover nodrag nopan"
                onPointerDown={stopEvent}
                onClick={stopPropagation}
              >
                <div className="quest-task-flow-edge-handoff-directions">
                  <button
                    type="button"
                    className={`quest-task-flow-edge-handoff-direction nodrag nopan${trimText(direction).toLowerCase() === 'forward' ? ' is-active' : ''}`}
                    onPointerDown={stopEvent}
                    onClick={(event) => {
                      stopEvent(event);
                      setDirection('forward');
                    }}
                  >
                    {getEdgeHandoffDirectionLabel(forwardPreview)}
                  </button>
                  <button
                    type="button"
                    className={`quest-task-flow-edge-handoff-direction nodrag nopan${trimText(direction).toLowerCase() === 'reverse' ? ' is-active' : ''}`}
                    onPointerDown={stopEvent}
                    onClick={(event) => {
                      stopEvent(event);
                      setDirection('reverse');
                    }}
                  >
                    {getEdgeHandoffDirectionLabel(reversePreview)}
                  </button>
                </div>
                <EdgeHandoffPreviewContent
                  preview={selectedPreview}
                  detailLevel={resolvedDetailLevel}
                  onSelectDetailLevel={setDetailLevel}
                />
                <div className="quest-task-flow-edge-handoff-actions">
                  <button
                    type="button"
                    className="quest-branch-btn quest-branch-btn-primary nodrag nopan"
                    onPointerDown={stopEvent}
                    onClick={confirmHandoff}
                    disabled={handoffBusy}
                  >
                    {handoffBusy ? '传递中…' : '确认传递'}
                  </button>
                  <button
                    type="button"
                    className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                    onPointerDown={stopEvent}
                    onClick={(event) => {
                      stopEvent(event);
                      setComposerOpen(false);
                    }}
                    disabled={handoffBusy}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function MelodyNode({ data }) {
  const {
    node,
    draftSourceNode,
    state,
    nodeMap,
    rendererApi,
    nodeView,
    badgeLabel,
    title,
    rawTitle,
    summary,
    primaryAction,
    canCreateManualBranch,
    canConnectSession,
    graphProposal,
    isDone,
    isRichView,
    isDraftBranchComposer,
    className,
    badgeClassName,
    actionLabel,
    quickConnectSourceEnabled,
    quickConnectTargetVisible,
    quickConnectPending,
    quickConnectBusy,
  } = data;

  const manualComposerOpen = rendererApi?.activeComposer?.type === 'manual' && rendererApi?.activeComposer?.nodeId === node?.id;
  const reparentComposerOpen = rendererApi?.activeComposer?.type === 'reparent' && rendererApi?.activeComposer?.nodeId === node?.id;
  const actionStripActive = rendererApi?.activeActionNodeId === node?.id;
  const [branchTitle, setBranchTitle] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [reparentQuery, setReparentQuery] = useState('');
  const [reparentSelectionKey, setReparentSelectionKey] = useState('');
  const [reparentBusy, setReparentBusy] = useState(false);
  const [graphProposalBusy, setGraphProposalBusy] = useState(false);
  const manualInputRef = useRef(null);
  const reparentInputRef = useRef(null);
  const isMobile = rendererApi?.isMobileQuestTracker?.() === true;

  useEffect(() => {
    if (!isDraftBranchComposer) {
      setBranchTitle('');
      setManualBusy(false);
    }
  }, [isDraftBranchComposer]);

  useEffect(() => {
    if (!reparentComposerOpen) {
      setReparentQuery('');
      setReparentSelectionKey('');
      setReparentBusy(false);
    }
  }, [reparentComposerOpen]);

  useEffect(() => {
    setGraphProposalBusy(false);
  }, [graphProposal?.proposalKey]);

  useLayoutEffect(() => {
    if (!isDraftBranchComposer) return;
    const input = manualInputRef.current;
    if (!input) return;
    const timer = (rendererApi?.windowRef || window).requestAnimationFrame?.(() => {
      input.focus();
      input.select?.();
    });
    return () => {
      if (typeof timer === 'number') {
        (rendererApi?.windowRef || window).cancelAnimationFrame?.(timer);
      }
    };
  }, [isDraftBranchComposer, rendererApi]);

  useLayoutEffect(() => {
    if (!reparentComposerOpen) return;
    const input = reparentInputRef.current;
    if (!input) return;
    const timer = (rendererApi?.windowRef || window).requestAnimationFrame?.(() => {
      input.focus();
      input.select?.();
    });
    return () => {
      if (typeof timer === 'number') {
        (rendererApi?.windowRef || window).cancelAnimationFrame?.(timer);
      }
    };
  }, [reparentComposerOpen, rendererApi]);

  const rawTargets = !isDraftBranchComposer && typeof rendererApi?.listConnectTargets === 'function'
    ? rendererApi.listConnectTargets({
      sourceSessionId: trimText(node?.sourceSessionId || node?.sessionId || ''),
      node,
      state,
      nodeMap,
    })
    : [];
  const connectActionAvailable = canConnectSession && Array.isArray(rawTargets) && rawTargets.length > 0;
  const showInlineConnectButton = isMobile && connectActionAvailable;
  const showDesktopQuickActions = !isMobile && (
    node?.isCurrent === true
    || actionStripActive
    || quickConnectPending
    || quickConnectBusy
    || manualComposerOpen
    || reparentComposerOpen
  );
  const showDesktopManualButton = !isMobile && canCreateManualBranch;
  const showDesktopConnectHandle = !isMobile && quickConnectSourceEnabled;
  const hostsInlineActions = primaryAction === 'create-branch'
    || showDesktopManualButton
    || showDesktopConnectHandle
    || showInlineConnectButton
    || Boolean(graphProposal);
  const filteredTargets = (Array.isArray(rawTargets) ? rawTargets : [])
    .filter((entry) => !trimText(reparentQuery) || String(entry?.searchText || '').toLowerCase().includes(trimText(reparentQuery).toLowerCase()))
    .slice(0, 8);
  const selectedTarget = filteredTargets.find((entry) => `${entry.mode}:${entry.sessionId || ''}` === reparentSelectionKey)
    || (Array.isArray(rawTargets) ? rawTargets.find((entry) => `${entry.mode}:${entry.sessionId || ''}` === reparentSelectionKey) : null)
    || null;

  useEffect(() => {
    if (!reparentComposerOpen) return;
    if (!filteredTargets.length) {
      if (reparentSelectionKey) setReparentSelectionKey('');
      return;
    }
    const hasSelectedTarget = filteredTargets.some((entry) => `${entry.mode}:${entry.sessionId || ''}` === reparentSelectionKey);
    if (!hasSelectedTarget) {
      const firstTarget = filteredTargets[0];
      setReparentSelectionKey(`${firstTarget.mode}:${firstTarget.sessionId || ''}`);
    }
  }, [filteredTargets, reparentComposerOpen, reparentSelectionKey]);

  async function executePrimaryAction(event) {
    stopEvent(event);
    if (!rendererApi?.nodeActionController?.executePrimaryAction) return;
    await rendererApi.nodeActionController.executePrimaryAction(node, {
      state,
      nodeMap,
      isRichView,
      isDone,
    });
  }

  function openManualComposer(event) {
    stopEvent(event);
    rendererApi?.setActiveActionNodeId?.(node?.id || '');
    rendererApi?.setActiveComposer?.({ type: 'manual', nodeId: node?.id || '' });
  }

  async function confirmManualBranch(event) {
    stopEvent(event);
    const normalizedTitle = normalizeText(branchTitle);
    if (!normalizedTitle) {
      manualInputRef.current?.focus?.();
      return;
    }
    setManualBusy(true);
    try {
      const executed = await rendererApi?.nodeActionController?.executeManualBranch?.(draftSourceNode || node, normalizedTitle, {
        state,
        nodeMap,
        isRichView,
        isDone,
      });
      if (executed) {
        rendererApi?.setActiveComposer?.(null);
        rendererApi?.setActiveActionNodeId?.('');
      }
    } finally {
      setManualBusy(false);
    }
  }

  function openReparentComposer(event) {
    stopEvent(event);
    rendererApi?.setActiveActionNodeId?.(node?.id || '');
    rendererApi?.setActiveComposer?.({ type: 'reparent', nodeId: node?.id || '' });
  }

  async function confirmReparent(event) {
    stopEvent(event);
    if (!selectedTarget) return;
    setReparentBusy(true);
    try {
      const executed = await rendererApi?.nodeActionController?.executeConnectSession?.(
        node,
        selectedTarget.sessionId,
        {
          state,
          nodeMap,
          isRichView,
          isDone,
        },
      );
      if (executed) {
        rendererApi?.setActiveComposer?.(null);
        rendererApi?.setActiveActionNodeId?.('');
      }
    } finally {
      setReparentBusy(false);
    }
  }

  async function applyGraphProposal(event) {
    stopEvent(event);
    if (!graphProposal || graphProposalBusy) return;
    setGraphProposalBusy(true);
    try {
      const executed = await rendererApi?.nodeActionController?.executeGraphProposal?.(graphProposal, {
        sessionId: rendererApi?.getCurrentSessionId?.() || '',
        state,
        nodeMap,
      });
      if (executed) {
        rendererApi?.setActiveComposer?.(null);
        rendererApi?.setActiveActionNodeId?.('');
      }
    } finally {
      setGraphProposalBusy(false);
    }
  }

  async function handleBodyClick() {
    if (isDraftBranchComposer) return;
    if (primaryAction === 'open-session' && !isDone && node?.sessionId) {
      await rendererApi?.nodeActionController?.executePrimaryAction?.(node, {
        state,
        nodeMap,
        isRichView,
        isDone,
      });
      return;
    }
    if (isRichView && typeof rendererApi?.selectTaskCanvasNode === 'function') {
      rendererApi.selectTaskCanvasNode(node?.id || '', { render: true });
      return;
    }
    if (hostsInlineActions) {
      rendererApi?.setActiveActionNodeId?.(
        actionStripActive && !manualComposerOpen && !reparentComposerOpen ? '' : (node?.id || ''),
      );
    }
  }

  if (isDraftBranchComposer) {
    return (
      <div className="quest-task-flow-react-node-shell nopan">
        <div className={`${className} nopan`}>
          {badgeLabel ? <div className={badgeClassName}>{badgeLabel}</div> : null}
          <div className="quest-task-flow-node-title" title={rawTitle}>{title}</div>
          {summary ? <div className="quest-task-flow-node-summary" title={summary}>{summary}</div> : null}
          <input
            ref={manualInputRef}
            type="text"
            className="quest-task-flow-branch-input nodrag nopan"
            placeholder="输入 fork 标题"
            aria-label="fork 标题"
            value={branchTitle}
            onChange={(event) => setBranchTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void confirmManualBranch(event);
              } else if (event.key === 'Escape') {
                stopEvent(event);
                rendererApi?.setActiveComposer?.(null);
                rendererApi?.setActiveActionNodeId?.('');
              }
            }}
            disabled={manualBusy}
          />
          <div className="quest-task-flow-draft-hint">确认后会立刻创建并切入这条 fork 任务。</div>
          <div className="quest-task-flow-branch-actions">
            <button
              type="button"
              className="quest-branch-btn quest-branch-btn-primary nodrag nopan"
              onPointerDown={stopEvent}
              onClick={confirmManualBranch}
              disabled={manualBusy}
            >
              {manualBusy ? '创建中…' : '创建 fork'}
            </button>
            <button
              type="button"
              className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
              onPointerDown={stopEvent}
              onClick={(event) => {
                stopEvent(event);
                rendererApi?.setActiveComposer?.(null);
                rendererApi?.setActiveActionNodeId?.('');
              }}
              disabled={manualBusy}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="quest-task-flow-react-node-shell nopan">
      <Handle
        type="target"
        position={Position.Left}
        id="task-connect-target"
        className={`quest-task-flow-connect-handle is-target${quickConnectTargetVisible ? ' is-visible is-highlight' : ''}`}
        isConnectable={quickConnectTargetVisible === true}
        data-label="接入"
        style={{
          minWidth: 0,
          minHeight: 0,
          width: 0,
          height: 0,
          border: 0,
          background: 'transparent',
          overflow: 'visible',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="task-connect-source"
        className={`quest-task-flow-connect-handle is-source${showDesktopConnectHandle ? ' is-visible' : ''}${quickConnectPending ? ' is-active' : ''}${quickConnectBusy ? ' is-busy' : ''}`}
        isConnectable={showDesktopConnectHandle === true && quickConnectBusy !== true}
        data-label={quickConnectBusy ? '连接中' : ''}
        title={quickConnectBusy ? '连接中' : '拖线连接'}
        style={{
          minWidth: 0,
          minHeight: 0,
          width: 0,
          height: 0,
          border: 0,
          background: 'transparent',
          overflow: 'visible',
        }}
      />
      {(showDesktopManualButton || showDesktopConnectHandle) ? (
        <div className={`quest-task-flow-node-quick-actions${showDesktopQuickActions ? ' is-visible' : ''}`}>
          {showDesktopManualButton ? (
            <button
              type="button"
              className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-quick-add nodrag nopan"
              onPointerDown={stopEvent}
              onClick={openManualComposer}
              hidden={manualComposerOpen}
              disabled={manualBusy || reparentBusy}
              title="新建任务"
              aria-label="新建任务"
            >
              +
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`${className} nopan`} onClick={handleBodyClick}>
        {badgeLabel ? <div className={badgeClassName}>{badgeLabel}</div> : null}
        <div className="quest-task-flow-node-title" title={rawTitle}>{title}</div>
        {summary ? <div className="quest-task-flow-node-summary" title={summary}>{summary}</div> : null}

        {primaryAction === 'create-branch' ? (
          <button
            type="button"
            className="quest-branch-btn quest-branch-btn-primary quest-task-flow-node-action nodrag nopan"
            onPointerDown={stopPropagation}
            onClick={executePrimaryAction}
            disabled={manualBusy || reparentBusy}
          >
            {actionLabel}
          </button>
        ) : null}

        {canCreateManualBranch ? (
          null
        ) : null}

        {showInlineConnectButton ? (
          null
        ) : null}
      </div>
      {(graphProposal || showInlineConnectButton || reparentComposerOpen || (isMobile && canCreateManualBranch)) ? (
        <NodeToolbar
          isVisible={
            node?.isCurrent === true
            || actionStripActive
            || reparentComposerOpen
          }
          position={Position.Bottom}
          offset={4}
          align="center"
        >
          <div
            className="quest-task-flow-react-node-actions nodrag nopan"
            onPointerDown={stopEvent}
            onClick={stopPropagation}
          >
            {(graphProposal || showInlineConnectButton || (isMobile && canCreateManualBranch)) ? (
              <div className="quest-task-flow-react-node-action-strip">
                {graphProposal ? (
                  <button
                    type="button"
                    className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action nodrag nopan"
                    onPointerDown={stopEvent}
                    onClick={applyGraphProposal}
                    disabled={graphProposalBusy || manualBusy || reparentBusy}
                    title="应用建议"
                    aria-label="应用建议"
                  >
                    {graphProposalBusy ? '应用中…' : '应用建议'}
                  </button>
                ) : null}

                {isMobile && canCreateManualBranch ? (
                  <button
                    type="button"
                    className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action quest-task-flow-node-action-compact nodrag nopan"
                    onPointerDown={stopEvent}
                    onClick={openManualComposer}
                    hidden={manualComposerOpen}
                    disabled={reparentBusy || manualBusy}
                    title="新建任务"
                    aria-label="新建任务"
                  >
                    +
                  </button>
                ) : null}

                {showInlineConnectButton ? (
                  <button
                    type="button"
                    className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action nodrag nopan"
                    onPointerDown={stopEvent}
                    onClick={openReparentComposer}
                    hidden={reparentComposerOpen}
                    disabled={manualBusy || reparentBusy}
                  >
                    连接
                  </button>
                ) : null}
              </div>
            ) : null}

            {reparentComposerOpen ? (
              <div
                className="quest-task-flow-reparent-composer nodrag nopan"
                onPointerDown={stopEvent}
                onClick={stopPropagation}
              >
                <input
                  ref={reparentInputRef}
                  type="text"
                  className="quest-task-flow-branch-input nodrag nopan"
                  placeholder="搜索任务标题或路径"
                  aria-label="连接目标"
                  value={reparentQuery}
                  onChange={(event) => setReparentQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      stopEvent(event);
                      rendererApi?.setActiveComposer?.(null);
                    } else if (event.key === 'Enter' && selectedTarget) {
                      void confirmReparent(event);
                    }
                  }}
                  disabled={reparentBusy}
                />
                <div className="quest-task-flow-reparent-list">
                  {filteredTargets.length > 0 ? filteredTargets.map((entry) => {
                    const optionKey = `${entry.mode}:${entry.sessionId || ''}`;
                    return (
                      <button
                        key={optionKey}
                        type="button"
                        className={`quest-task-flow-reparent-option nodrag nopan${reparentSelectionKey === optionKey ? ' is-selected' : ''}`}
                        onPointerDown={stopEvent}
                        onClick={(event) => {
                          stopEvent(event);
                          setReparentSelectionKey(optionKey);
                        }}
                      >
                        <div className="quest-task-flow-reparent-option-title">{entry.title || '未命名任务'}</div>
                        <div className="quest-task-flow-reparent-option-path">{entry.displayPath || entry.path || '当前任务'}</div>
                      </button>
                    );
                  }) : (
                    <div className="quest-task-flow-reparent-empty">没有可连接的任务</div>
                  )}
                </div>
                <div className="quest-task-flow-reparent-confirm" hidden={!selectedTarget}>
                  <div className="quest-task-flow-reparent-confirm-text">
                    {selectedTarget
                      ? `将与「${selectedTarget.path && selectedTarget.path !== '顶层任务' ? selectedTarget.path : (selectedTarget.title || '目标任务')}」建立关联`
                      : ''}
                  </div>
                  <div className="quest-task-flow-branch-actions">
                    <button
                      type="button"
                      className="quest-branch-btn quest-branch-btn-primary nodrag nopan"
                      onPointerDown={stopEvent}
                      onClick={confirmReparent}
                      disabled={reparentBusy || !selectedTarget}
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                      onPointerDown={stopEvent}
                      onClick={(event) => {
                        stopEvent(event);
                        rendererApi?.setActiveComposer?.(null);
                        rendererApi?.setActiveActionNodeId?.('');
                      }}
                      disabled={reparentBusy}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </NodeToolbar>
      ) : null}
    </div>
  );
}

function FlowViewportSync({
  nodes = [],
  focusNodeIds = [],
  viewportKey = '',
  viewportMemoryKey = '',
  isMobile = false,
}) {
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastAppliedViewportSyncKeyRef = useRef('');
  const normalizedViewportSyncKey = trimText(viewportMemoryKey || viewportKey || '')
    || `nodes:${(Array.isArray(nodes) ? nodes : []).map((node) => trimText(node?.id || '')).filter(Boolean).join('|')}`;

  useLayoutEffect(() => {
    if (!nodesInitialized) return undefined;
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    if (!normalizedViewportSyncKey) return undefined;
    if (lastAppliedViewportSyncKeyRef.current === normalizedViewportSyncKey) {
      return undefined;
    }
    const focusTargets = focusNodeIds.length > 0
      ? focusNodeIds.map((id) => ({ id }))
      : nodes.map((node) => ({ id: node.id }));
    const hostWindow = globalThis?.window || window;
    const raf = hostWindow?.requestAnimationFrame?.bind(hostWindow);
    const cancelRaf = hostWindow?.cancelAnimationFrame?.bind(hostWindow);
    const fitPadding = focusNodeIds.length > 0
      ? (isMobile ? 0.1 : 0.08)
      : (isMobile ? 0.16 : 0.14);
    let rafHandle = null;
    const restoreViewport = () => {
      const savedViewport = readTaskMapViewportMemory(viewportMemoryKey);
      if (!savedViewport || typeof reactFlow?.setViewport !== 'function') {
        return false;
      }
      reactFlow.setViewport(savedViewport, { duration: 0 });
      return true;
    };
    const persistViewport = () => {
      if (typeof reactFlow?.getViewport !== 'function') return;
      writeTaskMapViewportMemory(viewportMemoryKey, reactFlow.getViewport());
    };
    const applyViewport = () => {
      const restored = restoreViewport();
      if (!restored) {
        reactFlow.fitView({
          nodes: focusTargets,
          padding: fitPadding,
          duration: 0,
          minZoom: isMobile ? 0.25 : 0.42,
          maxZoom: 1.22,
          includeHiddenNodes: true,
        });
      }
      if (typeof raf === 'function') {
        rafHandle = raf(() => {
          rafHandle = null;
          persistViewport();
        });
        return;
      }
      persistViewport();
    };

    lastAppliedViewportSyncKeyRef.current = normalizedViewportSyncKey;
    if (typeof raf === 'function') {
      rafHandle = raf(() => {
        rafHandle = null;
        applyViewport();
      });
    } else {
      applyViewport();
    }

    return () => {
      if (rafHandle) cancelRaf?.(rafHandle);
    };
  }, [reactFlow, normalizedViewportSyncKey, viewportMemoryKey, isMobile, nodesInitialized]);

  return null;
}

function TaskFlowBoard({
  activeQuest,
  nodeMap,
  rootNode,
  state,
  rendererApi,
}) {
  const [activeComposer, setActiveComposer] = useState(null);
  const [activeActionNodeId, setActiveActionNodeId] = useState('');
  const [pendingConnectSourceNodeId, setPendingConnectSourceNodeId] = useState('');
  const [quickConnectBusy, setQuickConnectBusy] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const interactionConfig = getTaskMapInteractionConfig({
    mobile: rendererApi?.isMobileQuestTracker?.() === true,
  });
  const layoutStorage = rendererApi?.windowRef?.localStorage || null;
  const layoutStorageKey = createTaskMapLayoutStorageKey({
    rootSessionId: trimText(activeQuest?.rootSessionId || rootNode?.sessionId || ''),
    questId: trimText(activeQuest?.id || ''),
  });
  const currentNodeIds = Array.isArray(activeQuest?.nodes)
    ? activeQuest.nodes.map((node) => trimText(node?.id)).filter(Boolean)
    : [];
  const [layoutPositions, setLayoutPositions] = useState(() => filterTaskMapLayoutPositions(
    readTaskMapLayoutPositions(layoutStorage, layoutStorageKey),
    currentNodeIds,
  ));
  const previousTopologyKeyRef = useRef('');
  const lastFlowNodeTopologyKeyRef = useRef('');
  const effectiveLayoutPositions = interactionConfig.nodesDraggable ? layoutPositions : null;
  const snapshot = buildBoardSnapshot({
    activeQuest,
    nodeMap,
    rootNode,
    state,
    rendererApi: {
      ...rendererApi,
      activeComposer,
      setActiveComposer,
      activeActionNodeId,
      setActiveActionNodeId,
    },
    positionOverrides: effectiveLayoutPositions,
  });
  const draftBranchComposerEntry = buildDraftBranchComposerEntry({
    snapshotNodes: snapshot.nodes,
    activeComposer,
    rendererApi,
    state,
    nodeMap,
  });
  const baseNodeEntries = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const listConnectTargetsForEntry = (entry = null) => {
    const sourceSessionId = resolveFlowEntrySessionId(entry);
    if (!sourceSessionId || typeof rendererApi?.listConnectTargets !== 'function') return [];
    return rendererApi.listConnectTargets({
      sourceSessionId,
      node: entry?.data?.node || null,
      state,
      nodeMap,
    });
  };
  const pendingConnectSourceEntry = trimText(pendingConnectSourceNodeId)
    ? baseNodeEntries.find((entry) => trimText(entry?.id || '') === trimText(pendingConnectSourceNodeId))
    : null;
  const pendingConnectTargetSessionIds = new Set(
    listConnectTargetsForEntry(pendingConnectSourceEntry)
      .map((entry) => trimText(entry?.sessionId || ''))
      .filter(Boolean),
  );
  const boardNodes = baseNodeEntries.map((entry) => {
    const quickConnectSourceEnabled = Boolean(
      !interactionConfig.isMobile
      && entry?.data?.canConnectSession === true
      && listConnectTargetsForEntry(entry).length > 0,
    );
    const entrySessionId = resolveFlowEntrySessionId(entry);
    const quickConnectTargetEnabled = Boolean(
      !interactionConfig.isMobile
      && trimText(pendingConnectSourceNodeId)
      && trimText(entry?.id || '') !== trimText(pendingConnectSourceNodeId)
      && entrySessionId
      && pendingConnectTargetSessionIds.has(entrySessionId),
    );
    return {
      ...entry,
      data: {
        ...entry.data,
        quickConnectSourceEnabled,
        quickConnectTargetVisible: quickConnectTargetEnabled,
        quickConnectPending: trimText(entry?.id || '') === trimText(pendingConnectSourceNodeId),
        quickConnectBusy,
      },
    };
  });
  const boardEdges = draftBranchComposerEntry
    ? [...snapshot.edges, draftBranchComposerEntry.edge]
    : snapshot.edges;
  const renderedNodes = draftBranchComposerEntry
    ? [...boardNodes, draftBranchComposerEntry.node]
    : boardNodes;
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(renderedNodes);
  const pendingGraphSuggestions = collectPendingGraphSuggestions(boardNodes);
  const topologyKey = [
    snapshot.nodes
      .map((node) => `${node.id}:${trimText(node?.data?.node?.parentNodeId || '')}`)
      .sort()
      .join('|'),
    snapshot.edges
      .map((edge) => `${trimText(edge?.source || '')}>${trimText(edge?.target || '')}`)
      .sort()
      .join('|'),
  ].join('||');
  const viewportMemoryKey = [
    trimText(layoutStorageKey || activeQuest?.id || rootNode?.id || ''),
    topologyKey,
  ].filter(Boolean).join('||');

  useEffect(() => {
    if (pendingGraphSuggestions.length > 0) return;
    setSuggestionsOpen(false);
  }, [pendingGraphSuggestions.length]);
  const activeComposerKey = activeComposer
    ? `${trimText(activeComposer.type)}:${trimText(activeComposer.nodeId)}`
    : '';
  const snapshotStateKey = [
    activeComposerKey,
    trimText(activeActionNodeId),
    trimText(pendingConnectSourceNodeId),
    quickConnectBusy === true ? '1' : '0',
    renderedNodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
      node.data?.rawTitle || '',
      node.data?.summary || '',
      node.data?.className || '',
      node.data?.badgeLabel || '',
      node.data?.primaryAction || '',
      node.data?.canCreateManualBranch === true ? '1' : '0',
      node.data?.canConnectSession === true ? '1' : '0',
      node.data?.quickConnectSourceEnabled === true ? '1' : '0',
      node.data?.quickConnectTargetVisible === true ? '1' : '0',
      node.data?.graphProposal?.proposalKey || '',
      node.data?.isDraftBranchComposer === true ? '1' : '0',
    ].join(':')).join('|'),
    boardEdges.map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.data?.variant || '',
      edge.data?.current === true ? '1' : '0',
    ].join(':')).join('|'),
  ].join('||');

  useEffect(() => {
    const topologyChanged = lastFlowNodeTopologyKeyRef.current !== topologyKey;
    setFlowNodes((currentNodes) => {
      const currentNodeById = new Map(
        (Array.isArray(currentNodes) ? currentNodes : [])
          .filter((node) => trimText(node?.id))
          .map((node) => [trimText(node.id), node]),
      );
      return renderedNodes.map((node) => {
        const currentNode = currentNodeById.get(trimText(node?.id || ''));
        if (!currentNode) return node;
        const mergedNode = {
          ...currentNode,
          ...node,
        };
        if (!topologyChanged && currentNode?.position) {
          mergedNode.position = currentNode.position;
        }
        return mergedNode;
      });
    });
    lastFlowNodeTopologyKeyRef.current = topologyKey;
  }, [setFlowNodes, snapshotStateKey, topologyKey]);

  useEffect(() => {
    const previousTopologyKey = previousTopologyKeyRef.current;
    previousTopologyKeyRef.current = topologyKey;
    if (!previousTopologyKey || previousTopologyKey === topologyKey) return;
    if (Object.keys(layoutPositions || {}).length === 0) return;
    setLayoutPositions({});
    writeTaskMapLayoutPositions(layoutStorage, layoutStorageKey, {});
  }, [topologyKey, layoutPositions, layoutStorage, layoutStorageKey]);

  useEffect(() => {
    if (interactionConfig.nodesDraggable) return;
    if (Object.keys(layoutPositions || {}).length === 0) return;
    setLayoutPositions({});
    writeTaskMapLayoutPositions(layoutStorage, layoutStorageKey, {});
  }, [interactionConfig.nodesDraggable, layoutPositions, layoutStorage, layoutStorageKey]);

  function persistNodePositions(nextNodes = []) {
    if (!interactionConfig.nodesDraggable) return;
    const nextNodeMap = new Map(
      (Array.isArray(flowNodes) ? flowNodes : [])
        .filter((node) => trimText(node?.id))
        .map((node) => [trimText(node.id), node]),
    );
    for (const node of Array.isArray(nextNodes) ? nextNodes : []) {
      const nodeId = trimText(node?.id);
      if (!nodeId) continue;
      nextNodeMap.set(nodeId, node);
    }
    const nextNodeList = snapshot.nodes.map((node) => nextNodeMap.get(node.id) || node);
    const nextPositions = filterTaskMapLayoutPositions(
      Object.fromEntries(
        nextNodeList
          .map((node) => {
            const nodeId = trimText(node?.id);
            return [
              nodeId,
              {
                x: node?.position?.x,
                y: node?.position?.y,
              },
            ];
          })
          .filter(([nodeId]) => nodeId),
      ),
      snapshot.nodes.map((node) => node.id),
    );
    setLayoutPositions(nextPositions);
    writeTaskMapLayoutPositions(layoutStorage, layoutStorageKey, nextPositions);
  }

  async function handleConnect(connection = null) {
    const sourceNodeId = trimText(connection?.source || '');
    const targetNodeId = trimText(connection?.target || '');
    setPendingConnectSourceNodeId('');
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId || quickConnectBusy) return;

    const nodeById = new Map(
      baseNodeEntries
        .filter((entry) => trimText(entry?.id))
        .map((entry) => [trimText(entry.id), entry]),
    );
    const sourceEntry = nodeById.get(sourceNodeId) || null;
    const targetEntry = nodeById.get(targetNodeId) || null;
    const targetSessionId = resolveFlowEntrySessionId(targetEntry);
    const validTargets = listConnectTargetsForEntry(sourceEntry);
    const targetAllowed = validTargets.some((entry) => trimText(entry?.sessionId || '') === targetSessionId);
    if (!sourceEntry?.data?.node || !targetSessionId || !targetAllowed) return;

    setQuickConnectBusy(true);
    try {
      const executed = await rendererApi?.nodeActionController?.executeConnectSession?.(
        sourceEntry.data.node,
        targetSessionId,
        {
          state,
          nodeMap,
          isRichView: sourceEntry?.data?.isRichView === true,
          isDone: sourceEntry?.data?.isDone === true,
        },
      );
      if (executed) {
        setActiveComposer(null);
        setActiveActionNodeId('');
      }
    } finally {
      setQuickConnectBusy(false);
    }
  }

  return (
    <div className={`quest-task-flow-scroll quest-task-flow-react-scroll${interactionConfig.isMobile ? ' is-mobile' : ''}`}>
      <div className="quest-task-flow-canvas quest-task-flow-react-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={boardEdges}
            nodeTypes={{ 'melody-node': MelodyNode }}
            edgeTypes={{ 'melody-edge': MelodyEdge }}
            nodesDraggable={interactionConfig.nodesDraggable}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            edgesUpdatable={false}
            elementsSelectable={false}
            selectionOnDrag={false}
            onNodesChange={onNodesChange}
            onNodeDragStop={(_event, _node, draggedNodes) => {
              persistNodePositions(draggedNodes);
            }}
            panOnDrag={interactionConfig.panOnDrag}
            zoomOnScroll={interactionConfig.zoomOnScroll}
            zoomOnPinch={interactionConfig.zoomOnPinch}
            zoomOnDoubleClick={interactionConfig.zoomOnDoubleClick}
            preventScrolling={interactionConfig.preventScrolling}
            fitView={false}
            minZoom={interactionConfig.minZoom}
            maxZoom={interactionConfig.maxZoom}
            proOptions={{ hideAttribution: true }}
            nodeDragThreshold={interactionConfig.nodeDragThreshold}
            onMoveEnd={(_event, viewport) => {
              writeTaskMapViewportMemory(viewportMemoryKey, viewport);
            }}
            onPaneClick={() => {
              setActiveComposer(null);
              setActiveActionNodeId('');
              setPendingConnectSourceNodeId('');
              setSuggestionsOpen(false);
            }}
          >
            <FlowViewportSync
              nodes={flowNodes}
              focusNodeIds={snapshot.focusNodeIds}
              viewportKey={topologyKey}
              viewportMemoryKey={viewportMemoryKey}
              isMobile={rendererApi?.isMobileQuestTracker?.() === true}
            />
          </ReactFlow>
        </ReactFlowProvider>
        {pendingGraphSuggestions.length > 0 ? (
          <div className="quest-task-flow-react-global-actions">
            <div className="quest-task-flow-react-global-button">
              <button
                type="button"
                className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                onClick={() => setSuggestionsOpen((value) => !value)}
                aria-expanded={suggestionsOpen ? 'true' : 'false'}
              >
                整理建议
                <span className="quest-task-flow-react-global-count">{pendingGraphSuggestions.length}</span>
              </button>
            </div>
            {suggestionsOpen ? (
              <div className="quest-task-flow-react-global-panel nodrag nopan">
                <div className="quest-task-flow-react-global-panel-header">
                  <div className="quest-task-flow-react-global-panel-title">当前建议</div>
                  <div className="quest-task-flow-react-global-panel-hint">先看全图，再逐条应用</div>
                </div>
                <div className="quest-task-flow-react-global-list">
                  {pendingGraphSuggestions.slice(0, 5).map((entry) => (
                    <div key={entry.proposalKey} className="quest-task-flow-react-global-item">
                      <div className="quest-task-flow-react-global-item-header">
                        <div className="quest-task-flow-react-global-item-title">
                          <span className="quest-task-flow-react-global-item-title-text">{entry.nodeTitle || '未命名任务'}</span>
                        </div>
                        <div className="quest-task-flow-react-global-item-kind">{entry.kindLabel}</div>
                      </div>
                      <div className="quest-task-flow-react-global-item-reason">{entry.reasonText}</div>
                      <div className="quest-task-flow-react-global-item-actions">
                        <button
                          type="button"
                          className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                          onClick={() => {
                            setActiveComposer(null);
                            setActiveActionNodeId(entry.nodeId);
                            setSuggestionsOpen(false);
                          }}
                        >
                          查看建议
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function createEmptyState(documentRef = document) {
  const empty = documentRef.createElement('div');
  empty.className = 'task-map-empty';
  empty.textContent = '暂无任务地图。';
  return empty;
}

function canUseReactFlowMount(documentRef = document) {
  return Boolean(
    documentRef
    && typeof documentRef.querySelector === 'function'
    && typeof createRoot === 'function',
  );
}

function appendStaticNodeText(documentRef, host, className, text, title = '') {
  const normalizedText = String(text || '').trim();
  if (!normalizedText || !host) return null;
  const node = ensureCompatElement(documentRef.createElement('div'), documentRef);
  node.className = className;
  node.textContent = normalizedText;
  if (title) node.title = String(title);
  host.appendChild(node);
  return node;
}

function renderStaticFlowBoard({
  activeQuest = null,
  nodeMap = new Map(),
  rootNode = null,
  state = null,
  rendererApi = null,
  documentRef = document,
} = {}) {
  const snapshot = buildBoardSnapshot({
    activeQuest,
    nodeMap,
    rootNode,
    state,
    rendererApi,
    positionOverrides: null,
  });
  const container = ensureCompatElement(documentRef.createElement('div'), documentRef);
  container.className = 'quest-task-mindmap-board is-spine quest-task-flow-shell is-static-fallback';
  container.dataset.taskMapRenderer = 'react-flow';
  container.dataset.taskMapViewport = rendererApi?.isMobileQuestTracker?.() === true ? 'mobile' : 'desktop';

  if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    return createEmptyState(documentRef);
  }

  for (const entry of snapshot.nodes) {
    const flowNode = ensureCompatElement(documentRef.createElement('div'), documentRef);
    flowNode.className = String(entry?.data?.className || '').trim();
    const primaryAction = trimText(entry?.data?.primaryAction || '');
    const isRichView = entry?.data?.isRichView === true;
    const isDone = entry?.data?.isDone === true;
    if (flowNode.style?.setProperty) {
      flowNode.style.setProperty('width', entry?.style?.width || '');
      flowNode.style.setProperty('height', entry?.style?.height || '');
      flowNode.style.setProperty('min-height', entry?.style?.minHeight || '');
    }
    appendStaticNodeText(documentRef, flowNode, entry?.data?.badgeClassName || '', entry?.data?.badgeLabel || '');
    appendStaticNodeText(documentRef, flowNode, 'quest-task-flow-node-title', entry?.data?.title || '', entry?.data?.rawTitle || '');
    appendStaticNodeText(documentRef, flowNode, 'quest-task-flow-node-summary', entry?.data?.summary || '', entry?.data?.summary || '');

    if (primaryAction === 'open-session' || isRichView) {
      flowNode.addEventListener('click', async (event) => {
        stopEvent(event);
        if (primaryAction === 'open-session' && !isDone && entry?.data?.node?.sessionId) {
          await rendererApi?.nodeActionController?.executePrimaryAction?.(entry.data.node, {
            state: entry?.data?.state || state,
            nodeMap: entry?.data?.nodeMap || nodeMap,
            isRichView,
            isDone,
          });
          return;
        }
        if (isRichView && typeof rendererApi?.selectTaskCanvasNode === 'function') {
          rendererApi.selectTaskCanvasNode(entry?.data?.node?.id || '', { render: true });
        }
      });
    }

    if (primaryAction === 'create-branch') {
      const actionBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
      actionBtn.type = 'button';
      actionBtn.className = 'quest-branch-btn quest-branch-btn-primary quest-task-flow-node-action nodrag nopan';
      actionBtn.textContent = entry?.data?.actionLabel || '开启';
      actionBtn.addEventListener('click', async (event) => {
        stopEvent(event);
        await rendererApi?.nodeActionController?.executePrimaryAction?.(entry.data.node, {
          state: entry?.data?.state || state,
          nodeMap: entry?.data?.nodeMap || nodeMap,
          isRichView,
          isDone,
        });
      });
      flowNode.appendChild(actionBtn);
    }

    const rawTargets = typeof rendererApi?.listConnectTargets === 'function'
      ? rendererApi.listConnectTargets({
        sourceSessionId: trimText(entry?.data?.node?.sourceSessionId || entry?.data?.node?.sessionId || ''),
        node: entry?.data?.node || null,
        state,
        nodeMap,
      })
      : [];

    const connectActionAvailable = entry?.data?.canConnectSession === true && Array.isArray(rawTargets) && rawTargets.length > 0;
    if (entry?.data?.canCreateManualBranch === true || connectActionAvailable) {
      const actions = ensureCompatElement(documentRef.createElement('div'), documentRef);
      actions.className = 'quest-task-flow-react-node-actions nodrag nopan';
      const strip = ensureCompatElement(documentRef.createElement('div'), documentRef);
      strip.className = 'quest-task-flow-react-node-action-strip';
      actions.appendChild(strip);

      if (entry?.data?.canCreateManualBranch === true) {
        const branchBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
        branchBtn.type = 'button';
        branchBtn.className = 'quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action quest-task-flow-node-action-compact nodrag nopan';
        branchBtn.textContent = '+';
        branchBtn.title = '新建任务';
        strip.appendChild(branchBtn);
      }

      if (connectActionAvailable) {
        const reparentBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
        reparentBtn.type = 'button';
        reparentBtn.className = 'quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action nodrag nopan';
        reparentBtn.textContent = '连接...';
        strip.appendChild(reparentBtn);

        const composer = ensureCompatElement(documentRef.createElement('div'), documentRef);
        composer.className = 'quest-task-flow-reparent-composer nodrag nopan';
        composer.hidden = true;
        const list = ensureCompatElement(documentRef.createElement('div'), documentRef);
        list.className = 'quest-task-flow-reparent-list';
        composer.appendChild(list);

        for (const target of Array.isArray(rawTargets) ? rawTargets.slice(0, 8) : []) {
          const option = ensureCompatElement(documentRef.createElement('button'), documentRef);
          option.type = 'button';
          option.className = 'quest-task-flow-reparent-option nodrag nopan';
          appendStaticNodeText(documentRef, option, 'quest-task-flow-reparent-option-title', target?.title || '未命名任务');
          appendStaticNodeText(documentRef, option, 'quest-task-flow-reparent-option-path', target?.displayPath || target?.path || '当前任务');
          list.appendChild(option);
        }

        reparentBtn.addEventListener('click', (event) => {
          stopEvent(event);
          composer.hidden = false;
        });
        actions.appendChild(composer);
      }

      flowNode.appendChild(actions);
    }

    container.appendChild(flowNode);
  }

  if (rendererApi?.taskHandoffController) {
    for (const edge of Array.isArray(snapshot.edges) ? snapshot.edges : []) {
      if (edge?.data?.canHandoff !== true) continue;
      const actionShell = ensureCompatElement(documentRef.createElement('div'), documentRef);
      actionShell.className = 'quest-task-flow-edge-action-shell is-static-fallback';

      const triggerBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
      triggerBtn.type = 'button';
      triggerBtn.className = 'quest-task-flow-edge-handoff-btn nodrag nopan';
      triggerBtn.textContent = '传递';
      actionShell.appendChild(triggerBtn);

      const popover = ensureCompatElement(documentRef.createElement('div'), documentRef);
      popover.className = 'quest-task-flow-edge-handoff-popover nodrag nopan';
      popover.hidden = true;

      const directions = ensureCompatElement(documentRef.createElement('div'), documentRef);
      directions.className = 'quest-task-flow-edge-handoff-directions';
      popover.appendChild(directions);

      const previewHost = ensureCompatElement(documentRef.createElement('div'), documentRef);
      previewHost.className = 'quest-task-flow-edge-handoff-preview';
      popover.appendChild(previewHost);
      const summaryEl = ensureCompatElement(documentRef.createElement('div'), documentRef);
      summaryEl.className = 'quest-task-flow-edge-handoff-summary';
      popover.insertBefore(summaryEl, previewHost);
      const detailLevelControls = ensureCompatElement(documentRef.createElement('div'), documentRef);
      detailLevelControls.className = 'quest-task-flow-edge-handoff-detail-levels';
      popover.insertBefore(detailLevelControls, previewHost);

      let activeDirection = 'forward';
      let activeDetailLevel = 'balanced';
      const renderPreview = () => {
        previewHost.innerHTML = '';
        const preview = rendererApi.taskHandoffController.buildPreview(edge.data, activeDirection, {
          detailLevel: activeDetailLevel,
        });
        summaryEl.textContent = trimText(preview?.summary || '');
        summaryEl.hidden = !summaryEl.textContent;
        const sections = Array.isArray(preview?.sections) ? preview.sections : [];
        if (sections.length === 0) {
          appendStaticNodeText(documentRef, previewHost, 'quest-task-flow-edge-handoff-empty', '当前没有可传递的结构化上下文。');
          return;
        }
        for (const section of sections) {
          const sectionEl = ensureCompatElement(documentRef.createElement('div'), documentRef);
          sectionEl.className = 'quest-task-flow-edge-handoff-section';
          appendStaticNodeText(documentRef, sectionEl, 'quest-task-flow-edge-handoff-section-title', section.label || '');
          const body = ensureCompatElement(documentRef.createElement('div'), documentRef);
          body.className = 'quest-task-flow-edge-handoff-section-body';
          for (const item of Array.isArray(section.items) ? section.items : []) {
            appendStaticNodeText(documentRef, body, 'quest-task-flow-edge-handoff-item', item || '');
          }
          sectionEl.appendChild(body);
          previewHost.appendChild(sectionEl);
        }
      };

      for (const option of EDGE_HANDOFF_DETAIL_LEVEL_OPTIONS) {
        const detailBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
        detailBtn.type = 'button';
        detailBtn.className = `quest-task-flow-edge-handoff-detail-level nodrag nopan${option.value === activeDetailLevel ? ' is-active' : ''}`;
        detailBtn.textContent = option.label;
        detailBtn.addEventListener('click', (event) => {
          stopEvent(event);
          activeDetailLevel = option.value;
          for (const child of detailLevelControls.children || []) {
            child.classList?.remove?.('is-active');
          }
          detailBtn.classList?.add?.('is-active');
          renderPreview();
        });
        detailLevelControls.appendChild(detailBtn);
      }

      for (const nextDirection of ['forward', 'reverse']) {
        const preview = rendererApi.taskHandoffController.buildPreview(edge.data, nextDirection, {
          detailLevel: activeDetailLevel,
        });
        const directionBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
        directionBtn.type = 'button';
        directionBtn.className = `quest-task-flow-edge-handoff-direction nodrag nopan${nextDirection === activeDirection ? ' is-active' : ''}`;
        directionBtn.textContent = getEdgeHandoffDirectionLabel(preview);
        directionBtn.addEventListener('click', (event) => {
          stopEvent(event);
          activeDirection = nextDirection;
          for (const child of directions.children || []) {
            child.classList?.remove?.('is-active');
          }
          directionBtn.classList?.add?.('is-active');
          renderPreview();
        });
        directions.appendChild(directionBtn);
      }

      const actions = ensureCompatElement(documentRef.createElement('div'), documentRef);
      actions.className = 'quest-task-flow-edge-handoff-actions';
      const confirmBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
      confirmBtn.type = 'button';
      confirmBtn.className = 'quest-branch-btn quest-branch-btn-primary nodrag nopan';
      confirmBtn.textContent = '确认传递';
      confirmBtn.addEventListener('click', async (event) => {
        stopEvent(event);
        confirmBtn.disabled = true;
        try {
          await rendererApi.taskHandoffController.executeHandoff(edge.data, activeDirection, {
            detailLevel: activeDetailLevel,
          });
          popover.hidden = true;
        } finally {
          confirmBtn.disabled = false;
        }
      });
      const cancelBtn = ensureCompatElement(documentRef.createElement('button'), documentRef);
      cancelBtn.type = 'button';
      cancelBtn.className = 'quest-branch-btn quest-branch-btn-secondary nodrag nopan';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', (event) => {
        stopEvent(event);
        popover.hidden = true;
      });
      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      popover.appendChild(actions);

      triggerBtn.addEventListener('click', (event) => {
        stopEvent(event);
        popover.hidden = !popover.hidden;
      });

      renderPreview();
      actionShell.appendChild(popover);
      container.appendChild(actionShell);
    }
  }

  return container;
}

function createRenderer({
  documentRef = document,
  windowRef = window,
  isMobileQuestTracker = () => false,
  clipText: clipTextImpl = clipText,
  translate = (key) => key,
  collapseTaskMapAfterAction = null,
  enterBranchFromSession = null,
  reparentSession = null,
  connectSessions = null,
  listReparentTargets = null,
  listConnectTargets = null,
  getSessionRecord = null,
  attachSession = null,
  buildTaskHandoffPreview = null,
  handoffSessionTaskData = null,
  selectTaskCanvasNode = null,
  getSelectedTaskCanvasNodeId = () => '',
  getCurrentSessionId = () => '',
} = {}) {
  ensureReactDocumentCompat(documentRef);
  ensureReactFlowStyles(documentRef);
  const supportsReactFlowMount = canUseReactFlowMount(documentRef);
  const nodeActionController = getNodeActionController(windowRef, {
    collapseTaskMapAfterAction,
    enterBranchFromSession,
    getSessionRecord,
    attachSession,
    reparentSession,
    getCurrentSessionId,
  });
  let reactFlowBoardContainer = null;
  let reactFlowBoardRoot = null;
  const rendererApi = {
    documentRef,
    windowRef,
    isMobileQuestTracker,
    clipText: clipTextImpl,
    translate,
    listReparentTargets,
    selectTaskCanvasNode,
    getSelectedTaskCanvasNodeId,
    getCurrentSessionId,
    nodeActionController,
  };

  return {
    getRenderStateKey() {
      return trimText(getSelectedTaskCanvasNodeId?.() || '');
    },
    renderFlowBoard({ activeQuest, nodeMap, rootNode, state }) {
      const hasNodeMapApi = nodeMap && typeof nodeMap.get === 'function';
      if (!activeQuest || !hasNodeMapApi || !rootNode?.id) {
        return createEmptyState(documentRef);
      }
      if (!supportsReactFlowMount) {
        return renderStaticFlowBoard({
          activeQuest,
          nodeMap,
          rootNode,
          state,
          rendererApi,
          documentRef,
        });
      }
      if (!reactFlowBoardContainer || !reactFlowBoardRoot) {
        reactFlowBoardContainer = ensureCompatElement(documentRef.createElement('div'), documentRef);
        reactFlowBoardRoot = createRoot(reactFlowBoardContainer);
      }
      const container = reactFlowBoardContainer;
      const interactionConfig = getTaskMapInteractionConfig({
        mobile: isMobileQuestTracker() === true,
      });
      container.className = `quest-task-mindmap-board is-spine quest-task-flow-shell ${interactionConfig.shellClassName}`;
      container.dataset.taskMapRenderer = 'react-flow';
      container.dataset.taskMapViewport = interactionConfig.isMobile ? 'mobile' : 'desktop';
      reactFlowBoardRoot.render(
        <TaskFlowBoard
          activeQuest={activeQuest}
          nodeMap={nodeMap}
          rootNode={rootNode}
          state={state}
          rendererApi={rendererApi}
        />,
      );
      container.__melodysyncCleanup = () => {
        reactFlowBoardRoot?.unmount?.();
        reactFlowBoardRoot = null;
        reactFlowBoardContainer = null;
      };
      return container;
    },
  };
}

const workbenchReactUiApi = Object.freeze({
  createRenderer,
  createRichViewRenderer,
  createNodeCanvasController,
  createTrackerRenderer,
  renderSessionList,
  createSessionListRenderer,
  createTaskListController,
  createStatusCardRenderer,
  createPersistentEditorRenderer,
  createOperationRecordSummaryRenderer,
  createOperationRecordListRenderer,
});

globalThis.MelodySyncWorkbenchReactUi = workbenchReactUiApi;
globalThis.MelodySyncSessionListReactUi = workbenchReactUiApi;
globalThis.MelodySyncTaskMapReactUi = workbenchReactUiApi;
