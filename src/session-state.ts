export const SESSION_FAST_STATE_ENTRY = "pi-provider-service-tier:session-fast";
export const FAST_UI_KEY = "pi-provider-service-tier:fast";
export const FAST_SHORTCUT = "ctrl+alt+f";

export interface SessionFastState {
  version: 1;
  active: boolean;
  override: boolean;
  reason?: "unsupported";
}

export interface SessionEntryLike {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

export interface FastModelLike {
  id?: unknown;
  api?: unknown;
}

const FAST_APIS = new Set(["openai-responses", "openai-completions", "openai-codex-responses"]);

export function isGptFastModel(model: FastModelLike | undefined): boolean {
  return Boolean(model && typeof model.id === "string" && typeof model.api === "string"
    && /^gpt(?:[-._]|$)/iu.test(model.id.trim()) && FAST_APIS.has(model.api));
}

export function createSessionFastState(
  active = false,
  reason?: "unsupported",
  override = true,
): SessionFastState {
  return { version: 1, active, override, ...(!active && reason ? { reason } : {}) };
}

export function parseSessionFastState(value: unknown): SessionFastState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.active !== "boolean") return undefined;
  const override = typeof record.override === "boolean" ? record.override : true;
  return createSessionFastState(record.active, record.reason === "unsupported" ? "unsupported" : undefined, override);
}

/** Restore from the active branch, never abandoned branches or shared config. */
export function restoreSessionFastState(branch: readonly SessionEntryLike[]): SessionFastState {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== "custom" || entry.customType !== SESSION_FAST_STATE_ENTRY) continue;
    const state = parseSessionFastState(entry.data);
    if (state) return state;
  }
  return createSessionFastState(false, undefined, false);
}

export function fastStatusText(
  model: FastModelLike | undefined,
  state: SessionFastState,
  persistentTier?: string,
): string | undefined {
  if (!isGptFastModel(model)) return undefined;
  const label = state.override
    ? state.active
      ? "⚡ Fast 开启（本会话）"
      : state.reason
        ? "○ Fast 关闭（本会话已降级）"
        : "○ Fast 关闭（本会话）"
    : persistentTier === "priority"
      ? "⚡ Fast 开启（持久配置）"
      : "○ Fast 关闭";
  return `${label} · Ctrl+Alt+F 切换 · /fast ${state.active ? "off" : "on"}`;
}

export function fastPayload(payload: unknown, model: FastModelLike | undefined, state: SessionFastState): unknown | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  // Do not change nested calls, virtual-model dispatches, or another model's payload.
  if (record.model !== model?.id || !isGptFastModel(model)) return undefined;
  if (state.active) return { ...record, service_tier: "priority" };
  // A session-local off overrides priority/fast model defaults without rewriting
  // the persistent project/user configuration.
  const result = { ...record };
  delete result.service_tier;
  return result;
}
