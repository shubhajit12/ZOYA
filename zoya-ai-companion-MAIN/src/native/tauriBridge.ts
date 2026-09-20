/**
 * Bridge for Tauri native features when running inside the desktop .exe.
 * Browser preview keeps safe no-op fallbacks.
 */
import { invoke } from '@tauri-apps/api/core';

export class TauriBridge {
  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  private async invokeCommand<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.isTauriAvailable()) {
      throw new Error(`Tauri is not available; cannot invoke native command: ${command}`);
    }
    return await invoke<T>(command, args);
  }

  public async enterCompanion(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invokeCommand('enter_mate_companion');
    } else {
      console.log('[Native] Mate companion mode requested (browser preview)');
    }
  }

  public async exitCompanion(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invokeCommand('exit_mate_companion');
    } else {
      console.log('[Native] Mate companion restore requested (browser preview)');
    }
  }

  public async startCompanionDrag(anchorX: number, anchorY: number): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invokeCommand('start_companion_drag', { anchorX, anchorY });
    } else {
      console.log('[Native] Companion drag requested (browser preview)');
    }
  }

  public async finishCompanionDrag(anchorX: number, anchorY: number): Promise<boolean> {
    if (this.isTauriAvailable()) {
      return await this.invokeCommand<boolean>('finish_companion_drag', { anchorX, anchorY });
    }
    console.log('[Native] Companion drag finished (browser preview)');
    return false;
  }

  public minimizeWindow() {
    if (this.isTauriAvailable()) {
      void this.invokeCommand('plugin:window|set_minimized', { value: true });
    } else {
      console.log('[Native] Minimize window triggered');
    }
  }

  public toggleMaximizeWindow() {
    if (this.isTauriAvailable()) {
      void this.invokeCommand('plugin:window|toggle_maximize');
    } else {
      console.log('[Native] Toggle Maximize triggered');
    }
  }

  public closeWindow() {
    if (this.isTauriAvailable()) {
      void this.invokeCommand('plugin:window|close');
    } else {
      console.log('[Native] Close window triggered');
    }
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean) {
    if (this.isTauriAvailable()) {
      await this.invokeCommand('plugin:window|set_always_on_top', { value: alwaysOnTop });
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
