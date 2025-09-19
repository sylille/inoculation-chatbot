import type { NextApiRequest, NextApiResponse } from 'next'
import { openAIHeaders } from '../../lib/openaiHeaders'

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: openAIHeaders(true),
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
  })
  const txt = await r.text()
  res.status(200).json({ status: r.status, body: tryJson(txt) })
}
function tryJson(s: string) { try { return JSON.parse(s) } catch { return s } }
