/**
 * RadialMenuController
 *
 * Shows a radial genre menu when the user pinches their right hand.
 * - Pinch down  → menu appears at pinch origin, 30 cm in front of camera
 * - Hold & move → nearest item within activation radius highlights
 * - Pinch up    → if far enough from origin, selected genre triggers generation
 *                 if near origin (dead zone) → menu closes, nothing happens
 */

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import { LyriaMusicController } from "./LyriaMusicController"

// ── Config ───────────────────────────────────────────────────────────────────

const GENRES = ["K-Pop", "Rock", "Hip-Hop", "Jazz", "Classical", "Electronic"]
const GENRE_KEYS = ["kpop", "rock", "hiphop", "jazz", "classical", "electronic"]

/** Radius of the radial ring in cm */
const RING_RADIUS = 6

/** How close (cm) a finger must be to an item to highlight it */
const HOVER_DIST = 3.5

/** Dead-zone radius (cm) — releasing within this from origin does nothing */
const DEAD_ZONE = 2.5

/** Scale of each label SceneObject (cm) */
const ITEM_SCALE = 1.5

@component
export class RadialMenuController extends BaseScriptComponent {
  @input lyriaMusicController: LyriaMusicController
  @input statusText: Text

  private rightHand: TrackedHand
  private camera = WorldCameraFinderProvider.getInstance()

  private menuRoot: SceneObject | null = null
  private itemObjects: SceneObject[] = []
  private itemTexts: Text[] = []

  private pinchOrigin: vec3 = new vec3(0, 0, 0)
  private hoveredIndex: number = -1
  private isMenuOpen: boolean = false

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      const handData = HandInputData.getInstance()
      this.rightHand = handData.getHand("right")

      this.rightHand.onPinchDown.add(() => this.openMenu())
      this.rightHand.onPinchUp.add(() => this.closeMenu())
      this.rightHand.onPinchCancel.add(() => this.dismissMenu())

      this.createEvent("UpdateEvent").bind(() => this.onUpdate())

      print("[RadialMenu] Ready")
    })
  }

  // ── Menu open / close ──────────────────────────────────────────────────────

  private openMenu(): void {
    if (this.isMenuOpen) return
    this.isMenuOpen = true

    this.pinchOrigin = this.rightHand.indexTip.position

    this.buildMenu()
    print("[RadialMenu] Opened")
  }

  private closeMenu(): void {
    if (!this.isMenuOpen) return
    this.isMenuOpen = false

    const tipPos = this.rightHand.indexTip.position
    const dist = tipPos.distance(this.pinchOrigin)

    if (dist > DEAD_ZONE && this.hoveredIndex >= 0) {
      const genre = GENRE_KEYS[this.hoveredIndex]
      print("[RadialMenu] Selected: " + GENRES[this.hoveredIndex])
      this.lyriaMusicController.generateForGenre(genre)
    } else {
      print("[RadialMenu] Released in dead zone — dismissed")
    }

    this.destroyMenu()
  }

  private dismissMenu(): void {
    if (!this.isMenuOpen) return
    this.isMenuOpen = false
    this.destroyMenu()
    print("[RadialMenu] Dismissed (pinch cancelled)")
  }

  // ── Update loop ────────────────────────────────────────────────────────────

  private onUpdate(): void {
    if (!this.isMenuOpen || !this.menuRoot) return

    const tipPos = this.rightHand.indexTip.position
    let newHover = -1
    let bestDist = HOVER_DIST

    for (let i = 0; i < this.itemObjects.length; i++) {
      const itemPos = this.itemObjects[i].getTransform().getWorldPosition()
      const d = tipPos.distance(itemPos)
      if (d < bestDist) {
        bestDist = d
        newHover = i
      }
    }

    if (newHover !== this.hoveredIndex) {
      this.hoveredIndex = newHover
      this.updateHighlights()
    }
  }

  // ── Build / destroy menu ───────────────────────────────────────────────────

  private buildMenu(): void {
    this.menuRoot = global.scene.createSceneObject("RadialMenuRoot")
    this.menuRoot.getTransform().setWorldPosition(this.pinchOrigin)
    this.orientToCamera()
    this.itemObjects = []
    this.itemTexts = []
    this.hoveredIndex = -1

    const count = GENRES.length
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const localX = Math.cos(angle) * RING_RADIUS
      const localY = Math.sin(angle) * RING_RADIUS

      const item = global.scene.createSceneObject("Genre_" + GENRES[i])
      item.setParent(this.menuRoot)

      const localPos = new vec3(localX, localY, 0)
      item.getTransform().setLocalPosition(localPos)
      item.getTransform().setLocalScale(new vec3(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE))

      const textComp = item.createComponent("Component.Text") as Text
      textComp.text = GENRES[i]
      textComp.horizontalAlignment = HorizontalAlignment.Center
      textComp.verticalAlignment = VerticalAlignment.Center

      this.itemObjects.push(item)
      this.itemTexts.push(textComp)
    }

    this.updateHighlights()
  }

  private orientToCamera(): void {
    if (!this.menuRoot) return
    const camPos = this.camera.getWorldPosition()
    const menuPos = this.menuRoot.getTransform().getWorldPosition()
    const f = camPos.sub(menuPos).normalize() // local +Z toward camera

    const worldUp = new vec3(0, 1, 0)
    const r = worldUp.cross(f).normalize()    // local +X (right)
    const u = f.cross(r).normalize()          // local +Y (up)

    // Rotation matrix (columns = r, u, f) → quaternion
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

    this.menuRoot.getTransform().setWorldRotation(new quat(qw, qx, qy, qz))
  }

  private destroyMenu(): void {
    if (this.menuRoot) {
      this.menuRoot.destroy()
      this.menuRoot = null
    }
    this.itemObjects = []
    this.itemTexts = []
    this.hoveredIndex = -1
  }

  private updateHighlights(): void {
    for (let i = 0; i < this.itemTexts.length; i++) {
      if (i === this.hoveredIndex) {
        this.itemTexts[i].textFill.color = new vec4(0.2, 1.0, 0.4, 1.0) // bright green
      } else {
        this.itemTexts[i].textFill.color = new vec4(1.0, 1.0, 1.0, 0.85)
      }
    }
  }
}
