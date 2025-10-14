// pages/api/chat.ts
export const config = { runtime: 'edge' }

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let payload: { messages?: Msg[] }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const messages = (payload.messages ?? []).map((m) => ({
    role: m.role,
    content: String(m.content ?? '')
  })) as Msg[]

  if (!messages.length) {
    return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 })
  }

  // Keep tight: small, fast model; deterministic for repeatability
  const body = {
    model: 'gpt-4o-mini',              // fast + good for dialogue
    temperature: 0.6,
    max_tokens: 220,
    messages
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 25_000) // hard cap 25s server time

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      // important for edge: keepalive helps when clients navigate away
      keepalive: true
    })
    clearTimeout(t)

    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return new Response(JSON.stringify({ error: `OpenAI error: ${errText}` }), { status: 502 })
    }

    const data = await r.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    return new Response(JSON.stringify({ text }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    })
  } catch (e: any) {
    clearTimeout(t)
    const msg = e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'Unknown error')
    return new Response(JSON.stringify({ error: msg }), { status: 504 })
  }
}
