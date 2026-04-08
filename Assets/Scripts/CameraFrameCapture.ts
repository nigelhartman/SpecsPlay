import { CameraFeedController } from "./CameraFeedController"
import { LyriaMusicController } from "./LyriaMusicController"

const CAPTURE_INTERVAL_SECONDS = 5

@component
export class CameraFrameCapture extends BaseScriptComponent {
  @input cameraFeedController: CameraFeedController
  @input lyriaMusicController: LyriaMusicController

  private lastCaptureTime: number = 0
  private isCapturing: boolean = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.cameraFeedController) {
        print("[CameraFrameCapture] ERROR: cameraFeedController input not set")
        return
      }
      if (!this.lyriaMusicController) {
        print("[CameraFrameCapture] ERROR: lyriaMusicController input not set")
        return
      }
      this.createEvent("UpdateEvent").bind(() => this.onUpdate())
      print("[CameraFrameCapture] Ready, capturing every " + CAPTURE_INTERVAL_SECONDS + "s")
    })
  }

  private onUpdate(): void {
    if (!this.lyriaMusicController.isStreaming()) return

    const now = getTime()
    if (now - this.lastCaptureTime < CAPTURE_INTERVAL_SECONDS) return
    if (this.isCapturing) return

    const texture = this.cameraFeedController.cameraTexture
    if (!texture) return

    this.isCapturing = true
    this.lastCaptureTime = now

    Base64.encodeTextureAsync(
      texture,
      (base64: string) => {
        this.isCapturing = false
        this.lyriaMusicController.sendFrame(base64)
      },
      () => {
        this.isCapturing = false
        print("[CameraFrameCapture] WARN: texture encode failed, skipping frame")
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }
}
