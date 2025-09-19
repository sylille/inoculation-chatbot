// pages/api/chat.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { messages } = req.body ?? {}
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })

  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
  const base = process.env.OPENAI_API_BASE || 'https://api.openai.com'

  // Flatten messages → single prompt (Responses API friendly)
  const prompt = messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')

  try {
    const r = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: openAIHeaders(true),
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 800,
        temperature: 0.7,
      }),
    })
    const txt = await r.text()
    if (!r.ok) return res.status(r.status).json({ error: txt })

    // Try to extract text; fallback to raw if shape changes
    try {
      const json = JSON.parse(txt)
      const first = json?.output?.[0]?.content?.find((c: any) => c?.type?.includes('text'))
      const outText = first?.text ?? ''
      return res.status(200).json({ text: outText, raw: json })
    } catch {
      return res.status(200).json({ text: txt })
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
}
