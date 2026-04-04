export function createResumeCompletionTargetsHook({ resumePendingCompletionTargets }) {
  if (typeof resumePendingCompletionTargets !== 'function') {
    throw new Error('createResumeCompletionTargetsHook requires resumePendingCompletionTargets');
  }

  return async function resumeCompletionTargetsHook() {
    await resumePendingCompletionTargets();
  };
}

