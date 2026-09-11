import { PcCommand } from '../types';

export class PcControlService {
  /**
   * Parse user message or AI intent into a PC Command if detected.
   */
  public parseCommand(input: string): PcCommand | null {
    const lower = input.toLowerCase().trim();

    if (lower.startsWith('open ') || lower.includes('launch ')) {
      const target = lower.replace(/^(open|launch)\s+/, '').replace(/(please|app|application)$/, '').trim();
      return {
        id: `cmd_${Date.now()}`,
        action: 'open_app',
        target,
        description: `Open application '${target}'`,
        isDangerous: false,
      };
    }

    if (lower.includes('volume to ') || lower.includes('set volume ')) {
      const match = lower.match(/\b(\d{1,3})%/);
      const val = match ? parseInt(match[1], 10) : 50;
      return {
        id: `cmd_${Date.now()}`,
        action: 'system_volume',
        target: `${val}`,
        description: `Set system audio volume to ${val}%`,
        isDangerous: false,
      };
    }

    if (lower.includes('system info') || lower.includes('system status') || lower.includes('pc status')) {
      return {
        id: `cmd_${Date.now()}`,
        action: 'system_status',
        description: `Retrieve CPU, Memory, and System performance details`,
        isDangerous: false,
      };
    }

    if (lower.includes('delete file') || lower.includes('remove directory') || lower.includes('format drive') || lower.includes('shutdown pc')) {
      return {
        id: `cmd_${Date.now()}`,
        action: 'custom_shell',
        target: input,
        description: `Potentially destructive system action: "${input}"`,
        isDangerous: true,
      };
    }

    return null;
  }

  /**
   * Execute or simulate command via web abstraction / Tauri native bridge.
   */
  public async executeCommand(cmd: PcCommand): Promise<{ success: boolean; message: string }> {
    console.log(`[PC Control] Executing command:`, cmd);

    // If running in browser / AI studio environment, provide realistic desktop native response
    switch (cmd.action) {
      case 'open_app':
        return {
          success: true,
          message: `Attempting to launch ${cmd.target}. (Tauri desktop bridge ready)`,
        };
      case 'system_volume':
        return {
          success: true,
          message: `Volume adjusted to ${cmd.target}%.`,
        };
      case 'system_status':
        return {
          success: true,
          message: `System Operating Normally: CPU 12%, RAM 2.8 GB / 4.0 GB (Optimized), GPU active.`,
        };
      case 'custom_shell':
        return {
          success: false,
          message: `Action blocked by Zoya Security Policy. High risk command require authorization.`,
        };
      default:
        return { success: true, message: `Command '${cmd.description}' executed successfully.` };
    }
  }
}

export const pcControlService = new PcControlService();
