// ---- WebSocket ----
function t(key, vars) {
  return window.melodySyncT ? window.melodySyncT(key, vars) : key;
}

function renderRealtimeIcon(name, className = "") {
  return window.MelodySyncIcons?.render(name, { className }) || "";
}

function resolveWsUrl(path) {
  return typeof path === "string" ? path : String(path || "");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}${resolveWsUrl("/ws")}`);

  ws.onopen = () => {
    updateStatus("connected", getCurrentSession());
    if (hasSeenWsOpen) {
      refreshRealtimeViews({ viewportIntent: "preserve" }).catch(() => {});
    } else {
      hasSeenWsOpen = true;
    }
  };

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handleWsMessage(msg);
  };

  ws.onclose = () => {
    updateStatus("disconnected", getCurrentSession());
    scheduleReconnect();
  };

  ws.onerror = () => ws.close();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

async function dispatchAction(msg) {
  try {
    switch (msg.action) {
      case "list":
        await fetchSessionsList();
        return true;
      case "attach": {
        currentSessionId = msg.sessionId;
        hasAttachedSession = true;
        const attachedSession = getCurrentSession();
        if (!attachedSession || attachedSession.id !== msg.sessionId) {
          await refreshCurrentSession();
          return true;
        }
        const runState = typeof getSessionRunState === "function"
          ? getSessionRunState(attachedSession)
          : "idle";
        const eventsPromise = fetchSessionEvents(msg.sessionId, {
          runState,
          viewportIntent: "session_entry",
        });
        const queueCount = Number.isInteger(attachedSession?.activity?.queue?.count)
          ? attachedSession.activity.queue.count
          : 0;
        if (queueCount > 0 && !Array.isArray(attachedSession?.queuedMessages)) {
          await Promise.all([
            fetchSessionState(msg.sessionId),
            eventsPromise,
          ]);
        } else {
          await eventsPromise;
        }
        return true;
      }
      case "create": {
        const data = await fetchJsonOrRedirect("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                folder: msg.folder || "~",
                tool: msg.tool,
                name: msg.name || "",
                group: msg.group || "",
                sourceId: msg.sourceId || "",
                sourceName: msg.sourceName || "",
              }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          attachSession(session.id, session);
        } else {
          await fetchSessionsList();
        }
        return true;
      }
      case "rename": {
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: msg.name }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await refreshSidebarSession(msg.sessionId);
        }
        return true;
      }
      case "session_preferences": {
        const payload = {};
        if (Object.prototype.hasOwnProperty.call(msg, "tool")) payload.tool = msg.tool || "";
        if (Object.prototype.hasOwnProperty.call(msg, "model")) payload.model = msg.model || "";
        if (Object.prototype.hasOwnProperty.call(msg, "effort")) payload.effort = msg.effort || "";
        if (Object.prototype.hasOwnProperty.call(msg, "thinking")) payload.thinking = msg.thinking === true;
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await refreshSidebarSession(msg.sessionId);
        }
        return;
      }
      case "archive":
      case "unarchive": {
        const shouldArchive = msg.action === "archive";
        const previousSession = applyOptimisticSessionArchiveState(msg.sessionId, shouldArchive);
        try {
          const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: shouldArchive }),
          });
          if (data.session) {
            const session = upsertSession(data.session) || data.session;
            renderSessionList();
            if (currentSessionId === msg.sessionId) {
              applyAttachedSessionState(msg.sessionId, session);
            }
          } else if (currentSessionId === msg.sessionId) {
            await refreshCurrentSession();
          } else {
            await fetchSessionsList();
          }
        } catch (error) {
          if (previousSession) {
            restoreOptimisticSessionSnapshot(previousSession);
          }
          throw error;
        }
        return true;
      }
      case "delete": {
        const previousSession = applyOptimisticSessionDelete(msg.sessionId);
        try {
          await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
            method: "DELETE",
          });
          if (currentSessionId === msg.sessionId) {
            currentSessionId = null;
            hasAttachedSession = false;
            showEmpty();
          }
          await fetchSessionsList();
        } catch (error) {
          if (previousSession) {
            restoreOptimisticSessionSnapshot(previousSession);
          }
          throw error;
        }
        return true;
      }
      case "pin":
      case "unpin": {
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: msg.action === "pin" }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await fetchSessionsList();
        }
        return true;
      }
      case "organize": {
        await organizeSessionById(msg.sessionId || currentSessionId, {
          viewportIntent: msg.viewportIntent || "preserve",
        });
        return true;
      }
      case "persistent_promote": {
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}/promote-persistent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: msg.kind,
            ...(msg.digest ? { digest: msg.digest } : {}),
            ...(msg.recurring ? { recurring: msg.recurring } : {}),
            ...(msg.execution ? { execution: msg.execution } : {}),
            ...(msg.runtimePolicy ? { runtimePolicy: msg.runtimePolicy } : {}),
          }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId && data.session?.id === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
          await window.MelodySyncWorkbench?.refreshOperationRecord?.();
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await refreshSidebarSession(msg.sessionId);
        }
        return true;
      }
      case "persistent_run": {
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}/run-persistent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(msg.runPrompt ? { runPrompt: msg.runPrompt } : {}),
            ...(msg.runtime ? { runtime: msg.runtime } : {}),
          }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
          await window.MelodySyncWorkbench?.refreshOperationRecord?.();
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await refreshSidebarSession(msg.sessionId);
        }
        return true;
      }
      case "persistent_patch": {
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persistent: Object.prototype.hasOwnProperty.call(msg, "persistent")
              ? msg.persistent
              : null,
          }),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
          await window.MelodySyncWorkbench?.refreshOperationRecord?.();
        } else if (currentSessionId === msg.sessionId) {
          await refreshCurrentSession();
        } else {
          await refreshSidebarSession(msg.sessionId);
        }
        return true;
      }
      case "send": {
        const targetSessionId = msg.sessionId || currentSessionId;
        if (!targetSessionId) return false;
        const requestId = msg.requestId || createRequestId();
        const canUseMultipart = Array.isArray(msg.images)
          && msg.images.some((image) => image?.file && typeof image.file.arrayBuffer === "function");
        const requestUrl = `/api/sessions/${encodeURIComponent(targetSessionId)}/messages`;
        const data = canUseMultipart
          ? await (async () => {
              const formData = new FormData();
              const existingImages = [];
              const externalAssets = [];
              formData.set("requestId", requestId);
              formData.set("text", msg.text || "");
              if (msg.tool) formData.set("tool", msg.tool);
              if (msg.model) formData.set("model", msg.model);
              if (msg.effort) formData.set("effort", msg.effort);
              if (msg.thinking) formData.set("thinking", "true");
              for (const image of msg.images || []) {
                if (image?.file) {
                  formData.append("images", image.file, image.originalName || image.file.name || "attachment");
                  continue;
                }
                if (image?.assetId) {
                  externalAssets.push({
                    assetId: image.assetId,
                    originalName: image.originalName || "",
                    mimeType: image.mimeType || "",
                  });
                  continue;
                }
                if (!image?.filename) continue;
                existingImages.push({
                  filename: image.filename,
                  originalName: image.originalName || "",
                  mimeType: image.mimeType || "",
                });
              }
              if (existingImages.length > 0) {
                formData.set("existingImages", JSON.stringify(existingImages));
              }
              if (externalAssets.length > 0) {
                formData.set("externalAssets", JSON.stringify(externalAssets));
              }
              return fetchJsonOrRedirect(requestUrl, {
                method: "POST",
                body: formData,
              });
            })()
          : await fetchJsonOrRedirect(requestUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId,
                text: msg.text,
                ...(msg.images ? { images: msg.images } : {}),
                ...(msg.tool ? { tool: msg.tool } : {}),
                ...(msg.model ? { model: msg.model } : {}),
                ...(msg.effort ? { effort: msg.effort } : {}),
                ...(msg.thinking ? { thinking: true } : {}),
              }),
            });
        if (typeof finalizeComposerPendingSend === "function") {
          finalizeComposerPendingSend(data.requestId || requestId);
        }
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === session.id) {
            applyAttachedSessionState(session.id, session);
          }
        }
        try {
          if (currentSessionId === targetSessionId) {
            await refreshCurrentSession();
          } else {
            await refreshSidebarSession(targetSessionId);
          }
        } catch {
          setTimeout(() => {
            if (currentSessionId === targetSessionId) {
              refreshCurrentSession().catch(() => {});
            } else {
              refreshSidebarSession(targetSessionId).catch(() => {});
            }
          }, 0);
        }
        return true;
      }
      case "cancel":
        await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(currentSessionId)}/cancel`, {
          method: "POST",
        });
        await refreshCurrentSession();
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.error("HTTP action failed:", error.message);
    return false;
  }
}

