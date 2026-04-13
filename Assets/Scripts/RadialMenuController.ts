/**
 * RadialMenuController
 *
 * Shows a radial genre menu when the user pinches their right hand.
 * - No connection → pinch shows ✕ error state (no genre ring)
 * - Pinch down    → menu appears at exact pinch position, facing camera
 * - Hold & move   → nearest item within activation radius highlights
 * - Pinch up      → if far enough from origin, selected genre triggers generation
 *                   if near origin (dead zone) → menu closes, nothing happens
 * - Generating    → menu stays open, center shows ⏳, ring hidden
 * - Done          → menu closes automatically; next pinch opens fresh
 */

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData"
import TrackedHand from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/TrackedHand"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import { LyriaMusicController } from "./LyriaMusicController"

// ── Config ───────────────────────────────────────────────────────────────────

const GENRES = ["K-Pop", "Rock", "Hip-Hop", "Jazz", "Classical", "Electronic"]
const GENRE_KEYS = ["kpop", "rock", "hiphop", "jazz", "classical", "electronic"]

const RING_RADIUS = 9.36
const HOVER_DIST = 3.5
const DEAD_ZONE = 2.5
const ITEM_SCALE = 1.5

@component
export class RadialMenuController extends BaseScriptComponent {
  @input lyriaMusicController: LyriaMusicController

  @input
  @hint("Drag in a Sphere prefab for the center dot indicator")
  centerSpherePrefab: ObjectPrefab

  private rightHand: TrackedHand
  private camera = WorldCameraFinderProvider.getInstance()

  private menuRoot: SceneObject | null = null
  private itemObjects: SceneObject[] = []
  private itemTexts: Text[] = []
  private itemUnderlines: Text[] = []
  private sphereMaterial: Material | null = null
  private centerLabel: Text | null = null   // ⏳ / idle label in center
  private ringRoot: SceneObject | null = null // parent of genre items — hidden during generation

  private pinchOrigin: vec3 = new vec3(0, 0, 0)
  private hoveredIndex: number = -1
  private isMenuOpen: boolean = false
  private isGenerating: boolean = false

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

    // No backend connection → show error indicator
    if (!this.lyriaMusicController.isConnected) {
      this.isMenuOpen = true
      this.pinchOrigin = this.rightHand.indexTip.position
      this.buildErrorMenu()
      print("[RadialMenu] No connection")
      return
    }

