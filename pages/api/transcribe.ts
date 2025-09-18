// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import { promises as fsp } from 'fs'

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '30mb',
  },
}

type ParsedFile = { filePath: string; originalFilename: string }

async function parseForm(req: NextApiRequest): Promise<ParsedFile> {
  const form = new formidable.IncomingForm()
  return new Promise((res, rej) => {
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

    // Read the uploaded temp file
    const buffer = await fsp.readFile(filePath)

    // ✅ Use Uint8Array (valid BlobPart) to satisfy TS/undici types
    const u8 = new Uint8Array(buffer)
    const file = new File([u8], originalFilename || 'voice.webm', { type: 'audio/webm' })

    const form = new FormData()
    form.append('file', file)
    form.append('model', 'whisper-1') // change if your org uses a different STT model

    const r = await fetch(
      `${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/audio/transcriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY!}` },
        body: form,
      }
    )

    if (!r.ok) {
      const errText = await r.text()
      return res.status(r.status).json({ error: errText })
    }

    const json = await r.json()
    return res.status(200).json({ text: json.text ?? '', raw: json })
  } catch (err: any) {
    console.error('Transcribe error:', err)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
