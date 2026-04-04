(function nodeRichViewUiModule() {
  function createRenderer({
    documentRef = document,
    windowRef = window,
  } = {}) {
    function renderMarkdownContent(target, markdown) {
      if (!target) return;
      if (typeof windowRef?.renderMarkdownIntoNode === "function") {
        windowRef.renderMarkdownIntoNode(target, markdown);
        return;
      }
      if (typeof globalThis?.renderMarkdownIntoNode === "function") {
        globalThis.renderMarkdownIntoNode(target, markdown);
        return;
      }
      if (typeof windowRef?.marked?.parse === "function") {
        target.innerHTML = windowRef.marked.parse(String(markdown || ""));
        return;
      }
      target.textContent = String(markdown || "");
    }

    function createRichViewFrame({
      title = "",
      src = "",
      srcdoc = "",
    } = {}) {
      const frame = documentRef.createElement("iframe");
      frame.className = "quest-task-flow-node-rich-frame panzoom-exclude";
      frame.setAttribute("title", String(title || "").trim());
      frame.setAttribute("loading", "lazy");
      frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
      if (src) {
        frame.src = src;
      } else {
        frame.srcdoc = String(srcdoc || "");
      }
      return frame;
    }

    function createRichViewSurface(node = {}, view = null) {
      const resolvedView = view && typeof view === "object"
        ? view
        : (node?.view && typeof node.view === "object" ? node.view : { type: "flow-node" });
      const viewType = String(resolvedView?.type || "flow-node").trim() || "flow-node";
      const shell = documentRef.createElement("div");
      shell.className = `quest-task-flow-node-rich quest-task-flow-node-rich-${viewType}`;

      if (viewType === "markdown") {
        const body = documentRef.createElement("div");
        body.className = "quest-task-flow-node-rich-body quest-task-flow-node-rich-markdown";
        renderMarkdownContent(body, resolvedView.content || node.summary || "");
        shell.appendChild(body);
        return shell;
      }

      if (viewType === "html") {
        if (resolvedView.renderMode === "inline") {
          const body = documentRef.createElement("div");
          body.className = "quest-task-flow-node-rich-body quest-task-flow-node-rich-html";
          body.innerHTML = String(resolvedView.content || "");
          shell.appendChild(body);
          return shell;
        }
        shell.appendChild(createRichViewFrame({
          title: String(node.title || "HTML 视图"),
          src: resolvedView.src,
          srcdoc: resolvedView.content,
        }));
        return shell;
      }

      if (viewType === "iframe") {
        shell.appendChild(createRichViewFrame({
          title: String(node.title || "嵌入视图"),
          src: resolvedView.src,
          srcdoc: resolvedView.content,
        }));
        return shell;
      }

      return shell;
    }

    return Object.freeze({
      renderMarkdownContent,
      createRichViewSurface,
    });
  }

  window.MelodySyncWorkbenchNodeRichViewUi = Object.freeze({
    createRenderer,
  });
})();
