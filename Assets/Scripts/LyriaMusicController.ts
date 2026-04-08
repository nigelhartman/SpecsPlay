import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
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

  @input kpopButton: RectangleButton
  @input rockButton: RectangleButton
  @input hiphopButton: RectangleButton

  @input statusText: Text

  // ── Private state ───────────────────────────────────────────────────────────

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private socket: WebSocket | null = null
  private isGenerating: boolean = false

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.backendUrl) {
        print("[LyriaMusicController] ERROR: backendUrl is not set in Inspector")
      }
      this.kpopButton?.onTriggerUp.add(() => this.generate("kpop"))
      this.rockButton?.onTriggerUp.add(() => this.generate("rock"))
      this.hiphopButton?.onTriggerUp.add(() => this.generate("hiphop"))
      this.connect()
    })
  }

  // ── WebSocket connection ────────────────────────────────────────────────────

  private connect(): void {
    if (!this.backendUrl) return

    this.setStatus("Connecting...")
    this.socket = this.internetModule.createWebSocket(this.backendUrl)

    this.socket.onopen = () => {
      print("[LyriaMusicController] Connected")
      this.setStatus("Ready — pick a style")
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
            else if (msg.state === "done") { this.isGenerating = false; this.setStatus("Playing") }
            else if (msg.state === "error") {
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

  // ── Song generation ─────────────────────────────────────────────────────────

  private generate(style: string): void {
    if (this.isGenerating) {
      print("[LyriaMusicController] Already generating, ignoring tap")
      return
    }
    if (!this.socket) {
      print("[LyriaMusicController] Not connected")
      return
    }

    const texture = this.cameraFeedController?.cameraTexture
    if (!texture) {
      print("[LyriaMusicController] No camera texture available")
      this.setStatus("No camera")
      return
    }

    this.isGenerating = true
    this.audioStreamPlayer.stop()
    this.setStatus("Capturing...")

    Base64.encodeTextureAsync(
      texture,
      (base64: string) => {
        this.setStatus("Generating " + style + "...")
        this.socket.send(JSON.stringify({ type: "generate", imageBase64: base64, style }))
      },
      () => {
        this.isGenerating = false
        this.setStatus("Capture failed")
        print("[LyriaMusicController] WARN: texture encode failed")
      },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Keep CameraFrameCapture compatible — always false in song-based mode */
  public isStreaming(): boolean {
    return false
  }

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.text = msg
  }
}
