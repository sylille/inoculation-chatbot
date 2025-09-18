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

    // Read the temp file into a Buffer
    const buffer = await fsp.readFile(filePath)

    // Convert Buffer -> ArrayBuffer slice so TS is happy with Blob/File constructor
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

    // Create a File (undici provides File in Node 18+)
    const file = new File([ab], originalFilename || 'voice.webm', { type: 'audio/webm' })

    // Build multipart payload using Web FormData (no 'form-data' pkg)
    const form = new FormData()
    form.append('file', file)
    form.append('model', 'whisper-1') // swap if your org uses another STT model

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
      return res.status(r.status).json({ error: errText })
    }

    const json = await r.json()
    return res.status(200).json({ text: json.text ?? '', raw: json })
  } catch (err: any) {
    console.error('Transcribe error:', err)
    return res.status(500).json({ error: err?.message ?? String(err) })
  }
}
