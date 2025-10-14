// pages/api/transcribe.ts
export const config = { runtime: 'edge' }

// Accepts multipart/form-data with `audio` (webm/opus). Returns { text }.
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  // Edge Request has .formData()
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 })
  }

  const audio = form.get('audio')
  if (!audio || !(audio instanceof File)) {
    return new Response(JSON.stringify({ error: 'audio file required' }), { status: 400 })
  }

  // Build a new form for OpenAI Whisper
  const upstream = new FormData()
  upstream.append('file', audio, (audio as File).name || 'audio.webm')
  upstream.append('model', 'whisper-1') // robust + fast
  // Optional: language hint if mostly Korean, speeds up a bit
  // upstream.append('language', 'ko')

  const ctrl = new AbortController()
  const to = setTimeout(() => ctrl.abort(), 60_000) // STT can take longer

  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: upstream,
      signal: ctrl.signal,
      keepalive: true
    })
    clearTimeout(to)

    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return new Response(JSON.stringify({ error: `Whisper error: ${errText}` }), { status: 502 })
    }

    const data = await r.json()
    const text = String(data?.text ?? '')
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  } catch (e: any) {
    clearTimeout(to)
    const msg = e?.name === 'AbortError' ? 'STT timeout' : (e?.message || 'Unknown error')
    return new Response(JSON.stringify({ error: msg }), { status: 504 })
  }
}
