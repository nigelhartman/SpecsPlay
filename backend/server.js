/**
 * Lyria Vision Proxy — backend/server.js
 *
 * Accepts a single WebSocket connection from the Spectacles lens.
 * Protocol (Spectacles → server):
 *   { type: "start", stylePrompt: string }   — open Lyria session and start playing
 *   { type: "frame", data: "<base64 JPEG>" } — analyze scene with Gemini Vision
 *   { type: "stop" }                         — pause Lyria and close session
 *
 * Protocol (server → Spectacles):
 *   Binary Uint8Array frames                 — raw PCM 16-bit 48 kHz stereo from Lyria
 *   { type: "status", state, message? }      — control/error messages
 *
 * Setup:
 *   npm install
 *   GEMINI_API_KEY=<your-key> node server.js
 *   # In another terminal: ngrok http 3000  → use the wss:// URL in Lens Studio
 */

"use strict"

const { WebSocketServer } = require("ws")
const { GoogleGenAI } = require("@google/genai")

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ""
const VISION_MODEL = "gemini-2.5-flash"
const LYRIA_MODEL = "models/lyria-realtime-exp"

// How often to call Vision even if new frames arrive faster (ms)
const VISION_THROTTLE_MS = 5000

if (!GEMINI_API_KEY) {
  console.error("[server] FATAL: GEMINI_API_KEY environment variable not set")
  process.exit(1)
}

// ── Gemini client ─────────────────────────────────────────────────────────────

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

// Patch SDK bug: double-slash in WebSocket URL (googleapis.com//ws/...)
const wsf = ai.live.music.webSocketFactory
const origCreate = wsf.create.bind(wsf)
wsf.create = (url, ...rest) => {
  const fixed = url
    .replace("googleapis.com//ws/", "googleapis.com/ws/")
    .replace("v1beta.GenerativeService", "v1alpha.GenerativeService")
  console.log("[lyria] Connecting to:", fixed)
  return origCreate(fixed, ...rest)
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })
console.log(`[server] Listening on ws://localhost:${PORT}`)
console.log("[server] Run:  ngrok http " + PORT + "  then paste the wss:// URL into Lens Studio")

wss.on("connection", (ws) => {
  console.log("[server] Spectacles connected")

  /** @type {import("@google/genai").LiveMusicSession | null} */
  let lyriaSession = null
  let stylePrompt = ""
  let lastSceneDesc = ""
  let lastVisionTime = 0
  let visionInFlight = false

  // ── Send helpers ────────────────────────────────────────────────────────────

  const sendStatus = (state, message) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(JSON.stringify({ type: "status", state, ...(message ? { message } : {}) }))
  }

  // ── Lyria session ───────────────────────────────────────────────────────────

  const openLyriaSession = async () => {
    try {
      lyriaSession = await ai.live.music.connect({
        model: LYRIA_MODEL,
        callbacks: {
          onmessage: (msg) => {
            const chunks = msg.serverContent?.audioChunks
            if (chunks?.length) {
              for (const chunk of chunks) {
                if (!chunk.data) continue
                const pcm = Buffer.from(chunk.data, "base64")
                console.log("[lyria] audio chunk:", pcm.length, "bytes")
                if (ws.readyState === ws.OPEN) ws.send(pcm)
              }
            }
            if (msg.setupComplete) {
              console.log("[lyria] Setup complete, calling play()")
              lyriaSession.play()
            }
            if (msg.filteredPrompt) {
              console.warn("[lyria] Prompt filtered:", JSON.stringify(msg.filteredPrompt))
            }
          },
          onerror: (e) => {
            console.error("[lyria] Error:", e.error ?? e)
            sendStatus("error", String(e.error ?? e))
          },
          onclose: (e) => {
            console.log("[lyria] Session closed, code:", e.code)
            lyriaSession = null
          },
        },
      })

      console.log("[lyria] Connected, waiting for setupComplete...")
      await applyPrompt(lastSceneDesc)
      sendStatus("ready")
    } catch (err) {
      console.error("[lyria] Failed to open session:", err)
      sendStatus("error", "Lyria session failed: " + err.message)
    }
  }

  const closeLyriaSession = async () => {
    if (!lyriaSession) return
    try {
      await lyriaSession.stop()
    } catch (_) {}
    lyriaSession = null
  }

  // ── Prompt builder ──────────────────────────────────────────────────────────

  /**
   * Combine the Gemini Vision scene description with the user's style prompt
   * and push it to Lyria as a weighted prompt.
   */
  const applyPrompt = async (sceneDesc) => {
    if (!lyriaSession) return

    const parts = []
    if (sceneDesc) parts.push(sceneDesc)
    if (stylePrompt) parts.push(stylePrompt)
    const combined = parts.join(", ") || "ambient instrumental music"

    console.log("[lyria] Updating prompt →", combined)
    try {
      await lyriaSession.setWeightedPrompts({ weightedPrompts: [{ text: combined, weight: 1.0 }] })
    } catch (err) {
      console.error("[lyria] setWeightedPrompts failed:", err)
    }
  }

  // ── Gemini Vision ───────────────────────────────────────────────────────────

  /**
   * Describe the scene in the JPEG using Gemini Vision.
   * Returns a 5–8 word mood/environment description, e.g. "sunny park, playful daytime atmosphere".
   */
  const describeScene = async (base64Jpeg) => {
    const resp = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Jpeg,
              },
            },
            {
              text: 'Describe this scene in 5-8 words focusing on mood, lighting, and environment. Reply with ONLY the description, no punctuation.',
            },
          ],
        },
      ],
    })
    return resp.text?.trim() ?? ""
  }

  // ── Message handler ─────────────────────────────────────────────────────────

  ws.on("message", async (data, isBinary) => {
    let msg
    try {
      const str = data.toString()
      try {
        msg = JSON.parse(str)
      } catch (e) {
        const pos = parseInt(e.message.match(/position (\d+)/)?.[1] ?? "0")
        if (pos > 0) {
          msg = JSON.parse(str.slice(0, pos))
        } else {
          throw e
        }
      }
    } catch (e) {
      console.warn("[server] Parse error:", e.message)
      return
    }

    switch (msg.type) {
      case "start":
        stylePrompt = (msg.stylePrompt ?? "").trim()
        console.log("[server] Start requested, stylePrompt:", stylePrompt || "(none)")
        await openLyriaSession()
        break

      case "stop":
        console.log("[server] Stop requested")
        await closeLyriaSession()
        sendStatus("stopped")
        break

      case "frame": {
        const now = Date.now()
        if (visionInFlight || now - lastVisionTime < VISION_THROTTLE_MS) break

        visionInFlight = true
        lastVisionTime = now

        try {
          const sceneDesc = await describeScene(msg.data)
          if (sceneDesc && sceneDesc !== lastSceneDesc) {
            console.log("[vision] Scene:", sceneDesc)
            lastSceneDesc = sceneDesc
            await applyPrompt(sceneDesc)
          }
        } catch (err) {
          console.error("[vision] Error:", err.message)
        } finally {
          visionInFlight = false
        }
        break
      }

      default:
        console.warn("[server] Unknown message type:", msg.type)
    }
  })

  // ── Connection close ────────────────────────────────────────────────────────

  ws.on("close", async () => {
    console.log("[server] Spectacles disconnected")
    await closeLyriaSession()
  })

  ws.on("error", (err) => {
    console.error("[server] WebSocket error:", err)
  })
})
