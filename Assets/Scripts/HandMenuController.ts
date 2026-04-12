import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import { AudioStreamPlayer } from "./AudioStreamPlayer"
import { LyriaMusicController } from "./LyriaMusicController"

const FACING_ANGLE_THRESHOLD = 40 // degrees; palm faces camera when angle < this
const SIDE_OFFSET = 5 // cm; offset to the side of the hand for menu placement
const BUTTON_PROXIMITY_CM = 2.0 // cm; distance threshold for touch interaction

@component
export class HandMenuController extends BaseScriptComponent {
  @input audioStreamPlayer: AudioStreamPlayer
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

  private leftHand: TrackedHand | null = null
  private rightHand: TrackedHand | null = null

  private menuRoot: SceneObject | null = null
  private albumArtImage: Image | null = null
  private lastSongId: number = -1
  private timeText: Text | null = null
  private playPauseText: Text | null = null
  private playPauseIcon: Image | null = null
  private playPauseObj: SceneObject | null = null

  private wasNearButton: boolean = false

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
    // Create root container
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

    // 3. Play/Pause button — icon if materials provided, otherwise text
    this.playPauseObj = global.scene.createSceneObject("HandMenu_PlayPause")
    this.playPauseObj.setParent(this.menuRoot)
    this.playPauseObj.getTransform().setLocalPosition(new vec3(0, -1, 0))
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

    // Update transform
    this.updateTransform()

    // Update album art
    this.updateAlbumArt()

    // Update play/pause button
    this.updatePlayPauseLabel()

    // Check right-hand finger proximity to the play/pause button
    this.checkButtonInteraction()

  }

  private setVisible(visible: boolean): void {
    if (this.menuRoot) {
      this.menuRoot.enabled = visible
    }
  }

  private updateTransform(): void {
    if (!this.leftHand || !this.menuRoot) return

    const pinkyPos = this.leftHand.pinkyKnuckle.position
    const indexRight = this.leftHand.indexKnuckle.right
    const menuPos = pinkyPos.add(indexRight.uniformScale(SIDE_OFFSET))

    const menuRotation = this.leftHand.indexKnuckle.rotation

    this.menuRoot.getTransform().setWorldPosition(menuPos)
    this.menuRoot.getTransform().setWorldRotation(menuRotation)
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

  private updatePlayPauseLabel(): void {
    const isPaused = this.audioStreamPlayer.isPaused

    // Icon mode: swap material
    if (this.playPauseIcon) {
      const mat = isPaused ? this.playIconMaterial : this.pauseIconMaterial
      if (mat) this.playPauseIcon.mainMaterial = mat
      return
    }

    // Text mode fallback
    if (this.playPauseText) {
      this.playPauseText.text = isPaused ? "▶ Play" : "⏸ Pause"
    }
  }

  private checkButtonInteraction(): void {
    if (!this.rightHand || !this.playPauseObj) return

    const indexTipPos = this.rightHand.indexTip.position
    const buttonWorldPos = this.playPauseObj.getTransform().getWorldPosition()
    const dist = indexTipPos.distance(buttonWorldPos)

    const isNear = dist < BUTTON_PROXIMITY_CM

    if (isNear && !this.wasNearButton) {
      // Finger just entered the button zone — toggle play/pause
      if (this.audioStreamPlayer.isPaused) {
        this.audioStreamPlayer.resume()
      } else {
        this.audioStreamPlayer.pause()
      }
    }

    this.wasNearButton = isNear
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private formatTime(sec: number): string {
    const totalSec = Math.max(0, Math.floor(sec))
    const minutes = Math.floor(totalSec / 60)
    const seconds = totalSec % 60
    const mm = minutes < 10 ? "0" + minutes : "" + minutes
    const ss = seconds < 10 ? "0" + seconds : "" + seconds
    return mm + ":" + ss
  }
}
