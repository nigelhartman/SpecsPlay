import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"

const SAMPLE_RATE = 48000
const CHANNELS = 2 // Lyria outputs stereo PCM
// bytes per second: 48000 samples/sec * 2 channels * 2 bytes/sample (int16)
const BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * 2

@component
export class AudioStreamPlayer extends BaseScriptComponent {
  @input dynamicAudioOutput: DynamicAudioOutput

  private isReady: boolean = false
  private hasLoggedUnreadyWarning: boolean = false

  private pcmFrames: Uint8Array[] = []
  private playStartTime: number = 0
  private savedPausedAtSec: number = 0
  public isPaused: boolean = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      if (!this.dynamicAudioOutput) {
        print("[AudioStreamPlayer] ERROR: dynamicAudioOutput input not set")
        return
      }
      this.dynamicAudioOutput.initialize(SAMPLE_RATE)
      this.isReady = true
      print("[AudioStreamPlayer] Ready at " + SAMPLE_RATE + "Hz stereo")
    })
  }

  public get totalDurationSec(): number {
    let totalBytes = 0
    for (let i = 0; i < this.pcmFrames.length; i++) {
      totalBytes += this.pcmFrames[i].byteLength
    }
    return totalBytes / BYTES_PER_SEC
  }

  public currentTimeSec(): number {
    if (this.isPaused) {
      return this.savedPausedAtSec
    }
    const elapsed = getTime() - this.playStartTime
    const total = this.totalDurationSec
    return total > 0 ? Math.min(elapsed, total) : elapsed
  }

  public addFrame(pcmBytes: Uint8Array): void {
    if (!this.isReady) {
      if (!this.hasLoggedUnreadyWarning) {
        print("[AudioStreamPlayer] WARN: not ready yet, dropping frames until initialized")
        this.hasLoggedUnreadyWarning = true
      }
      return
    }

    // Set play start time on first frame
    if (this.pcmFrames.length === 0) {
      this.playStartTime = getTime()
    }

    this.pcmFrames.push(pcmBytes)
    this.dynamicAudioOutput.addAudioFrame(pcmBytes, CHANNELS)
  }

  public pause(): void {
    if (!this.isReady || this.isPaused) return
    this.savedPausedAtSec = this.currentTimeSec()
    this.isPaused = true
    this.dynamicAudioOutput.interruptAudioOutput()
    print("[AudioStreamPlayer] Paused at " + this.savedPausedAtSec.toFixed(2) + "s")
  }

  public resume(): void {
    if (!this.isReady || !this.isPaused) return

    const byteOffset = this.savedPausedAtSec * BYTES_PER_SEC
    let accumulated = 0
    let queued = 0

    for (let i = 0; i < this.pcmFrames.length; i++) {
      const frame = this.pcmFrames[i]
      const frameEnd = accumulated + frame.byteLength

      if (frameEnd <= byteOffset) {
        // This frame is entirely before the resume point; skip it
        accumulated = frameEnd
        continue
      }

      if (accumulated < byteOffset) {
        // This frame straddles the resume point; slice off the already-played portion
        const sliceStart = Math.floor(byteOffset - accumulated)
        const partial = frame.slice(sliceStart)
        this.dynamicAudioOutput.addAudioFrame(partial, CHANNELS)
      } else {
        // This frame is entirely after the resume point; queue as-is
        this.dynamicAudioOutput.addAudioFrame(frame, CHANNELS)
      }

      accumulated = frameEnd
      queued++
    }

    this.playStartTime = getTime() - this.savedPausedAtSec
    this.isPaused = false
    print("[AudioStreamPlayer] Resumed from " + this.savedPausedAtSec.toFixed(2) + "s, re-queued " + queued + " frame(s)")
  }

  public stop(): void {
    if (!this.isReady) return
    this.dynamicAudioOutput.interruptAudioOutput()
    this.pcmFrames = []
    this.playStartTime = 0
    this.savedPausedAtSec = 0
    this.isPaused = false
    print("[AudioStreamPlayer] Stopped")
  }
}
