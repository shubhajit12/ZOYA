import { invoke, isTauri } from '@tauri-apps/api/core';

export class TauriBridge {
  private isTauriAvailable(): boolean {
    return isTauri();
  }

  private async invoke<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.isTauriAvailable()) {
      throw new Error(`Tauri is not available; cannot invoke native command: ${command}`);
    }
    return await invoke(command, args) as T;
  }

  public async diagnosticPing(): Promise<void> {
    await invoke('diagnostic_ping');
  }

  public async launchMinecraftBot(config: Record<string, unknown>): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('launch_minecraft_bot', { configJson: JSON.stringify(config) });
    } else {
      throw new Error('Minecraft Bot can only be launched from the desktop ZOYA app.');
    }
  }

  public async stopMinecraftBot(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('stop_minecraft_bot');
    } else {
      throw new Error('Minecraft Bot can only be stopped from the desktop ZOYA app.');
    }
  }

  public async enterCompanion(): Promise<void> {
    await invoke('start_mate_companion');
  }

  public async exitCompanion(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('exit_mate_companion');
    } else {
      console.log('[Native] Mate companion restore requested (browser preview)');
    }
  }

  public async startWindowDrag(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('start_window_drag');
    } else {
      console.log('[Native] Window drag requested (browser preview)');
    }
  }

  public async startCompanionDrag(anchorX: number, anchorY: number): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('start_companion_drag', { anchorX, anchorY });
    } else {
      console.log('[Native] Companion drag requested (browser preview)');
    }
  }

  public async finishCompanionDrag(anchorX: number, anchorY: number): Promise<boolean> {
    if (this.isTauriAvailable()) {
      return await this.invoke<boolean>('finish_companion_drag', { anchorX, anchorY });
    }
    console.log('[Native] Companion drag finished (browser preview)');
    return false;
  }

  public async minimizeWindow(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('minimize_window');
    } else {
      console.log('[Native] Minimize window triggered');
    }
  }

  public async toggleMaximizeWindow(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('toggle_maximize_window');
    } else {
      console.log('[Native] Toggle Maximize triggered');
    }
  }

  public async closeWindow(): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('close_window');
    } else {
      console.log('[Native] Close window triggered');
    }
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    if (this.isTauriAvailable()) {
      await this.invoke('set_always_on_top', { alwaysOnTop });
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
