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
        this.image = this.sceneObject.getComponent("Component.Image") as Image

        if (!this.image) {
          print("[CameraFeedController] No Image component found on " + this.sceneObject.name)
          return
        }

        const cameraRequest = CameraModule.createCameraRequest()
        cameraRequest.cameraId = CameraModule.CameraId.Default_Color

        this.cameraTexture = this.cameraModule.requestCamera(cameraRequest)
        const provider = this.cameraTexture.control as CameraTextureProvider

        if (provider) {
          print("[CameraFeedController] Camera ready, attaching frame listener")
          provider.onNewFrame.add(this.onNewFrame.bind(this))
        } else {
          print("[CameraFeedController] ERROR: CameraTextureProvider is null")
        }
      } catch (e) {
        print("[CameraFeedController] ERROR during setup: " + e)
      }
    })
  }

  private onNewFrame(): void {
    if (this.image && this.cameraTexture) {
      this.image.mainPass.baseTex = this.cameraTexture
    }
  }
}
