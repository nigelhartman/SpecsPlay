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
  private image: Image

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => {
      try {
        const cameraRequest = CameraModule.createCameraRequest()
        cameraRequest.cameraId = CameraModule.CameraId.Default_Color

        this.cameraTexture = this.cameraModule.requestCamera(cameraRequest)
        const provider = this.cameraTexture.control as CameraTextureProvider

        // Display feed on Image component if one is present (optional, for debugging)
        this.image = this.sceneObject.getComponent("Component.Image") as Image
        if (provider && this.image) {
          provider.onNewFrame.add(this.onNewFrame.bind(this))
        }

        if (!provider) {
          print("[CameraFeedController] ERROR: CameraTextureProvider is null")
        }
      } catch (e) {
        print("[CameraFeedController] ERROR during setup: " + e)
      }
    })
  }

  private onNewFrame(): void {
    this.image.mainPass.baseTex = this.cameraTexture
  }
}
