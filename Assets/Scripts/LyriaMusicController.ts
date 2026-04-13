import { CameraFeedController } from "./CameraFeedController"

@component
export class LyriaMusicController extends BaseScriptComponent {
  // ── Inspector inputs ────────────────────────────────────────────────────────

  @input
  @hint("https://xxxx.ngrok-free.app  (update each ngrok session)")
  backendUrl: string = ""

  @input cameraFeedController: CameraFeedController

  @input
  @hint("AudioComponent on any SceneObject — used to play the generated MP3")
  audioComponent: AudioComponent

  @input
  @hint("RemoteMediaModule asset")
  remoteMediaModule: RemoteMediaModule

  // ── Public state ────────────────────────────────────────────────────────────

  public songId: number = 0
  public get generating(): boolean { return this.isGenerating }
  public get isConnected(): boolean { return this.connected }
  public albumArtTexture: Texture | null = null

  // ── Private state ───────────────────────────────────────────────────────────

  private internetModule: InternetModule = require("LensStudio:InternetModule")
  private isGenerating: boolean = false
  private connected: boolean = false
  private lastFrameBase64: string = ""
  private lastCacheTime: number = 0
  private isCaching: boolean = false

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.backendUrl) {
        print("[LyriaMusicController] ERROR: backendUrl is not set in Inspector")
        return
      }
      this.checkConnection()
      this.createEvent("UpdateEvent").bind(() => this.cacheFrame())
    })
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public generateForGenre(genre: string): void {
    if (this.isGenerating) {
      print("[LyriaMusicController] Already generating, ignoring")
      return
    }

    this.isGenerating = true
    if (this.audioComponent?.isPlaying()) this.audioComponent.stop(false)

    const imageBase64 = this.lastFrameBase64
    this.captureAlbumArt(imageBase64)

    this.postGenerate(genre, imageBase64)
  }

  // ── Connection check ────────────────────────────────────────────────────────

  private checkConnection(): Promise<boolean> {
    const req = new Request(this.backendUrl + "/health", { method: "GET" })
    return this.internetModule.fetch(req, {}).then((res) => {
      this.connected = res.status === 200
      print("[LyriaMusicController] Health: " + res.status + " → connected=" + this.connected)
      return this.connected
    }).catch(() => {
      this.connected = false
      print("[LyriaMusicController] Cannot reach backend")
      return false
    })
  }

  // ── HTTP generation ─────────────────────────────────────────────────────────

  private postGenerate(genre: string, imageBase64: string): void {
    this.songId++
    print("[LyriaMusicController] Generating " + genre + "...")

    const req = new Request(this.backendUrl + "/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ style: genre, imageBase64 }),
    })

    this.internetModule.fetch(req, {}).then((response) => {
      return response.json()
    }).then((json: { url?: string; error?: string }) => {
      if (!json.url) {
        print("[LyriaMusicController] Error from server: " + (json.error ?? "no url"))
        this.isGenerating = false
        return
      }
      this.loadAudio(json.url)
    }).catch((err) => {
      print("[LyriaMusicController] Fetch error: " + err)
      this.isGenerating = false
    })
  }

  private loadAudio(url: string): void {
    print("[LyriaMusicController] Loading audio from " + url)
    const resource = this.internetModule.makeResourceFromUrl(url)
    this.remoteMediaModule.loadResourceAsAudioTrackAsset(
      resource,
      (track: AudioTrackAsset) => {
        print("[LyriaMusicController] Audio loaded, playing")
        this.audioComponent.audioTrack = track
        this.audioComponent.play(1)
        this.isGenerating = false
        this.connected = true
      },
      (err: string) => {
        print("[LyriaMusicController] Audio load failed: " + err)
        this.isGenerating = false
      }
    )
  }

  // ── Album art ───────────────────────────────────────────────────────────────

  private captureAlbumArt(imageBase64: string): void {
    if (!imageBase64) return
    Base64.decodeTextureAsync(
      imageBase64,
      (tex: Texture) => { this.albumArtTexture = tex },
      () => { print("[LyriaMusicController] Failed to decode album art") }
    )
  }

  // ── Frame caching ───────────────────────────────────────────────────────────

  private cacheFrame(): void {
    if (this.isCaching) return
    const now = getTime()
    if (now - this.lastCacheTime < 3) return

    const texture = this.cameraFeedController?.cameraTexture
    if (!texture) return

    this.isCaching = true
    this.lastCacheTime = now
    Base64.encodeTextureAsync(
      texture,
      (base64: string) => { this.lastFrameBase64 = base64; this.isCaching = false },
      () => { this.isCaching = false },
      CompressionQuality.LowQuality,
      EncodingType.Jpg
    )
  }
}
