// pages/api/chat.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import fetch from 'node-fetch'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const body = req.body
  const { messages } = body // messages: array of {role, content} including system prompt

  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })

  try {
    // Call Chat Completions API (v1)
    const r = await fetch(`${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // change based on availability
        messages,
        max_tokens: 800,
        temperature: 0.7
      })
    })

    const json = await r.json()
    // The assistant response location may vary; typically json.choices[0].message.content
    const assistantText = json?.choices?.[0]?.message?.content ?? ''
    return res.status(200).json({ text: assistantText, raw: json })
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message ?? String(err) })
  }
}
