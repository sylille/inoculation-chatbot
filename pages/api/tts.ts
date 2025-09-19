// pages/api/tts.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' })

  try {
    const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts' // change if needed for your account
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: openAIHeaders(true),
      body: JSON.stringify({
        model,
        voice: 'aria',       // try 'verse', 'aria', etc. (depends on availability)
        input: text,
        format: 'mp3'
      })
    })

    if (!r.ok) {
      const errText = await r.text()
      return res.status(r.status).json({ error: errText })
    }

    const arrayBuf = await r.arrayBuffer()
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(Buffer.from(arrayBuf))
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) })
  }
}
