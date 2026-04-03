(function taskMapNodeSettingsUiModule(global) {
  const model = global.MelodySyncTaskMapNodeSettingsModel;

  function escHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createNodeRow(definition) {
    const isBuiltIn = definition?.builtIn === true;
    return `
      <div class="task-map-node-row${isBuiltIn ? ' is-builtin' : ' is-custom'}">
        <div class="task-map-node-row-copy">
          <div class="task-map-node-row-title">
            <span class="task-map-node-row-label">${escHtml(definition?.label || definition?.id)}</span>
            <code class="task-map-node-id">${escHtml(definition?.id)}</code>
          </div>
          ${definition?.description ? `<div class="task-map-node-row-desc">${escHtml(definition.description)}</div>` : ''}
        </div>
        ${isBuiltIn
          ? ''
          : `
            <div class="task-map-node-actions">
              <button class="settings-app-btn" type="button" data-action="edit-node" data-node-id="${escHtml(definition?.id)}">编辑</button>
              <button class="settings-app-btn" type="button" data-action="delete-node" data-node-id="${escHtml(definition?.id)}">删除</button>
            </div>
          `}
      </div>
    `;
  }

  function renderSection({ title, count, emptyCopy, listHtml }) {
    return `
      <section class="task-map-node-section">
        <div class="task-map-node-section-header">
          <div class="task-map-node-section-title">${escHtml(title)}</div>
          <span class="task-map-node-section-count">${escHtml(count)}</span>
        </div>
        <div class="task-map-node-section-body">
          ${listHtml
            ? `<div class="task-map-node-settings-list">${listHtml}</div>`
            : `<div class="task-map-node-settings-empty">${escHtml(emptyCopy)}</div>`}
        </div>
      </section>
    `;
  }

  function createController({
    bodyEl = null,
    documentRef = global.document,
  } = {}) {
    if (!bodyEl || !model) {
      return {
        activate() {},
        refresh() {},
      };
    }

    let nodeData = null;
    let formState = {
      editingId: '',
      pending: false,
      error: '',
      values: model.createNodeFormDefaults(),
    };

    async function fetchNodeDefinitions() {
      const response = await global.fetch('/api/workbench/node-definitions', {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return model.normalizeNodeDefinitionsPayload(await response.json());
    }

    function resetForm(definition = null) {
      formState = {
        editingId: definition?.id || '',
        pending: false,
        error: '',
        values: model.createNodeFormDefaults(definition),
      };
    }

    function getCustomDefinition(nodeId) {
      const normalizedId = String(nodeId || '').trim().toLowerCase();
      return nodeData?.customNodeKinds?.find((definition) => definition.id === normalizedId) || null;
    }

    async function loadNodeDefinitions() {
      bodyEl.innerHTML = '<div class="task-map-node-settings-loading">加载节点配置中…</div>';
      try {
        nodeData = await fetchNodeDefinitions();
        if (!formState.editingId) {
          resetForm();
        }
        render();
      } catch (error) {
        bodyEl.innerHTML = `<div class="task-map-node-settings-error">加载失败：${escHtml(error.message)}</div>`;
      }
    }

    async function saveNodeDefinition(payload) {
      formState.pending = true;
      formState.error = '';
      render();
      try {
        const targetId = formState.editingId;
        const response = await global.fetch(
          targetId
            ? `/api/workbench/node-definitions/${encodeURIComponent(targetId)}`
            : '/api/workbench/node-definitions',
          {
            method: targetId ? 'PATCH' : 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        nodeData = model.normalizeNodeDefinitionsPayload(data || {});
        resetForm();
        render();
      } catch (error) {
        formState.pending = false;
        formState.error = error.message || '保存失败';
        render();
      }
    }

    async function deleteNodeDefinition(nodeId) {
      const confirmed = typeof global.confirm === 'function'
        ? global.confirm(`删除自定义节点「${nodeId}」？`)
        : true;
      if (!confirmed) return;
      try {
        const response = await global.fetch(`/api/workbench/node-definitions/${encodeURIComponent(nodeId)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        nodeData = model.normalizeNodeDefinitionsPayload(data || {});
        if (formState.editingId === nodeId) {
          resetForm();
        }
        render();
      } catch (error) {
        formState.error = error.message || '删除失败';
        render();
      }
    }

    function readFormValues(form) {
      const readFieldValue = (name) => {
        const field = form?.elements?.namedItem?.(name);
        return typeof field?.value === 'string' ? field.value : '';
      };
      return {
        id: readFieldValue('id'),
        label: readFieldValue('label'),
        description: readFieldValue('description'),
        lane: readFieldValue('lane'),
        role: readFieldValue('role'),
        mergePolicy: readFieldValue('mergePolicy'),
      };
    }

    function renderOptions(values, selectedValue, labelFactory) {
      return values.map((value) => `
        <option value="${escHtml(value)}"${value === selectedValue ? ' selected' : ''}>
          ${escHtml(labelFactory(value))}
        </option>
      `).join('');
    }

    function render() {
      if (!nodeData) return;
      const builtInDefinitions = nodeData.builtInDefinitions || [];
      const customDefinitions = nodeData.customNodeKinds || [];
      const builtInListHtml = builtInDefinitions.map((definition) => createNodeRow(definition)).join('');
      const customListHtml = customDefinitions.map((definition) => createNodeRow(definition)).join('');
      const defaults = formState.values;
      const formTitle = formState.editingId ? '编辑自定义节点' : '新增自定义节点';
      const saveLabel = formState.editingId ? '更新节点' : '新增节点';

      bodyEl.innerHTML = `
        ${renderSection({
          title: '系统节点',
          count: String(builtInDefinitions.length),
          emptyCopy: '当前没有系统节点。',
          listHtml: builtInListHtml,
        })}
        ${renderSection({
          title: '自定义节点',
          count: String(customDefinitions.length),
          emptyCopy: '当前还没有自定义节点。',
          listHtml: customListHtml,
        })}
        <section class="task-map-node-section task-map-node-form-section">
          <div class="task-map-node-section-header">
            <div class="task-map-node-section-title">${escHtml(formTitle)}</div>
            ${formState.editingId
              ? '<button class="settings-app-btn" type="button" data-action="reset-node-form">取消编辑</button>'
              : ''}
          </div>
          <form class="settings-inline-form task-map-node-form" data-form="task-map-node">
            <label class="task-map-node-field">
              <span class="task-map-node-field-label">节点 ID</span>
              <input class="settings-inline-input" name="id" value="${escHtml(defaults.id)}" placeholder="review-note" ${formState.editingId ? 'disabled' : ''}>
              <span class="task-map-node-field-note">创建后不可修改，建议使用短横线英文 ID。</span>
            </label>
            <label class="task-map-node-field">
              <span class="task-map-node-field-label">节点名称</span>
              <input class="settings-inline-input" name="label" value="${escHtml(defaults.label)}" placeholder="复盘节点">
            </label>
            <label class="task-map-node-field">
              <span class="task-map-node-field-label">节点说明</span>
              <textarea class="settings-inline-textarea" name="description" placeholder="用于表达一次阶段复盘或总结。">${escHtml(defaults.description)}</textarea>
            </label>
            <div class="task-map-node-form-grid">
              <label class="task-map-node-field">
                <span class="task-map-node-field-label">泳道</span>
                <select class="settings-inline-select" name="lane">
                  ${renderOptions(nodeData.nodeLanes, defaults.lane, model.getLaneLabel)}
                </select>
              </label>
              <label class="task-map-node-field">
                <span class="task-map-node-field-label">角色</span>
                <select class="settings-inline-select" name="role">
                  ${renderOptions(nodeData.nodeRoles, defaults.role, model.getRoleLabel)}
                </select>
              </label>
              <label class="task-map-node-field">
                <span class="task-map-node-field-label">合并策略</span>
                <select class="settings-inline-select" name="mergePolicy">
                  ${renderOptions(nodeData.nodeMergePolicies, defaults.mergePolicy, model.getMergePolicyLabel)}
                </select>
              </label>
            </div>
            ${formState.error ? `<div class="task-map-node-form-error">${escHtml(formState.error)}</div>` : ''}
            <div class="task-map-node-form-actions">
              <button class="new-session-btn secondary" type="button" data-action="reset-node-form">清空</button>
              <button class="new-session-btn" type="submit" ${formState.pending ? 'disabled' : ''}>${escHtml(formState.pending ? '保存中…' : saveLabel)}</button>
            </div>
          </form>
        </section>
      `;
    }

    bodyEl.addEventListener('click', (event) => {
      const action = event?.target?.dataset?.action;
      const nodeId = event?.target?.dataset?.nodeId;
      if (action === 'edit-node' && nodeId) {
        const definition = getCustomDefinition(nodeId);
        if (!definition) return;
        resetForm(definition);
        render();
      }
      if (action === 'delete-node' && nodeId) {
        deleteNodeDefinition(nodeId);
      }
      if (action === 'reset-node-form') {
        resetForm();
        render();
      }
    });

    bodyEl.addEventListener('submit', (event) => {
      if (event?.target?.dataset?.form !== 'task-map-node') return;
      event.preventDefault?.();
      const values = readFormValues(event.target);
      saveNodeDefinition(values);
    });

    return {
      activate() {
        loadNodeDefinitions();
      },
      refresh() {
        loadNodeDefinitions();
      },
    };
  }

  let sharedSettingsRegistered = false;

  function registerIntoSharedSettings() {
    if (sharedSettingsRegistered) return;
    const settingsPanel = global.MelodySyncSettingsPanel;
    const autoMountedBodyEl = global.document?.getElementById?.('taskMapNodeSettingsBody');
    if (!settingsPanel || !autoMountedBodyEl) return;
    sharedSettingsRegistered = true;
    const controller = createController({ bodyEl: autoMountedBodyEl, documentRef: global.document });
    settingsPanel.registerTab({
      id: 'nodes',
      onShow() {
        controller.activate();
      },
    });
  }

  registerIntoSharedSettings();
  global.document?.addEventListener?.('melodysync:settings-panel-ready', registerIntoSharedSettings);

  global.MelodySyncTaskMapNodeSettingsUi = Object.freeze({
    createController,
  });
})(window);
