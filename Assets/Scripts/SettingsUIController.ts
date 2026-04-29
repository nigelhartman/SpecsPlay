/**
 * SettingsUIController
 *
 * Programmatic floating settings/library UI using SpectaclesUIKit Frame.
 * - Left side fixed vertical menu (non-scrollable)
 * - Library opens by default
 * - Library cards are large and scroll inside ScrollWindow
 */

import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import { Frame } from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import { CapsuleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/CapsuleButton"
import { RectangleButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import { ScrollWindow } from "SpectaclesUIKit.lspkg/Scripts/Components/ScrollWindow/ScrollWindow"
import { LyriaMusicController, LibrarySong } from "./LyriaMusicController"

const PANEL_DIST = 45
const FRAME_SIZE = new vec2(35, 24)

const MENU_X = -13.2
const MENU_TITLE_Y = 8
const LIBRARY_TAB_Y = 4
const SETTINGS_TAB_Y = -3

const PAGE_X = 4.8
const MENU_Z = 0.0
const SCROLL_Z_OFFSET = 0.0

const MAX_THUMBS = 9
const LIBRARY_WINDOW_SIZE = new vec2(21.6, 27.2)
const LIBRARY_WINDOW_POS = new vec3(0, -3.0, 0)
const CARD_WIDTH = 6.5
const CARD_HEIGHT = 6.6
const CARD_GRID_COLUMNS = 3
const CARD_GAP_X = 0.8
const CARD_GAP_Y = 1.0
const CARD_LABEL_OFFSET = 1.0
const LIBRARY_TITLE_MARGIN = 4.6
const LIBRARY_TITLE_Z = 0.2

const LYRIA_CLIP_MODEL = "lyria-3-clip-preview"
const LYRIA_PRO_MODEL = "lyria-3-pro-preview"

const FRAME_RENDER_ORDER = 200
const BUTTON_RENDER_ORDER = 220
const CONTENT_RENDER_ORDER = 230

const WHITE = new vec4(1, 1, 1, 0.9)
const YELLOW = new vec4(1, 1, 0, 1)
const DIM = new vec4(0.65, 0.65, 0.65, 0.8)

@component
export class SettingsUIController extends BaseScriptComponent {
  @input lyriaMusicController: LyriaMusicController

  @input
  @hint("Unlit material template for album art thumbnails — one clone per thumbnail")
  albumArtMaterial: Material

  private camera = WorldCameraFinderProvider.getInstance()
  private frame: Frame | null = null

  private isVisible = false
  private activeTab = "library"

  private settingsTabObj: SceneObject | null = null
  private libraryTabObj: SceneObject | null = null
  private settingsTabButton: CapsuleButton | null = null
  private libraryTabButton: CapsuleButton | null = null
  private settingsTabText: Text | null = null
  private libraryTabText: Text | null = null

  private clipModelButton: CapsuleButton | null = null
  private proModelButton: CapsuleButton | null = null
  private clipModelText: Text | null = null
  private proModelText: Text | null = null
  private modelStatusText: Text | null = null

  private settingsPage: SceneObject | null = null
  private libraryPage: SceneObject | null = null
  private libraryStatusText: Text | null = null
  private libraryScrollWindow: ScrollWindow | null = null

  private thumbRoots: SceneObject[] = []
  private thumbButtons: RectangleButton[] = []
  private thumbImages: Image[] = []
  private thumbMats: (Material | null)[] = []
  private thumbLabels: Text[] = []
  private thumbAudioUrls: string[] = []
  private thumbArtUrls: string[] = []

  private closeButtonBound = false

  onAwake(): void {
    const g = global as any
    g.settingsUiToggle = () => this.toggle()
    g.settingsUiIsOpen = () => this.isVisible

    const apiObj = this as any
    if (apiObj.api) {
      apiObj.api.toggle = () => this.toggle()
      apiObj.api.isPanelOpen = () => this.isVisible
    }

    const frameObj = global.scene.createSceneObject("SettingsUI_Frame")
    this.frame = frameObj.createComponent(Frame.getTypeName()) as Frame
    this.frame.autoShowHide = false

    frameObj.getTransform().setLocalPosition(new vec3(0, -99999, 0))
    frameObj.getTransform().setLocalScale(vec3.zero())

    print("[SettingsUI] onAwake")

    this.createEvent("OnStartEvent").bind(() => {
      print("[SettingsUI] onStart")
      try {
        this.buildPanel()
      } catch (e) {
        print("[SettingsUI] buildPanel failed: " + e)
        return
      }

      const delay = this.createEvent("DelayedCallbackEvent")
      delay.bind(() => {
        const f = this.frame!
        f.showCloseButton = true
        f.showFollowButton = true
        f.innerSize = FRAME_SIZE
        f.renderOrder = FRAME_RENDER_ORDER
        f.opacity = 0
        f.sceneObject.enabled = false
        this.bindCloseButton()
        print("[SettingsUI] Ready")
      })
      delay.reset(0)
    })
  }

  public show(): void {
    if (this.isVisible || !this.frame) return
    this.isVisible = true
    this.bindCloseButton()

    this.frame.sceneObject.getTransform().setLocalScale(vec3.one())
    this.frame.sceneObject.enabled = true
    this.positionPanel()

    this.frame.setUseFollow(true)
    this.frame.smoothFollow?.startDragging()
    this.frame.smoothFollow?.finishDragging()
    this.frame.setFollowing(true)

    this.frame.showVisual()

    if (this.activeTab === "library") this.refreshLibrary()
  }

  public hide(): void {
    if (!this.frame) return
    this.isVisible = false
    this.frame.setFollowing(false)
    this.frame.opacity = 0
    this.frame.sceneObject.enabled = false
    this.resetInteractionState()
  }

  public toggle(): void {
    if (this.isVisible) this.hide(); else this.show()
  }

  public get isOpen(): boolean {
    return this.isVisible
  }

  public isPanelOpen(): boolean {
    return this.isVisible
  }

  private buildPanel(): void {
    const parent = this.frame!.content ?? this.frame!.sceneObject
    this.buildTabBar(parent)
    this.buildSettingsPage(parent)
    this.buildLibraryPage(parent)
    this.applyTab("library")
  }

  private buildTabBar(parent: SceneObject): void {
    const menuTitleObj = global.scene.createSceneObject("SettingsUI_MenuTitle")
    menuTitleObj.setParent(parent)
    menuTitleObj.getTransform().setLocalPosition(new vec3(MENU_X, MENU_TITLE_Y, 0.1))
    const menuTitle = menuTitleObj.createComponent("Component.Text") as Text
    menuTitle.text = "MENU"
    menuTitle.horizontalAlignment = HorizontalAlignment.Center
    menuTitle.verticalAlignment = VerticalAlignment.Center
    menuTitle.textFill.color = DIM
    menuTitle.renderOrder = CONTENT_RENDER_ORDER

    this.libraryTabObj = global.scene.createSceneObject("SettingsUI_TabLibrary")
    this.libraryTabObj.setParent(parent)
    this.libraryTabObj.getTransform().setLocalPosition(new vec3(MENU_X, LIBRARY_TAB_Y, MENU_Z))
    this.libraryTabButton = this.libraryTabObj.createComponent(CapsuleButton.getTypeName()) as CapsuleButton
    this.libraryTabButton.size = new vec3(8.4, 5.1, 1)
    this.libraryTabButton.initialize()
    this.libraryTabButton.renderOrder = BUTTON_RENDER_ORDER
    this.libraryTabButton.onTriggerUp.add(() => this.applyTab("library"))

    const libraryLabelObj = global.scene.createSceneObject("SettingsUI_TabLibrary_Label")
    libraryLabelObj.setParent(this.libraryTabObj)
    libraryLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
    libraryLabelObj.getTransform().setLocalScale(new vec3(1.2, 1.2, 1))
    this.libraryTabText = libraryLabelObj.createComponent("Component.Text") as Text
    this.libraryTabText.text = "Library"
    this.libraryTabText.horizontalAlignment = HorizontalAlignment.Center
    this.libraryTabText.verticalAlignment = VerticalAlignment.Center
    this.libraryTabText.renderOrder = CONTENT_RENDER_ORDER

    this.settingsTabObj = global.scene.createSceneObject("SettingsUI_TabSettings")
    this.settingsTabObj.setParent(parent)
    this.settingsTabObj.getTransform().setLocalPosition(new vec3(MENU_X, SETTINGS_TAB_Y, MENU_Z))
    this.settingsTabButton = this.settingsTabObj.createComponent(CapsuleButton.getTypeName()) as CapsuleButton
    this.settingsTabButton.size = new vec3(8.4, 5.1, 1)
    this.settingsTabButton.initialize()
    this.settingsTabButton.renderOrder = BUTTON_RENDER_ORDER
    this.settingsTabButton.onTriggerUp.add(() => this.applyTab("settings"))

    const settingsLabelObj = global.scene.createSceneObject("SettingsUI_TabSettings_Label")
    settingsLabelObj.setParent(this.settingsTabObj)
    settingsLabelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
    settingsLabelObj.getTransform().setLocalScale(new vec3(1.2, 1.2, 1))
    this.settingsTabText = settingsLabelObj.createComponent("Component.Text") as Text
    this.settingsTabText.text = "Settings"
    this.settingsTabText.horizontalAlignment = HorizontalAlignment.Center
    this.settingsTabText.verticalAlignment = VerticalAlignment.Center
    this.settingsTabText.renderOrder = CONTENT_RENDER_ORDER
  }

  private buildSettingsPage(parent: SceneObject): void {
    this.settingsPage = global.scene.createSceneObject("SettingsUI_PageSettings")
    this.settingsPage.setParent(parent)
    this.settingsPage.getTransform().setLocalPosition(new vec3(PAGE_X, 0, 0))

    const headingObj = global.scene.createSceneObject("SettingsUI_SettingsHeading")
    headingObj.setParent(this.settingsPage)
    headingObj.getTransform().setLocalPosition(new vec3(0, 6, 0))
    headingObj.getTransform().setLocalScale(new vec3(1.7, 1.7, 1))
    const headingText = headingObj.createComponent("Component.Text") as Text
    headingText.text = "Settings"
    headingText.horizontalAlignment = HorizontalAlignment.Center
    headingText.verticalAlignment = VerticalAlignment.Center
    headingText.textFill.color = WHITE
    headingText.renderOrder = CONTENT_RENDER_ORDER

    const bodyObj = global.scene.createSceneObject("SettingsUI_SettingsBody")
    bodyObj.setParent(this.settingsPage)
    bodyObj.getTransform().setLocalPosition(new vec3(0, 2.4, 0))
    bodyObj.getTransform().setLocalScale(new vec3(1.05, 1.05, 1))
    const bodyText = bodyObj.createComponent("Component.Text") as Text
    bodyText.text = "Lyria Model"
    bodyText.horizontalAlignment = HorizontalAlignment.Center
    bodyText.verticalAlignment = VerticalAlignment.Center
    bodyText.textFill.color = DIM
    bodyText.renderOrder = CONTENT_RENDER_ORDER

    const clipObj = global.scene.createSceneObject("SettingsUI_ModelClip")
    clipObj.setParent(this.settingsPage)
    clipObj.getTransform().setLocalPosition(new vec3(0, 0.2, 0))
    this.clipModelButton = clipObj.createComponent(CapsuleButton.getTypeName()) as CapsuleButton
    this.clipModelButton.size = new vec3(12, 3.2, 1)
    this.clipModelButton.initialize()
    this.clipModelButton.renderOrder = BUTTON_RENDER_ORDER
    this.clipModelButton.onTriggerUp.add(() => {
      this.lyriaMusicController.setGenerationModel(LYRIA_CLIP_MODEL)
      this.updateModelSelectionUI()
    })

    const clipTextObj = global.scene.createSceneObject("SettingsUI_ModelClip_Label")
    clipTextObj.setParent(clipObj)
    clipTextObj.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
    this.clipModelText = clipTextObj.createComponent("Component.Text") as Text
    this.clipModelText.text = "Lyria 3 Clip"
    this.clipModelText.horizontalAlignment = HorizontalAlignment.Center
    this.clipModelText.verticalAlignment = VerticalAlignment.Center
    this.clipModelText.renderOrder = CONTENT_RENDER_ORDER

    const proObj = global.scene.createSceneObject("SettingsUI_ModelPro")
    proObj.setParent(this.settingsPage)
    proObj.getTransform().setLocalPosition(new vec3(0, -3.5, 0))
    this.proModelButton = proObj.createComponent(CapsuleButton.getTypeName()) as CapsuleButton
    this.proModelButton.size = new vec3(12, 3.2, 1)
    this.proModelButton.initialize()
    this.proModelButton.renderOrder = BUTTON_RENDER_ORDER
    this.proModelButton.onTriggerUp.add(() => {
      this.lyriaMusicController.setGenerationModel(LYRIA_PRO_MODEL)
      this.updateModelSelectionUI()
    })

    const proTextObj = global.scene.createSceneObject("SettingsUI_ModelPro_Label")
    proTextObj.setParent(proObj)
    proTextObj.getTransform().setLocalPosition(new vec3(0, 0, 0.2))
    this.proModelText = proTextObj.createComponent("Component.Text") as Text
    this.proModelText.text = "Lyria 3 Pro"
    this.proModelText.horizontalAlignment = HorizontalAlignment.Center
    this.proModelText.verticalAlignment = VerticalAlignment.Center
    this.proModelText.renderOrder = CONTENT_RENDER_ORDER

    const statusObj = global.scene.createSceneObject("SettingsUI_ModelStatus")
    statusObj.setParent(this.settingsPage)
    statusObj.getTransform().setLocalPosition(new vec3(0, -6.6, 0))
    statusObj.getTransform().setLocalScale(new vec3(0.95, 0.95, 1))
    this.modelStatusText = statusObj.createComponent("Component.Text") as Text
    this.modelStatusText.horizontalAlignment = HorizontalAlignment.Center
    this.modelStatusText.verticalAlignment = VerticalAlignment.Center
    this.modelStatusText.textFill.color = DIM
    this.modelStatusText.renderOrder = CONTENT_RENDER_ORDER

    this.updateModelSelectionUI()
  }

  private buildLibraryPage(parent: SceneObject): void {
    this.libraryPage = global.scene.createSceneObject("SettingsUI_PageLibrary")
    this.libraryPage.setParent(parent)
    this.libraryPage.getTransform().setLocalPosition(new vec3(PAGE_X, 0, 0))

    const headingObj = global.scene.createSceneObject("SettingsUI_LibraryHeading")
    headingObj.setParent(this.libraryPage)
    headingObj.getTransform().setLocalPosition(
      new vec3(
        0,
        LIBRARY_WINDOW_POS.y + LIBRARY_WINDOW_SIZE.y * 0.5 + LIBRARY_TITLE_MARGIN,
        LIBRARY_TITLE_Z
      )
    )
    headingObj.getTransform().setLocalScale(vec3.one())
    const headingText = headingObj.createComponent("Component.Text") as Text
    headingText.text = "Library"
    headingText.horizontalAlignment = HorizontalAlignment.Center
    headingText.verticalAlignment = VerticalAlignment.Center
    headingText.textFill.color = DIM
    headingText.renderOrder = CONTENT_RENDER_ORDER

    const statusObj = global.scene.createSceneObject("SettingsUI_LibStatus")
    statusObj.setParent(this.libraryPage)
    statusObj.getTransform().setLocalPosition(new vec3(0, 5.6, 0))
    statusObj.getTransform().setLocalScale(new vec3(1.3, 1.3, 1))
    this.libraryStatusText = statusObj.createComponent("Component.Text") as Text
    this.libraryStatusText.text = ""
    this.libraryStatusText.horizontalAlignment = HorizontalAlignment.Center
    this.libraryStatusText.verticalAlignment = VerticalAlignment.Center
    this.libraryStatusText.textFill.color = DIM
    this.libraryStatusText.renderOrder = CONTENT_RENDER_ORDER

    this.libraryScrollWindow = null
    try {
      const scrollRoot = global.scene.createSceneObject("SettingsUI_LibraryScrollWindow")
      scrollRoot.setParent(this.libraryPage)
      scrollRoot.getTransform().setLocalPosition(new vec3(LIBRARY_WINDOW_POS.x, LIBRARY_WINDOW_POS.y, LIBRARY_WINDOW_POS.z + SCROLL_Z_OFFSET))
      this.libraryScrollWindow = scrollRoot.createComponent(ScrollWindow.getTypeName()) as ScrollWindow
      this.libraryScrollWindow.horizontal = false
      this.libraryScrollWindow.vertical = true
      this.libraryScrollWindow.windowSize = LIBRARY_WINDOW_SIZE
      this.libraryScrollWindow.scrollDimensions = LIBRARY_WINDOW_SIZE
      this.libraryScrollWindow.scrollSnapping = false
      this.libraryScrollWindow.edgeFade = false
      print("[SettingsUI] ScrollWindow enabled")
    } catch (e) {
      this.libraryScrollWindow = null
      print("[SettingsUI] ScrollWindow unavailable, fallback mode: " + e)
    }

    for (let i = 0; i < MAX_THUMBS; i++) {
      const thumbRoot = global.scene.createSceneObject("SettingsUI_Thumb_" + i)
      if (this.libraryScrollWindow) {
        this.libraryScrollWindow.addObject(thumbRoot)
      } else {
        thumbRoot.setParent(this.libraryPage)
      }
      thumbRoot.getTransform().setLocalPosition(new vec3(0, 0, 0))
      thumbRoot.enabled = false

      const thumbButton = thumbRoot.createComponent(RectangleButton.getTypeName()) as RectangleButton
      thumbButton.size = new vec3(CARD_WIDTH, CARD_HEIGHT, 1)
      thumbButton.initialize()
      thumbButton.renderOrder = BUTTON_RENDER_ORDER
      thumbButton.onTriggerUp.add(() => {
        const audioUrl = this.thumbAudioUrls[i]
        const artUrl = this.thumbArtUrls[i]
        if (!audioUrl) return

        print("[SettingsUI] Loading song: " + audioUrl)
        this.lyriaMusicController.loadSongFromLibrary(audioUrl, artUrl)
        this.hide()
      })

      const imgObj = global.scene.createSceneObject("SettingsUI_ThumbImg_" + i)
      imgObj.setParent(thumbRoot)
      imgObj.getTransform().setLocalScale(new vec3(CARD_WIDTH - 0.4, CARD_HEIGHT - 0.4, 1))
      const imgComp = imgObj.createComponent("Component.Image") as Image
      imgComp.renderOrder = CONTENT_RENDER_ORDER

      let mat: Material | null = null
      if (this.albumArtMaterial) {
        mat = this.albumArtMaterial.clone()
        imgComp.mainMaterial = mat
      }

      const labelObj = global.scene.createSceneObject("SettingsUI_ThumbLabel_" + i)
      labelObj.setParent(thumbRoot)
      labelObj.getTransform().setLocalPosition(new vec3(0, -(CARD_HEIGHT * 0.5 + CARD_LABEL_OFFSET), 0.1))
      labelObj.getTransform().setLocalScale(new vec3(1.0, 1.0, 1))
      const labelText = labelObj.createComponent("Component.Text") as Text
      labelText.text = ""
      labelText.horizontalAlignment = HorizontalAlignment.Center
      labelText.verticalAlignment = VerticalAlignment.Center
      labelText.textFill.color = WHITE
      labelText.renderOrder = CONTENT_RENDER_ORDER

      this.thumbRoots.push(thumbRoot)
      this.thumbButtons.push(thumbButton)
      this.thumbImages.push(imgComp)
      this.thumbMats.push(mat)
      this.thumbLabels.push(labelText)
      this.thumbAudioUrls.push("")
      this.thumbArtUrls.push("")
    }
  }

  private applyTab(tab: string): void {
    this.activeTab = tab
    if (this.settingsPage) this.settingsPage.enabled = tab === "settings"
    if (this.libraryPage) this.libraryPage.enabled = tab === "library"

    if (this.settingsTabText) {
      this.settingsTabText.textFill.color = tab === "settings" ? YELLOW : WHITE
    }
    if (this.libraryTabText) {
      this.libraryTabText.textFill.color = tab === "library" ? YELLOW : WHITE
    }

    if (this.settingsTabObj) {
      this.settingsTabObj.getTransform().setLocalScale(tab === "settings" ? vec3.one() : new vec3(0.95, 0.95, 1))
    }
    if (this.libraryTabObj) {
      this.libraryTabObj.getTransform().setLocalScale(tab === "library" ? vec3.one() : new vec3(0.95, 0.95, 1))
    }

    if (tab === "library" && this.isVisible) this.refreshLibrary()
    if (tab === "settings") this.updateModelSelectionUI()
  }

  private updateModelSelectionUI(): void {
    const selectedModel = this.lyriaMusicController.getGenerationModel()
    const clipSelected = selectedModel === LYRIA_CLIP_MODEL
    const proSelected = selectedModel === LYRIA_PRO_MODEL

    if (this.clipModelText) this.clipModelText.textFill.color = clipSelected ? YELLOW : WHITE
    if (this.proModelText) this.proModelText.textFill.color = proSelected ? YELLOW : WHITE

    if (this.modelStatusText) {
      this.modelStatusText.text = "Current: " + (proSelected ? "Lyria 3 Pro" : "Lyria 3 Clip")
    }
  }

  private refreshLibrary(): void {
    if (this.libraryStatusText) this.libraryStatusText.text = "Loading..."
    for (const root of this.thumbRoots) root.enabled = false

    this.lyriaMusicController.fetchLibrary().then((songs: LibrarySong[]) => {
      this.populateThumbnails(songs)
    })
  }

  private populateThumbnails(songs: LibrarySong[]): void {
    if (this.libraryStatusText) {
      this.libraryStatusText.text = songs.length === 0 ? "No songs yet." : ""
    }

    const count = Math.min(songs.length, MAX_THUMBS)
    this.layoutLibraryCards(count)

    for (let i = 0; i < MAX_THUMBS; i++) {
      if (i >= count) {
        this.thumbRoots[i].enabled = false
        continue
      }

      const song = songs[i]
      this.thumbRoots[i].enabled = true
      this.thumbLabels[i].text = song.style
      this.thumbAudioUrls[i] = song.url
      this.thumbArtUrls[i] = song.artUrl

      if (song.artUrl && this.thumbMats[i]) {
        const idx = i
        this.lyriaMusicController.loadImageTexture(
          song.artUrl,
          (tex: Texture) => {
            const mat = this.thumbMats[idx]
            if (mat && mat.mainPass) mat.mainPass.baseTex = tex
          },
          () => {}
        )
      }
    }

    print("[SettingsUI] Library populated with " + count + " songs")
  }

  private layoutLibraryCards(count: number): void {
    if (!this.libraryScrollWindow) {
      const colStride = CARD_WIDTH + CARD_GAP_X
      const rowStride = CARD_HEIGHT + CARD_GAP_Y
      const gridWidth = CARD_GRID_COLUMNS * CARD_WIDTH + (CARD_GRID_COLUMNS - 1) * CARD_GAP_X
      const startX = -gridWidth * 0.5 + CARD_WIDTH * 0.5
      const startY = 2.8
      for (let i = 0; i < count; i++) {
        const col = i % CARD_GRID_COLUMNS
        const row = Math.floor(i / CARD_GRID_COLUMNS)
        this.thumbRoots[i].getTransform().setLocalPosition(new vec3(startX + col * colStride, startY - row * rowStride, 0))
      }
      return
    }

    const rows = Math.max(1, Math.ceil(count / CARD_GRID_COLUMNS))
    const gridWidth = CARD_GRID_COLUMNS * CARD_WIDTH + (CARD_GRID_COLUMNS - 1) * CARD_GAP_X
    const rowStride = CARD_HEIGHT + CARD_LABEL_OFFSET + CARD_GAP_Y
    const contentHeight = CARD_HEIGHT + CARD_LABEL_OFFSET + (rows - 1) * rowStride
    const clampedHeight = Math.max(LIBRARY_WINDOW_SIZE.y, contentHeight)

    this.libraryScrollWindow.scrollDimensions = new vec2(LIBRARY_WINDOW_SIZE.x, clampedHeight)

    const firstCardY = clampedHeight * 0.5 - CARD_HEIGHT * 0.5
    const firstCardX = -gridWidth * 0.5 + CARD_WIDTH * 0.5
    const colStride = CARD_WIDTH + CARD_GAP_X

    for (let i = 0; i < count; i++) {
      const col = i % CARD_GRID_COLUMNS
      const row = Math.floor(i / CARD_GRID_COLUMNS)
      this.thumbRoots[i].getTransform().setLocalPosition(new vec3(firstCardX + col * colStride, firstCardY - row * rowStride, 0))
    }

    this.libraryScrollWindow.scrollPositionNormalized = new vec2(0, 1)
  }

  private positionPanel(): void {
    if (!this.frame) return
    const base = this.camera.getForwardPositionParallelToGround(PANEL_DIST)
    const camPos = this.camera.getWorldPosition()
    const pos = new vec3(base.x, camPos.y - 5, base.z)
    this.frame.sceneObject.getTransform().setWorldPosition(pos)
    print("[SettingsUI] Panel at " + pos.x.toFixed(1) + " " + pos.y.toFixed(1) + " " + pos.z.toFixed(1))
  }

  private bindCloseButton(): void {
    if (!this.frame || this.closeButtonBound || !this.frame.closeButton) return

    this.frame.closeButton.onTriggerUp.add(() => {
      print("[SettingsUI] Close button pressed")
      this.hide()
    })
    this.closeButtonBound = true
  }

  private resetInteractionState(): void {
    if (this.libraryScrollWindow) {
      this.libraryScrollWindow.scrollPositionNormalized = new vec2(0, 1)
    }
  }
}