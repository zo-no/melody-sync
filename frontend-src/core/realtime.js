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

// Expose dispatchAction globally so React bundles can create sessions
globalThis._melodySyncDispatchAction = (msg) => dispatchAction(msg);

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
        let latestSession = attachedSession;
        if (queueCount > 0 && !Array.isArray(attachedSession?.queuedMessages)) {
          const [detailSession] = await Promise.all([
            fetchSessionState(msg.sessionId),
            eventsPromise,
          ]);
          latestSession = getCurrentSession() || detailSession || latestSession;
        } else {
          await eventsPromise;
          latestSession = getCurrentSession() || latestSession;
        }
        if (latestSession && typeof markVisibleSessionReviewed === "function") {
          const shouldSyncReviewed = typeof isSessionBusy === "function"
            ? !isSessionBusy(latestSession)
            : true;
          await Promise.resolve(markVisibleSessionReviewed(latestSession, {
            sync: shouldSyncReviewed,
          })).catch(() => {});
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
            description: msg.description || "",
            sourceId: msg.sourceId || "",
            sourceName: msg.sourceName || "",
            ...(msg.persistent && typeof msg.persistent === "object" ? { persistent: msg.persistent } : {}),
          }),
        });
        // After creation, if taskPoolMembership is specified, PATCH it onto the new session.
        // This is used to make a session a project root (role:'project') since the create
        // endpoint does not accept taskPoolMembership directly.
        if (data.session?.id && msg.taskPoolMembership && typeof msg.taskPoolMembership === "object") {
          const patchData = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(data.session.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskPoolMembership: msg.taskPoolMembership }),
          }).catch(() => null);
          if (patchData?.session) {
            Object.assign(data, { session: patchData.session });
          }
        }
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          // noAttach: skip auto-opening the session in the chat view (e.g. project roots, background tasks)
          if (!msg.noAttach) {
            attachSession(session.id, session);
          }
          return session;
        }
        await fetchSessionsList();
        return true;
      }
      case "rename": {
        const renamePatch = { name: msg.name };
        // 如果是长期项目重命名，同步更新 persistent.digest.title
        if (typeof msg.digestTitle === "string" && msg.digestTitle.trim()) {
          renamePatch.persistent = { digest: { title: msg.digestTitle.trim() } };
        }
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(renamePatch),
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
        // "archive" = mark as done (workflowState: "done")
        // "unarchive" = undo done (clear workflowState)
        const shouldMarkDone = msg.action === "archive";
        const nextWorkflowState = shouldMarkDone ? "done" : "";
        const previousSession = applyOptimisticSessionWorkflowState(msg.sessionId, nextWorkflowState);
        try {
          const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflowState: nextWorkflowState }),
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
      case "complete_pending": {
        const previousSession = applyOptimisticSessionWorkflowState(msg.sessionId, "done");
        try {
          // If the session being completed is a branch, auto-merge its context back to the parent first
          const targetSession = Array.isArray(sessions)
            ? sessions.find((s) => s?.id === msg.sessionId) || null
            : null;
          const isBranch = String(targetSession?.taskCard?.lineRole || "").trim().toLowerCase() === "branch";
          if (isBranch) {
            try {
              const mergeData = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(msg.sessionId)}/merge-return`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mergeType: "conclusion" }),
              });
              if (mergeData?.session) {
                upsertSession(mergeData.session);
              }
            } catch (_mergeErr) {
              // merge-return is best-effort; continue to mark done even if it fails
            }
          }
          const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflowState: "done" }),
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
        } catch (error) {
          if (previousSession) {
            restoreOptimisticSessionSnapshot(previousSession);
          }
          throw error;
        }
        return true;
      }
      case "restore_pending": {
        const previousSession = applyOptimisticSessionWorkflowState(msg.sessionId, "");
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowState: "" }),
        }).catch((error) => {
          if (previousSession) {
            restoreOptimisticSessionSnapshot(previousSession);
          }
          throw error;
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
      case "delete": {
        const targetSession = Array.isArray(sessions)
          ? sessions.find((session) => session?.id === msg.sessionId) || null
          : null;
        const sessionName = typeof targetSession?.name === "string" && targetSession.name.trim()
          ? targetSession.name.trim()
          : t("session.defaultName");
        const _targetWf = String(targetSession?.workflowState || '').trim().toLowerCase();
        const isArchived = _targetWf === 'done' || _targetWf === 'complete' || _targetWf === 'completed';
        const confirmMsg = (isArchived
          ? t("action.deleteArchivedConfirm")
          : t("action.deleteConfirm")
        ).replace("{name}", sessionName);
        const confirmed = typeof showConfirm === "function"
          ? await showConfirm(confirmMsg, { title: t("action.delete"), danger: true, confirmLabel: t("action.delete"), cancelLabel: t("action.cancel") })
          : window.confirm(confirmMsg);
        if (!confirmed) return true;
        // Direct delete — no prerequisite needed
        const previousSession = applyOptimisticSessionDelete(msg.sessionId);
        try {
          const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
            method: "DELETE",
          });
          removeSessionsFromClientState(
            normalizeDeletedSessionIds(data?.deletedSessionIds, msg.sessionId),
          );
          try {
            await fetchSessionsList();
          } catch (refreshError) {
            console.warn("Session list refresh failed after delete:", refreshError?.message || refreshError);
          }
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
          if (currentSessionId === msg.sessionId) {
            if (data.session?.id && data.session.id !== msg.sessionId && typeof attachSession === "function") {
              attachSession(data.session.id, session);
            } else {
              applyAttachedSessionState(msg.sessionId, session);
            }
          } else if (currentSessionId === data.session?.id) {
            applyAttachedSessionState(data.session.id, session);
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
        if (data.parentSession) {
          const parentSession = upsertSession(data.parentSession) || data.parentSession;
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, parentSession);
            const runState = typeof getSessionRunState === "function" ? getSessionRunState(parentSession) : "running";
            await fetchSessionEvents(msg.sessionId, { runState, viewportIntent: "preserve" });
          }
        }
        if (data.spawnedSession) {
          upsertSession(data.spawnedSession);
        }
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (!data.parentSession && currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
            const runState = typeof getSessionRunState === "function" ? getSessionRunState(session) : "running";
            await fetchSessionEvents(msg.sessionId, { runState, viewportIntent: "preserve" });
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
      case "session_patch": {
        // General-purpose PATCH for arbitrary session fields (e.g. taskPoolMembership, name)
        const patchBody = msg.patch && typeof msg.patch === "object" ? msg.patch : {};
        const data = await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(msg.sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        if (data.session) {
          const session = upsertSession(data.session) || data.session;
          renderSessionList();
          if (currentSessionId === msg.sessionId) {
            applyAttachedSessionState(msg.sessionId, session);
          }
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
    if (msg?.action === "delete" && typeof alert === "function") {
      if (typeof showAlert === "function") showAlert(error?.message || t("action.deleteFailed"), { title: t("action.deleteFailed") || t("action.deleteFailed") });
      else alert(error?.message || t("action.deleteFailed"));
    }
    return false;
  }
}

function buildOptimisticArchivedSession(session, archived) {
  if (!session?.id) return null;
  const next = { ...session };
  if (archived) {
    // Mark as done via workflowState (archived field is no longer used)
    next.workflowState = "done";
    delete next.pinned;
    return next;
  }
  // Undo done
  next.workflowState = "";
  return next;
}

function applyOptimisticSessionArchiveState(sessionId, archived) {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) return null;
  const previous = sessions[index];
  const next = buildOptimisticArchivedSession(previous, archived);
  if (!next) return null;
  const _prevWf = String(previous?.workflowState || '').trim().toLowerCase();
  const _wasDone = _prevWf === 'done' || _prevWf === 'complete' || _prevWf === 'completed';
  if (!_wasDone && archived) {
    archivedSessionCount += 1;
  } else if (_wasDone && !archived) {
    archivedSessionCount = Math.max(0, archivedSessionCount - 1);
  }
  sessions[index] = next;
  if (typeof assignSessionListOrderHints === "function") {
    assignSessionListOrderHints(sessions, new Map([[sessionId, previous]]));
  }
  sortSessionsInPlace();
  if (currentSessionId === sessionId) {
    applyAttachedSessionState(sessionId, next);
  } else {
    renderSessionList();
  }
  return previous;
}

function buildOptimisticWorkflowSession(previous, workflowState = "") {
  if (!previous?.id) return null;
  const normalizedWorkflowState = typeof workflowState === "string"
    ? workflowState.trim()
    : "";
  const next = { ...previous };
  if (normalizedWorkflowState) {
    next.workflowState = normalizedWorkflowState;
    if (normalizedWorkflowState === "done") {
      next.workflowCompletedAt = new Date().toISOString();
    } else {
      delete next.workflowCompletedAt;
    }
  } else {
    delete next.workflowState;
    delete next.workflowCompletedAt;
  }
  return next;
}

function applyOptimisticSessionWorkflowState(sessionId, workflowState = "") {
  const index = sessions.findIndex((session) => session.id === sessionId);
  if (index === -1) return null;
  const previous = sessions[index];
  const next = buildOptimisticWorkflowSession(previous, workflowState);
  if (!next) return null;
  sessions[index] = next;
  if (typeof assignSessionListOrderHints === "function") {
    assignSessionListOrderHints(sessions, new Map([[sessionId, previous]]));
  }
  sortSessionsInPlace();
  if (currentSessionId === sessionId) {
    applyAttachedSessionState(sessionId, next);
  } else {
    renderSessionList();
  }
  return previous;
}

function normalizeDeletedSessionIds(deletedSessionIds = [], fallbackSessionId = "") {
  const normalized = new Set();
  for (const sessionId of Array.isArray(deletedSessionIds) ? deletedSessionIds : []) {
    const trimmed = typeof sessionId === "string" ? sessionId.trim() : "";
    if (trimmed) normalized.add(trimmed);
  }
  const fallback = typeof fallbackSessionId === "string" ? fallbackSessionId.trim() : "";
  if (fallback) normalized.add(fallback);
  return [...normalized];
}

function removeSessionsFromClientState(sessionIds = []) {
  const deletedIds = normalizeDeletedSessionIds(sessionIds);
  if (deletedIds.length === 0) return [];
  const targetIds = new Set(deletedIds);
  const removedSessions = [];
  const nextSessions = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session?.id && targetIds.has(session.id)) {
      removedSessions.push(session);
      continue;
    }
    nextSessions.push(session);
  }
  const shouldClearCurrent = Boolean(currentSessionId && targetIds.has(currentSessionId));
  if (!removedSessions.length && !shouldClearCurrent) return [];
  sessions = nextSessions;
  const removedArchivedCount = removedSessions.filter((session) => {
    const wf = String(session?.workflowState || '').trim().toLowerCase();
    return wf === 'done' || wf === 'complete' || wf === 'completed';
  }).length;
  if (removedArchivedCount > 0) {
    archivedSessionCount = Math.max(0, archivedSessionCount - removedArchivedCount);
  }
  if (shouldClearCurrent) {
    currentSessionId = null;
    hasAttachedSession = false;
  }
  for (const id of deletedIds) {
    if (typeof clearDraft === "function") clearDraft(id);
  }
  sortSessionsInPlace();
  renderSessionList();
  if (shouldClearCurrent && typeof showEmpty === "function") {
    showEmpty();
  }
  return removedSessions;
}

function applyOptimisticSessionDelete(sessionId) {
  const previous = Array.isArray(sessions)
    ? sessions.find((session) => session?.id === sessionId) || null
    : null;
  if (!previous) return null;
  removeSessionsFromClientState([sessionId]);
  return previous;
}

function restoreOptimisticSessionSnapshot(session) {
  if (!session?.id) return;
  const index = sessions.findIndex((entry) => entry.id === session.id);
  const current = index === -1 ? null : sessions[index];
  const _curWf = String(current?.workflowState || '').trim().toLowerCase();
  const _newWf = String(session?.workflowState || '').trim().toLowerCase();
  const _curDone = _curWf === 'done' || _curWf === 'complete' || _curWf === 'completed';
  const _newDone = _newWf === 'done' || _newWf === 'complete' || _newWf === 'completed';
  if (!_curDone && _newDone) {
    archivedSessionCount += 1;
  } else if (_curDone && !_newDone) {
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
  const _wfState = String(session?.workflowState || '').trim().toLowerCase();
  const archived = _wfState === 'done' || _wfState === 'complete' || _wfState === 'completed';
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
