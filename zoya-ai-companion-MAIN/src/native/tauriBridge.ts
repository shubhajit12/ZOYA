/**
 * Bridge for Tauri native features when running inside the desktop .exe.
 * Browser preview keeps safe no-op fallbacks.
 */
export class TauriBridge {
  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private async invoke(command: string): Promise<void> {
    if (!this.isTauriAvailable()) return;
    const internals = (window as any).__TAURI_INTERNALS__;
    if (typeof internals?.invoke !== 'function') return;
    await internals.invoke(command);
  }

  public async enterCompanion(): Promise<void> {
    if (this.isTauriAvailable()) await this.invoke('enter_companion');
    else console.log('[Native] Companion mode requested (browser preview)');
  }

  public async exitCompanion(): Promise<void> {
    if (this.isTauriAvailable()) await this.invoke('exit_companion');
    else console.log('[Native] Companion restore requested (browser preview)');
  }

  public minimizeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI_INTERNALS__?.invoke?.('plugin:window|set_minimized', { value: true });
    } else {
      console.log('[Native] Minimize window triggered');
    }
  }

  public toggleMaximizeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI_INTERNALS__?.invoke?.('plugin:window|toggle_maximize');
    } else {
      console.log('[Native] Toggle Maximize triggered');
    }
  }

  public closeWindow() {
    if (this.isTauriAvailable()) {
      (window as any).__TAURI_INTERNALS__?.invoke?.('plugin:window|close');
    } else {
      console.log('[Native] Close window triggered');
    }
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean) {
    if (this.isTauriAvailable()) {
      await (window as any).__TAURI_INTERNALS__?.invoke?.('plugin:window|set_always_on_top', { value: alwaysOnTop });
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
