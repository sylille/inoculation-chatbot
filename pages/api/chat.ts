// pages/api/chat.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { messages } = req.body ?? {}
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })

  try {
    const r = await fetch(`${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 800,
        temperature: 0.7
      })
    })

    if (!r.ok) {
      const err = await r.text()
      return res.status(r.status).json({ error: err })
    }

    const json = await r.json()
    const assistantText = json?.choices?.[0]?.message?.content ?? ''
    return res.status(200).json({ text: assistantText, raw: json })
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message ?? String(err) })
  }
}
