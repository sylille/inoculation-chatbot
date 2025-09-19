// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'

type Role = 'user' | 'assistant' | 'system'
type Msg = { role: Role; content: string }
type TranscribeResp = { text: string }
type ChatResp = { text: string }

type LogRow = {
  ts: string
  user: string
  npc: string
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [npcReply, setNpcReply] = useState('')
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      content: `You are "Aegis", an empathetic NPC trained to inoculate users against political manipulation techniques.
Behavior rules:
1) Nonpartisan, neutral tone. Never take a political side.
2) Use Empathetic Refutational Interview (ERI):
   - Listen & validate feelings concisely.
   - Refute by naming the manipulation technique (e.g., cherry-picking, ad hominem) and offer one-sentence correction.
   - Inoculate: give a 1-sentence mental heuristic to spot it next time.
   - Action: suggest one small action the user can try now.
3) Keep replies short (1–2 paragraphs). Ask ONE clarifying question.
4) Use plain, respectful language for older adults.`
    }
  ])

  // UI options
  const [useServerVoice, setUseServerVoice] = useState<boolean>(true) // toggle server TTS vs browser TTS
  const [logs, setLogs] = useState<LogRow[]>([])

  // Media / audio nodes
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)

  // Simple “speaking” audio element for server TTS
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audioPlayerRef.current = new Audio()
    return () => {
      // cleanup
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  // --- Recording with auto-stop on silence ---
  async function startRecording() {
    try {
      setTranscript('')
      setNpcReply('')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      // Build analyser for silence detection (RMS threshold)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        // Stop meters
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        // tear down mic
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null

        // Build blob and send
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size > 0) {
          await sendAudio(blob)
        } else {
          console.warn('Empty recording')
        }
      }

      mr.start()
      setIsRecording(true)
      silenceStartRef.current = null
      monitorSilence() // kick off RMS checking
    } catch (err) {
      console.error(err)
      alert('Microphone permission or recording failed.')
    }
  }

  function stopRecording() {
    try {
      const mr = mediaRecorderRef.current
      if (mr && mr.state !== 'inactive') mr.stop()
      setIsRecording(false)
    } catch (err) {
      console.error(err)
    }
  }

  function monitorSilence() {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.fftSize)
    const SILENCE_RMS = 0.02   // adjust if needed
    const SILENCE_MS = 1200    // auto-stop after ~1.2s of silence

    const loop = (t: number) => {
      analyser.getByteTimeDomainData(data)
      // Compute RMS (0..1)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)

      if (rms < SILENCE_RMS) {
        // start or continue counting silence
        if (silenceStartRef.current == null) silenceStartRef.current = performance.now()
        const silenceFor = performance.now() - (silenceStartRef.current ?? 0)
        if (silenceFor > SILENCE_MS && isRecording) {
          stopRecording()
          return
        }
      } else {
        // reset silence timer when voice detected
        silenceStartRef.current = null
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
  }

  // --- Network calls ---
  async function sendAudio(blob: Blob) {
    try {
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')

      const tResp = await axios.post<TranscribeResp>('/api/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const text: string = String(tResp.data?.text ?? '')
      setTranscript(text)

      // Conversation
      const userMsg: Msg = { role: 'user', content: text }
      const newMessages: Msg[] = [...messages, userMsg]
      setMessages(newMessages)

      const cResp = await axios.post<ChatResp>('/api/chat', { messages: newMessages })
      const reply: string = String(cResp.data?.text ?? '')
      setNpcReply(reply)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Log row
      setLogs(prev => [...prev, { ts: new Date().toISOString(), user: text, npc: reply }])

      // Speak
      if (useServerVoice) {
        await speakServer(reply)
      } else {
        speakBrowser(reply)
      }
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error || err?.message || String(err)
      console.error(err)
      alert('Error sending audio: ' + serverMsg)
    }
  }

  // --- TTS options ---
  function speakBrowser(text: string) {
    if (!text) return
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        // You can adjust these or pick a voice by language
        u.rate = 1.0
        u.pitch = 1.0
        // const ko = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('ko'))
        // if (ko) u.voice = ko
        window.speechSynthesis.speak(u)
      } else {
        console.warn('speechSynthesis not supported')
      }
    } catch (e) {
      console.error('Browser TTS failed', e)
    }
  }

  async function speakServer(text: string) {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      if (!r.ok) {
        const errTxt = await r.text()
        throw new Error(errTxt)
      }
      const arrayBuf = await r.arrayBuffer()
      const blob = new Blob([arrayBuf], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = url
        await audioPlayerRef.current.play()
      }
    } catch (e) {
      console.error('Server TTS failed, falling back to browser TTS', e)
      speakBrowser(text)
    }
  }

  // --- CSV export ---
  function downloadCSV() {
    const header = ['timestamp', 'user', 'npc']
    const rows = logs.map(r => [r.ts, csvEscape(r.user), csvEscape(r.npc)])
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inoculation_npc_logs_${new Date().toISOString().slice(0,10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function csvEscape(s: string) {
    const needsQuotes = /[",\n]/.test(s)
    const esc = s.replace(/"/g, '""')
    return needsQuotes ? `"${esc}"` : esc
  }

  function resetConversation() {
    setMessages(prev => prev.length ? [prev[0]] : [])
    setTranscript('')
    setNpcReply('')
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Inoculation NPC — Audio Roleplay</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Tap the mic, speak, and pause — it stops automatically when you finish.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
        {/* One-tap button: start, then auto-stop on silence */}
        <button
          onClick={() => (isRecording ? stopRecording() : startRecording())}
          style={{
            width: 84, height: 84, borderRadius: '50%',
            border: 'none',
            background: isRecording ? '#da1e28' : '#0f62fe',
            color: '#fff', fontSize: 22, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.15)'
          }}
          aria-pressed={isRecording}
        >
          {isRecording ? 'Listening…' : '🎤'}
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={useServerVoice}
            onChange={e => setUseServerVoice(e.target.checked)}
          />
          Better voice (server TTS)
        </label>

        <button onClick={resetConversation} style={btnSecondaryStyle}>Reset</button>
        <button onClick={downloadCSV} style={btnSecondaryStyle}>Download CSV</button>
      </div>

      <section style={{ marginTop: 8 }}>
        <h3>Your transcript</h3>
        <div style={boxStyle}>
          {transcript ? transcript : <em>— say something —</em>}
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h3>NPC reply</h3>
        <div style={{ ...boxStyle, minHeight: 110, whiteSpace: 'pre-wrap' }}>
          {npcReply ? npcReply : <em>NPC will reply here</em>}
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h4>Conversation (debug)</h4>
        <ol style={{ paddingLeft: 18 }}>
          {messages.map((m, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              <strong>{m.role}:</strong> {m.content}
            </li>
          ))}
        </ol>
      </section>

      <footer style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
        Tip: Auto-stop uses silence detection (~1.2s). If it cuts off, speak continuously or tap again.
      </footer>
    </main>
  )
}

const btnSecondaryStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#e0e0e0',
  color: '#111',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer'
}

const boxStyle: React.CSSProperties = {
  minHeight: 64,
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 10,
  background: '#fafafa'
}
