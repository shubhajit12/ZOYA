/**
 * Bridge for Tauri native features when running inside desktop .exe environment.
 * Gracefully degrades to standard web APIs when running in preview.
 */
export class TauriBridge {
  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  public minimizeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI__?.window?.appWindow?.minimize();
    } else {
      console.log('[Native] Minimize window triggered');
    }
  }

  public toggleMaximizeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI__?.window?.appWindow?.toggleMaximize();
    } else {
      console.log('[Native] Toggle Maximize triggered');
    }
  }

  public closeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI__?.window?.appWindow?.close();
    } else {
      console.log('[Native] Close window triggered');
    }
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean) {
    if (this.isTauriAvailable()) {
      await (window as any).__TAURI__?.window?.appWindow?.setAlwaysOnTop(alwaysOnTop);
    } else {
      console.log(`[Native] Always-on-top set to: ${alwaysOnTop}`);
    }
  }

  public getEnvironmentInfo() {
    return {
      isDesktop: this.isTauriAvailable(),
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown',
    };
  }
}

export const tauriBridge = new TauriBridge();
