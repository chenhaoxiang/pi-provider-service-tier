import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PACKAGE_NAME = "pi-provider-service-tier";

// Brand visible messages, not the intentionally compact footer/status text.
export function extensionMessage(message: string): string {
  const label = message.match(/^\[([^\]\r\n]+)\](?:\s|$)/)?.[1];
  return label === PACKAGE_NAME || label?.startsWith(`${PACKAGE_NAME} v`)
    ? message
    : `[${PACKAGE_NAME}] ${message}`;
}

export function notify(ctx: Pick<ExtensionContext, "ui">, message: string, type?: Parameters<ExtensionContext["ui"]["notify"]>[1]): void {
  ctx.ui.notify(extensionMessage(message), type);
}
