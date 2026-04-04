(function emailSettingsUiModule(global) {
  const body = global.document?.getElementById?.('emailSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;

  if (!body || !settingsPanel) return;

  let loaded = null;
  let pending = false;
  let error = '';
  let success = '';

  function escHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function checkedAttr(value) {
    return value ? 'checked' : '';
  }

  function listToTextarea(values) {
    return Array.isArray(values) ? values.join('\n') : '';
  }

  function splitTextareaList(value) {
    return String(value || '')
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function getNamedField(form, name) {
    return form?.elements?.namedItem?.(name) || null;
  }

  function getFieldValue(form, name) {
    const field = getNamedField(form, name);
    return typeof field?.value === 'string' ? field.value : '';
  }

  function getCheckboxValue(form, name) {
    return getNamedField(form, name)?.checked === true;
  }

  async function fetchSettings() {
    body.innerHTML = '<div class="hooks-loading">加载中…</div>';
    try {
      const response = await global.fetch('/api/settings/email', {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      loaded = await response.json();
      pending = false;
      error = '';
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  async function saveSettings(form) {
    if (pending || !form) return;
    pending = true;
    error = '';
    success = '';
    render();
    try {
      const response = await global.fetch('/api/settings/email', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: {
            name: getFieldValue(form, 'identityName').trim(),
            localPart: getFieldValue(form, 'identityLocalPart').trim(),
            domain: getFieldValue(form, 'identityDomain').trim(),
            description: getFieldValue(form, 'identityDescription').trim(),
            instanceAddressMode: getFieldValue(form, 'identityInstanceAddressMode').trim(),
          },
          allowlist: {
            allowedEmails: splitTextareaList(getFieldValue(form, 'allowEmails')),
            allowedDomains: splitTextareaList(getFieldValue(form, 'allowDomains')),
          },
          outbound: {
            provider: getFieldValue(form, 'outboundProvider').trim(),
            account: getFieldValue(form, 'outboundAccount').trim(),
            from: getFieldValue(form, 'outboundFrom').trim(),
          },
          automation: {
            enabled: getCheckboxValue(form, 'automationEnabled'),
            allowlistAutoApprove: getCheckboxValue(form, 'allowlistAutoApprove'),
            autoApproveReviewer: getFieldValue(form, 'autoApproveReviewer').trim(),
            chatBaseUrl: getFieldValue(form, 'automationChatBaseUrl').trim(),
            authFile: getFieldValue(form, 'automationAuthFile').trim(),
            deliveryMode: getFieldValue(form, 'automationDeliveryMode').trim(),
          },
        }),
      });
      const next = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(next?.error || `HTTP ${response.status}`);
      }
      loaded = next || loaded;
      pending = false;
      success = '已保存';
      render();
    } catch (err) {
      pending = false;
      error = err?.message || '保存失败';
      render();
    }
  }

  function renderSelectOptions(options, selectedValue) {
    return (Array.isArray(options) ? options : [])
      .map((option) => {
        const value = String(option?.value || '').trim();
        const label = String(option?.label || value).trim();
        return `<option value="${escHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escHtml(label)}</option>`;
      })
      .join('');
  }

  function renderStatusRows() {
    if (!loaded) return '';
    const rows = [];
    if (loaded.paths?.emailRoot) {
      rows.push(`<div class="hooks-summary-desc"><strong>邮箱目录：</strong><code>${escHtml(loaded.paths.emailRoot)}</code></div>`);
    }
    if (loaded.paths?.identityFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>身份文件：</strong><code>${escHtml(loaded.paths.identityFile)}</code></div>`);
    }
    if (loaded.paths?.allowlistFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>允许名单：</strong><code>${escHtml(loaded.paths.allowlistFile)}</code></div>`);
    }
    if (loaded.paths?.outboundFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>发送配置：</strong><code>${escHtml(loaded.paths.outboundFile)}</code></div>`);
    }
    if (loaded.paths?.automationFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>自动化配置：</strong><code>${escHtml(loaded.paths.automationFile)}</code></div>`);
    }
    if (loaded.effectiveStatus) {
      rows.push(`<div class="hooks-summary-desc"><strong>当前状态：</strong>${escHtml(loaded.effectiveStatus)}</div>`);
    }
    const counts = loaded.counts || {};
    rows.push(
      `<div class="hooks-summary-desc"><strong>队列：</strong>待审 ${Number(counts.review || 0)} · 隔离 ${Number(counts.quarantine || 0)} · 已批准 ${Number(counts.approved || 0)}</div>`,
    );
    return rows.join('');
  }

  function render() {
    if (!loaded) return;
    const identity = loaded.identity || {};
    const allowlist = loaded.allowlist || {};
    const outbound = loaded.outbound || {};
    const automation = loaded.automation || {};
    const options = loaded.options || {};
    const statusRow = error
      ? `<div class="hooks-error">保存失败：${escHtml(error)}</div>`
      : (success ? `<div class="hooks-summary"><div class="hooks-summary-desc">${escHtml(success)}</div></div>` : '');

    body.innerHTML = `
      <div class="hooks-phase-section">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">Email 设置</div>
            <div class="hooks-phase-desc">统一管理邮箱身份、发送方式和自动化处理。</div>
          </div>
        </div>
        <div class="hooks-event-card">
          <form data-email-settings-form style="display:flex;flex-direction:column;gap:12px;padding:12px 0;">
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">邮箱身份</div>
              <div class="task-map-node-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));display:grid;gap:12px;">
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">显示名称</span>
                  <input class="settings-inline-input" name="identityName" value="${escHtml(identity.name)}" placeholder="Rowan">
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">实例地址模式</span>
                  <select class="settings-inline-input" name="identityInstanceAddressMode">${renderSelectOptions(options.instanceAddressModes, identity.instanceAddressMode || 'plus')}</select>
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Local Part</span>
                  <input class="settings-inline-input" name="identityLocalPart" value="${escHtml(identity.localPart)}" placeholder="rowan">
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Domain</span>
                  <input class="settings-inline-input" name="identityDomain" value="${escHtml(identity.domain)}" placeholder="example.com">
                </label>
              </div>
              <label class="task-map-node-field" style="margin-top:12px;">
                <span class="task-map-node-field-label">说明</span>
                <input class="settings-inline-input" name="identityDescription" value="${escHtml(identity.description)}" placeholder="Agent-facing mailbox identity for MelodySync collaboration.">
              </label>
              ${identity.address ? `<div class="hooks-summary" style="margin-top:10px"><div class="hooks-summary-desc"><strong>当前地址：</strong><code>${escHtml(identity.address)}</code></div></div>` : ''}
            </div>

            <div class="task-map-node-section">
              <div class="task-map-node-section-title">允许名单</div>
              <label class="task-map-node-field">
                <span class="task-map-node-field-label">允许邮箱</span>
                <textarea class="settings-inline-textarea" name="allowEmails" placeholder="owner@example.com">${escHtml(listToTextarea(allowlist.allowedEmails))}</textarea>
              </label>
              <label class="task-map-node-field">
                <span class="task-map-node-field-label">允许域名</span>
                <textarea class="settings-inline-textarea" name="allowDomains" placeholder="example.com">${escHtml(listToTextarea(allowlist.allowedDomains))}</textarea>
              </label>
            </div>

            <div class="task-map-node-section">
              <div class="task-map-node-section-title">发送方式</div>
              <div class="task-map-node-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));display:grid;gap:12px;">
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Provider</span>
                  <select class="settings-inline-input" name="outboundProvider">${renderSelectOptions(options.providers, outbound.provider || 'apple_mail')}</select>
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">发件地址</span>
                  <input class="settings-inline-input" name="outboundFrom" value="${escHtml(outbound.from)}" placeholder="rowan@example.com">
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Apple Mail 账户</span>
                  <input class="settings-inline-input" name="outboundAccount" value="${escHtml(outbound.account)}" placeholder="Google">
                </label>
              </div>
            </div>

            <div class="task-map-node-section">
              <div class="task-map-node-section-title">自动化</div>
              <div style="display:grid;gap:10px;">
                <label class="task-map-node-field" style="flex-direction:row;align-items:center;gap:8px;">
                  <input type="checkbox" name="automationEnabled" ${checkedAttr(automation.enabled)}>
                  <span class="task-map-node-field-label">启用邮箱自动化</span>
                </label>
                <label class="task-map-node-field" style="flex-direction:row;align-items:center;gap:8px;">
                  <input type="checkbox" name="allowlistAutoApprove" ${checkedAttr(automation.allowlistAutoApprove)}>
                  <span class="task-map-node-field-label">允许名单自动批准</span>
                </label>
              </div>
              <div class="task-map-node-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));display:grid;gap:12px;margin-top:12px;">
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">投递方式</span>
                  <select class="settings-inline-input" name="automationDeliveryMode">${renderSelectOptions(options.deliveryModes, automation.deliveryMode || 'reply_email')}</select>
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">自动批准执行者</span>
                  <input class="settings-inline-input" name="autoApproveReviewer" value="${escHtml(automation.autoApproveReviewer)}" placeholder="mailbox-auto-approve">
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Chat Base URL</span>
                  <input class="settings-inline-input" name="automationChatBaseUrl" value="${escHtml(automation.chatBaseUrl)}" placeholder="http://127.0.0.1:7760">
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">Auth 文件</span>
                  <input class="settings-inline-input" name="automationAuthFile" value="${escHtml(automation.authFile)}" placeholder="${escHtml(loaded.appRoot || '')}/config/auth.json">
                </label>
              </div>
            </div>

            <div class="hooks-summary">${renderStatusRows()}</div>
            ${statusRow}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="new-session-btn" type="submit" ${pending ? 'disabled' : ''}>${pending ? '保存中…' : '保存'}</button>
              <button class="new-session-btn secondary" type="button" data-action="reload-email-settings" ${pending ? 'disabled' : ''}>重新加载</button>
            </div>
          </form>
        </div>
      </div>
    `;

    body.querySelector?.('[data-email-settings-form]')?.addEventListener?.('submit', (event) => {
      event.preventDefault?.();
      void saveSettings(event.currentTarget);
    });
    body.querySelector?.('[data-action="reload-email-settings"]')?.addEventListener?.('click', () => {
      if (pending) return;
      success = '';
      error = '';
      void fetchSettings();
    });
  }

  settingsPanel.registerTab({
    id: 'email',
    onShow() {
      void fetchSettings();
    },
  });
})(window);
