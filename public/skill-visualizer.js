(() => {
  const fileInput = document.getElementById('fileInput');
  const textArea = document.getElementById('skillText');
  const parseBtn = document.getElementById('parseBtn');
  const clearBtn = document.getElementById('clearBtn');
  const exportBtn = document.getElementById('exportBtn');
  const statusEl = document.getElementById('status');
  const metaEl = document.getElementById('meta');
  const rawOutput = document.getElementById('rawOutput');
  const graphArea = document.getElementById('graphArea');
  const nodeLayer = document.getElementById('nodesLayer');
  const edgeCanvas = document.getElementById('edgeCanvas');
  const storageKey = 'melodysync.skill-visualizer.last';
  const defaultSample = `# 示例 Skill: 批量导出日报

## 输入
- 准备今日数据目录
- 读取 /data/report 目录

## 流程
1. 检查是否有可读权限
2. 解析配置文件
3. 如果存在待审核条目，则发送提醒给 Owner；否则直接进入下一步
4. 聚合结果并生成报告
5. 把报告保存到 /tmp/report.json 并通知发送

## 收尾
- 记录本次任务时间
- 回传状态`;

const NODE_W = 260;
const NODE_H = 92;
const X_GAP = 44;
const Y_GAP = 100;
const MARKER_ID = 'flow-arrow';

function setStatus(message, type = 'ok') {
  statusEl.textContent = message || '';
  statusEl.className = `status ${type}`;
}

function setMeta(html) {
  metaEl.innerHTML = html;
}

function storeDraft(value) {
  localStorage.setItem(storageKey, value || '');
}

function readDraft() {
  return localStorage.getItem(storageKey) || '';
}

function cleanText(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function isLikelyJson(text) {
  const t = cleanText(text).trim();
  if (!t) return false;
  if (!t.startsWith('{') && !t.startsWith('[')) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function extractDecisionBranches(text) {
  const src = text
    .replace(/^如果\s+/i, '')
    .replace(/^if\s+/i, '')
    .trim();

  const elseMatch = src.match(/\s*(?:。|，|,|;|；|\s+)(否则|else)\s+/i);
  const elseIndex = elseMatch ? elseMatch.index : -1;
  let condition = src;
  let yesText = '';
  let noText = '';

  if (elseIndex >= 0) {
    condition = src.slice(0, elseIndex).trim();
    noText = src.slice(elseIndex + elseMatch[0].length).trim();
  }

  const thenMatch = condition.match(/^(.*?)\s*(?:则|then)\s*(.+)$/i);
  if (thenMatch) {
    condition = thenMatch[1].trim();
    yesText = thenMatch[2].trim();
  }

  if (!yesText) yesText = '通过条件';
  if (!noText) noText = '不满足条件';
  return { condition, yesText, noText };
}

function parseMarkdown(text) {
  const source = cleanText(text).trim();
  const lines = source.split('\n');
  const nodes = [];
  const edges = [];
  const candidates = [];
  const metadata = {
    title: '',
    summary: '',
  };

  if (!source) return { title: '空 Skill', summary: '无内容', nodes, edges };

  let inCodeFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const title = headingMatch[2].trim();
      if (!metadata.title && headingMatch[1].length === 1) {
        metadata.title = title;
      } else if (!metadata.summary) {
        metadata.summary = title;
      } else {
        candidates.push({ kind: 'section', text: title, line: i + 1 });
      }
      continue;
    }

    const stepMatch = line.match(/^(?:[-*+]|(?:\d+[.)]))\s+(.*)$/);
    if (stepMatch) {
      const text = stepMatch[1].trim();
      if (text) candidates.push({ kind: 'step', text, line: i + 1 });
      continue;
    }
  }

  if (!candidates.length) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line || line.startsWith('```')) continue;
      candidates.push({ kind: 'step', text: line, line: i + 1 });
    }
  }

  const startNode = {
    id: 'n0',
    type: 'start',
    title: metadata.title || 'Skill Start',
    detail: metadata.summary || '流程起点',
    order: 0,
    line: 0,
  };

  nodes.push(startNode);
  let prevNodeId = startNode.id;
  let pendingJoinTargets = [];
  let nodeIndex = 1;
  const addNode = (type, title, detail) => {
    const node = {
      id: `n${nodeIndex}`,
      type,
      title,
      detail,
      order: nodes.length,
      line: 0,
    };
    nodeIndex += 1;
    nodes.push(node);
    return node;
  };

  for (const item of candidates) {
    const text = item.text.trim();
    if (!text) continue;
    const isDecision = /^(?:如果|if)\s+/i.test(text) && (text.includes('则') || text.includes('then') || text.includes('否则') || text.includes('else'));
    const fromJoin = pendingJoinTargets.length > 0 ? [...pendingJoinTargets] : [];
    pendingJoinTargets = [];

    let title = text;
    let nodeType = item.kind === 'section' ? 'section' : 'action';
    let mainNode = addNode(nodeType, title.length > 90 ? `${title.slice(0, 87)}...` : title, text);
    mainNode.line = item.line;

    if (fromJoin.length > 0) {
      fromJoin.forEach((id) => edges.push({ from: id, to: mainNode.id, label: '汇合' }));
    } else {
      edges.push({ from: prevNodeId, to: mainNode.id });
    }

    if (isDecision) {
      const branch = extractDecisionBranches(text);
      const yesNode = addNode('decision', `条件分支：${branch.condition}`, `是：${branch.yesText}`);
      const noNode = addNode('decision', `条件分支：${branch.condition}`, `否：${branch.noText}`);
      edges.push({ from: mainNode.id, to: yesNode.id, label: '是' });
      edges.push({ from: mainNode.id, to: noNode.id, label: '否' });
      pendingJoinTargets = [yesNode.id, noNode.id];
    } else {
      prevNodeId = mainNode.id;
    }
  }

  if (pendingJoinTargets.length > 0 && !nodes.find((n) => n.type === 'end')) {
    const endNode = addNode('section', '流程结束', '无后续分支');
    pendingJoinTargets.forEach((id) => edges.push({ from: id, to: endNode.id, label: '汇合' }));
  }

  return {
    title: metadata.title || 'Skill 流程图',
    summary: metadata.summary || `${nodes.length - 1} 个步骤`,
    nodes,
    edges,
  };
}

