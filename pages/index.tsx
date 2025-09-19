// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'

type Role = 'user' | 'assistant' | 'system'
type Msg = { role: Role; content: string }
type TranscribeResp = { text: string }
type ChatResp = { text: string }

type LogRow = { ts: string; user: string; npc: string }

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [npcReply, setNpcReply] = useState('')
  const [messages, setMessages] = useState<Msg[]>([
    {
  "role": "system",
  "content": "You are 'Ari', an empathetic NPC trained to inoculate users against political manipulation techniques. You suggest roleplay with them to help them understand various manipulation techniques commonly used in political media.\n\nManipulation techniques:\n1. Trolling people, i.e., deliberately provoking people to react emotionally, thus evoking outrage.\n2. Exploiting emotional language, i.e., trying to make people afraid or angry about a particular topic.\n3. Artificially amplifying the reach and popularity of certain messages, for example through social media bots or by buying fake followers.\n4. Creating and spreading conspiracy theories, i.e., blaming a small, secretive and nefarious organization for events going on in the world.\n5. Polarizing audiences by deliberately emphasizing and magnifying inter-group differences.\n\nBehavior rules:\n1) For the sake of roleplay, you must first act as the manipulator in a short scenario line. Make it clear afterward that this was roleplay.\n2) After roleplay, immediately step out of role and use Empathetic Refutational Interview (ERI):\n   - Listen & validate feelings concisely.\n   - Refute by naming the manipulation technique (e.g., trolling, conspiracy theory) and offer a one-sentence correction.\n   - Inoculate: give a one-sentence mental heuristic to spot it next time.\n   - Action: suggest one small action the user can try now.\n3) Keep replies short (1–2 paragraphs). Always ask ONE clarifying question at the end.\n4) Use plain, respectful language for older adults. Keep a positive attitude and cheerful demeanor.\n5) Always separate the roleplay part from the ERI part by clearly labeling them (e.g., [Roleplay as manipulator], [Step out of role])."
}
  ])

  // options / logs
  const [useServerVoice, setUseServerVoice] = useState<boolean>(true)
  const [logs, setLogs] = useState<LogRow[]>([])

  // audio graph / detection
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const maxDurTimerRef = useRef<number | null>(null)
  const [rmsUI, setRmsUI] = useState(0) // 0..1 for pulsing ring

  // Max duration cap (ms)
  const MAX_DURATION_MS = 30000

  // Server TTS audio
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    audioPlayerRef.current = new Audio()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (maxDurTimerRef.current) window.clearTimeout(maxDurTimerRef.current)
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
      streamRef.current?.getTracks().forEach(t => t.stop())
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  // ---------- Recording with adaptive silence + pulsing ring + max duration ----------
  async function startRecording() {
    try {
      setTranscript('')
      setNpcReply('')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      // Audio graph
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      // Collect audio
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        if (maxDurTimerRef.current) window.clearTimeout(maxDurTimerRef.current)
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        setRmsUI(0)

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size > 0) await sendAudio(blob)
      }

      // Start capture
      mr.start()
      setIsRecording(true)
      silenceStartRef.current = null

      // Calibrate ambient and start loop
      await calibrateSilence(analyser)
      monitorSilenceAdaptive()

      // Max duration cap
      maxDurTimerRef.current = window.setTimeout(() => {
        if (isRecording) stopRecording()
      }, MAX_DURATION_MS)
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

  // ambient calibration
  async function calibrateSilence(analyser: AnalyserNode) {
    const data = new Float32Array(analyser.fftSize)
    const samples: number[] = []
    const start = performance.now()
    while (performance.now() - start < 800) {
      analyser.getFloatTimeDomainData(data)
      samples.push(rmsFromFloat(data))
      await new Promise(r => requestAnimationFrame(r))
    }
    const ambient = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
    ;(analyser as any).__ambient = ambient
  }

  function rmsFromFloat(buf: Float32Array) {
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    return Math.sqrt(sum / buf.length)
  }

  function monitorSilenceAdaptive() {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Float32Array(analyser.fftSize)
    const ambient = (analyser as any).__ambient ?? 0.01

    // Hysteresis thresholds relative to ambient
    const startTalk = Math.max(ambient * 3, 0.02)
    const stopTalk  = Math.max(ambient * 1.5, 0.012)

    const MIN_SPEECH_MS = 400
    const MIN_SILENCE_MS = 1000

    let state: 'silent' | 'talking' = 'silent'
    let stateSince = performance.now()

    const loop = () => {
      analyser.getFloatTimeDomainData(data)
      const rms = rmsFromFloat(data)

      // update UI ring with eased RMS
      setRmsUI(prev => prev * 0.85 + Math.min(1, rms * 6) * 0.15)

      const now = performance.now()
      if (state === 'silent') {
        if (rms > startTalk && now - stateSince > 120) {
          state = 'talking'
          stateSince = now
        }
      } else {
        if (rms < stopTalk && now - stateSince > MIN_SPEECH_MS) {
          if (silenceStartRef.current == null) silenceStartRef.current = now
          const silenceFor = now - (silenceStartRef.current ?? now)
          if (silenceFor > MIN_SILENCE_MS && isRecording) {
            stopRecording()
            return
          }
        } else {
          silenceStartRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  // ---------- Network calls ----------
  async function sendAudio(blob: Blob) {
    try {
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')

      const tResp = await axios.post<TranscribeResp>('/api/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const text: string = String(tResp.data?.text ?? '')
      setTranscript(text)

      const userMsg: Msg = { role: 'user', content: text }
      const newMessages: Msg[] = [...messages, userMsg]
      setMessages(newMessages)

      const cResp = await axios.post<ChatResp>('/api/chat', { messages: newMessages })
      const reply: string = String(cResp.data?.text ?? '')
      setNpcReply(reply)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      setLogs(prev => [...prev, { ts: new Date().toISOString(), user: text, npc: reply }])

      if (useServerVoice) await speakServer(reply)
      else speakBrowser(reply)
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error || err?.message || String(err)
      console.error(err)
      alert('Error sending audio: ' + serverMsg)
    }
  }

  // ---------- TTS ----------
  function speakBrowser(text: string) {
    if (!text) return
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 1.0
        u.pitch = 1.0
        // const ko = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('ko'))
        // if (ko) u.voice = ko
        window.speechSynthesis.speak(u)
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
      if (!r.ok) throw new Error(await r.text())
      const arrayBuf = await r.arrayBuffer()
      const blob = new Blob([arrayBuf], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = url
        await audioPlayerRef.current.play()
      }
    } catch (e) {
      console.error('Server TTS failed; fallback to browser', e)
      speakBrowser(text)
    }
  }

  // Replay last reply button
  async function replayLast() {
    if (!npcReply) return
    if (useServerVoice) await speakServer(npcReply)
    else speakBrowser(npcReply)
  }

  // ---------- CSV export (UTF-8 BOM for Korean) ----------
  function downloadCSV() {
    const header = ['timestamp', 'user', 'npc']
    const rows = logs.map(r => [r.ts, csvEscape(r.user), csvEscape(r.npc)])
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]) // Excel-friendly UTF-8
    const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' })

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

  // ---------- UI ----------
  const ringSize = 110
  const pulse = Math.max(0, Math.min(1, rmsUI)) // clamp 0..1
  const glow = 8 + pulse * 18
  const scale = 1 + pulse * 0.12

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Inoculation NPC — Audio Roleplay</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Tap the mic, speak, and pause — it stops automatically. Max {Math.round(MAX_DURATION_MS/1000)}s per turn.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
        {/* Pulsing ring container */}
        <div
          style={{
            width: ringSize, height: ringSize, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            boxShadow: `0 0 ${glow}px ${Math.max(2, glow/4)}px rgba(15,98,254,0.5)`,
            transition: 'box-shadow 120ms linear, transform 120ms linear',
            transform: `scale(${scale})`,
            background: isRecording ? 'rgba(15,98,254,0.08)' : 'transparent'
          }}
        >
          {/* One-tap button */}
          <button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            style={{
              width: 84, height: 84, borderRadius: '50%',
              border: 'none',
              background: isRecording ? '#da1e28' : '#0f62fe',
              color: '#fff', fontSize: 18, cursor: 'pointer',
              boxShadow: '0 6px 16px rgba(0,0,0,0.15)'
            }}
            aria-pressed={isRecording}
          >
            {isRecording ? '듣는중' : '🎤'}
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={useServerVoice}
            onChange={e => setUseServerVoice(e.target.checked)}
          />
          Better voice (server TTS)
        </label>

        <button onClick={replayLast} style={btnSecondaryStyle} disabled={!npcReply}>
          Replay last reply
        </button>

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
        Tip: If auto-stop cuts off, speak continuously or tap again. You can also replay the last reply.
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
