import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { messages } = req.body ?? {}
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })

  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: openAIHeaders(true),
      body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.7 }),
    })
    const txt = await r.text()
    if (!r.ok) return res.status(r.status).json({ error: txt })
    const json = JSON.parse(txt)
    const assistantText = json?.choices?.[0]?.message?.content ?? ''
    return res.status(200).json({ text: assistantText, raw: json })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
}
