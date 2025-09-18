// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import { promises as fsp } from 'fs'

export const config = {
  api: {
    bodyParser: false,          // we parse multipart ourselves
    sizeLimit: '30mb',          // allow larger audio
  },
}

// parse multipart form and return local filepath
async function parseForm(req: NextApiRequest) {
  const form = new formidable.IncomingForm()
  return new Promise<{ filePath: string; originalFilename: string }>((res, rej) => {
    form.parse(req, (err, _fields, files: any) => {
      if (err) return rej(err)
      const file = files?.audio
      if (!file) return rej(new Error('No audio file found in field "audio"'))
      res({
        filePath: file.filepath ?? file.path,
        originalFilename: file.originalFilename ?? file.name ?? 'voice.webm',
      })
    })
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

  try {
    const { filePath, originalFilename } = await parseForm(req)

    // Read file into Buffer, then make a Web Blob (works with Node 18+)
    const buffer = await fsp.readFile(filePath)
    const blob = new Blob([buffer], { type: 'audio/webm' })

    // Use Web FormData (undici) — NOT the 'form-data' package
    const form = new FormData()
    form.append('file', blob, originalFilename || 'voice.webm')
    form.append('model', 'whisper-1')

    const r = await fetch(
      `${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/audio/transcriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
        },
        body: form,
      }
    )

    if (!r.ok) {
      const errText = await r.text()
      // bubble up the OpenAI error so the client can see it
      return res.status(r.status).json({ error: errText })
    }

    const json = await r.json()
    return res.status(200).json({ text: json.text ?? '', raw: json })
  } catch (err: any) {
    console.error('Transcribe error:', err)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
