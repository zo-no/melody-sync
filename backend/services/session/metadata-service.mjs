import { loadSessionsMeta } from '../../session/meta-store.mjs';
import { normalizeSessionAgreements } from '../../session/agreements.mjs';
import {
  normalizeSessionDescription,
  normalizeSessionGroup,
} from '../../session/naming.mjs';
import { shouldExposeSession } from '../../session/visibility.mjs';
import { resolveSessionStateFromSession } from '../../session-runtime/session-state.mjs';

function normalizeSessionSidebarOrder(value) {
  const parsed = typeof value === 'number'
    ? value
    : parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function getNextSidebarOrderForGroup(group = '', {
  excludeSessionId = '',
} = {}) {
  const normalizedGroup = normalizeSessionGroup(group || '');
  if (!normalizedGroup) return 0;
  const metas = await loadSessionsMeta();
  const maxOrder = metas.reduce((currentMax, meta) => {
    if (!meta || meta.archived === true) return currentMax;
    if (excludeSessionId && meta.id === excludeSessionId) return currentMax;
    if (normalizeSessionGroup(meta.group || '') !== normalizedGroup) return currentMax;
    return Math.max(currentMax, normalizeSessionSidebarOrder(meta.sidebarOrder));
  }, 0);
  return maxOrder > 0 ? maxOrder + 1 : 1;
}

function normalizeSessionTaskCardManagedBindings(value) {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set([
    'mainGoal',
    'goal',
    'candidateBranches',
    'checkpoint',
    'nextSteps',
    'lineRole',
    'branchFrom',
    'branchReason',
    'memory',
    'knownConclusions',
  ]);
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const key = typeof entry === 'string' ? entry.trim() : '';
    if (!key || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function normalizeSessionReviewedAt(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function createSessionMetadataMutationService({
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  clearRenameState,
  enrichSessionMeta,
  findSessionMeta,
  mutateSessionMeta,
  nowIso,
  stabilizeSessionTaskCard,
}) {
  async function setSessionArchived(id, archived = true) {
    const shouldArchive = archived === true;
    const current = await findSessionMeta(id);
    if (!current) return null;

    const result = await mutateSessionMeta(id, (session) => {
      const isArchived = session.archived === true;
      if (isArchived === shouldArchive) return false;
      if (shouldArchive) {
        session.archived = true;
        delete session.pinned;
        session.archivedAt = nowIso();
        return true;
      }
      delete session.archived;
      delete session.archivedAt;
      return true;
    });

    if (!result.meta) return null;
    if (!result.changed) {
      return enrichSessionMeta(result.meta);
    }

    if (shouldExposeSession(current)) {
      broadcastSessionsInvalidation();
    }
    broadcastSessionInvalidation(id);
    return enrichSessionMeta(result.meta);
  }

  async function setSessionPinned(id, pinned = true) {
    const shouldPin = pinned === true;
    const result = await mutateSessionMeta(id, (session) => {
      if (session.archived && shouldPin) return false;
      const isPinned = session.pinned === true;
      if (isPinned === shouldPin) return false;
      if (shouldPin) {
        session.pinned = true;
      } else {
        delete session.pinned;
      }
      return true;
    });

    if (!result.meta) return null;
    if (result.changed && shouldExposeSession(result.meta)) {
      broadcastSessionsInvalidation();
    }
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  async function renameSession(id, name, options = {}) {
    const nextName = typeof name === 'string' ? name.trim() : '';
    if (!nextName) return null;

    const result = await mutateSessionMeta(id, (session) => {
      const preserveAutoRename = options.preserveAutoRename === true;
      const nextPending = preserveAutoRename;
      const changed = session.name !== nextName || session.autoRenamePending !== nextPending;
      if (!changed) return false;
      session.name = nextName;
      session.autoRenamePending = nextPending;
      session.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    clearRenameState(id);
    broadcastSessionInvalidation(id);
    return enrichSessionMeta(result.meta);
  }

  async function updateSessionGrouping(id, patch = {}) {
    const result = await mutateSessionMeta(id, (session) => {
      let changed = false;
      let groupChanged = false;
      if (Object.prototype.hasOwnProperty.call(patch, 'group')) {
        const nextGroup = normalizeSessionGroup(patch.group || '');
        if (nextGroup) {
          if (session.group !== nextGroup) {
            session.group = nextGroup;
            changed = true;
            groupChanged = true;
          }
        } else if (session.group) {
          delete session.group;
          changed = true;
          groupChanged = true;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
        const nextDescription = normalizeSessionDescription(patch.description || '');
        if (nextDescription) {
          if (session.description !== nextDescription) {
            session.description = nextDescription;
            changed = true;
          }
        } else if (session.description) {
          delete session.description;
          changed = true;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'manualGroup')) {
        const nextManualGroup = normalizeSessionGroup(patch.manualGroup || '');
        if (nextManualGroup) {
          if (session.manualGroup !== nextManualGroup) {
            session.manualGroup = nextManualGroup;
            changed = true;
          }
        } else if (session.manualGroup) {
          delete session.manualGroup;
          changed = true;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'sidebarOrder')) {
        const nextSidebarOrder = normalizeSessionSidebarOrder(patch.sidebarOrder);
        if (nextSidebarOrder) {
          if (session.sidebarOrder !== nextSidebarOrder) {
            session.sidebarOrder = nextSidebarOrder;
            changed = true;
          }
        } else if (session.sidebarOrder) {
          delete session.sidebarOrder;
          changed = true;
        }
      }
      if (
        groupChanged
        && !Object.prototype.hasOwnProperty.call(patch, 'sidebarOrder')
        && session.group
      ) {
        delete session.sidebarOrder;
      }
      if (changed) {
        session.updatedAt = nowIso();
      }
      return changed;
    });

    if (!result.meta) return null;
    let finalMeta = result.meta;
    if (
      result.changed
      && Object.prototype.hasOwnProperty.call(patch, 'group')
      && finalMeta.group
      && !Object.prototype.hasOwnProperty.call(patch, 'sidebarOrder')
    ) {
      const nextSidebarOrder = await getNextSidebarOrderForGroup(finalMeta.group, {
        excludeSessionId: id,
      });
      if (nextSidebarOrder > 0) {
        const sidebarOrderResult = await mutateSessionMeta(id, (session) => {
          if (normalizeSessionSidebarOrder(session.sidebarOrder) === nextSidebarOrder) return false;
          session.sidebarOrder = nextSidebarOrder;
          session.updatedAt = nowIso();
          return true;
        });
        if (sidebarOrderResult?.meta) {
          finalMeta = sidebarOrderResult.meta;
        }
      }
    }
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(finalMeta);
  }

  async function updateSessionTaskCard(id, taskCard, options = {}) {
    const result = await mutateSessionMeta(id, (session) => {
      const nextManagedBindings = normalizeSessionTaskCardManagedBindings(options?.managedBindingKeys);
      const currentManagedBindings = normalizeSessionTaskCardManagedBindings(session.taskCardManagedBindings);
      const currentTaskCard = stabilizeSessionTaskCard(session, session.taskCard, {
        managedBindingKeys: currentManagedBindings,
      });
      const nextTaskCard = stabilizeSessionTaskCard(session, taskCard, {
        ...options,
        managedBindingKeys: nextManagedBindings,
      });
      const managedBindingsChanged = JSON.stringify(currentManagedBindings) !== JSON.stringify(nextManagedBindings);
      const nextSessionState = resolveSessionStateFromSession({
        ...session,
        taskCard: nextTaskCard || null,
      });
      const hasMeaningfulSessionState = nextSessionState && (
        nextSessionState.goal
        || nextSessionState.mainGoal
        || nextSessionState.checkpoint
        || nextSessionState.needsUser === true
        || nextSessionState.lineRole === 'branch'
        || nextSessionState.branchFrom
      );
      const currentSessionStateJson = JSON.stringify(session.sessionState || null);
      const nextSessionStateJson = JSON.stringify(hasMeaningfulSessionState ? nextSessionState : null);
      if (
        JSON.stringify(currentTaskCard) === JSON.stringify(nextTaskCard)
        && !managedBindingsChanged
        && currentSessionStateJson === nextSessionStateJson
      ) {
        return false;
      }

      if (nextTaskCard) {
        session.taskCard = nextTaskCard;
      } else if (session.taskCard) {
        delete session.taskCard;
      }

      if (nextManagedBindings.length > 0) {
        session.taskCardManagedBindings = nextManagedBindings;
      } else if (session.taskCardManagedBindings) {
        delete session.taskCardManagedBindings;
      }

      if (hasMeaningfulSessionState) {
        session.sessionState = nextSessionState;
      } else if (session.sessionState) {
        delete session.sessionState;
      }

      session.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  async function updateSessionAgreements(id, patch = {}) {
    const hasActiveAgreements = Object.prototype.hasOwnProperty.call(patch || {}, 'activeAgreements');
    if (!hasActiveAgreements) {
      return null;
    }

    const nextActiveAgreements = normalizeSessionAgreements(patch.activeAgreements);
    const result = await mutateSessionMeta(id, (session) => {
      const currentActiveAgreements = normalizeSessionAgreements(session.activeAgreements || []);
      if (JSON.stringify(currentActiveAgreements) === JSON.stringify(nextActiveAgreements)) {
        return false;
      }

      if (nextActiveAgreements.length > 0) {
        session.activeAgreements = nextActiveAgreements;
      } else if (session.activeAgreements) {
        delete session.activeAgreements;
      }

      session.updatedAt = nowIso();
      return true;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  async function updateSessionLastReviewedAt(id, lastReviewedAt) {
    const nextLastReviewedAt = normalizeSessionReviewedAt(lastReviewedAt || '');
    const result = await mutateSessionMeta(id, (session) => {
      const currentLastReviewedAt = normalizeSessionReviewedAt(session.lastReviewedAt || '');
      if (nextLastReviewedAt) {
        if (currentLastReviewedAt !== nextLastReviewedAt) {
          session.lastReviewedAt = nextLastReviewedAt;
          return true;
        }
        return false;
      }

      if (currentLastReviewedAt) {
        delete session.lastReviewedAt;
        return true;
      }

      return false;
    });

    if (!result.meta) return null;
    if (result.changed) {
      broadcastSessionInvalidation(id);
    }
    return enrichSessionMeta(result.meta);
  }

  return {
    renameSession,
    setSessionArchived,
    setSessionPinned,
    updateSessionAgreements,
    updateSessionGrouping,
    updateSessionLastReviewedAt,
    updateSessionTaskCard,
  };
}
