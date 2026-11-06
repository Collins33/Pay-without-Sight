// Workflow position persisted in chrome.storage so it survives page reloads and service worker restarts.

export const WORKFLOW_KEY = 'pws.workflow.v1';

export function defaultWorkflowState() {
  return { workflowId: null, stageId: null, furthestIndex: -1, updatedAt: 0 };
}

/** Validates whatever was in storage; corrupted data falls back to the default. */
export function sanitizeWorkflowState(raw) {
  const base = defaultWorkflowState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    workflowId: typeof raw.workflowId === 'string' ? raw.workflowId.slice(0, 64) : null,
    stageId: typeof raw.stageId === 'string' ? raw.stageId.slice(0, 64) : null,
    furthestIndex: Number.isInteger(raw.furthestIndex) && raw.furthestIndex >= -1 && raw.furthestIndex < 100 ? raw.furthestIndex : -1,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

export async function loadWorkflowState(storage) {
  return sanitizeWorkflowState(await storage.get(WORKFLOW_KEY));
}

export async function saveWorkflowState(storage, state) {
  await storage.set(WORKFLOW_KEY, sanitizeWorkflowState(state));
}
