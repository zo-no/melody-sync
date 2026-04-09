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
            group?.canDelete
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "folder-group-delete",
                    title: payload?.grouping?.deleteFolderLabel || "删除分组",
                    "aria-label": payload?.grouping?.deleteFolderLabel || "删除分组",
                    onClick: (event) => {
                      event.preventDefault?.();
                      event.stopPropagation?.();
                      payload?.actions?.removeTemplateFolder?.(group?.label || "");
                    },
                  },
                  h("span", {
                    dangerouslySetInnerHTML: { __html: renderUiIconHtml(payload, "trash") },
                  }),
                )
              : null,
          )
        : null,
      h("div", {
        className: "folder-group-items",
        hidden: showGroupHeaders && isCollapsed,
        ref: itemsRef,
      }),
    );
  }

  function renderCreateFolderSectionReact(payload) {
    if (payload?.grouping?.showCreateFolder !== true) return null;
    return h(
      "div",
      { className: "session-grouping-create-section" },
      h(
        "button",
        {
          type: "button",
          className: "session-grouping-create-btn",
          onClick: (event) => {
            payload?.actions?.openGroupingCreate?.(event.currentTarget);
          },
        },
        `+ ${payload?.grouping?.createFolderLabel || "创建分组"}`,
      ),
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
      renderCreateFolderSectionReact(payload),
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
      if (group?.canDelete) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "folder-group-delete";
        deleteBtn.title = payload?.grouping?.deleteFolderLabel || "删除分组";
        deleteBtn.setAttribute("aria-label", deleteBtn.title);
        deleteBtn.innerHTML = renderUiIconHtml(payload, "trash");
        deleteBtn.addEventListener("click", (event) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          payload?.actions?.removeTemplateFolder?.(group?.label || "");
        });
        header.appendChild(deleteBtn);
      }
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

  function appendCreateFolderSectionDom(payload) {
    if (payload?.grouping?.showCreateFolder !== true) return;
    const section = document.createElement("div");
    section.className = "session-grouping-create-section";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-grouping-create-btn";
    button.textContent = `+ ${payload?.grouping?.createFolderLabel || "创建分组"}`;
    button.addEventListener("click", (event) => {
      payload?.actions?.openGroupingCreate?.(event.currentTarget);
    });
    section.appendChild(button);
    payload.sessionListEl.appendChild(section);
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
    appendCreateFolderSectionDom(payload);
    appendArchivedSectionDom(payload);
    return true;
  }

  function renderSessionList(payload) {
    if (renderSessionListReact(payload)) return true;
    return renderSessionListDom(payload);
  }

  function createSessionListRenderer() {
    return Object.freeze({
      renderSessionList,
      renderSessionCollections(payload = {}) {
        return renderSessionList(payload);
      },
    });
  }

  const api = Object.freeze({
    renderSessionList,
    createSessionListRenderer,
  });

  globalThisRef.MelodySyncSessionListReactUi = api;
  globalThisRef.MelodySyncSessionListUi = api;
})(window);
