"use strict"

const http = require("http")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { spawn } = require("child_process")
const { GoogleGenAI } = require("@google/genai")

// ── Config ───────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT ? parseInt(process.env.PORT) : 3000
const BASE_URL         = (process.env.BASE_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "")
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY ?? ""
const GEMINI_KEY       = process.env.GEMINI_API_KEY ?? ""
const DEFAULT_MODEL    = "lyria-3-clip-preview"
const AUDIO_DIR        = path.join(__dirname, "tmp_audio")
const ART_DIR          = path.join(__dirname, "tmp_art")
const SONGS_FILE       = path.join(__dirname, "songs.json")
const FILE_TTL         = 10 * 60 * 1000  // 10 minutes (only for non-library files)

const OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"

const MODEL_MAP = {
  "lyria-3-clip-preview": {
    openrouter: "google/lyria-3-clip-preview",
    gemini: "lyria-3-clip-preview",
  },
  "lyria-3-pro-preview": {
    openrouter: "google/lyria-3-pro-preview",
    gemini: "lyria-3-pro-preview",
  },
}

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
const SECRET_KEY     = process.env.SECRET_KEY ?? ""
const SONG_LIMIT     = 100

let songCount = 0

if (!OPENROUTER_KEY && !GEMINI_KEY) {
  console.error("[server] FATAL: neither OPENROUTER_API_KEY nor GEMINI_API_KEY is set")
  process.exit(1)
}
if (!SECRET_KEY) {
  console.warn("[server] WARN: SECRET_KEY not set — all requests will be accepted without auth")
}
if (!process.env.BASE_URL) {
  console.warn("[server] WARN: BASE_URL not set — audio URLs will use localhost, Spectacles won't reach them")
}

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR)
if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR)

// ── Song library ──────────────────────────────────────────────────────────────

/** @type {{ id: string, style: string, url: string, artUrl: string, audioFilename: string, artFilename: string, createdAt: string }[]} */
let songLibrary = []

function loadLibrary() {
  try {
    if (fs.existsSync(SONGS_FILE)) {
      songLibrary = JSON.parse(fs.readFileSync(SONGS_FILE, "utf8"))
      console.log(`[server] Loaded ${songLibrary.length} songs from library`)
    }
  } catch (err) {
    console.warn("[server] Could not load songs.json:", err.message)
    songLibrary = []
  }
}

function saveLibrary() {
  try {
    fs.writeFileSync(SONGS_FILE, JSON.stringify(songLibrary, null, 2))
  } catch (err) {
    console.warn("[server] Could not save songs.json:", err.message)
  }
}

loadLibrary()

// ── Cleanup old non-library files ─────────────────────────────────────────────

setInterval(() => {
  const cutoff = Date.now() - FILE_TTL
  const libraryAudioFiles = new Set(songLibrary.map(s => s.audioFilename).filter(Boolean))
  for (const f of fs.readdirSync(AUDIO_DIR)) {
    if (libraryAudioFiles.has(f)) continue
    const fp = path.join(AUDIO_DIR, f)
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp)
    } catch {}
  }
}, 60_000)

// ── PCM → MP3 conversion ──────────────────────────────────────────────────────

function pcmToMp3(pcmBuffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-f", "s16le",
      "-ar", "48000",
      "-ac", "2",
      "-i", "pipe:0",
      "-codec:a", "libmp3lame",
      "-q:a", "2",
      "-f", "mp3",
      "pipe:1",
    ])
    const chunks = []
    ff.stdout.on("data", c => chunks.push(c))
    ff.stderr.on("data", () => {})
    ff.on("close", code => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    ff.on("error", reject)
    ff.stdin.write(pcmBuffer)
    ff.stdin.end()
  })
}

// ── Generation ────────────────────────────────────────────────────────────────

const geminiAi = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null

function resolveModel(requestedModel) {
  if (requestedModel && MODEL_MAP[requestedModel]) {
    return requestedModel
  }
  return DEFAULT_MODEL
}

async function generateMp3(style, imageBase64, requestedModel) {
  const stylePrompt = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.kpop
  const prompt = `Generate a ${stylePrompt} inspired by this scene.`
  const model = resolveModel(requestedModel)

  if (USE_OPENROUTER) {
    return generateMp3OpenRouter(prompt, imageBase64, MODEL_MAP[model].openrouter)
  } else {
    return generateMp3Gemini(prompt, imageBase64, MODEL_MAP[model].gemini)
  }
}