    this.isMenuOpen = true
    this.pinchOrigin = this.rightHand.indexTip.position
    this.buildMenu()
    print("[RadialMenu] Opened")
  }

  private closeMenu(): void {
    if (!this.isMenuOpen) return

    // During generation the menu stays open; swallow pinch-up until done
    if (this.isGenerating) return

    this.isMenuOpen = false

    const tipPos = this.rightHand.indexTip.position
    const dist = tipPos.distance(this.pinchOrigin)

    if (dist > DEAD_ZONE && this.hoveredIndex >= 0) {
      const genre = GENRE_KEYS[this.hoveredIndex]
      print("[RadialMenu] Selected: " + GENRES[this.hoveredIndex])
      this.startGeneration(genre)
    } else {
      print("[RadialMenu] Released in dead zone — dismissed")
      this.destroyMenu()
    }
  }

  private dismissMenu(): void {
    if (!this.isMenuOpen) return
    if (this.isGenerating) return   // don't cancel while generating
    this.isMenuOpen = false
    this.destroyMenu()
    print("[RadialMenu] Dismissed (pinch cancelled)")
  }

  // ── Generation lifecycle ───────────────────────────────────────────────────

  private startGeneration(genre: string): void {
    this.isGenerating = true

    // Re-open a minimal menu showing the ⏳ indicator at the pinch origin
    this.destroyMenu()
    this.isMenuOpen = true
    this.buildGeneratingMenu()

    this.lyriaMusicController.generateForGenre(genre)
  }

  // ── Update loop ────────────────────────────────────────────────────────────

  private onUpdate(): void {
    // Auto-close generating menu once the controller reports done
    if (this.isGenerating && !this.lyriaMusicController.generating) {
      this.isGenerating = false
      this.isMenuOpen = false
      this.destroyMenu()
      print("[RadialMenu] Generation complete — menu closed")
      return
    }

    if (!this.isMenuOpen || !this.menuRoot) return
    if (this.isGenerating) return  // no hover tracking during generation

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
    this.itemUnderlines = []
    this.hoveredIndex = -1
    this.centerLabel = null

    // Ring container
    this.ringRoot = global.scene.createSceneObject("RadialMenuRing")
    this.ringRoot.setParent(this.menuRoot)

    const count = GENRES.length
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const localX = Math.cos(angle) * RING_RADIUS
      const localY = Math.sin(angle) * RING_RADIUS

      const item = global.scene.createSceneObject("Genre_" + GENRES[i])
      item.setParent(this.ringRoot)
      item.getTransform().setLocalPosition(new vec3(localX, localY, 0))
      item.getTransform().setLocalScale(new vec3(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE))

      const textComp = item.createComponent("Component.Text") as Text
      textComp.text = GENRES[i]
      textComp.horizontalAlignment = HorizontalAlignment.Center
      textComp.verticalAlignment = VerticalAlignment.Center

      const ulObj = global.scene.createSceneObject("UL_" + GENRES[i])
      ulObj.setParent(item)
      ulObj.getTransform().setLocalPosition(new vec3(0, -0.6, 0))
      const ulText = ulObj.createComponent("Component.Text") as Text
      ulText.text = "─────"
      ulText.horizontalAlignment = HorizontalAlignment.Center
      ulText.verticalAlignment = VerticalAlignment.Center
      ulText.textFill.color = new vec4(1, 1, 0, 0)

      this.itemObjects.push(item)
      this.itemTexts.push(textComp)
      this.itemUnderlines.push(ulText)
    }

    this.buildCenterSphere()
    this.updateHighlights()
  }

  private buildGeneratingMenu(): void {
    this.menuRoot = global.scene.createSceneObject("RadialMenuRoot")
    this.menuRoot.getTransform().setWorldPosition(this.pinchOrigin)
    this.orientToCamera()
    this.itemObjects = []
    this.itemTexts = []
    this.itemUnderlines = []
    this.ringRoot = null

    this.buildCenterSphere()

    // Center label: ⏳
    const labelObj = global.scene.createSceneObject("RadialMenu_GenLabel")
    labelObj.setParent(this.menuRoot)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, 0))
    labelObj.getTransform().setLocalScale(new vec3(2, 2, 2))
    this.centerLabel = labelObj.createComponent("Component.Text") as Text
    this.centerLabel.text = "⏳"
    this.centerLabel.horizontalAlignment = HorizontalAlignment.Center
    this.centerLabel.verticalAlignment = VerticalAlignment.Center
    this.centerLabel.textFill.color = new vec4(1, 1, 1, 1)
  }

  private buildErrorMenu(): void {
    this.menuRoot = global.scene.createSceneObject("RadialMenuRoot")
    this.menuRoot.getTransform().setWorldPosition(this.pinchOrigin)
    this.orientToCamera()
    this.itemObjects = []
    this.itemTexts = []
    this.itemUnderlines = []
    this.ringRoot = null

    const labelObj = global.scene.createSceneObject("RadialMenu_ErrorLabel")
    labelObj.setParent(this.menuRoot)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, 0))
    labelObj.getTransform().setLocalScale(new vec3(2, 2, 2))
    const errText = labelObj.createComponent("Component.Text") as Text
    errText.text = "✕"
    errText.horizontalAlignment = HorizontalAlignment.Center
    errText.verticalAlignment = VerticalAlignment.Center
    errText.textFill.color = new vec4(1, 0.2, 0.2, 1)

    // Auto-dismiss the error menu on pinch-up (handled in closeMenu which returns early only during isGenerating)
  }

  private buildCenterSphere(): void {
    this.sphereMaterial = null
    if (this.centerSpherePrefab) {
      const sphereObj = this.centerSpherePrefab.instantiate(this.menuRoot)
      sphereObj.getTransform().setLocalPosition(new vec3(0, 0, 0))
      sphereObj.getTransform().setLocalScale(new vec3(0.8, 0.8, 0.8))
      const mv = sphereObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (mv) this.sphereMaterial = mv.mainMaterial
    }
  }

  private destroyMenu(): void {
    if (this.menuRoot) {
      this.menuRoot.destroy()
      this.menuRoot = null
    }
    this.ringRoot = null
    this.itemObjects = []
    this.itemTexts = []
    this.itemUnderlines = []
    this.sphereMaterial = null
    this.centerLabel = null
    this.hoveredIndex = -1
  }

  private orientToCamera(): void {
    if (!this.menuRoot) return
    const camPos = this.camera.getWorldPosition()
    const menuPos = this.menuRoot.getTransform().getWorldPosition()
    const f = camPos.sub(menuPos).normalize()

    const worldUp = new vec3(0, 1, 0)
    const r = worldUp.cross(f).normalize()
    const u = f.cross(r).normalize()

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

  private updateHighlights(): void {
    const anyHovered = this.hoveredIndex >= 0
    for (let i = 0; i < this.itemTexts.length; i++) {
      if (i === this.hoveredIndex) {
        this.itemTexts[i].textFill.color = new vec4(1.0, 1.0, 0.0, 1.0)
        this.itemUnderlines[i].textFill.color = new vec4(1.0, 1.0, 0.0, 1.0)
      } else {
        this.itemTexts[i].textFill.color = new vec4(1.0, 1.0, 1.0, 0.85)
        this.itemUnderlines[i].textFill.color = new vec4(1.0, 1.0, 0.0, 0.0)
      }
    }
    if (this.sphereMaterial) {
      this.sphereMaterial.mainPass.baseColor = anyHovered
        ? new vec4(1.0, 1.0, 0.0, 1.0)
        : new vec4(1.0, 1.0, 1.0, 1.0)
    }
  }
}
