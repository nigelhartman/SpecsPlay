/**
 * Lyria Song Generator — backend/server.js
 *
 * Accepts a WebSocket connection from Spectacles or the test frontend.
 * Protocol (client → server):
 *   { type: "generate", imageBase64: string, style: "kpop"|"rock"|"hiphop" }
 *
 * Protocol (server → client):
 *   { type: "status", state: "generating"|"done"|"error", message? }
 *   Binary Uint8Array — raw PCM 16-bit 48 kHz stereo chunks
 *
 * Requirements:
 *   ffmpeg must be installed (brew install ffmpeg)
 *   GEMINI_API_KEY set in ../.env
 */

"use strict"

const { WebSocketServer } = require("ws")
const { GoogleGenAI } = require("@google/genai")
const { execFile } = require("child_process")
const { promisify } = require("util")
const execFileAsync = promisify(execFile)
const fs = require("fs")
const os = require("os")
const path = require("path")

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ""
const LYRIA_MODEL = "lyria-3-clip-preview"

const STYLE_PROMPTS = {
  kpop:       "upbeat K-pop song with catchy melodic hooks, bright synthesizers, and energetic beat",
  rock:       "energetic rock song with electric guitar riffs, powerful drums, and driving rhythm",
  hiphop:     "hip-hop track with heavy bass, rhythmic beats, and urban atmosphere",
  jazz:       "smooth jazz with expressive saxophone, walking bass, and brushed drums",
  classical:  "orchestral classical piece with strings, piano, and rich harmonic progressions",
  electronic: "atmospheric electronic music with synthesizer pads, evolving textures, and subtle rhythms",
}

if (!GEMINI_API_KEY) {
  console.error("[server] FATAL: GEMINI_API_KEY environment variable not set")
  process.exit(1)
}

// ── Gemini client ─────────────────────────────────────────────────────────────

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

// ── Audio conversion ──────────────────────────────────────────────────────────

async function mp3ToPcm16(mp3Buffer) {
  const tmpIn  = path.join(os.tmpdir(), `lyria_in_${Date.now()}.mp3`)
  const tmpOut = path.join(os.tmpdir(), `lyria_out_${Date.now()}.pcm`)
  try {
    fs.writeFileSync(tmpIn, mp3Buffer)
    await execFileAsync("ffmpeg", [
      "-y", "-i", tmpIn,
      "-f", "s16le", "-ar", "48000", "-ac", "2",
      tmpOut,
    ])
    return fs.readFileSync(tmpOut)
  } finally {
    if (fs.existsSync(tmpIn))  fs.unlinkSync(tmpIn)
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut)
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT })
console.log(`[server] Listening on ws://localhost:${PORT}`)
console.log("[server] Run:  ngrok http " + PORT + "  then paste the wss:// URL into Lens Studio")

wss.on("connection", (ws) => {
  console.log("[server] Client connected")

  const sendStatus = (state, message) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(JSON.stringify({ type: "status", state, ...(message ? { message } : {}) }))
  }

  ws.on("message", async (data, isBinary) => {
    if (isBinary) return

    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }

    if (msg.type !== "generate") return

    const style      = msg.style ?? "kpop"
    const imageBase64 = msg.imageBase64 ?? null
    const stylePrompt = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.kpop

    console.log(`[server] Generating ${style} song...`)
    sendStatus("generating")

    try {
      const parts = [
        { text: `Generate a ${stylePrompt} inspired by this scene.` },
      ]
      if (imageBase64) {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } })
      }

      const response = await ai.models.generateContent({
        model: LYRIA_MODEL,
        contents: parts,
        config: { responseModalities: ["AUDIO"] },
      })

      let mp3Buffer = null
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          mp3Buffer = Buffer.from(part.inlineData.data, "base64")
          console.log(`[server] Received audio: ${mp3Buffer.length} bytes (${part.inlineData.mimeType})`)
          break
        }
      }

      if (!mp3Buffer) {
        sendStatus("error", "No audio in response")
        return
      }

      console.log("[server] Converting MP3 → PCM16 48kHz stereo...")
      const pcm = await mp3ToPcm16(mp3Buffer)
      console.log(`[server] PCM ready: ${pcm.length} bytes (~${Math.round(pcm.length / 48000 / 4)}s), sending...`)

      // Send in 1-second chunks for progressive playback
      const CHUNK = 48000 * 2 * 2 // 1s @ 48kHz stereo PCM16
      for (let i = 0; i < pcm.length; i += CHUNK) {
        if (ws.readyState !== ws.OPEN) break
        ws.send(pcm.slice(i, i + CHUNK))
      }

      sendStatus("done")
      console.log("[server] Done")
    } catch (err) {
      console.error("[server] Generation error:", err.message)
      sendStatus("error", err.message)
    }
  })

  ws.on("close", () => console.log("[server] Client disconnected"))
  ws.on("error", (err) => console.error("[server] Error:", err))
})
