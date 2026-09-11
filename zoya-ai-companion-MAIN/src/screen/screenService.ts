export class ScreenService {
  private mediaStream: MediaStream | null = null;
  private isActive: boolean = false;
  private videoElement: HTMLVideoElement | null = null;

  public isSharingActive(): boolean {
    return this.isActive;
  }

  public async startScreenShare(): Promise<boolean> {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen capture API not supported in this browser context.');
      }

      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as any,
        audio: false,
      });

      this.isActive = true;

      // Handle user stopping screen share from browser bar
      const track = this.mediaStream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          this.stopScreenShare();
        };
      }

      // Prepare hidden video element for snapshot canvas capture
      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.mediaStream;
      this.videoElement.play();

      return true;
    } catch (err: any) {
      console.warn('Screen share initialization failed or rejected:', err);
      this.stopScreenShare();
      return false;
    }
  }

  public stopScreenShare(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
    this.isActive = false;
  }

  /**
   * Capture a JPEG base64 frame from active screen share (or returns null if inactive)
   */
  public captureFrame(): string | null {
    if (!this.isActive || !this.videoElement || this.videoElement.readyState < 2) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.videoElement.videoWidth || 1280;
      canvas.height = this.videoElement.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    } catch (e) {
      console.warn('Failed to capture frame snapshot:', e);
      return null;
    }
  }
}

export const screenService = new ScreenService();
