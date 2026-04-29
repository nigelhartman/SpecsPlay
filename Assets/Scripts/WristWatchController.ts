/**
 * WristWatchController
 *
 * Shows a small "⚙" button on the DORSAL (back) side of the left wrist — like
 * a watch face — when the user rotates their wrist outward to look at it.
 * Tapping the button with the right index finger toggles the SettingsUIController.
 *
 * Visibility: shown when getFacingCameraAngle() > DORSAL_ANGLE_THRESHOLD (back
 * of hand facing camera), hidden when palm faces camera (existing hand menu state).
 */

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import { SettingsUIController } from "./SettingsUIController"

const DORSAL_ANGLE_THRESHOLD = 130  // degrees — back-of-hand toward camera
const BUTTON_PROXIMITY_CM    = 2.5
const BUTTON_HOVER_RANGE_CM  = 6.5
const BUTTON_SCALE           = 3.0
const HOVER_SMOOTHING        = 0.12

@component
export class WristWatchController extends BaseScriptComponent {
  @input settingsUIController: SettingsUIController

  @input
  @hint("Optional material icon for the wrist settings button")
  settingsIconMaterial?: Material

  private leftHand: TrackedHand | null = null
  private rightHand: TrackedHand | null = null

  private buttonRoot: SceneObject | null = null
  private iconImage: Image | null = null
  private iconText: Text | null = null
  private iconMaterial: Material | null = null
  private hoverAmount: number = 0
  private wasNearButton: boolean = false

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      const handInput = HandInputData.getInstance()
      this.leftHand = handInput.getHand("left")
      this.rightHand = handInput.getHand("right")
      this.buildButton()
      this.createEvent("UpdateEvent").bind(() => this.onUpdate())
      print("[WristWatch] Ready")
    })
  }

  // ── Button construction ───────────────────────────────────────────────────

  private buildButton(): void {
    this.buttonRoot = global.scene.createSceneObject("WristWatch_Root")
    this.buttonRoot.enabled = false

    const iconObj = global.scene.createSceneObject("WristWatch_Icon")
    iconObj.setParent(this.buttonRoot)
    iconObj.getTransform().setLocalScale(new vec3(BUTTON_SCALE, BUTTON_SCALE, 1))

    if (this.settingsIconMaterial) {
      this.iconImage = iconObj.createComponent("Component.Image") as Image
      this.iconMaterial = this.settingsIconMaterial.clone()
      this.iconImage.mainMaterial = this.iconMaterial
      this.updateIconColor(0)
      return
    }

    this.iconText = iconObj.createComponent("Component.Text") as Text
    this.iconText.text = "⚙"
    this.iconText.horizontalAlignment = HorizontalAlignment.Center
    this.iconText.verticalAlignment = VerticalAlignment.Center
    this.updateIconColor(0)
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  private onUpdate(): void {
    if (!this.leftHand || !this.buttonRoot) return

    const isTracked = this.leftHand.isTracked()
    const facingAngle = this.leftHand.getFacingCameraAngle()
    const isDorsal = isTracked && facingAngle !== null && facingAngle > DORSAL_ANGLE_THRESHOLD

    this.buttonRoot.enabled = isDorsal

    if (isDorsal) {
      this.updateButtonTransform()
    }

    // Always track proximity so wasNearButton stays accurate even when isDorsal
    // flickers off for a frame. Without this, resetting wasNearButton on every
    // isDorsal=false frame causes a double-toggle (open then immediately close).
    this.checkTap(isDorsal)
  }

  // ── Transform ─────────────────────────────────────────────────────────────

  private updateButtonTransform(): void {
    const wristPos         = this.leftHand!.wrist.position
    const indexMidPos      = this.leftHand!.indexMidJoint.position
    const middleMidPos     = this.leftHand!.middleMidJoint.position
    const middleKnucklePos = this.leftHand!.middleKnuckle.position

    // handRight × handFwd = dorsal (back-of-hand) normal for the left hand.
    // No negation: verified that handRight.cross(handFwd) points toward dorsal
    // (away from palm) because the left-hand cross product matches the dorsal side.
    const handRight    = indexMidPos.sub(middleMidPos).normalize()
    const handFwd      = middleKnucklePos.sub(wristPos).normalize()
    const dorsalNormal = handRight.cross(handFwd).normalize()

    // Place button 3.0 cm proud of the dorsal side of the wrist
    const pos = wristPos.add(dorsalNormal.uniformScale(3.0))
    this.buttonRoot!.getTransform().setWorldPosition(pos)

    // Rotation: same worldUp-based approach as RadialMenuController.orientToCamera.
    // f = dorsalNormal (points toward viewer in the watch-checking pose).
    const f       = dorsalNormal
    const worldUp = new vec3(0, 1, 0)
    const rRef    = Math.abs(f.y) > 0.99 ? new vec3(1, 0, 0) : worldUp
    const r       = rRef.cross(f).normalize()
    const u       = f.cross(r).normalize()
    this.buttonRoot!.getTransform().setWorldRotation(this.buildQuat(r, u, f))
  }

  // ── Tap detection ─────────────────────────────────────────────────────────

  private checkTap(isDorsal: boolean): void {
    if (!this.rightHand) {
      this.updateHover(false, BUTTON_HOVER_RANGE_CM)
      return
    }
    const tipPos = this.rightHand.indexTip.position
    const btnPos = this.buttonRoot!.getTransform().getWorldPosition()
    const distance = tipPos.distance(btnPos)
    const isNear = distance < BUTTON_PROXIMITY_CM
    this.updateHover(isDorsal, distance)

    // Only fire when button is visible — but always update wasNearButton so
    // stale "near" state from a hidden frame doesn't trigger on the next show.
    if (isDorsal && isNear && !this.wasNearButton) {
      if (this.settingsUIController) {
        if (this.toggleSettingsUi()) {
          print("[WristWatch] Tapped — toggled settings UI")
        }
      }
    }
    this.wasNearButton = isNear
  }

  private updateHover(isDorsal: boolean, distanceCm: number): void {
    let target = 0
    if (isDorsal) {
      target = 1 - Math.min(Math.max(distanceCm / BUTTON_HOVER_RANGE_CM, 0), 1)
    }
    this.hoverAmount += (target - this.hoverAmount) * HOVER_SMOOTHING
    this.updateIconColor(this.hoverAmount)
  }

  private updateIconColor(amount: number): void {
    const t = Math.min(Math.max(amount, 0), 1)
    const color = new vec4(1, 1, 1 - t, 1)

    if (this.iconMaterial && this.iconMaterial.mainPass) {
      this.iconMaterial.mainPass.baseColor = color
    }
    if (this.iconText) {
      this.iconText.textFill.color = color
    }
  }

  private toggleSettingsUi(): boolean {
    const ui = this.settingsUIController as any
    if (!ui) return false

    if (typeof ui.toggle === "function") {
      ui.toggle()
      return true
    }

    if (ui.api && typeof ui.api.toggle === "function") {
      ui.api.toggle()
      return true
    }

    const resolved = this.resolveSettingsController(ui)
    if (resolved && typeof resolved.toggle === "function") {
      resolved.toggle()
      return true
    }

    const g = global as any
    if (typeof g.settingsUiToggle === "function") {
      g.settingsUiToggle()
      return true
    }

    print("[WristWatch] SettingsUIController toggle() not available")
    return false
  }

  private resolveSettingsController(input: any): any {
    if (!input) return null

    if (typeof input.getSceneObject === "function") {
      const so = input.getSceneObject() as SceneObject
      if (so) {
        const byType = so.getComponent(SettingsUIController.getTypeName()) as any
        if (byType) return byType

        const generic = so.getComponent("ScriptComponent") as any
        if (generic && typeof generic.toggle === "function") return generic
      }
    }

    if (input.scriptComponent && typeof input.scriptComponent.toggle === "function") {
      return input.scriptComponent
    }
    if (input.component && typeof input.component.toggle === "function") {
      return input.component
    }
    if (input.script && typeof input.script.toggle === "function") {
      return input.script
    }

    return null
  }

  // ── Quaternion from basis vectors ─────────────────────────────────────────

  private buildQuat(r: vec3, u: vec3, f: vec3): quat {
    // Shepperd's method: rotation matrix columns are r(X), u(Y), f(Z)
    const trace = r.x + u.y + f.z
    let qw: number, qx: number, qy: number, qz: number
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1)
      qw = 0.25 / s; qx = (u.z - f.y) * s; qy = (f.x - r.z) * s; qz = (r.y - u.x) * s
    } else if (r.x > u.y && r.x > f.z) {
      const s = 2 * Math.sqrt(1 + r.x - u.y - f.z)
      qw = (u.z - f.y) / s; qx = 0.25 * s; qy = (u.x + r.y) / s; qz = (f.x + r.z) / s
    } else if (u.y > f.z) {
      const s = 2 * Math.sqrt(1 + u.y - r.x - f.z)
      qw = (f.x - r.z) / s; qx = (u.x + r.y) / s; qy = 0.25 * s; qz = (f.y + u.z) / s
    } else {
      const s = 2 * Math.sqrt(1 + f.z - r.x - u.y)
      qw = (r.y - u.x) / s; qx = (f.x + r.z) / s; qy = (f.y + u.z) / s; qz = 0.25 * s
    }
    return new quat(qw, qx, qy, qz)
  }
}
