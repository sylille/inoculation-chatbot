// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'

export const config = {
  api: { bodyParser: false }
}

async function parseForm(req: NextApiRequest) {
  const form = new formidable.IncomingForm()
  return new Promise<{ filePath: string; originalFilename: string }>((res, rej) => {
    form.parse(req, (err, fields, files: any) => {
      if (err) return rej(err)
      const file = files?.audio
      if (!file) return rej(new Error('No audio file'))
      res({
        filePath: file.filepath ?? file.path,
        originalFilename: file.originalFilename ?? file.name
      })
    })
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { filePath } = await parseForm(req)
    const data = fs.createReadStream(filePath)

    // call OpenAI Whisper transcription
    const form = new (require('form-data'))()
    form.append('file', data)
    form.append('model', 'whisper-1')

    const r = await fetch(
      `${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/audio/transcriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`
        },
        body: form as any
      }
    )

    if (!r.ok) {
      const errText = await r.text()
      return res.status(r.status).json({ error: errText })
    }

    const json = await r.json()
    return res.status(200).json({ text: json.text ?? '', raw: json })
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message ?? String(err) })
  }
}
