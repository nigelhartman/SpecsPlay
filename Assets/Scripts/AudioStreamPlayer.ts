import { DynamicAudioOutput } from "RemoteServiceGateway.lspkg/Helpers/DynamicAudioOutput"

const SAMPLE_RATE = 48000
const CHANNELS = 2 // Lyria outputs stereo PCM

@component
export class AudioStreamPlayer extends BaseScriptComponent {
  @input dynamicAudioOutput: DynamicAudioOutput

  private isReady: boolean = false
  private hasLoggedUnreadyWarning: boolean = false

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

  public addFrame(pcmBytes: Uint8Array): void {
    if (!this.isReady) {
      if (!this.hasLoggedUnreadyWarning) {
        print("[AudioStreamPlayer] WARN: not ready yet, dropping frames until initialized")
        this.hasLoggedUnreadyWarning = true
      }
      return
    }
    this.dynamicAudioOutput.addAudioFrame(pcmBytes, CHANNELS)
  }

  public stop(): void {
    if (!this.isReady) return
    this.dynamicAudioOutput.interruptAudioOutput()
    print("[AudioStreamPlayer] Stopped")
  }
}
