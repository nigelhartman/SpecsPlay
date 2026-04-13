import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import { LyriaMusicController } from "./LyriaMusicController"

const FACING_ANGLE_THRESHOLD = 40
const SIDE_OFFSET = 6.325
const DOWN_OFFSET = 0.5
const BUTTON_PROXIMITY_CM = 2.0

@component
export class HandMenuController extends BaseScriptComponent {
  @input lyriaMusicController: LyriaMusicController

  @input
  @hint("Unlit material for the album art — empty cover by default, swapped when a song is generated")
  albumArtMaterial: Material

  @input
  @hint("Optional icon material for the Play state")
  playIconMaterial: Material

  @input
  @hint("Optional icon material for the Pause state")
  pauseIconMaterial: Material

  @input
  @hint("Icon material for the Restart/Back button")
  restartIconMaterial: Material

  private leftHand: TrackedHand | null = null
  private rightHand: TrackedHand | null = null

  private menuRoot: SceneObject | null = null
  private albumArtImage: Image | null = null
  private lastSongId: number = -1
  private timeText: Text | null = null
  private playPauseIcon: Image | null = null
  private playPauseText: Text | null = null
  private playPauseObj: SceneObject | null = null
  private restartObj: SceneObject | null = null

  private wasNearPlayButton: boolean = false
  private wasNearRestartButton: boolean = false

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      const handInput = HandInputData.getInstance()
      this.leftHand = handInput.getHand("left")
      this.rightHand = handInput.getHand("right")

      this.buildMenu()

