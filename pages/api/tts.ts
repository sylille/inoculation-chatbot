// pages/api/tts.ts
export const config = { runtime: 'edge' }

// Simple in-memory LRU. Lives as long as the edge instance is warm.
type Entry = { buf: ArrayBuffer, at: number }
const GLOBAL = globalThis as any
if (!GLOBAL.__TTS_CACHE) GLOBAL.__TTS_CACHE = new Map<string, Entry>()
const CACHE: Map<string, Entry> = GLOBAL.__TTS_CACHE
const MAX_ITEMS = 64

async function sha1(s: string) {
  const enc = new TextEncoder().encode(s)
  const buf = await crypto.subtle.digest('SHA-1', enc)
  const bytes = Array.from(new Uint8Array(buf))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

function touch(key: string, entry: Entry) {
  CACHE.delete(key)
  CACHE.set(key, entry)
  if (CACHE.size > MAX_ITEMS) {
    // evict oldest
    const first = CACHE.keys().next().value
    CACHE.delete(first)
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: { text?: string; voice?: string }
  try { body = await req.json() } catch { return new Response('Bad JSON', { status: 400 }) }

  const text = (body.text ?? '').trim()
  if (!text) return new Response('text required', { status: 400 })

  // You can expose a toggle in UI; default to a natural voice
  const voice = (body.voice ?? 'alloy')

  const key = await sha1(`v1|${voice}|${text}`)
  const cached = CACHE.get(key)
  if (cached) {
    touch(key, cached)
    return new Response(cached.buf, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }
    })
  }

  // OpenAI TTS – pick a fast model that returns MP3
  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 25_000)

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',  // fast, good quality; you can switch to 'tts-1' if preferred
        input: text,
        voice,
        format: 'mp3'
      }),
      signal: ctrl.signal,
      keepalive: true
    })
    clearTimeout(to)

    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return new Response(`OpenAI TTS error: ${errText}`, { status: 502 })
    }

    const buf = await r.arrayBuffer()
    const entry: Entry = { buf, at: Date.now() }
    touch(key, entry)

    return new Response(buf, {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }
    })
  } catch (e: any) {
    clearTimeout(to)
    const msg = e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'Unknown error')
    return new Response(msg, { status: 504 })
  }
}
