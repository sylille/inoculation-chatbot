// pages/api/health_chat.ts
import type { NextApiRequest, NextApiResponse } from 'next'
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json', Authorization:`Bearer ${process.env.OPENAI_API_KEY!}`},
    body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', messages:[{role:'user',content:'ping'}], max_tokens:5 })
  })
  const txt = await r.text()
  res.status(200).json({ status: r.status, body: tryJson(txt) })
}
function tryJson(s:string){try{return JSON.parse(s)}catch{return s}}
