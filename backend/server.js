/**
 * Lyria Song Generator — backend/server.js
 *
 * Simple HTTP server. No WebSocket, no PCM conversion.
 *
 * POST /generate   { imageBase64: string, style: string }
 *                  → { url: "https://BASE_URL/audio/uuid.mp3" }
 *
 * GET  /audio/:id  → streams the MP3 file
 * GET  /health     → "ok"
 *
 * .env (parent dir):
 *   OPENROUTER_API_KEY=...   ← preferred if present
 *   GEMINI_API_KEY=...       ← fallback
 *   BASE_URL=https://xxxx.ngrok-free.app
 */

"use strict"

const http = require("http")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { GoogleGenAI } = require("@google/genai")

// ── Config ───────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT ? parseInt(process.env.PORT) : 3000
const BASE_URL         = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY ?? ""
const GEMINI_KEY       = process.env.GEMINI_API_KEY ?? ""
const MODEL            = "lyria-3-clip-preview"
const AUDIO_DIR        = path.join(__dirname, "tmp_audio")
const FILE_TTL         = 10 * 60 * 1000  // 10 minutes

// OpenRouter uses the full model path
const OPENROUTER_MODEL = "google/lyria-3-clip-preview"
const OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"

const STYLE_PROMPTS = {
  kpop:       "upbeat K-pop song with catchy melodic hooks, bright synthesizers, and energetic beat, lyrics mixing English and Korean",
  rock:       "energetic rock song with electric guitar riffs, powerful drums, and driving rhythm",
  hiphop:     "hip-hop track with heavy bass, rhythmic beats, and urban atmosphere",
  jazz:       "smooth jazz with expressive saxophone, walking bass, and brushed drums, include sung or spoken vocal lyrics",
  classical:  "orchestral classical piece with strings, piano, and rich harmonic progressions, include a sung vocal melody with lyrics",
  electronic: "atmospheric electronic music with synthesizer pads, evolving textures, and subtle rhythms, include sung or spoken lyrics",
}

// ── Determine which backend to use ───────────────────────────────────────────

const USE_OPENROUTER = !!OPENROUTER_KEY

if (!OPENROUTER_KEY && !GEMINI_KEY) {
  console.error("[server] FATAL: neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set")
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

// ── Generation ────────────────────────────────────────────────────────────────

const geminiAi = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null

async function generateMp3(style, imageBase64) {
  const stylePrompt = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.kpop
  const prompt = `Generate a ${stylePrompt} inspired by this scene.`

  if (USE_OPENROUTER) {
    return generateMp3OpenRouter(prompt, imageBase64)
  } else {
    return generateMp3Gemini(prompt, imageBase64)
  }
}

async function generateMp3OpenRouter(prompt, imageBase64) {
  const contentParts = [{ type: "text", text: prompt }]
  if (imageBase64) {
    contentParts.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
    })
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      modalities: ["audio"],
      stream: true,
      messages: [{ role: "user", content: contentParts }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter ${response.status}: ${text}`)
  }

  // Collect SSE stream and reassemble base64 audio chunks
  const text = await response.text()
  let audioBase64 = ""

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice(6).trim()
    if (payload === "[DONE]") break
    let chunk
    try { chunk = JSON.parse(payload) } catch { continue }

    for (const choice of chunk.choices ?? []) {
      // content may be a string delta or array of parts
      const delta = choice.delta
      if (!delta) continue

      if (typeof delta.content === "string") {
        audioBase64 += delta.content
      } else if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          if (part.type === "input_audio" && part.input_audio?.data) {
            audioBase64 += part.input_audio.data
          }
        }
      }
      // Some providers put audio in delta.audio
      if (delta.audio?.data) audioBase64 += delta.audio.data
    }
  }

  if (!audioBase64) throw new Error("No audio in OpenRouter stream response")
  return Buffer.from(audioBase64, "base64")
}

async function generateMp3Gemini(prompt, imageBase64) {
  const parts = [{ text: prompt }]
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } })
  }

  const response = await geminiAi.models.generateContent({
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
  const backend = USE_OPENROUTER
    ? `OpenRouter (${OPENROUTER_MODEL})`
    : `Gemini API (${MODEL})`
  console.log(`[server] Listening on http://localhost:${PORT}`)
  console.log(`[server] Using: ${backend}`)
  console.log(`[server] Run:  ngrok http ${PORT}`)
  console.log(`[server] Then: set BASE_URL=https://xxxx.ngrok-free.app in .env`)
})
