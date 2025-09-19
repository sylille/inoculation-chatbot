import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const base = process.env.OPENAI_API_BASE || 'https://api.openai.com'
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
    const r = await fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: openAIHeaders(true),
      body: JSON.stringify({ model, input: 'ping', max_output_tokens: 5 }),
    })
    const txt = await r.text()
    res.status(200).json({ status: r.status, body: tryJson(txt) })
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) })
  }
}
function tryJson(s: string) { try { return JSON.parse(s) } catch { return s } }
