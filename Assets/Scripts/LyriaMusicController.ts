import { AudioStreamPlayer } from "./AudioStreamPlayer"
import { CameraFeedController } from "./CameraFeedController"

@component
export class LyriaMusicController extends BaseScriptComponent {
  // ── Inspector inputs ────────────────────────────────────────────────────────

  @input
  @hint("wss://xxxx.ngrok-free.app  (update each ngrok session)")
  backendUrl: string = ""

  @input audioStreamPlayer: AudioStreamPlayer
  @input cameraFeedController: CameraFeedController
  @input statusText: Text

  // ── Private state ───────────────────────────────────────────────────────────

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private socket: WebSocket | null = null
  private isGenerating: boolean = false
  private lastFrameBase64: string = ""

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.backendUrl) {
        print("[LyriaMusicController] ERROR: backendUrl is not set in Inspector")
      }
      // Continuously cache latest camera frame so menu selection is instant
      this.createEvent("UpdateEvent").bind(() => this.cacheFrame())
      this.connect()
    })
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Called by RadialMenuController when the user selects a genre */
  public generateForGenre(genre: string): void {
    if (this.isGenerating) {
      print("[LyriaMusicController] Already generating, ignoring")
      return
    }
    if (!this.socket) {
      print("[LyriaMusicController] Not connected")
      return
    }

    this.isGenerating = true
    this.audioStreamPlayer.stop()

    if (this.lastFrameBase64) {
      this.sendGenerate(genre, this.lastFrameBase64)
    } else {
      // Fallback: capture fresh frame
      this.captureAndGenerate(genre)
    }
  }

  /** Keep CameraFrameCapture compatible */
  public isStreaming(): boolean { return false }
  public sendFrame(_base64: string): void {}

  // ── WebSocket connection ────────────────────────────────────────────────────

  private connect(): void {
    if (!this.backendUrl) return

    this.setStatus("Connecting...")
    this.socket = this.internetModule.createWebSocket(this.backendUrl)

    this.socket.onopen = () => {
      print("[LyriaMusicController] Connected")
      this.setStatus("Pinch to pick genre")
    }

    this.socket.onmessage = (event: WebSocketMessageEvent) => {
      if (event.data instanceof Blob) {
        event.data.bytes().then((bytes: Uint8Array) => {
          this.audioStreamPlayer.addFrame(bytes)
        })
      } else {
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === "status") {
            if (msg.state === "generating") this.setStatus("Generating...")
            else if (msg.state === "done") {
              this.isGenerating = false
              this.setStatus("Playing — pinch to change")
            } else if (msg.state === "error") {
              this.isGenerating = false
              this.setStatus("Error")
              print("[LyriaMusicController] Error: " + (msg.message ?? "unknown"))
            }
          }
        } catch (_) {}
      }
    }

    this.socket.onclose = () => {
      print("[LyriaMusicController] Disconnected")
      this.isGenerating = false
      this.setStatus("Disconnected")
    }

    this.socket.onerror = (_event: WebSocketEvent) => {
      print("[LyriaMusicController] WebSocket error")
      this.isGenerating = false
      this.setStatus("Connection error")
    }
  }

  // ── Frame caching ───────────────────────────────────────────────────────────

  private cacheFrame(): void {
    const texture = this.cameraFeedController?.cameraTexture
    if (!texture) return

    Base64.encodeTextureAsync(
      texture,
      (base64: string) => { this.lastFrameBase64 = base64 },
      () => {},
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  private captureAndGenerate(genre: string): void {
    const texture = this.cameraFeedController?.cameraTexture
    if (!texture) {
      this.isGenerating = false
      this.setStatus("No camera")
      return
    }

    this.setStatus("Capturing...")
    Base64.encodeTextureAsync(
      texture,
      (base64: string) => this.sendGenerate(genre, base64),
      () => {
        this.isGenerating = false
        this.setStatus("Capture failed")
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  private sendGenerate(genre: string, imageBase64: string): void {
    this.setStatus("Generating " + genre + "...")
    this.socket.send(JSON.stringify({ type: "generate", imageBase64, style: genre }))
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.text = msg
  }
}