function parseJsonSkill(text) {
  const data = JSON.parse(cleanText(text));
  const nodes = [];
  const edges = [];

  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  const start = {
    id: 'n0',
    type: 'start',
    title: title || 'Skill Start',
    detail: summary || '流程起点',
    order: 0,
    line: 0,
  };

  nodes.push(start);
  let prev = start.id;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  let idx = 1;

  for (const step of steps) {
    const label = typeof step === 'string'
      ? step
      : typeof step === 'object'
        ? step.title || step.name || ''
        : '';
    if (!label) continue;
    const node = {
      id: `n${nodes.length + 1}`,
      type: step.type === 'condition' ? 'decision' : 'action',
      title: label.length > 80 ? `${label.slice(0, 77)}...` : label,
      detail: typeof step === 'object'
        ? (step.description || step.note || '').toString()
        : '',
      order: idx,
      line: 0,
    };
    nodes.push(node);
    edges.push({ from: prev, to: node.id });
    prev = node.id;
    idx += 1;
    if (step && typeof step === 'object' && Array.isArray(step.branches)) {
      for (const branch of step.branches.slice(0, 2)) {
        const bLabel = typeof branch === 'string' ? branch : String(branch.title || branch.name || '');
        const bNode = {
          id: `n${nodes.length + 1}`,
          type: 'decision',
          title: '条件分支',
          detail: bLabel,
          order: idx,
          line: 0,
        };
        nodes.push(bNode);
        edges.push({ from: prev, to: bNode.id, label: branch.label || '分支' });
        idx += 1;
      }
    }
  }

  return {
    title: title || 'JSON Skill',
    summary: summary || `来自 JSON 的 ${nodes.length - 1} 个节点`,
    nodes,
    edges,
  };
}

