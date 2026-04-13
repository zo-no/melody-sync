"use strict";

/**
 * Custom dialog utilities — replaces window.confirm / window.alert.
 *
 * showAlert(message, { title })
 * showConfirm(message, { title, confirmLabel, cancelLabel, danger })
 *   → Promise<boolean>
 * showChoice(message, { title, choices: [{ label, value, danger }], cancelLabel })
 *   → Promise<value | null>
 */

(function installMelodySyncDialogs(root) {
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createBackdrop() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.style.zIndex = "9999";
    return backdrop;
  }

  function createModal({ title, body, footerHtml }) {
    const modal = document.createElement("div");
    modal.className = "modal dialog-modal";
    modal.style.width = "min(420px, 100%)";
    modal.style.maxHeight = "none";
    modal.innerHTML = (title
      ? `<div class="modal-header"><div class="modal-title">${esc(title)}</div></div>`
      : "") +
      `<div class="modal-body dialog-modal-body">${body}</div>` +
      `<div class="modal-footer">${footerHtml}</div>`;
    return modal;
  }

  function showAlert(message, opts) {
    const title = (opts && opts.title) || "";
    return new Promise(function (resolve) {
      const backdrop = createBackdrop();
      const modal = createModal({
        title: title,
        body: `<p class="dialog-message">${esc(message)}</p>`,
        footerHtml: `<button class="modal-btn primary" data-role="ok" type="button">知道了</button>`,
      });
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      function close() { backdrop.remove(); resolve(); }
      modal.querySelector("[data-role='ok']").addEventListener("click", close);
      backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });
      modal.querySelector("[data-role='ok']").focus();
    });
  }

  function showConfirm(message, opts) {
    const title = (opts && opts.title) || "";
    const confirmLabel = (opts && opts.confirmLabel) || "确定";
    const cancelLabel = (opts && opts.cancelLabel) || "取消";
    const danger = !!(opts && opts.danger);
    return new Promise(function (resolve) {
      const backdrop = createBackdrop();
      const confirmCls = danger ? "modal-btn danger" : "modal-btn primary";
      const modal = createModal({
        title: title,
        body: `<p class="dialog-message">${esc(message)}</p>`,
        footerHtml:
          `<button class="modal-btn" data-role="cancel" type="button">${esc(cancelLabel)}</button>` +
          `<button class="${confirmCls}" data-role="confirm" type="button">${esc(confirmLabel)}</button>`,
      });
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      function confirm() { backdrop.remove(); resolve(true); }
      function cancel() { backdrop.remove(); resolve(false); }
      modal.querySelector("[data-role='confirm']").addEventListener("click", confirm);
      modal.querySelector("[data-role='cancel']").addEventListener("click", cancel);
      backdrop.addEventListener("click", function (e) { if (e.target === backdrop) cancel(); });
      function onKey(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", onKey); cancel(); }
        if (e.key === "Enter") { document.removeEventListener("keydown", onKey); confirm(); }
      }
      document.addEventListener("keydown", onKey);
      modal.querySelector("[data-role='confirm']").focus();
    });
  }

  function showChoice(message, opts) {
    const title = (opts && opts.title) || "";
    const choices = (opts && Array.isArray(opts.choices)) ? opts.choices : [];
    const cancelLabel = (opts && opts.cancelLabel) || "取消";
    return new Promise(function (resolve) {
      const backdrop = createBackdrop();
      const choiceButtons = choices.map(function (c, i) {
        const cls = c.danger ? "modal-btn danger" : (i === 0 ? "modal-btn primary" : "modal-btn");
        return `<button class="${cls}" data-role="choice" data-index="${i}" type="button">${esc(c.label)}</button>`;
      }).join("");
      const modal = createModal({
        title: title,
        body: `<p class="dialog-message">${esc(message)}</p>`,
        footerHtml:
          `<button class="modal-btn" data-role="cancel" type="button">${esc(cancelLabel)}</button>` +
          choiceButtons,
      });
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modal.querySelectorAll("[data-role='choice']").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var idx = Number(btn.dataset.index);
          backdrop.remove();
          resolve(choices[idx] ? choices[idx].value : null);
        });
      });
      modal.querySelector("[data-role='cancel']").addEventListener("click", function () {
        backdrop.remove(); resolve(null);
      });
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) { backdrop.remove(); resolve(null); }
      });
      function onKey(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", onKey); backdrop.remove(); resolve(null); }
      }
      document.addEventListener("keydown", onKey);
      var firstChoice = modal.querySelector("[data-role='choice']");
      if (firstChoice) firstChoice.focus();
    });
  }

  root.showAlert = showAlert;
  root.showConfirm = showConfirm;
  root.showChoice = showChoice;

}(typeof globalThis !== "undefined" ? globalThis : window));
