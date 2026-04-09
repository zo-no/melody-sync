(function sessionListReactUiModule(globalThisRef) {
  "use strict";

  const ReactRuntime = globalThisRef.React || null;
  const ReactDOMRuntime = globalThisRef.ReactDOM || null;
  const hasReactRuntime = Boolean(
    ReactRuntime
    && ReactDOMRuntime
    && typeof ReactRuntime.createElement === "function"
  );

  const h = hasReactRuntime
    ? ReactRuntime.createElement.bind(ReactRuntime)
    : null;
  const Fragment = hasReactRuntime ? ReactRuntime.Fragment : null;
  const useHostEffect = hasReactRuntime
    ? (ReactRuntime.useLayoutEffect || ReactRuntime.useEffect || null)
    : null;
  const useRef = hasReactRuntime ? ReactRuntime.useRef : null;
  const canUseReactComponents = Boolean(hasReactRuntime && typeof useHostEffect === "function" && typeof useRef === "function");

  function renderUiIconHtml(payload, iconName) {
    return payload?.helpers?.renderUiIcon?.(iconName) || "";
  }

  function appendItemsToHost(payload, host, sessions, options = {}) {
    if (!host || typeof payload?.helpers?.appendSessionItems !== "function") return;
    host.innerHTML = "";
    payload.helpers.appendSessionItems(host, sessions, options);
  }

  function renderPinnedSectionReact(payload) {
    if (!Array.isArray(payload?.pinnedSessions) || payload.pinnedSessions.length === 0) return null;
    const itemsRef = useRef(null);

    useHostEffect(() => {
      appendItemsToHost(payload, itemsRef.current, payload.pinnedSessions);
    }, [payload, payload.pinnedSessions]);

    return h(
      "div",
      { className: "pinned-section" },
      h(
        "div",
        { className: "pinned-section-header" },
        h("span", { className: "pinned-label" }, payload.helpers.t("sidebar.pinned")),
        h("span", { className: "folder-count" }, String(payload.pinnedSessions.length)),
      ),
      h("div", { className: "pinned-items", ref: itemsRef }),
    );
  }

  function renderGroupSectionReact(payload, group) {
    const itemsRef = useRef(null);
    const showGroupHeaders = payload?.showGroupHeaders === true;
    const isCollapsed = showGroupHeaders && group?.collapsed === true;

    useHostEffect(() => {
      appendItemsToHost(payload, itemsRef.current, group?.sessions || []);
    }, [payload, group?.sessions]);

    return h(
      "div",
      { className: "folder-group" + (showGroupHeaders ? "" : " is-ungrouped") },
      showGroupHeaders
        ? h(
            "div",
            {
              className: "folder-group-header" + (isCollapsed ? " collapsed" : ""),
              onClick: () => {
                payload?.actions?.setGroupCollapsed?.(group.key, !isCollapsed);
              },
            },
            h("span", {
              className: "folder-chevron",
              dangerouslySetInnerHTML: { __html: renderUiIconHtml(payload, "chevron-down") },
            }),
            h("span", { className: "folder-name", title: group?.title || "" }, group?.label || ""),
            h("span", { className: "folder-count" }, String(Array.isArray(group?.sessions) ? group.sessions.length : 0)),
          )
        : null,
      h("div", {
        className: "folder-group-items",
        hidden: showGroupHeaders && isCollapsed,
        ref: itemsRef,
      }),
    );
  }

  function renderArchivedSectionReact(payload) {
    const archived = payload?.archived || null;
    if (!archived?.shouldRenderSection) return null;

    const itemsRef = useRef(null);
    const isCollapsed = archived.isCollapsed === true;

    useHostEffect(() => {
      if (!isCollapsed) {
        payload?.actions?.ensureArchivedLoaded?.();
      }
    }, [payload, isCollapsed, archived?.loading, archived?.sessions?.length]);

    useHostEffect(() => {
      const host = itemsRef.current;
      if (!host) return;
      host.innerHTML = "";
      if (archived.loading && archived.sessions.length === 0) {
        const loading = document.createElement("div");
        loading.className = "archived-empty";
        loading.textContent = payload.helpers.t("sidebar.loadingArchived");
        host.appendChild(loading);
        return;
      }
      if (archived.sessions.length === 0) {
        const empty = document.createElement("div");
        empty.className = "archived-empty";
        empty.textContent = archived.emptyText;
        host.appendChild(empty);
        return;
      }
      payload.helpers.appendSessionItems(host, archived.sessions, { archived: true });
    }, [
      payload,
      archived.loading,
      archived.emptyText,
      archived.sessions,
      archived.sessions?.length,
      archived.isCollapsed,
    ]);

    return h(
      "div",
      { id: "archivedSection", className: "archived-section" },
      h(
        "div",
        {
          className: "archived-section-header" + (isCollapsed ? " collapsed" : ""),
          onClick: () => {
            const nextCollapsed = !isCollapsed;
            payload?.actions?.setGroupCollapsed?.(archived.storageKey, nextCollapsed);
            if (!nextCollapsed) {
              payload?.actions?.ensureArchivedLoaded?.();
            }
          },
        },
        h("span", {
          className: "folder-chevron",
          dangerouslySetInnerHTML: { __html: renderUiIconHtml(payload, "chevron-down") },
        }),
        h("span", { className: "archived-label" }, payload.helpers.t("sidebar.archive")),
        h("span", { className: "folder-count" }, String(archived.count)),
      ),
      h("div", {
        className: "archived-items",
        hidden: isCollapsed,
        ref: itemsRef,
      }),
    );
  }

  function renderSessionListReact(payload) {
    if (!canUseReactComponents || !payload?.sessionListEl) return false;

    const container = payload.sessionListEl;
    const app = h(
      Fragment,
      null,
      renderPinnedSectionReact(payload),
      ...(Array.isArray(payload.groups)
        ? payload.groups.map((group) => h(renderGroupSectionReact, {
            key: group?.key || group?.label || "",
            payload,
            group,
          }))
        : []),
      renderArchivedSectionReact(payload),
    );

    if (!container.__melodySyncSessionListReactRoot && typeof ReactDOMRuntime.createRoot === "function") {
      container.innerHTML = "";
      container.__melodySyncSessionListReactRoot = ReactDOMRuntime.createRoot(container);
    }

    const root = container.__melodySyncSessionListReactRoot;
    if (root && typeof root.render === "function") {
      root.render(app);
      return true;
    }

    if (typeof ReactDOMRuntime.render === "function") {
      ReactDOMRuntime.render(app, container);
      return true;
    }

    return false;
  }

  function appendPinnedSectionDom(payload) {
    if (!Array.isArray(payload.pinnedSessions) || payload.pinnedSessions.length === 0) return;

    const section = document.createElement("div");
    section.className = "pinned-section";

    const header = document.createElement("div");
    header.className = "pinned-section-header";
    header.innerHTML = `<span class="pinned-label">${payload.helpers.esc(payload.helpers.t("sidebar.pinned"))}</span><span class="folder-count">${payload.pinnedSessions.length}</span>`;

    const items = document.createElement("div");
    items.className = "pinned-items";
    appendItemsToHost(payload, items, payload.pinnedSessions);

    section.appendChild(header);
    section.appendChild(items);
    payload.sessionListEl.appendChild(section);
  }

  function appendGroupSectionDom(payload, group) {
    const groupEl = document.createElement("div");
    groupEl.className = "folder-group" + (payload.showGroupHeaders ? "" : " is-ungrouped");

    const items = document.createElement("div");
    items.className = "folder-group-items";
    items.hidden = payload.showGroupHeaders && group.collapsed === true;
    appendItemsToHost(payload, items, group.sessions);

    if (payload.showGroupHeaders) {
      const header = document.createElement("div");
      header.className = "folder-group-header" + (group.collapsed ? " collapsed" : "");
      header.innerHTML = `<span class="folder-chevron">${renderUiIconHtml(payload, "chevron-down")}</span>
        <span class="folder-name" title="${payload.helpers.esc(group.title)}">${payload.helpers.esc(group.label)}</span>
        <span class="folder-count">${group.sessions.length}</span>`;
      header.addEventListener("click", () => {
        const nextCollapsed = !header.classList.contains("collapsed");
        header.classList.toggle("collapsed", nextCollapsed);
        items.hidden = nextCollapsed;
        payload.actions.setGroupCollapsed(group.key, nextCollapsed);
      });
      groupEl.appendChild(header);
    }

    groupEl.appendChild(items);
    payload.sessionListEl.appendChild(groupEl);
  }

  function appendArchivedSectionDom(payload) {
    const archived = payload.archived;
    if (!archived?.shouldRenderSection) return;

    const section = document.createElement("div");
    section.id = "archivedSection";
    section.className = "archived-section";

    const header = document.createElement("div");
    header.className = "archived-section-header" + (archived.isCollapsed ? " collapsed" : "");
    header.innerHTML = `<span class="folder-chevron">${renderUiIconHtml(payload, "chevron-down")}</span>
      <span class="archived-label">${payload.helpers.esc(payload.helpers.t("sidebar.archive"))}</span>
      <span class="folder-count">${archived.count}</span>`;

    const items = document.createElement("div");
    items.className = "archived-items";
    items.hidden = archived.isCollapsed;

    header.addEventListener("click", () => {
      const nextCollapsed = !header.classList.contains("collapsed");
      header.classList.toggle("collapsed", nextCollapsed);
      items.hidden = nextCollapsed;
      payload.actions.setGroupCollapsed(archived.storageKey, nextCollapsed);
      if (!nextCollapsed) {
        payload.actions.ensureArchivedLoaded();
      }
    });

    if (!archived.isCollapsed) {
      payload.actions.ensureArchivedLoaded();
    }

    if (archived.loading && archived.sessions.length === 0) {
      const loading = document.createElement("div");
      loading.className = "archived-empty";
      loading.textContent = payload.helpers.t("sidebar.loadingArchived");
      items.appendChild(loading);
    } else if (archived.sessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "archived-empty";
      empty.textContent = archived.emptyText;
      items.appendChild(empty);
    } else {
      appendItemsToHost(payload, items, archived.sessions, { archived: true });
    }

    section.appendChild(header);
    section.appendChild(items);
    payload.sessionListEl.appendChild(section);
  }

  function renderSessionListDom(payload) {
    if (!payload?.sessionListEl) return false;

    payload.sessionListEl.innerHTML = "";
    appendPinnedSectionDom(payload);
    for (const group of payload.groups || []) {
      appendGroupSectionDom(payload, group);
    }
    appendArchivedSectionDom(payload);
    return true;
  }

  const api = {
    renderSessionList(payload) {
      if (renderSessionListReact(payload)) return true;
      return renderSessionListDom(payload);
    },
  };

  globalThisRef.MelodySyncSessionListReactUi = Object.freeze(api);
})(window);
