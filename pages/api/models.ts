import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const base = process.env.OPENAI_API_BASE || 'https://api.openai.com'
    const r = await fetch(`${base}/v1/models`, { headers: openAIHeaders(false) })
    const body = await r.text()
    res.status(r.status).send(body)
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) })
  }
}