function buildOptimisticArchivedSession(session, archived) {
  if (!session?.id) return null;
  const next = { ...session };
  if (archived) {
    next.archived = true;
    next.archivedAt = next.archivedAt || new Date().toISOString();
    delete next.pinned;
    return next;
  }
  delete next.archived;
  delete next.archivedAt;
  return next;
}

function applyOptimisticSessionArchiveState(sessionId, archived) {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) return null;
  const previous = sessions[index];
  const next = buildOptimisticArchivedSession(previous, archived);
  if (!next) return null;
  if (previous?.archived !== true && archived) {
    archivedSessionCount += 1;
  } else if (previous?.archived === true && !archived) {
    archivedSessionCount = Math.max(0, archivedSessionCount - 1);
  }
  sessions[index] = next;
  if (typeof assignSessionListOrderHints === "function") {
    assignSessionListOrderHints(sessions, new Map([[sessionId, previous]]));
  }
  sortSessionsInPlace();
  refreshAppCatalog();
  if (currentSessionId === sessionId) {
    applyAttachedSessionState(sessionId, next);
  } else {
    renderSessionList();
  }
  return previous;
}

function applyOptimisticSessionDelete(sessionId) {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) return null;
  const previous = sessions[index];
  sessions.splice(index, 1);
  if (previous?.archived === true) {
    archivedSessionCount = Math.max(0, archivedSessionCount - 1);
  }
  sortSessionsInPlace();
  refreshAppCatalog();
  renderSessionList();
  return previous;
}

