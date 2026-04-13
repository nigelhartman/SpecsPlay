/**
 * Lyria Song Generator — backend/server.js
 *
 * Simple HTTP server. No WebSocket, no PCM conversion.
 *
 * POST /generate   { imageBase64: string, style: string }
 *                  → { url: "https://BASE_URL/audio/uuid.mp3" }
 *
 * GET  /audio/:id  → streams the MP3 file
 *
 * .env (parent dir):
 *   GEMINI_API_KEY=...
 *   BASE_URL=https://xxxx.ngrok-free.app   ← update each ngrok session
 */

"use strict"

const http = require("http")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { GoogleGenAI } = require("@google/genai")

// ── Config ───────────────────────────────────────────────────────────────────

const PORT       = process.env.PORT     ? parseInt(process.env.PORT) : 3000
const BASE_URL   = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const API_KEY    = process.env.GEMINI_API_KEY ?? ""
const MODEL      = "lyria-3-clip-preview"
const AUDIO_DIR  = path.join(__dirname, "tmp_audio")
const FILE_TTL   = 10 * 60 * 1000  // 10 minutes

const STYLE_PROMPTS = {
  kpop:       "upbeat K-pop song with catchy melodic hooks, bright synthesizers, and energetic beat, lyrics mixing English and Korean",
  rock:       "energetic rock song with electric guitar riffs, powerful drums, and driving rhythm",
  hiphop:     "hip-hop track with heavy bass, rhythmic beats, and urban atmosphere",
  jazz:       "smooth jazz with expressive saxophone, walking bass, and brushed drums",
  classical:  "orchestral classical piece with strings, piano, and rich harmonic progressions",
  electronic: "atmospheric electronic music with synthesizer pads, evolving textures, and subtle rhythms",
}

if (!API_KEY) {
  console.error("[server] FATAL: GEMINI_API_KEY not set")
  process.exit(1)
}
if (!process.env.BASE_URL) {
  console.warn("[server] WARN: BASE_URL not set — audio URLs will use localhost, Spectacles won't reach them")
}

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR)

// ── Cleanup old files ────────────────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - FILE_TTL
  for (const f of fs.readdirSync(AUDIO_DIR)) {
    const fp = path.join(AUDIO_DIR, f)
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp)
    } catch {}
  }
}, 60_000)

// ── Gemini client ─────────────────────────────────────────────────────────────

const ai = new GoogleGenAI({ apiKey: API_KEY })

async function generateMp3(style, imageBase64) {
  const stylePrompt = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.kpop
  const parts = [{ text: `Generate a ${stylePrompt} inspired by this scene.` }]
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } })
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: { responseModalities: ["AUDIO"] },
  })

  for (const part of response.candidates[0].content.parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64")
    }
  }
  throw new Error("No audio in Lyria response")
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.writeHead(204); res.end(); return
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end("ok")
    return
  }

  // POST /generate
  if (req.method === "POST" && req.url === "/generate") {
    let body = ""
    req.on("data", chunk => body += chunk)
    req.on("end", async () => {
      let style, imageBase64
      try {
        ;({ style, imageBase64 } = JSON.parse(body))
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON" }))
        return
      }

      console.log(`[server] Generating ${style}...`)
      try {
        const mp3 = await generateMp3(style, imageBase64)
        const filename = crypto.randomUUID() + ".mp3"
        fs.writeFileSync(path.join(AUDIO_DIR, filename), mp3)
        const url = `${BASE_URL}/audio/${filename}`
        console.log(`[server] Done — ${mp3.length} bytes → ${url}`)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ url }))
      } catch (err) {
        console.error("[server] Error:", err.message)
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // GET /audio/:filename
  if (req.method === "GET" && req.url.startsWith("/audio/")) {
    const filename = path.basename(req.url)
    const filepath = path.join(AUDIO_DIR, filename)
    if (!fs.existsSync(filepath)) {
      res.writeHead(404); res.end("Not found"); return
    }
    const stat = fs.statSync(filepath)
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    })
    fs.createReadStream(filepath).pipe(res)
    return
  }

  res.writeHead(404); res.end("Not found")
})

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`)
  console.log(`[server] Run:  ngrok http ${PORT}`)
  console.log(`[server] Then: set BASE_URL=https://xxxx.ngrok-free.app in .env and backendUrl in Inspector`)
})
