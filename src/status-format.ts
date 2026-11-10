export const STATUS_FORMAT_TOKENS = ["label", "symbol", "tier", "support", "fallback"] as const;
export const MAX_STATUS_FORMAT_LENGTH = 256;

/** Saved/imported processing-tier metadata is display-only, never terminal markup. */
export function formatServedTier(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(value) ? value : "unknown";
}

export const STATUS_FORMAT_PRESETS = {
  minimal: "{symbol} {tier}",
  medium: "{symbol} {tier} | {support}",
  long: "{label}: {symbol} {tier} | {support} | {fallback}",
} as const;
export const DEFAULT_STATUS_PRESET = "long";
export const DEFAULT_STATUS_FORMAT = STATUS_FORMAT_PRESETS[DEFAULT_STATUS_PRESET];

export interface StatusSegments {
  label: string;
  symbol: string;
  tier: string;
  support: string;
  fallback: string;
}

const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/u;
const FORMAT_PART = /\{\{|\}\}|\{(label|symbol|tier|support|fallback)\}/g;

// A bounded, single-line template, not an expression language or terminal escape.
export function isStatusFormat(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_STATUS_FORMAT_LENGTH || CONTROL.test(value)) return false;
  return !/[{}]/.test(value.replace(FORMAT_PART, ""));
}

export function formatStatus(segments: StatusSegments, format?: string): string | undefined {
  const template = format === undefined || !isStatusFormat(format) ? DEFAULT_STATUS_FORMAT : format;
  const text = template.replace(FORMAT_PART, (match, token: keyof StatusSegments | undefined) => {
    if (match === "{{") return "{";
    if (match === "}}") return "}";
    return segments[token!].replace(/[\p{Cc}\p{Zl}\p{Zp}\u202a-\u202e\u2066-\u2069]/gu, "").slice(0, 128);
  });
  return text.trim() ? text : undefined;
}