async function generateMp3OpenRouter(prompt, imageBase64, openRouterModel) {
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
      model: openRouterModel,
      modalities: ["audio"],
      stream: true,
      messages: [{ role: "user", content: contentParts }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter ${response.status}: ${text}`)
  }

  const text = await response.text()
  let audioBase64 = ""

  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const payload = line.slice(6).trim()
    if (payload === "[DONE]") break
    let chunk
    try { chunk = JSON.parse(payload) } catch { continue }

    for (const choice of chunk.choices ?? []) {
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
      if (delta.audio?.data) audioBase64 += delta.audio.data
    }
  }

  if (!audioBase64) throw new Error("No audio in OpenRouter stream response")
  const pcm = Buffer.from(audioBase64, "base64")
  return pcmToMp3(pcm)
}

async function generateMp3Gemini(prompt, imageBase64, geminiModel) {
  const parts = [{ text: prompt }]
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } })
  }

  const response = await geminiAi.models.generateContent({
    model: geminiModel,
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

  // GET /library
  if (req.method === "GET" && req.url === "/library") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify([...songLibrary].reverse()))
    return
  }

  // GET /art/:filename
  if (req.method === "GET" && req.url.startsWith("/art/")) {
    const filename = path.basename(req.url)
    const filepath = path.join(ART_DIR, filename)
    if (!fs.existsSync(filepath)) {
      res.writeHead(404); res.end("Not found"); return
    }
    res.writeHead(200, { "Content-Type": "image/jpeg" })
    fs.createReadStream(filepath).pipe(res)
    return
  }

  // POST /generate
  if (req.method === "POST" && req.url === "/generate") {
    let body = ""
    req.on("data", chunk => body += chunk)
    req.on("end", async () => {
      let style, imageBase64, secretKey, model
      try {
        ;({ style, imageBase64, secretKey, model } = JSON.parse(body))
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Invalid JSON" }))
        return
      }

      if (SECRET_KEY && secretKey !== SECRET_KEY) {
        console.warn("[server] Rejected: invalid secret key")
        res.writeHead(403, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Forbidden" }))
        return
      }

      if (songCount >= SONG_LIMIT) {
        console.warn(`[server] Rejected: song limit of ${SONG_LIMIT} reached`)
        res.writeHead(429, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: `Song limit of ${SONG_LIMIT} reached. Restart the server to reset.` }))
        return
      }

      songCount++
      const resolvedModel = resolveModel(model)
      console.log(`[server] Generating ${style} with ${resolvedModel}... (${songCount}/${SONG_LIMIT})`)
      try {
        const mp3 = await generateMp3(style, imageBase64, resolvedModel)
        const audioFilename = crypto.randomUUID() + ".mp3"
        const artFilename = imageBase64 ? crypto.randomUUID() + ".jpg" : ""

        fs.writeFileSync(path.join(AUDIO_DIR, audioFilename), mp3)

        if (imageBase64 && artFilename) {
          try {
            fs.writeFileSync(path.join(ART_DIR, artFilename), Buffer.from(imageBase64, "base64"))
          } catch (e) {
            console.warn("[server] Could not save art:", e.message)
          }
        }

        const url = `${BASE_URL}/audio/${audioFilename}`
        const artUrl = artFilename ? `${BASE_URL}/art/${artFilename}` : ""

        const songEntry = {
          id: crypto.randomUUID(),
          style,
          url,
          artUrl,
          audioFilename,
          artFilename,
          createdAt: new Date().toISOString(),
        }
        songLibrary.push(songEntry)

        // Trim library and delete oldest files
        if (songLibrary.length > SONG_LIMIT) {
          const removed = songLibrary.shift()
          try { fs.unlinkSync(path.join(AUDIO_DIR, removed.audioFilename)) } catch {}
          try { if (removed.artFilename) fs.unlinkSync(path.join(ART_DIR, removed.artFilename)) } catch {}
        }
        saveLibrary()

        console.log(`[server] Done — ${mp3.length} bytes → ${url}`)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ url, artUrl, model: resolvedModel }))
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
    ? `OpenRouter (${MODEL_MAP[DEFAULT_MODEL].openrouter})`
    : `Gemini API (${MODEL_MAP[DEFAULT_MODEL].gemini})`
  console.log(`[server] Listening on http://localhost:${PORT}`)
  console.log(`[server] Using: ${backend}`)
  console.log(`[server] Run:  ngrok http ${PORT}`)
  console.log(`[server] Then: set BASE_URL=https://xxxx.ngrok-free.app in .env`)
})
