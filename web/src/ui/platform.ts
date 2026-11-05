/** Platform facts the setup flow depends on ([runtime view](../../../docs/arc42/06-runtime-view.md)). */

/**
 * iOS and iPadOS (every browser there is WebKit) and macOS Safari give an
 * installed web app its own storage, separate from the browser tab. No
 * feature test exists, so this reads the user agent.
 */
export function separateAppStorage(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  const mac = /\bMacintosh\b/.test(userAgent);
  if (mac && maxTouchPoints > 1) return true; // iPadOS requesting the desktop site
  const otherEngine =
    /\b(Chrome|Chromium|CriOS|Edg|EdgiOS|Firefox|FxiOS|OPR|SamsungBrowser)\//.test(userAgent);
  return mac && /\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent) && !otherEngine;
}

export function standalone(): boolean {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia("(display-mode: standalone)").matches;
}

/** The deferred `beforeinstallprompt` event (Chromium only). */
export interface InstallPrompt {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;

export function captureInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as unknown as InstallPrompt;
  });
}

export function installPrompt(): InstallPrompt | null {
  return deferred;
}

export function consumeInstallPrompt(): void {
  deferred = null;
}
