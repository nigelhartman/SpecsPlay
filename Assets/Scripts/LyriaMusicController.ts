import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import { TextInputField } from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import { AudioStreamPlayer } from "./AudioStreamPlayer"

@component
export class LyriaMusicController extends BaseScriptComponent {
  // ── Inspector inputs ────────────────────────────────────────────────────────

  @input
  @hint("wss://xxxx.ngrok-free.app  (update each ngrok session)")
  backendUrl: string = ""

  @input audioStreamPlayer: AudioStreamPlayer
  @input startStopButton: RectangleButton
  @input styleInput: TextInputField

  /** Optional Text component to show connection status */
  @input statusText: Text

  // ── Private state ───────────────────────────────────────────────────────────

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private socket: WebSocket | null = null
  private streaming: boolean = false

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.backendUrl) {
        print("[LyriaMusicController] ERROR: backendUrl is not set in Inspector")
      }
      if (!this.audioStreamPlayer) {
        print("[LyriaMusicController] ERROR: audioStreamPlayer input not set")
      }
      if (!this.startStopButton) {
        print("[LyriaMusicController] ERROR: startStopButton input not set")
        return
      }
      this.startStopButton.onTriggerUp.add(() => this.toggleStream())
      this.setStatus("Ready")
      print("[LyriaMusicController] Initialized")
    })
  }

  // ── Public API (used by CameraFrameCapture) ─────────────────────────────────

  public isStreaming(): boolean {
    return this.streaming
  }

  public sendFrame(base64: string): void {
    if (!this.socket || !this.streaming) return
    this.socket.send(JSON.stringify({ type: "frame", data: base64 }))
  }

  // ── Stream control ──────────────────────────────────────────────────────────

  private toggleStream(): void {
    if (this.streaming) {
      this.stopStream()
    } else {
      this.startStream()
    }
  }

  private startStream(): void {
    if (!this.backendUrl) {
      print("[LyriaMusicController] Cannot start: backendUrl not set")
      this.setStatus("Error: no backend URL")
      return
    }

    this.setStatus("Connecting...")
    print("[LyriaMusicController] Connecting to " + this.backendUrl)

    this.socket = this.internetModule.createWebSocket(this.backendUrl)

    this.socket.onopen = () => {
      this.streaming = true
      print("[LyriaMusicController] Connected")
      this.setStatus("Streaming")

      const stylePrompt = this.styleInput ? this.styleInput.text : ""
      this.socket.send(JSON.stringify({ type: "start", stylePrompt }))
    }

    this.socket.onmessage = (event: WebSocketMessageEvent) => {
      if (event.data instanceof Blob) {
        // Binary frame = raw PCM from Lyria
        event.data.bytes().then((bytes: Uint8Array) => {
          this.audioStreamPlayer.addFrame(bytes)
        })
      } else {
        // JSON control message from backend
        try {
          const msg = JSON.parse(event.data as string)
          if (msg.type === "status") {
            print("[LyriaMusicController] Backend status: " + msg.state)
            if (msg.state === "error") this.setStatus("Error: " + (msg.message ?? "unknown"))
          }
        } catch (_) {
          // ignore unparseable messages
        }
      }
    }

    this.socket.onclose = () => {
      if (this.streaming) {
        print("[LyriaMusicController] Connection closed unexpectedly")
        this.setStatus("Disconnected")
      }
      this.streaming = false
      this.audioStreamPlayer.stop()
    }

    this.socket.onerror = (event: WebSocketEvent) => {
      print("[LyriaMusicController] WebSocket error: " + JSON.stringify(event))
      this.setStatus("Connection error")
      this.streaming = false
      this.audioStreamPlayer.stop()
    }
  }

  private stopStream(): void {
    if (!this.socket) return
    this.streaming = false
    try {
      this.socket.send(JSON.stringify({ type: "stop" }))
    } catch (_) {}
    this.socket.close()
    this.socket = null
    this.audioStreamPlayer.stop()
    this.setStatus("Stopped")
    print("[LyriaMusicController] Stream stopped")
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.text = msg
  }
}
