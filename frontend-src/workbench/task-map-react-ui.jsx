import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Handle,
  Position,
  ReactFlowProvider,
  ReactFlow,
  useNodesState,
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
const REACT_FLOW_EXTRA_CSS = `
.quest-task-flow-react-shell {
  position: relative;
}

.quest-task-flow-react-scroll {
  position: relative;
  min-width: 100%;
  min-height: 100%;
}

.quest-task-flow-react-canvas {
  width: 100%;
  height: 100%;
  min-height: 100%;
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
}

.quest-task-flow-react-node-shell .quest-task-flow-node {
  position: relative;
  left: auto !important;
  top: auto !important;
  width: 100%;
  min-height: 100%;
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
  touch-action: pan-x pan-y pinch-zoom;
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

function ensureReactFlowStyles(documentRef = document) {
  const doc = documentRef || globalThis?.document;
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
      const container = documentRef.createElement('div');
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
  getPersistentActionsEl = () => null,
  clipText: clipTextImpl = (value) => String(value || '').trim(),
  toConciseGoal = (value) => String(value || '').trim(),
  isMobileQuestTracker = () => false,
  isRedundantTrackerText = () => false,
  getCurrentTaskSummary = () => '',
  getBranchDisplayName = (session) => String(session?.name || '').trim(),
} = {}) {
  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
    if (host.__melodysyncReactRoot) return host.__melodysyncReactRoot;
    host.__melodysyncReactRoot = createRoot(host);
    return host.__melodysyncReactRoot;
  }

  function getTrackerVisualStatus(state) {
    if (!state?.hasSession || !state?.session) {
      return { key: '', label: '', dotClassName: '' };
    }
    const taskRunStatus = getTaskRunStatusApi(window)?.getTaskRunStatusPresentation?.({
      status: state?.branchStatus || '',
      workflowState: state?.session?.workflowState || '',
      activityState: state?.session?.activity?.run?.state || '',
      isCurrent: true,
      showIdle: true,
    }) || getTaskRunStatusApi(window)?.getTaskRunStatusUi?.({
      status: state?.branchStatus || '',
      workflowState: state?.session?.workflowState || '',
      activityState: state?.session?.activity?.run?.state || '',
      isCurrent: true,
      showIdle: true,
    }) || { key: '', label: '', summary: '', dotClassName: '' };
    const label = String(taskRunStatus?.label || '').trim();
    if (!label) {
      return { key: '', label: '', dotClassName: '' };
    }
    return {
      key: String(taskRunStatus?.key || '').trim(),
      label,
      dotClassName: String(taskRunStatus?.dotClassName || '').trim(),
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
      ? (getBranchDisplayName(state.session) || state.currentGoal || state.session?.name || state.mainGoal)
      : (state.session?.name || state.mainGoal || state.currentGoal);
    return toConciseGoal(baseTitle, isMobileQuestTracker() ? 44 : 64) || '当前任务';
  }

  function getPrimaryDetail(state) {
    if (!state?.hasSession) return '';
    if (state.isBranch) {
      return clipTextImpl(`来自主线：${state.branchFrom || state.mainGoal || '当前主线'}`, isMobileQuestTracker() ? 84 : 112);
    }
    const summary = clipTextImpl(getCurrentTaskSummary(state), isMobileQuestTracker() ? 80 : 112);
    if (summary) return summary;
    const currentGoal = clipTextImpl(state.currentGoal || '', isMobileQuestTracker() ? 80 : 112);
    return isRedundantTrackerText(currentGoal, state.session?.name, state.mainGoal) ? '' : currentGoal;
  }

  function getSecondaryDetail(state, primaryDetail = '') {
    if (!state?.hasSession) return '';
    if (!state.isBranch) {
      const candidateCount = Number(state?.candidateBranchCount || 0);
      return candidateCount > 0 ? `发现 ${candidateCount} 条建议支线` : '';
    }
    const nextStep = clipTextImpl(state.nextStep || '', isMobileQuestTracker() ? 72 : 96);
    if (!nextStep) return '';
    return isRedundantTrackerText(nextStep, state.currentGoal, primaryDetail) ? '' : nextStep;
  }

  function renderDetailList(host, items) {
    if (!host) return;
    ensureRoot(host)?.render(<TrackerDetailList items={items} />);
  }

  function renderDetail(taskCard, expanded) {
    if (!trackerDetailEl) return;
    const goal = taskCard?.goal || '';
    const showGoal = Boolean(goal);
    if (trackerGoalValEl) trackerGoalValEl.textContent = goal;
    if (trackerGoalRowEl) trackerGoalRowEl.hidden = !showGoal;

    const conclusions = Array.isArray(taskCard?.knownConclusions) ? taskCard.knownConclusions : [];
    renderDetailList(trackerConclusionsListEl, conclusions);
    if (trackerConclusionsRowEl) trackerConclusionsRowEl.hidden = conclusions.length === 0;

    const memory = Array.isArray(taskCard?.memory) ? taskCard.memory : [];
    renderDetailList(trackerMemoryListEl, memory);
    if (trackerMemoryRowEl) trackerMemoryRowEl.hidden = memory.length === 0;

    const hasAny = showGoal || conclusions.length > 0 || memory.length > 0;
    if (trackerDetailToggleBtn) {
      trackerDetailToggleBtn.hidden = !hasAny;
      trackerDetailToggleBtn.textContent = expanded ? '详情 ▾' : '详情 ▸';
    }
    trackerDetailEl.hidden = !hasAny || !expanded;
  }

  function renderPersistentActions(session, {
    onPromote = null,
    onRun = null,
    onToggle = null,
    onConfigure = null,
  } = {}) {
    const host = getPersistentActionsEl?.();
    if (!host) return;
    const kind = String(session?.persistent?.kind || '').trim().toLowerCase();
    if (!session?.id) {
      host.hidden = true;
      ensureRoot(host)?.render(null);
      return;
    }

    let buttons = [];
    if (!kind) {
      if (session?.archived === true) {
        host.hidden = true;
        ensureRoot(host)?.render(null);
        return;
      }
      buttons = [
        { label: '沉淀为长期项', onClick: onPromote, secondary: false },
      ];
    } else if (kind === 'recurring_task') {
      buttons = [
        { label: '立即执行', onClick: onRun, secondary: false },
        {
          label: String(session?.persistent?.state || '').trim().toLowerCase() === 'paused' ? '恢复周期' : '暂停周期',
          onClick: onToggle,
          secondary: true,
        },
        { label: '设置', onClick: onConfigure, secondary: true },
      ];
    } else if (kind === 'skill') {
      buttons = [
        { label: '触发按钮', onClick: onRun, secondary: false },
        { label: '设置', onClick: onConfigure, secondary: true },
      ];
    }

    host.hidden = buttons.length === 0;
    ensureRoot(host)?.render(buttons.length ? <TrackerPersistentActionsContent buttons={buttons} /> : null);
  }

  return {
    getPrimaryDetail,
    getPrimaryTitle,
    getSecondaryDetail,
    renderDetail,
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
  let lastRenderKey = '';
  let currentBoard = null;
  const reactRoot = trackerTaskListEl ? createRoot(trackerTaskListEl) : null;

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
    const renderKey = [
      state?.session?.id || '',
      activeQuest?.id || '',
      activeQuest?.currentNodeId || '',
      nodeEntries.join('|'),
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
          开启支线
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
        {mergeType === 'conclusion' ? '支线结论已带回主线' : '支线线索已带回主线'}
      </div>
      <div className="quest-merge-note-title">{branchTitle || '支线'}</div>
      <div className="quest-merge-note-summary">{clipTextImpl(content, 180)}</div>
      {nextStep ? (
        <div className="quest-merge-note-next">{`主线下一步：${nextStep}`}</div>
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
      <div className="quest-merge-note-label">已开启支线任务</div>
      <div className="quest-merge-note-title">{branchTitle}</div>
      {branchFrom ? (
        <div className="quest-merge-note-summary">{`来自主线：${branchFrom}`}</div>
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
  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(host);
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
}) {
  const [, setVersion] = useState(0);

  function rerender() {
    setVersion((value) => value + 1);
  }

  function pinRuntime(targetKey) {
    if (!draft || !currentRuntime?.tool) return;
    draft[targetKey] = cloneJson(currentRuntime);
    rerender();
  }

  function updateKind(nextKind) {
    if (!draft) return;
    draft.kind = nextKind;
    if (nextKind === 'recurring_task') {
      if (draft.scheduleMode !== 'pinned' && draft.scheduleMode !== 'session_default') {
        draft.scheduleMode = currentRuntime?.tool ? 'pinned' : 'session_default';
      }
      if (draft.scheduleMode === 'pinned' && !draft.scheduleRuntime?.tool && currentRuntime?.tool) {
        draft.scheduleRuntime = cloneJson(currentRuntime);
      }
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
  const dialogTitle = draft?.mode === 'configure' ? '长期项设置' : '沉淀为长期项';
  const leadText = draft
    ? (draft.mode === 'configure' ? '只保留类型、名称、摘要和提示词。' : '已根据当前会话自动生成一版长期项摘要。')
    : '正在整理当前会话内容…';

  return (
    <div className="modal persistent-editor-modal" role="dialog" aria-modal="true">
      <div className="modal-header persistent-editor-modal-header">
        <div className="modal-title persistent-editor-modal-title">{dialogTitle}</div>
        <button
          type="button"
          className="modal-close"
          aria-label="关闭"
          onClick={() => onClose?.()}
        >
          ×
        </button>
      </div>
      <div className="modal-lead persistent-editor-modal-lead">{leadText}</div>
      <div className="modal-body persistent-editor-modal-body">
        {isLoading || !draft ? (
          <div className="persistent-editor-modal-loading">正在加载…</div>
        ) : (
          <div className="persistent-editor-modal-form">
            <PersistentEditorField label="类型">
              <div className="operation-record-persistent-kind-row persistent-editor-modal-kind-row">
                {[
                  { kind: 'recurring_task', label: '长期任务' },
                  { kind: 'skill', label: '快捷按钮' },
                ].map((entry) => (
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
                rows={4}
                defaultValue={draft.digestSummary}
                placeholder="保留这次会话沉淀下来的核心摘要"
                onInput={(event) => {
                  draft.digestSummary = event.currentTarget.value;
                }}
              />
            </PersistentEditorField>

            <PersistentEditorField label="提示词">
              <textarea
                className="operation-record-persistent-textarea"
                rows={4}
                defaultValue={draft.runPrompt}
                placeholder="触发时默认要执行什么"
                onInput={(event) => {
                  draft.runPrompt = event.currentTarget.value;
                }}
              />
            </PersistentEditorField>

            {draft.kind === 'recurring_task' ? (
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

            {draft.kind === 'recurring_task' ? (
              <PersistentRuntimeSection
                title="周期执行"
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
        )}
      </div>
      <div className="modal-footer persistent-editor-modal-footer">
        {!isLoading && draft ? (
          <>
            <button type="button" className="modal-btn" onClick={() => onClose?.()}>
              取消
            </button>
            <button type="button" className="modal-btn primary" onClick={() => onSave?.()}>
              {draft.mode === 'configure' ? '保存' : '保存为长期项'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function createPersistentEditorRenderer({
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
} = {}) {
  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
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
  } else if (kind === 'skill') {
    buttons.push({ label: '触发按钮', secondary: false, onClick: onRun });
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
  if (!digestTitle && !summary && keyPoints.length === 0) return null;

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
    </>
  );
}

function createOperationRecordSummaryRenderer({
  documentRef = document,
  clipText: clipTextImpl = clipText,
} = {}) {
  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(host);
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
        : (item?.status === 'resolved' ? '已完成' : '支线')));

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
  function mountIntoHost(host, element) {
    if (!host) return null;
    const root = createRoot(host);
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
  }, [archived, createSessionItem, session]);

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
          />
        ))}
      </div>
    </div>
  );
}

function SessionListGroupSection({
  groupEntry = null,
  showGroupHeaders = false,
  isCollapsed = false,
  onToggleGroup = null,
  createSessionItem = null,
  chevronIconHtml = '',
}) {
  const sessions = Array.isArray(groupEntry?.sessions) ? groupEntry.sessions : [];
  return (
    <div className={`folder-group${showGroupHeaders ? '' : ' is-ungrouped'}`}>
      {showGroupHeaders ? (
        <div
          className={`folder-group-header${isCollapsed ? ' collapsed' : ''}`}
          onClick={() => onToggleGroup?.(groupEntry?.key || '', !isCollapsed)}
        >
          <SessionListChevron className="folder-chevron" iconHtml={chevronIconHtml} />
          <span className="folder-name" title={String(groupEntry?.title || '')}>{String(groupEntry?.label || '')}</span>
          <span className="folder-count">{sessions.length}</span>
        </div>
      ) : null}
      <div className="folder-group-items">
        {sessions.map((session) => (
          <SessionListItemMount
            key={`group:${groupEntry?.key || 'ungrouped'}:${session?.id || Math.random()}`}
            createSessionItem={createSessionItem}
            session={session}
          />
        ))}
      </div>
    </div>
  );
}

function ArchivedSessionSection({
  shouldRenderSection = false,
  isCollapsed = false,
  count = 0,
  archivedSessions = [],
  archivedSessionsLoading = false,
  archivedLabel = '已归档',
  loadingLabel = '加载中',
  emptyText = '',
  onToggleArchived = null,
  createSessionItem = null,
  chevronIconHtml = '',
}) {
  if (!shouldRenderSection) return null;
  const sessions = Array.isArray(archivedSessions) ? archivedSessions : [];
  const showLoading = archivedSessionsLoading && sessions.length === 0;
  const showEmpty = !showLoading && sessions.length === 0;

  return (
    <div id="archivedSection" className="archived-section">
      <div
        className={`archived-section-header${isCollapsed ? ' collapsed' : ''}`}
        onClick={() => onToggleArchived?.(!isCollapsed)}
      >
        <SessionListChevron className="folder-chevron" iconHtml={chevronIconHtml} />
        <span className="archived-label">{archivedLabel}</span>
        <span className="folder-count">{count}</span>
      </div>
      <div className="archived-items">
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
            />
          ))
          : null}
      </div>
    </div>
  );
}

function PersistentDockSection({
  groupKey = '',
  label = '',
  sessions = [],
  isCollapsed = false,
  onToggleSection = null,
  createSessionItem = null,
  chevronIconHtml = '',
}) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  return (
    <div className={`persistent-dock-section${isCollapsed ? ' is-collapsed' : ''}`}>
      <button
        className="persistent-dock-header"
        type="button"
        aria-label={`${label} ${safeSessions.length} 项`}
        onClick={() => onToggleSection?.(groupKey, !isCollapsed)}
      >
        <span className="persistent-dock-title">{label}</span>
        <span className="persistent-dock-count">{safeSessions.length}</span>
        <SessionListChevron className="persistent-dock-chevron" iconHtml={chevronIconHtml} />
      </button>
      <div className="persistent-dock-body">
        {safeSessions.map((session) => (
          <SessionListItemMount
            key={`persistent:${groupKey}:${session?.id || Math.random()}`}
            createSessionItem={createSessionItem}
            session={session}
          />
        ))}
      </div>
    </div>
  );
}

function PersistentSessionDock({
  longTermSessions = [],
  quickActionSessions = [],
  sectionTitle = '长期项',
  longTermLabel = '长期任务',
  quickActionsLabel = '快捷动作',
  isCollapsed = false,
  isSectionCollapsed = () => false,
  onToggleDock = null,
  onToggleSection = null,
  createSessionItem = null,
  chevronIconHtml = '',
}) {
  const hasLongTerm = Array.isArray(longTermSessions) && longTermSessions.length > 0;
  const hasQuickActions = Array.isArray(quickActionSessions) && quickActionSessions.length > 0;
  if (!hasLongTerm && !hasQuickActions) return null;
  const totalCount = (hasLongTerm ? longTermSessions.length : 0) + (hasQuickActions ? quickActionSessions.length : 0);

  return (
    <div className={`session-list-persistent-dock${isCollapsed ? ' is-collapsed' : ''}`}>
      <button
        className="persistent-dock-overview"
        type="button"
        aria-label={`${sectionTitle} ${totalCount} 项`}
        onClick={() => onToggleDock?.(!isCollapsed)}
      >
        <span className="persistent-dock-overview-title">{sectionTitle}</span>
        <span className="persistent-dock-overview-count">{totalCount}</span>
        <SessionListChevron className="persistent-dock-overview-chevron" iconHtml={chevronIconHtml} />
      </button>
      <div className="session-list-persistent-dock-body">
        {hasLongTerm ? (
          <PersistentDockSection
            groupKey="group:long-term"
            label={longTermLabel}
            sessions={longTermSessions}
            isCollapsed={isSectionCollapsed('group:long-term') === true}
            onToggleSection={onToggleSection}
            createSessionItem={createSessionItem}
            chevronIconHtml={chevronIconHtml}
          />
        ) : null}
        {hasQuickActions ? (
          <PersistentDockSection
            groupKey="group:quick-actions"
            label={quickActionsLabel}
            sessions={quickActionSessions}
            isCollapsed={isSectionCollapsed('group:quick-actions') === true}
            onToggleSection={onToggleSection}
            createSessionItem={createSessionItem}
            chevronIconHtml={chevronIconHtml}
          />
        ) : null}
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
  createSessionItem = null,
  chevronIconHtml = '',
  pinnedLabel = '',
  archived = null,
}) {
  return (
    <>
      <SessionListPinnedSection
        pinnedSessions={Array.isArray(pinnedSessions) ? pinnedSessions : []}
        pinnedLabel={pinnedLabel}
        createSessionItem={createSessionItem}
      />
      {(Array.isArray(orderedGroups) ? orderedGroups : []).map((groupEntry) => (
        <SessionListGroupSection
          key={`session-group:${groupEntry?.key || Math.random()}`}
          groupEntry={groupEntry}
          showGroupHeaders={showGroupHeaders}
          isCollapsed={isGroupCollapsed(groupEntry?.key || '') === true}
          onToggleGroup={onToggleGroup}
          createSessionItem={createSessionItem}
          chevronIconHtml={chevronIconHtml}
        />
      ))}
      <ArchivedSessionSection
        shouldRenderSection={archived?.shouldRenderSection === true}
        isCollapsed={archived?.isCollapsed === true}
        count={Number.isFinite(archived?.count) ? archived.count : 0}
        archivedSessions={Array.isArray(archived?.archivedSessions) ? archived.archivedSessions : []}
        archivedSessionsLoading={archived?.archivedSessionsLoading === true}
        archivedLabel={String(archived?.archivedLabel || '')}
        loadingLabel={String(archived?.loadingLabel || '')}
        emptyText={String(archived?.emptyText || '')}
        onToggleArchived={archived?.onToggleArchived}
        createSessionItem={createSessionItem}
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
  function ensureRoot(host) {
    if (!host || typeof createRoot !== 'function') return null;
    if (host.__melodysyncReactRoot) return host.__melodysyncReactRoot;
    host.innerHTML = '';
    host.__melodysyncReactRoot = createRoot(host);
    return host.__melodysyncReactRoot;
  }

  const chevronIconHtml = renderUiIcon('chevron-down');

  function renderSessionCollections({
    listEl = null,
    pinnedSessions = [],
    orderedGroups = [],
    showGroupHeaders = false,
    isGroupCollapsed = () => false,
    onToggleGroup = null,
    createSessionItem: createSessionItemOverride = null,
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
        createSessionItem={createSessionItemOverride || createSessionItem}
        chevronIconHtml={chevronIconHtml}
        pinnedLabel={String(translate('sidebar.pinned') || '')}
        archived={archived}
      />,
    );
  }

  function renderPersistentDock({
    containerEl = null,
    persistentSessionsByGroup = {},
    isDockCollapsed = false,
    isSectionCollapsed = () => false,
    onToggleDock = null,
    onToggleSection = null,
    createSessionItem: createSessionItemOverride = null,
  } = {}) {
    if (!containerEl) return;
    const longTermSessions = Array.isArray(persistentSessionsByGroup?.['group:long-term'])
      ? persistentSessionsByGroup['group:long-term']
      : [];
    const quickActionSessions = Array.isArray(persistentSessionsByGroup?.['group:quick-actions'])
      ? persistentSessionsByGroup['group:quick-actions']
      : [];
    const hasPersistentDock = longTermSessions.length > 0 || quickActionSessions.length > 0;
    containerEl.className = hasPersistentDock ? 'session-list-footer has-persistent-dock' : 'session-list-footer';
    containerEl.hidden = !hasPersistentDock;
    ensureRoot(containerEl)?.render(
      hasPersistentDock ? (
        <PersistentSessionDock
          longTermSessions={longTermSessions}
          quickActionSessions={quickActionSessions}
          sectionTitle={String(translate('persistent.sectionTitle') || '')}
          longTermLabel={String(translate('sidebar.group.longTerm') || '')}
          quickActionsLabel={String(translate('sidebar.group.quickActions') || '')}
          isCollapsed={isDockCollapsed === true}
          isSectionCollapsed={isSectionCollapsed}
          onToggleDock={onToggleDock}
          onToggleSection={onToggleSection}
          createSessionItem={createSessionItemOverride || createSessionItem}
          chevronIconHtml={chevronIconHtml}
        />
      ) : null,
    );
  }

  return Object.freeze({
    renderSessionCollections,
    renderPersistentDock,
  });
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
  return getNodeEffect(windowRef, node)?.actionLabel || '开启支线';
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
    nodeWidth: mobile ? 152 : 188,
    rootWidth: mobile ? 176 : 224,
    richNodeWidth: mobile ? 166 : 210,
    nodeHeight: mobile ? 88 : 100,
    rootHeight: mobile ? 98 : 118,
    candidateHeight: mobile ? 108 : 126,
    richNodeHeight: mobile ? 108 : 132,
    levelGap: mobile ? 98 : 122,
    siblingGap: mobile ? 18 : 22,
    paddingX: mobile ? 144 : 240,
    paddingY: mobile ? 112 : 176,
  };
}

function getProjectedTaskFlowNodeChildren(node, nodeMap) {
  return Array.isArray(node?.childNodeIds)
    ? node.childNodeIds.map((childId) => nodeMap.get(childId)).filter(Boolean)
    : [];
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

function buildProjectedTaskFlowTree(windowRef, nodeId, nodeMap) {
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  return {
    node,
    children: getProjectedTaskFlowNodeChildren(node, nodeMap)
      .map((child) => buildProjectedTaskFlowTree(windowRef, child.id, nodeMap))
      .filter(Boolean),
    width: 0,
    x: 0,
    y: 0,
    nodeWidth: 0,
    nodeHeight: 0,
  };
}

function measureProjectedTaskFlowTree(windowRef, tree, metrics) {
  if (!tree) return 0;
  const nodeWidth = getProjectedTaskFlowNodeWidth(windowRef, tree.node, metrics);
  if (!tree.children.length) {
    tree.width = nodeWidth;
    return tree.width;
  }
  const childWidths = tree.children.map((child) => measureProjectedTaskFlowTree(windowRef, child, metrics));
  const childrenWidth = childWidths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
  tree.width = Math.max(nodeWidth, childrenWidth);
  return tree.width;
}

function positionProjectedTaskFlowTree(windowRef, tree, left, top, metrics) {
  if (!tree) return;
  tree.nodeWidth = getProjectedTaskFlowNodeWidth(windowRef, tree.node, metrics);
  tree.nodeHeight = getProjectedTaskFlowNodeHeight(windowRef, tree.node, metrics);
  tree.x = left + Math.max(0, (tree.width - tree.nodeWidth) / 2);
  tree.y = top;
  if (!tree.children.length) return;

  const childrenWidth = tree.children.reduce((sum, child) => sum + child.width, 0)
    + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
  let cursor = left + Math.max(0, (tree.width - childrenWidth) / 2);
  const nextTop = top + tree.nodeHeight + metrics.levelGap;
  for (const child of tree.children) {
    positionProjectedTaskFlowTree(windowRef, child, cursor, nextTop, metrics);
    cursor += child.width + metrics.siblingGap;
  }
}

function flattenProjectedTaskFlowTree(tree, results = []) {
  if (!tree) return results;
  results.push(tree);
  for (const child of tree.children) {
    flattenProjectedTaskFlowTree(child, results);
  }
  return results;
}

function collectProjectedTaskFlowEdges(tree, edgeByTargetNodeId = new Map(), results = []) {
  if (!tree) return results;
  for (const child of tree.children) {
    const edge = edgeByTargetNodeId.get(child.node?.id) || null;
    results.push({
      id: trimText(edge?.id) || `edge:${tree.node?.id}:${child.node?.id}`,
      fromNodeId: trimText(tree.node?.id || ''),
      toNodeId: trimText(child.node?.id || ''),
      fromX: tree.x + tree.nodeWidth / 2,
      fromY: tree.y + tree.nodeHeight,
      toX: child.x + child.nodeWidth / 2,
      toY: child.y,
      current: child.node?.isCurrent === true,
      variant: edge?.type || getNodeEffect(globalThis?.window || window, child.node)?.edgeVariant || 'structural',
    });
    collectProjectedTaskFlowEdges(child, edgeByTargetNodeId, results);
  }
  return results;
}

function getProjectedTaskFlowNodeMeta(windowRef, node) {
  const nodeEffect = getNodeEffect(windowRef, node);
  const nodeStatusUi = getTaskFlowNodeStatusUi(windowRef, node);
  const nodeStatusLabel = String(nodeStatusUi?.label || '').trim();
  const metaLabel = String(getNodeEffectsApi(windowRef)?.getNodeMetaLabel?.(node) || '').trim();
  if (metaLabel) return metaLabel;
  if (nodeEffect?.metaVariant === 'candidate') return '可选';
  if (nodeEffect?.metaVariant === 'done') return '已收束';
  return nodeStatusLabel || '空闲';
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

function createFallbackNodeActionController({
  collapseTaskMapAfterAction = null,
  enterBranchFromSession = null,
  getSessionRecord = null,
  attachSession = null,
  reparentSession = null,
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
      if (this.hasNodeCapability(node, 'create-branch')) return 'create-branch';
      if (this.hasNodeCapability(node, 'open-session') && node?.sessionId) return 'open-session';
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
    async executeManualBranch(node, branchTitle, options = {}) {
      const sourceSessionId = trimText(node?.sourceSessionId || node?.sessionId);
      const normalizedTitle = trimText(branchTitle);
      if (!sourceSessionId || !normalizedTitle || typeof enterBranchFromSession !== 'function') return false;
      collapseTaskMapAfterAction?.({ render: false });
      await enterBranchFromSession(sourceSessionId, normalizedTitle, {
        branchReason: trimText(options?.branchReason) || `从「${trimText(node?.title) || '当前任务'}」继续拆出独立支线`,
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
    async executePrimaryAction(node, { state = null, nodeMap = new Map(), isRichView = false, isDone = false } = {}) {
      const action = this.resolvePrimaryAction(node, { isRichView, isDone });
      if (action === 'create-branch') {
        const sourceSessionId = trimText(node?.sessionId || node?.sourceSessionId);
        if (!sourceSessionId || typeof enterBranchFromSession !== 'function') return false;
        collapseTaskMapAfterAction?.({ render: false });
        await enterBranchFromSession(sourceSessionId, node.title, {
          branchReason: node?.parentNodeId
            ? `从「${nodeMap.get(node.parentNodeId)?.title || '当前节点'}」继续拆出独立支线`
            : '从当前任务拆出独立支线',
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
  };
}

function getNodeActionController(windowRef, options = {}) {
  const api = getNodeCapabilitiesApi(windowRef);
  if (typeof api?.createController === 'function') {
    return api.createController(options);
  }
  return createFallbackNodeActionController(options);
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
  const tree = buildProjectedTaskFlowTree(windowRef, rootNode.id, nodeMap);
  measureProjectedTaskFlowTree(windowRef, tree, metrics);
  positionProjectedTaskFlowTree(windowRef, tree, metrics.paddingX, metrics.paddingY, metrics);

  const entries = flattenProjectedTaskFlowTree(tree, []);
  const edgeByTargetNodeId = new Map(
    (Array.isArray(activeQuest?.edges) ? activeQuest.edges : [])
      .filter((edge) => edge?.toNodeId)
      .map((edge) => [edge.toNodeId, edge]),
  );
  const edges = collectProjectedTaskFlowEdges(tree, edgeByTargetNodeId, []);
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
    const canCreateManualBranch = node?.isCurrent === true
      && rendererApi?.nodeActionController?.canCreateManualBranch?.(node, { isRichView, isDone }) === true;
    const canReparentSession = node?.isCurrent === true
      && rendererApi?.nodeActionController?.canReparentSession?.(node, { isRichView, isDone }) === true;
    const statusAliasClassName = trimText(
      taskRunStatusApi?.getTaskRunStatusResolvedNodeClassName?.(nodeStatusUi?.key || '', 'is-') || '',
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
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: true,
      selectable: false,
      connectable: false,
      focusable: false,
      style: {
        width: `${Math.ceil(entry.nodeWidth)}px`,
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
        canReparentSession,
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
    .map((edge) => ({
      id: edge.id,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      type: 'melody-edge',
      selectable: false,
      focusable: false,
      data: {
        current: edge.current === true,
        variant: trimText(edge.variant || 'structural') || 'structural',
      },
    }));

  const focusNodeIds = flowNodes
    .filter((node) => node?.data?.node?.isCurrent)
    .map((node) => node.id);
  const pathNodeIds = flowNodes
    .filter((node) => node?.data?.node?.isCurrentPath)
    .map((node) => node.id);

  return {
    nodes: flowNodes,
    edges: flowEdges,
    hasOnlyRoot: entries.length <= 1,
    focusNodeIds: focusNodeIds.length > 0
      ? focusNodeIds
      : (pathNodeIds.length > 0 ? pathNodeIds : [trimText(rootNode.id)]),
  };
}

function stopEvent(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function stopPropagation(event) {
  event?.stopPropagation?.();
}

function MelodyEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}) {
  const midY = sourceY + ((targetY - sourceY) * 0.48);
  const className = [
    'react-flow__edge-path',
    'quest-task-flow-edge',
    data?.current === true ? 'is-current' : '',
    data?.variant === 'suggestion' ? 'is-candidate' : '',
  ].filter(Boolean).join(' ');
  return (
    <path
      className={className}
      d={`M ${sourceX} ${sourceY} V ${midY} H ${targetX} V ${targetY}`}
    />
  );
}

function MelodyNode({ data }) {
  const {
    node,
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
    canReparentSession,
    isDone,
    isRichView,
    className,
    badgeClassName,
    actionLabel,
  } = data;

  const hostsInlineActions = primaryAction === 'create-branch' || canCreateManualBranch || canReparentSession;
  const manualComposerOpen = rendererApi?.activeComposer?.type === 'manual' && rendererApi?.activeComposer?.nodeId === node?.id;
  const reparentComposerOpen = rendererApi?.activeComposer?.type === 'reparent' && rendererApi?.activeComposer?.nodeId === node?.id;
  const [branchTitle, setBranchTitle] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [reparentQuery, setReparentQuery] = useState('');
  const [reparentSelectionKey, setReparentSelectionKey] = useState('');
  const [reparentBusy, setReparentBusy] = useState(false);
  const manualInputRef = useRef(null);
  const reparentInputRef = useRef(null);

  useEffect(() => {
    if (!manualComposerOpen) {
      setBranchTitle('');
      setManualBusy(false);
    }
  }, [manualComposerOpen]);

  useEffect(() => {
    if (!reparentComposerOpen) {
      setReparentQuery('');
      setReparentSelectionKey('');
      setReparentBusy(false);
    }
  }, [reparentComposerOpen]);

  useLayoutEffect(() => {
    if (!manualComposerOpen) return;
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
  }, [manualComposerOpen, rendererApi]);

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

  const rawTargets = typeof rendererApi?.listReparentTargets === 'function'
    ? rendererApi.listReparentTargets({
      sourceSessionId: trimText(node?.sourceSessionId || node?.sessionId || ''),
      node,
      state,
      nodeMap,
    })
    : [];
  const filteredTargets = (Array.isArray(rawTargets) ? rawTargets : [])
    .filter((entry) => !trimText(reparentQuery) || String(entry?.searchText || '').toLowerCase().includes(trimText(reparentQuery).toLowerCase()))
    .slice(0, 8);
  const selectedTarget = filteredTargets.find((entry) => `${entry.mode}:${entry.sessionId || ''}` === reparentSelectionKey)
    || (Array.isArray(rawTargets) ? rawTargets.find((entry) => `${entry.mode}:${entry.sessionId || ''}` === reparentSelectionKey) : null)
    || null;

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
      const executed = await rendererApi?.nodeActionController?.executeManualBranch?.(node, normalizedTitle, {
        state,
        nodeMap,
        isRichView,
        isDone,
      });
      if (executed) {
        rendererApi?.setActiveComposer?.(null);
      }
    } finally {
      setManualBusy(false);
    }
  }

  function openReparentComposer(event) {
    stopEvent(event);
    rendererApi?.setActiveComposer?.({ type: 'reparent', nodeId: node?.id || '' });
  }

  async function confirmReparent(event) {
    stopEvent(event);
    if (!selectedTarget) return;
    setReparentBusy(true);
    try {
      const executed = await rendererApi?.nodeActionController?.executeReparentSession?.(
        node,
        selectedTarget.mode === 'detach' ? '' : selectedTarget.sessionId,
        {
          state,
          nodeMap,
          isRichView,
          isDone,
        },
      );
      if (executed) {
        rendererApi?.setActiveComposer?.(null);
      }
    } finally {
      setReparentBusy(false);
    }
  }

  async function handleBodyClick() {
    if (hostsInlineActions) return;
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
    }
  }

  return (
    <div className="quest-task-flow-react-node-shell">
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: 'none', width: 1, height: 1, border: 0, background: 'transparent' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: 'none', width: 1, height: 1, border: 0, background: 'transparent' }}
      />
      <div className={className} onClick={handleBodyClick}>
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
          <button
            type="button"
            className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action quest-task-flow-node-action-secondary nodrag nopan"
            onPointerDown={stopPropagation}
            onClick={openManualComposer}
            hidden={manualComposerOpen}
            disabled={reparentBusy || manualBusy}
          >
            新建支线
          </button>
        ) : null}

        {canReparentSession ? (
          <button
            type="button"
            className="quest-branch-btn quest-branch-btn-secondary quest-task-flow-node-action quest-task-flow-node-action-secondary nodrag nopan"
            onPointerDown={stopPropagation}
            onClick={openReparentComposer}
            hidden={reparentComposerOpen}
            disabled={manualBusy || reparentBusy}
          >
            挂到...
          </button>
        ) : null}

        {manualComposerOpen ? (
          <div
            className="quest-task-flow-branch-composer nodrag nopan"
            onPointerDown={stopPropagation}
            onClick={stopPropagation}
          >
            <input
              ref={manualInputRef}
              type="text"
              className="quest-task-flow-branch-input nodrag nopan"
              placeholder="输入支线标题"
              aria-label="支线标题"
              value={branchTitle}
              onChange={(event) => setBranchTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void confirmManualBranch(event);
                } else if (event.key === 'Escape') {
                  stopEvent(event);
                  rendererApi?.setActiveComposer?.(null);
                }
              }}
              disabled={manualBusy}
            />
            <div className="quest-task-flow-branch-actions">
              <button
                type="button"
                className="quest-branch-btn quest-branch-btn-primary nodrag nopan"
                onPointerDown={stopPropagation}
                onClick={confirmManualBranch}
                disabled={manualBusy}
              >
                开启
              </button>
              <button
                type="button"
                className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                onPointerDown={stopPropagation}
                onClick={(event) => {
                  stopEvent(event);
                  rendererApi?.setActiveComposer?.(null);
                }}
                disabled={manualBusy}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        {reparentComposerOpen ? (
          <div
            className="quest-task-flow-reparent-composer nodrag nopan"
            onPointerDown={stopPropagation}
            onClick={stopPropagation}
          >
            <input
              ref={reparentInputRef}
              type="text"
              className="quest-task-flow-branch-input nodrag nopan"
              placeholder="搜索任务标题或路径"
              aria-label="挂靠目标"
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
                    onPointerDown={stopPropagation}
                    onClick={(event) => {
                      stopEvent(event);
                      setReparentSelectionKey(optionKey);
                    }}
                  >
                    <div className="quest-task-flow-reparent-option-title">{entry.title || '未命名任务'}</div>
                    <div className="quest-task-flow-reparent-option-path">{entry.displayPath || entry.path || '顶层任务'}</div>
                  </button>
                );
              }) : (
                <div className="quest-task-flow-reparent-empty">没有可挂靠的任务</div>
              )}
            </div>
            <div className="quest-task-flow-reparent-confirm" hidden={!selectedTarget}>
              <div className="quest-task-flow-reparent-confirm-text">
                {selectedTarget
                  ? (selectedTarget.mode === 'detach'
                      ? '移出后会恢复为主线'
                      : `挂到「${selectedTarget.path && selectedTarget.path !== '顶层任务' ? selectedTarget.path : (selectedTarget.title || '目标任务')}」下，会保留当前下级结构`)
                  : ''}
              </div>
              <div className="quest-task-flow-branch-actions">
                <button
                  type="button"
                  className="quest-branch-btn quest-branch-btn-primary nodrag nopan"
                  onPointerDown={stopPropagation}
                  onClick={confirmReparent}
                  disabled={reparentBusy || !selectedTarget}
                >
                  确认
                </button>
                <button
                  type="button"
                  className="quest-branch-btn quest-branch-btn-secondary nodrag nopan"
                  onPointerDown={stopPropagation}
                  onClick={(event) => {
                    stopEvent(event);
                    rendererApi?.setActiveComposer?.(null);
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
    </div>
  );
}

function FlowViewportSync({ nodes = [], focusNodeIds = [], isMobile = false }) {
  const reactFlow = useReactFlow();
  const nodeSignature = nodes.map((node) => node.id).join('|');
  const focusSignature = focusNodeIds.join('|');

  useLayoutEffect(() => {
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    const focusTargets = focusNodeIds.length > 0
      ? focusNodeIds.map((id) => ({ id }))
      : nodes.map((node) => ({ id: node.id }));
    const hostWindow = globalThis?.window || window;
    const raf = hostWindow?.requestAnimationFrame?.bind(hostWindow);
    const cancelRaf = hostWindow?.cancelAnimationFrame?.bind(hostWindow);
    const run = () => {
      reactFlow.fitView({
        nodes: focusTargets,
        padding: focusNodeIds.length > 0 ? (isMobile ? 0.26 : 0.24) : (isMobile ? 0.34 : 0.3),
        duration: 0,
        minZoom: isMobile ? 0.52 : 0.38,
        maxZoom: 1.22,
        includeHiddenNodes: true,
      });
    };
    if (typeof raf === 'function') {
      const handle = raf(run);
      return () => cancelRaf?.(handle);
    }
    run();
    return undefined;
  }, [reactFlow, nodeSignature, focusSignature, isMobile]);

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
  const snapshot = buildBoardSnapshot({
    activeQuest,
    nodeMap,
    rootNode,
    state,
    rendererApi: {
      ...rendererApi,
      activeComposer,
      setActiveComposer,
    },
    positionOverrides: layoutPositions,
  });
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(snapshot.nodes);
  const snapshotStateKey = [
    snapshot.nodes.map((node) => [
      node.id,
      node.position.x,
      node.position.y,
      node.data?.rawTitle || '',
      node.data?.summary || '',
      node.data?.className || '',
      node.data?.badgeLabel || '',
      node.data?.primaryAction || '',
    ].join(':')).join('|'),
    snapshot.edges.map((edge) => [
      edge.id,
      edge.source,
      edge.target,
      edge.data?.variant || '',
      edge.data?.current === true ? '1' : '0',
    ].join(':')).join('|'),
  ].join('||');

  useEffect(() => {
    setFlowNodes(snapshot.nodes);
  }, [setFlowNodes, snapshotStateKey]);

  function persistNodePositions(nextNodes = []) {
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

  const emptyLabel = trimText(rendererApi?.translate?.('taskMap.empty') || '');
  const resolvedEmptyLabel = emptyLabel && emptyLabel !== 'taskMap.empty'
    ? emptyLabel
    : '暂无支线，后续任务流程会显示在这里。';

  return (
    <div className={`quest-task-flow-scroll quest-task-flow-react-scroll${interactionConfig.isMobile ? ' is-mobile' : ''}`}>
      <div className="quest-task-flow-canvas quest-task-flow-react-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={snapshot.edges}
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
            onlyRenderVisibleElements
            proOptions={{ hideAttribution: true }}
            nodeDragThreshold={interactionConfig.nodeDragThreshold}
            onPaneClick={() => setActiveComposer(null)}
          >
            <FlowViewportSync
              nodes={flowNodes}
              focusNodeIds={snapshot.focusNodeIds}
              isMobile={rendererApi?.isMobileQuestTracker?.() === true}
            />
          </ReactFlow>
        </ReactFlowProvider>
        {snapshot.hasOnlyRoot ? (
          <div className="task-map-empty quest-task-flow-react-empty">{resolvedEmptyLabel}</div>
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

function createRenderer({
  documentRef = document,
  windowRef = window,
  isMobileQuestTracker = () => false,
  clipText: clipTextImpl = clipText,
  translate = (key) => key,
  collapseTaskMapAfterAction = null,
  enterBranchFromSession = null,
  reparentSession = null,
  listReparentTargets = null,
  getSessionRecord = null,
  attachSession = null,
  selectTaskCanvasNode = null,
  getSelectedTaskCanvasNodeId = () => '',
} = {}) {
  ensureReactFlowStyles(documentRef);
  const nodeActionController = getNodeActionController(windowRef, {
    collapseTaskMapAfterAction,
    enterBranchFromSession,
    getSessionRecord,
    attachSession,
    reparentSession,
  });
  const rendererApi = {
    documentRef,
    windowRef,
    isMobileQuestTracker,
    clipText: clipTextImpl,
    translate,
    listReparentTargets,
    selectTaskCanvasNode,
    getSelectedTaskCanvasNodeId,
    nodeActionController,
  };

  return {
    getRenderStateKey() {
      return trimText(getSelectedTaskCanvasNodeId?.() || '');
    },
    renderFlowBoard({ activeQuest, nodeMap, rootNode, state }) {
      if (!activeQuest || !(nodeMap instanceof Map) || !rootNode?.id) {
        return createEmptyState(documentRef);
      }
      const container = documentRef.createElement('div');
      const interactionConfig = getTaskMapInteractionConfig({
        mobile: isMobileQuestTracker() === true,
      });
      container.className = `quest-task-mindmap-board is-spine quest-task-flow-shell ${interactionConfig.shellClassName}`;
      container.dataset.taskMapRenderer = 'react-flow';
      container.dataset.taskMapViewport = interactionConfig.isMobile ? 'mobile' : 'desktop';
      const root = createRoot(container);
      root.render(
        <TaskFlowBoard
          activeQuest={activeQuest}
          nodeMap={nodeMap}
          rootNode={rootNode}
          state={state}
          rendererApi={rendererApi}
        />,
      );
      container.__melodysyncCleanup = () => {
        root.unmount();
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