function parseSkillText(text) {
  const source = cleanText(text).trim();
  if (!source) {
    return { title: '空 Skill', summary: '请先粘贴内容', nodes: [], edges: [] };
  }
  if (isLikelyJson(source)) {
    try {
      return parseJsonSkill(source);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err.message}`);
    }
  }
  return parseMarkdown(source);
}

function computeLayout(graph) {
  const nodes = graph.nodes;
  const edges = graph.edges;
  const levels = new Map();
  nodes.forEach((node) => {
    levels.set(node.id, -1);
  });

  levels.set(nodes[0].id, 0);
  for (let i = 0; i < nodes.length * 2; i += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromLevel = levels.get(edge.from);
      const toLevel = levels.get(edge.to);
      if (fromLevel >= 0 && toLevel < fromLevel + 1) {
        levels.set(edge.to, fromLevel + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  nodes.forEach((node) => {
    if (levels.get(node.id) < 0) levels.set(node.id, 0);
  });

  const byLevel = {};
  for (const node of nodes) {
    const l = levels.get(node.id);
    if (!byLevel[l]) byLevel[l] = [];
    byLevel[l].push(node);
  }

  const positionById = {};
  Object.keys(byLevel).sort((a, b) => Number(a) - Number(b)).forEach((levelKey) => {
    const levelNodes = byLevel[Number(levelKey)];
    levelNodes.forEach((node, index) => {
      positionById[node.id] = {
        x: index * (NODE_W + X_GAP),
        y: Number(levelKey) * (NODE_H + Y_GAP),
      };
    });
  });

  const edgesByFrom = {};
  for (const edge of edges) {
    if (!edgesByFrom[edge.from]) edgesByFrom[edge.from] = [];
    edgesByFrom[edge.from].push(edge);
  }
  Object.keys(edgesByFrom).forEach((from) => {
    edgesByFrom[from].sort((a, b) => (a.to > b.to ? 1 : -1));
  });

  return { positionById, byLevel, edgesByFrom };
}

function renderFlow(graph) {
  if (!graph || !graph.nodes.length) {
    nodeLayer.innerHTML = '';
    edgeCanvas.setAttribute('viewBox', '0 0 0 0');
    rawOutput.textContent = '';
    setStatus('当前文件没有可识别步骤');
    return;
  }

  nodeLayer.innerHTML = '';
  const layout = computeLayout(graph);
  const byLevelEntries = Object.keys(layout.byLevel);
  const maxLevel = byLevelEntries.length
    ? Math.max(...byLevelEntries.map((key) => Number(key)))
    : 0;
  const maxRowCount = Math.max(...Object.values(layout.byLevel).map((rows) => rows.length), 1);

  const width = Math.max(640, maxRowCount * (NODE_W + X_GAP));
  const height = (maxLevel + 2) * (NODE_H + Y_GAP);
  graphArea.style.width = `${width}px`;
  graphArea.style.height = `${height}px`;
  edgeCanvas.setAttribute('viewBox', `0 0 ${width} ${height}`);
  edgeCanvas.setAttribute('width', String(width));
  edgeCanvas.setAttribute('height', String(height));

  const defs = `<defs><marker id="${MARKER_ID}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#0f172a" stroke-width="1.2" /></marker></defs>`;
  const lines = [];
  for (const edge of graph.edges) {
    const fromPos = layout.positionById[edge.from];
    const toPos = layout.positionById[edge.to];
    if (!fromPos || !toPos) continue;
    const startX = fromPos.x + NODE_W / 2;
    const startY = fromPos.y + NODE_H;
    const endX = toPos.x + NODE_W / 2;
    const endY = toPos.y;
    const midY = Math.min(height - 8, startY + Math.min(48, (endY - startY) / 2));
    const path = `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`;
    const labelX = (startX + endX) / 2;
    lines.push(`<path d="${path}" fill="none" stroke="#0f172a" stroke-width="1.3" marker-end="url(#${MARKER_ID})" />`);
    if (edge.label) {
      lines.push(`<g><rect x="${labelX - 14}" y="${midY - 12}" width="28" height="16" rx="4" fill="#fff" stroke="#cbd5e1"/><text class="edge-label" x="${labelX}" y="${midY - 1}" text-anchor="middle">${edge.label}</text></g>`);
    }
  }

  edgeCanvas.innerHTML = `${defs}<g>${lines.join('')}</g>`;

  for (const node of graph.nodes) {
    const pos = layout.positionById[node.id];
    const nodeEl = document.createElement('article');
    nodeEl.className = `node ${node.type || 'action'}`;
    nodeEl.style.left = `${pos.x}px`;
    nodeEl.style.top = `${pos.y}px`;
    const html = [
      `<span class="id">${node.id}</span>`,
      `<h3>${escapeHtml(node.title || '(未命名)')}</h3>`,
      `<p>${escapeHtml(node.detail || '')}</p>`,
    ].join('');
    nodeEl.innerHTML = html;
    nodeLayer.appendChild(nodeEl);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  ;
}

function refreshGraphFromInput() {
  const source = textArea.value;
  if (!source.trim()) {
    setStatus('请输入 Skill 内容');
    setMeta('');
    rawOutput.textContent = '';
    nodeLayer.innerHTML = '';
    edgeCanvas.innerHTML = '';
    return;
  }
  let graph;
  try {
    graph = parseSkillText(source);
  } catch (err) {
    setStatus(err.message || '解析失败', 'error');
    rawOutput.textContent = '';
    nodeLayer.innerHTML = '';
    edgeCanvas.innerHTML = '';
    return;
  }
  renderFlow(graph);
  rawOutput.textContent = JSON.stringify(graph, null, 2);
  setStatus(`已识别 ${graph.nodes.length} 个节点，${graph.edges.length} 条边`);
  setMeta(`<b>技能名：</b>${escapeHtml(graph.title)}；<b>说明：</b>${escapeHtml(graph.summary || '—')}`);
  storeDraft(source);
}

function clearAll() {
  textArea.value = '';
  rawOutput.textContent = '';
  nodeLayer.innerHTML = '';
  edgeCanvas.innerHTML = '';
  setMeta('');
  setStatus('');
  localStorage.removeItem(storageKey);
}

function readFilesAsText(fileList) {
  return Promise.all(Array.from(fileList).map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.onload = () => resolve({
      name: file.name,
      content: String(reader.result || ''),
      lineCount: String(reader.result || '').split('\n').length,
    });
    reader.readAsText(file);
  })));
}

function mergeFiles(files) {
  return files
    .map((item) => `\n\n<!-- ${item.name} -->\n${item.content}`)
    .join('\n')
    .trim();
}

parseBtn.addEventListener('click', refreshGraphFromInput);

clearBtn.addEventListener('click', clearAll);

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || !fileInput.files.length) return;
  setStatus('正在读取文件...');
  const items = await readFilesAsText(fileInput.files);
  const merged = mergeFiles(items);
  textArea.value = merged;
  setMeta(`<b>已导入 ${items.length} 个文件：</b>${items.map((item) => item.name).join(', ')}`);
  refreshGraphFromInput();
});

exportBtn.addEventListener('click', () => {
  if (!textArea.value.trim()) {
    setStatus('先导入并解析后再导出', 'warn');
    return;
  }
  const graph = parseSkillText(textArea.value);
  const payload = {
    parsedAt: new Date().toISOString(),
    sourceLength: textArea.value.length,
    ...graph,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json; charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `skill-visual-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  setStatus('导出完成');
});

textArea.addEventListener('input', () => {
  setMeta('');
  setStatus('');
});

const initial = readDraft();
textArea.value = initial || defaultSample;
if (!initial) storeDraft(defaultSample);
refreshGraphFromInput();
})();
