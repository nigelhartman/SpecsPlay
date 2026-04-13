/**
 * CameraFeedController
 *
 * Requests the Spectacles default color camera via CameraModule and
 * displays the live feed on the Image component on this SceneObject.
 */
@component
export class CameraFeedController extends BaseScriptComponent {
  private cameraModule: CameraModule = require("LensStudio:CameraModule")
  public cameraTexture: Texture
  public hasFrame: boolean = false
  private image: Image

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      try {
        const cameraRequest = CameraModule.createCameraRequest()
        cameraRequest.cameraId = CameraModule.CameraId.Default_Color

        this.cameraTexture = this.cameraModule.requestCamera(cameraRequest)
        const provider = this.cameraTexture.control as CameraTextureProvider

        if (!provider) {
          print("[CameraFeedController] ERROR: CameraTextureProvider is null")
          return
        }

        // Always track when the first frame arrives
        provider.onNewFrame.add(this.onNewFrame.bind(this))

        // Display feed on Image component if one is present (optional, for debugging)
        this.image = this.sceneObject.getComponent("Component.Image") as Image
      } catch (e) {
        print("[CameraFeedController] ERROR during setup: " + e)
      }
    })
  }

  private onNewFrame(): void {
    this.hasFrame = true
    if (this.image) {
      this.image.mainPass.baseTex = this.cameraTexture
    }
  }
}
