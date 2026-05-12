import type { Screenshot } from "./types.ts";

interface DisplayMediaConstraints extends MediaStreamConstraints {
  preferCurrentTab?: boolean;
}

interface CaptureGetDisplayMedia {
  getDisplayMedia(constraints?: DisplayMediaConstraints): Promise<MediaStream>;
}

export type CaptureMode = "off" | "ready" | "denied";

/**
 * One-shot session-scoped screen capture.
 *
 * Acquires the user's permission once via getDisplayMedia({preferCurrentTab:true}),
 * holds the resulting MediaStream, and crops frames per annotation. Re-uses one
 * <video> / <canvas> pair to avoid reallocating per click.
 *
 * In Chromium with `preferCurrentTab: true` the user's tab is highlighted in
 * the picker so the prompt is one click. Firefox doesn't expose `preferCurrentTab`
 * yet — falls back to the standard picker.
 */
export class CaptureSession {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: CaptureMode = "off";
  private readyPromise: Promise<boolean> | null = null;

  getState(): CaptureMode {
    return this.state;
  }

  async ensureReady(): Promise<boolean> {
    if (this.state === "ready" && this.stream && this.stream.active) return true;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.acquire().finally(() => { this.readyPromise = null; });
    return this.readyPromise;
  }

  private async acquire(): Promise<boolean> {
    const md = navigator.mediaDevices as MediaDevices & CaptureGetDisplayMedia;
    if (!md || typeof md.getDisplayMedia !== "function") {
      this.state = "denied";
      return false;
    }
    try {
      const stream = await md.getDisplayMedia({
        video: { frameRate: { ideal: 30 } } as MediaTrackConstraints,
        audio: false,
        preferCurrentTab: true,
      });
      this.stream = stream;
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      this.canvas = document.createElement("canvas");
      this.state = "ready";

      // If the user clicks "Stop sharing" in the browser's permission UI, the
      // track ends — drop our state so the next capture re-prompts.
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener("ended", () => {
          this.stop();
          this.state = "off";
        });
      }
      return true;
    } catch (e) {
      this.state = "denied";
      return false;
    }
  }

  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.canvas = null;
  }

  /**
   * Capture the current viewport, cropping to the bounding box of `el`.
   * Returns a Screenshot record with a PNG data URL and the bounds used.
   *
   * The capture stream's pixel dimensions usually equal the viewport in CSS
   * pixels × devicePixelRatio. We scale element rects accordingly.
   */
  async cropElement(el: Element, filename: string): Promise<Screenshot | null> {
    if (this.state !== "ready" || !this.video || !this.canvas || !this.stream) return null;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return null;

    // Give the video a moment to have a real frame buffered.
    if (this.video.readyState < 2) {
      await new Promise<void>((r) => {
        const onReady = () => { this.video?.removeEventListener("loadeddata", onReady); r(); };
        this.video?.addEventListener("loadeddata", onReady);
        setTimeout(r, 200);
      });
    }

    const frameW = this.video.videoWidth || window.innerWidth;
    const frameH = this.video.videoHeight || window.innerHeight;
    const scaleX = frameW / window.innerWidth;
    const scaleY = frameH / window.innerHeight;

    const r = el.getBoundingClientRect();
    // Clamp to the visible viewport (negative or oversized rects shouldn't break the crop).
    const cssX = Math.max(0, r.left);
    const cssY = Math.max(0, r.top);
    const cssW = Math.max(1, Math.min(window.innerWidth - cssX, r.width));
    const cssH = Math.max(1, Math.min(window.innerHeight - cssY, r.height));

    const sx = Math.round(cssX * scaleX);
    const sy = Math.round(cssY * scaleY);
    const sw = Math.round(cssW * scaleX);
    const sh = Math.round(cssH * scaleY);

    this.canvas.width = sw;
    this.canvas.height = sh;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, sw, sh);
    } catch {
      return null;
    }
    const dataUrl = this.canvas.toDataURL("image/png");
    return {
      filename,
      dataUrl,
      bounds: { x: cssX, y: cssY, width: cssW, height: cssH },
      mode: "element",
    };
  }
}