function restoreOptimisticSessionSnapshot(session) {
  if (!session?.id) return;
  const index = sessions.findIndex((entry) => entry.id === session.id);
  const current = index === -1 ? null : sessions[index];
  if (current?.archived !== true && session.archived === true) {
    archivedSessionCount += 1;
  } else if (current?.archived === true && session.archived !== true) {
    archivedSessionCount = Math.max(0, archivedSessionCount - 1);
  }
  if (index === -1) {
    sessions.push(session);
  } else {
    sessions[index] = session;
  }
  if (typeof assignSessionListOrderHints === "function") {
    assignSessionListOrderHints(sessions, current ? new Map([[session.id, current]]) : null);
  }
  sortSessionsInPlace();
  refreshAppCatalog();
  if (currentSessionId === session.id) {
    applyAttachedSessionState(session.id, session);
  } else {
    renderSessionList();
  }
}

function getCurrentSession() {
  return sessions.find((s) => s.id === currentSessionId) || null;
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case "build_info":
      void window.MelodySyncBuild?.applyBuildInfo?.(msg.buildInfo);
      break;

    case "sessions_invalidated":
      fetchSessionsList().catch(() => {});
      if (archivedSessionsLoaded) {
        fetchArchivedSessions().catch(() => {});
      }
      break;

    case "session_invalidated":
      if (!msg.sessionId) {
        refreshRealtimeViews().catch(() => {});
        break;
      }
      if (msg.sessionId === currentSessionId) {
        refreshCurrentSession().catch(() => {});
      } else {
        refreshSidebarSession(msg.sessionId).catch(() => {});
      }
      break;

    case "error":
      console.error("WS error:", msg.message);
      break;
  }
}

// ---- Status ----
function updateStatus(connState, session = getCurrentSession()) {
  const archived = session?.archived === true;
  if (connState === "disconnected") {
    statusDot.className = "status-dot";
    statusText.textContent = t("status.reconnecting");
    msgInput.disabled = !currentSessionId || archived;
    msgInput.placeholder = archived ? t("input.placeholder.archived") : t("input.placeholder.message");
    sendBtn.style.display = "";
    sendBtn.disabled = !currentSessionId || archived;
    sendBtn.title = t("action.send");
    window.dispatchEvent(new CustomEvent("melodysync:status-change", {
      detail: {
        connState,
        sessionId: currentSessionId || "",
        session,
        label: statusText.textContent,
        dotClass: statusDot.className,
      },
    }));
    return;
  }
  const visualStatus = getSessionVisualStatus(session);
  const activity = getSessionActivity(session);
  const runIsActive = activity.run.state === "running";
  const inputBusy = isSessionBusy(session);
  sessionStatus = runIsActive ? "running" : "idle";
  const showArchivedOnly = archived && visualStatus.key === "idle";
  if (showArchivedOnly) {
    statusDot.className = "status-dot";
    statusText.textContent = t("status.archived");
  } else if (visualStatus.label) {
    statusDot.className = visualStatus.dotClass
      ? `status-dot ${visualStatus.dotClass}`
      : "status-dot";
    statusText.textContent = archived
      ? `${visualStatus.label} · ${t("status.archived")}`
      : visualStatus.label;
  } else {
    statusDot.className = "status-dot";
    statusText.textContent = currentSessionId ? t("status.idle") : t("status.connected");
  }
  const hasSession = !!currentSessionId;
  msgInput.disabled = !hasSession || archived;
  msgInput.placeholder = archived
    ? t("input.placeholder.archived")
    : inputBusy
      ? t("input.placeholder.queueFollowUp")
      : t("input.placeholder.message");
  sendBtn.style.display = "";
  sendBtn.disabled = !hasSession || archived;
  sendBtn.title = inputBusy ? t("action.queueFollowUp") : t("action.send");
  cancelBtn.style.display = runIsActive && hasSession ? "flex" : "none";
  imgBtn.disabled = !hasSession || archived;
  inlineToolSelect.disabled = !hasSession || archived;
  inlineModelSelect.disabled = !hasSession || archived;
  window.dispatchEvent(new CustomEvent("melodysync:status-change", {
    detail: {
      connState,
      sessionId: currentSessionId || "",
      session,
      label: statusText.textContent,
      dotClass: statusDot.className,
    },
  }));
  thinkingToggle.disabled = !hasSession || archived;
  effortSelect.disabled = !hasSession || archived;
}