      this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    })
  }

  // ── Menu construction ───────────────────────────────────────────────────────

  private buildMenu(): void {
    this.menuRoot = global.scene.createSceneObject("HandMenu_Root")
    this.menuRoot.enabled = false

    // 1. Album art
    const albumArtObj = global.scene.createSceneObject("HandMenu_AlbumArt")
    albumArtObj.setParent(this.menuRoot)
    albumArtObj.getTransform().setLocalPosition(new vec3(0, 4, 0))
    albumArtObj.getTransform().setLocalScale(new vec3(5, 5, 1))
    this.albumArtImage = albumArtObj.createComponent("Component.Image") as Image
    if (this.albumArtMaterial) {
      this.albumArtImage.mainMaterial = this.albumArtMaterial
    }

    // 2. Time text
    const timeObj = global.scene.createSceneObject("HandMenu_Time")
    timeObj.setParent(this.menuRoot)
    timeObj.getTransform().setLocalPosition(new vec3(0, 0.2, 0))
    timeObj.getTransform().setLocalScale(new vec3(1.2, 1.2, 1.2))
    this.timeText = timeObj.createComponent("Component.Text") as Text
    this.timeText.text = "00:00 / 00:00"
    this.timeText.horizontalAlignment = HorizontalAlignment.Center
    this.timeText.verticalAlignment = VerticalAlignment.Center

    // 3. Restart button (left of play/pause)
    this.restartObj = global.scene.createSceneObject("HandMenu_Restart")
    this.restartObj.setParent(this.menuRoot)
    this.restartObj.getTransform().setLocalPosition(new vec3(-2.5, -2.0, 0))
    this.restartObj.getTransform().setLocalScale(new vec3(2, 2, 2))
    if (this.restartIconMaterial) {
      const restartIcon = this.restartObj.createComponent("Component.Image") as Image
      restartIcon.mainMaterial = this.restartIconMaterial
    } else {
      const restartText = this.restartObj.createComponent("Component.Text") as Text
      restartText.text = "⏮"
      restartText.horizontalAlignment = HorizontalAlignment.Center
      restartText.verticalAlignment = VerticalAlignment.Center
    }

    // 4. Play/Pause button
    this.playPauseObj = global.scene.createSceneObject("HandMenu_PlayPause")
    this.playPauseObj.setParent(this.menuRoot)
    this.playPauseObj.getTransform().setLocalPosition(new vec3(0, -2.0, 0))
    this.playPauseObj.getTransform().setLocalScale(new vec3(2, 2, 2))

    if (this.playIconMaterial || this.pauseIconMaterial) {
      this.playPauseIcon = this.playPauseObj.createComponent("Component.Image") as Image
      this.playPauseIcon.mainMaterial = this.playIconMaterial ?? this.pauseIconMaterial
    } else {
      this.playPauseText = this.playPauseObj.createComponent("Component.Text") as Text
      this.playPauseText.text = "▶ Play"
      this.playPauseText.horizontalAlignment = HorizontalAlignment.Center
      this.playPauseText.verticalAlignment = VerticalAlignment.Center
    }
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  private onUpdate(): void {
    if (!this.leftHand || !this.menuRoot) return

    const isTracked = this.leftHand.isTracked()
    const facingAngle = this.leftHand.getFacingCameraAngle()
    const isFacing = isTracked && facingAngle !== null && facingAngle < FACING_ANGLE_THRESHOLD

    this.setVisible(isFacing)
    if (!isFacing) return

    this.updateTransform()
    this.updateAlbumArt()
    this.updateTimeDisplay()
    this.updatePlayPauseLabel()
    this.checkButtonInteraction()
  }

  private setVisible(visible: boolean): void {
    if (this.menuRoot) this.menuRoot.enabled = visible
  }

  private updateTransform(): void {
    if (!this.leftHand || !this.menuRoot) return
    const pinkyPos = this.leftHand.pinkyKnuckle.position
    const indexRight = this.leftHand.indexKnuckle.right
    const worldDown = new vec3(0, -1, 0)
    const menuPos = pinkyPos.add(indexRight.uniformScale(SIDE_OFFSET)).add(worldDown.uniformScale(DOWN_OFFSET))
    this.menuRoot.getTransform().setWorldPosition(menuPos)
    this.menuRoot.getTransform().setWorldRotation(this.leftHand.indexKnuckle.rotation)
  }

  private updateAlbumArt(): void {
    const songId = this.lyriaMusicController.songId
    if (songId === this.lastSongId) return
    this.lastSongId = songId
    const tex = this.lyriaMusicController.albumArtTexture
    if (tex && this.albumArtImage?.mainMaterial?.mainPass) {
      this.albumArtImage.mainMaterial.mainPass.baseTex = tex
    }
  }

  private updateTimeDisplay(): void {
    if (!this.timeText) return
    const audio = this.lyriaMusicController.audioComponent
    if (!audio?.audioTrack) return
    const pos = audio.position
    const dur = audio.duration
    this.timeText.text = this.formatTime(pos) + " / " + this.formatTime(dur)
  }

  private updatePlayPauseLabel(): void {
    const audio = this.lyriaMusicController.audioComponent
    if (!audio?.audioTrack) return
    const isPlaying = audio.isPlaying()

    if (this.playPauseIcon) {
      const mat = isPlaying ? this.pauseIconMaterial : this.playIconMaterial
      if (mat) this.playPauseIcon.mainMaterial = mat
      return
    }
    if (this.playPauseText) {
      this.playPauseText.text = isPlaying ? "⏸ Pause" : "▶ Play"
    }
  }

  private checkButtonInteraction(): void {
    if (!this.rightHand) return
    const audio = this.lyriaMusicController.audioComponent
    if (!audio?.audioTrack) return

    const indexTipPos = this.rightHand.indexTip.position

    // Play/pause
    if (this.playPauseObj) {
      const isNear = indexTipPos.distance(this.playPauseObj.getTransform().getWorldPosition()) < BUTTON_PROXIMITY_CM
      if (isNear && !this.wasNearPlayButton) {
        if (audio.isPlaying()) {
          audio.pause()
        } else {
          audio.resume()
        }
      }
      this.wasNearPlayButton = isNear
    }

    // Restart
    if (this.restartObj) {
      const isNear = indexTipPos.distance(this.restartObj.getTransform().getWorldPosition()) < BUTTON_PROXIMITY_CM
      if (isNear && !this.wasNearRestartButton) {
        audio.stop(false)
        audio.play(1)
        audio.pause()
        print("[HandMenu] Track restarted")
      }
      this.wasNearRestartButton = isNear
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private formatTime(sec: number): string {
    const totalSec = Math.max(0, Math.floor(sec))
    const mm = Math.floor(totalSec / 60)
    const ss = totalSec % 60
    return (mm < 10 ? "0" + mm : "" + mm) + ":" + (ss < 10 ? "0" + ss : "" + ss)
  }
}
