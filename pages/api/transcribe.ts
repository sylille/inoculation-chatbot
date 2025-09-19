// pages/api/transcribe.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import formidable, { File as FormidableFile } from 'formidable'
import { promises as fsp } from 'fs'
import { openAIHeaders } from '../../lib/openaiHeaders'

export const config = {
  api: {
    bodyParser: false,     // we'll parse multipart ourselves
    sizeLimit: '30mb',
  },
}

type Parsed = { filePath: string; originalFilename: string }

function firstFile(f?: FormidableFile | FormidableFile[] | undefined): FormidableFile | undefined {
  return Array.isArray(f) ? f[0] : f
}

async function parseForm(req: NextApiRequest): Promise<Parsed> {
  // ✅ v2 style: call formidable() instead of new IncomingForm()
  const form = formidable({
    multiples: false,
    maxFileSize: 30 * 1024 * 1024, // 30MB
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err)
      const f = firstFile((files as any)?.audio)
      if (!f) return reject(new Error('No audio file found in field "audio"'))
      // v2 props are filepath / originalFilename
      const filePath = (f as any).filepath || (f as any).path
      const originalFilename =
        (f as any).originalFilename || (f as any).name || 'voice.webm'
      if (!filePath) return reject(new Error('Uploaded file path missing'))
      resolve({ filePath, originalFilename })
    })
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })
  try {
    const { filePath, originalFilename } = await parseForm(req)

    // Read file buffer
    const buffer = await fsp.readFile(filePath)
    // ✅ Use Uint8Array (valid BlobPart) to satisfy TS in Node 18
    const u8 = new Uint8Array(buffer)
    const blob = new Blob([u8], { type: 'audio/webm' })

    // Use Web FormData (Node 18 / undici)
    const form = new FormData()
    // Pass filename as 3rd arg so the API sees a file name
    form.append('file', blob, originalFilename || 'voice.webm')
    form.append('model', 'gpt-4o-mini-transcribe') // instead of 'whisper-1'
    
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: openAIHeaders(false),
      body: form,
    })


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
