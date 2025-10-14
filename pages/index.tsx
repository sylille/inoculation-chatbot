// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'

type Role = 'user' | 'assistant' | 'system'
type Msg = { role: Role; content: string }
type TranscribeResp = { text: string }
type ChatResp = { text: string }

type LogRow = { ts: string; user: string; npc: string }

// UI-level chat item (for the chat window), optionally carries audio per turn
type ChatTurn = {
  role: Role
  content: string
  audioUrl?: string // user's recorded audio or assistant's TTS (server) per turn
  // (we keep url only; blobs are reconstructed via fetch on demand for zip)
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [inputText, setInputText] = useState('') // manual typing input
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      content:
        "You are 'Ari', an empathetic NPC trained to inoculate Korean elderly users against political manipulation techniques. You suggest roleplay with them to help them understand various manipulation techniques commonly used in political media. After each roleplay, refer specific instructions on how to avoid these manipulation on digital media. \n\nManipulation techniques:\n1. Trolling people, i.e., deliberately provoking people to react emotionally, thus evoking outrage.\n2. Exploiting emotional language, i.e., trying to make people afraid or angry about a particular topic.\n3. Artificially amplifying the reach and popularity of certain messages, for example through social media bots or by buying fake followers.\n4. Creating and spreading conspiracy theories, i.e., blaming a small, secretive and nefarious organization for events going on in the world.\n5. Polarizing audiences by deliberately emphasizing and magnifying inter-group differences.\n\nBehavior rules:\n In this experiment you must discuss with the elderly about the possible anipulation techniques digital media can do. Keep in mind these elders are not aware that algorithm can behave negatively. You do not scare them, but offer insights using inoculation techniques. then, offer a roleplay on a specific scenario, such as showing a headline that can be manipulative. Do not refer to real, specific, political events, but to a health or food related facts that is clearly false. \n1) For the sake of roleplay, you must act as the manipulator in a short scenario line. Make it clear before and afterward that this was roleplay.\n2) After roleplay, immediately step out of role and use Empathetic Refutational Interview (ERI):  \n   - Listen & validate feelings concisely.  \n   - Refute by naming the manipulation technique (e.g., trolling, conspiracy theory) and offer a one-sentence correction. \n   - Inoculate: give a one-sentence mental heuristic to spot it next time.  \n   - Action: suggest one small action the user can try now.\n3) Keep replies short (1–2 sentences). Always ask ONE clarifying question at the end."
    }
  ])

  // options / logs
  const [useServerVoice, setUseServerVoice] = useState<boolean>(true)
  const [logs, setLogs] = useState<LogRow[]>([])

  // Multi-turn chat items (UI)
  const [chat, setChat] = useState<ChatTurn[]>([])
  const chatEndRef = useRef<HTMLDivElement | null>(null)

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

  // Max duration cap (ms) — preserved from your original file :contentReference[oaicite:1]{index=1}
  const MAX_DURATION_MS = 30000

  // Shared audio element for immediate playback (we also keep per-turn URLs on the chat items)
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

  // auto-scroll chat to bottom on new items
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat])

  // ---------- Recording with adaptive silence + pulsing ring + max duration ----------
  async function startRecording() {
    try {
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
        if (blob.size > 0) await handleRecordedBlob(blob)
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

    // Hysteresis thresholds relative to ambient (preserved) :contentReference[oaicite:2]{index=2}
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

  // ---------- Voice path helpers ----------
  async function handleRecordedBlob(blob: Blob) {
    try {
      // 1) Transcribe
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')

      const tResp = await axios.post<TranscribeResp>('/api/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const text: string = String(tResp.data?.text ?? '').trim()
      const userAudioUrl = URL.createObjectURL(blob)

      // 2) Add user turn (voice) to UI + messages
      if (text) {
        addUserTurn(text, userAudioUrl)
      } else {
        addUserTurn('(no speech detected)', userAudioUrl)
      }

      // 3) Ask the model
      await requestAssistantReply(text || '(no speech detected)')
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error || err?.message || String(err)
      console.error(err)
      alert('Error sending audio: ' + serverMsg)
    }
  }

  function addUserTurn(text: string, audioUrl?: string) {
    setChat(prev => [...prev, { role: 'user', content: text, audioUrl }])
    const userMsg: Msg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
  }

  async function requestAssistantReply(latestUserText: string) {
    const newMessages = messages.concat({ role: 'user', content: latestUserText })
    try {
      const cResp = await axios.post<ChatResp>('/api/chat', { messages: newMessages })
      const reply: string = String(cResp.data?.text ?? '')
      await addAssistantTurn(reply)
      setLogs(prev => [...prev, { ts: new Date().toISOString(), user: latestUserText, npc: reply }])
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err: any) {
      console.error(err)
      alert('Error getting reply: ' + (err?.message || String(err)))
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
        window.speechSynthesis.speak(u)
      }
    } catch (e) {
      console.error('Browser TTS failed', e)
    }
  }

  // returns URL if server TTS succeeds (so we can keep it per turn)
  async function speakServer(text: string): Promise<string | undefined> {
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
      return url
    } catch (e) {
      console.error('Server TTS failed; fallback to browser', e)
      speakBrowser(text)
      return undefined
    }
  }

  async function addAssistantTurn(reply: string) {
    let assistantAudioUrl: string | undefined
    if (useServerVoice) {
      assistantAudioUrl = await speakServer(reply)
    } else {
      speakBrowser(reply)
    }
    setChat(prev => [...prev, { role: 'assistant', content: reply, audioUrl: assistantAudioUrl }])
  }

  // Replay last reply button
  async function replayLast() {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'assistant') {
        if (chat[i].audioUrl && audioPlayerRef.current) {
          audioPlayerRef.current.src = chat[i].audioUrl! // non-null after guard
          await audioPlayerRef.current.play()
        } else {
          if (useServerVoice) await speakServer(chat[i].content)
          else speakBrowser(chat[i].content)
        }
        break
      }
    }
  }

  // ---------- Text path ----------
  async function sendText() {
    const text = inputText.trim()
    if (!text) return
    setInputText('')
    addUserTurn(text) // no audio for typed messages
    await requestAssistantReply(text)
  }

  // ---------- CSV export (UTF-8 BOM for Korean) ----------
  function downloadCSV() {
    const header = ['timestamp', 'user', 'npc']
    const rows = logs.map(r => [r.ts, csvEscape(r.user), csvEscape(r.npc)])
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]) // Excel-friendly UTF-8
    const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8' })

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inoculation_npc_logs_${new Date().toISOString().slice(0, 10)}.csv`
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
    setMessages(prev => (prev.length ? [prev[0]] : []))
    setChat([])
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  // ---------- Recordings ZIP (new) ----------
  // On-demand loader for JSZip (UMD) from CDN; attaches window.JSZip
  async function ensureJSZip(): Promise<any> {
    const w = window as any
    if (w.JSZip) return w.JSZip
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load JSZip'))
      document.head.appendChild(s)
    })
    return (window as any).JSZip
  }

  async function downloadRecordingsZip() {
    try {
      // Gather turns that have audio
      const turnsWithAudio = chat
        .map((t, idx) => ({ ...t, idx }))
        .filter(t => !!t.audioUrl)

      if (turnsWithAudio.length === 0) {
        alert('No recordings to download yet.')
        return
      }

      const JSZip = await ensureJSZip()
      const zip = new JSZip()

      // Fetch each audio URL and add to zip
      for (const t of turnsWithAudio) {
        try {
          const url = t.audioUrl!                  // assert non-null after filter
          const res = await fetch(url)
          const blob = await res.blob()
          // Decide extension from MIME type (best effort)
          let ext = 'bin'
          if (blob.type.includes('webm')) ext = 'webm'
          else if (blob.type.includes('mpeg') || blob.type.includes('mp3')) ext = 'mp3'
          else if (blob.type.includes('wav')) ext = 'wav'
          const who = t.role === 'user' ? 'user' : 'assistant'
          const idxStr = String(t.idx + 1).padStart(3, '0')
          const base = `${idxStr}_${who}`
          zip.file(`${base}.${ext}`, blob)
          // Also save the text content as a sidecar .txt for convenience
          const textContent = `[${who}] ${t.content}\n`
          zip.file(`${base}.txt`, textContent)
        } catch (e) {
          console.warn('Failed to include one recording:', e)
        }
      }

      // Add a minimal conversation manifest for reference
      const manifest = chat
        .map((t, i) => {
          const who = t.role === 'user' ? 'user' : t.role === 'assistant' ? 'assistant' : 'system'
          return `${String(i + 1).padStart(3, '0')}  ${who}: ${t.content}`
        })
        .join('\n')
      zip.file('conversation_manifest.txt', manifest)

      const out = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = `inoculation_npc_recordings_${new Date().toISOString().slice(0,10)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      console.error(e)
      alert('Could not create ZIP: ' + (e?.message || String(e)))
    }
  }

  // ---------- UI ----------
  const ringSize = 110
  const pulse = Math.max(0, Math.min(1, rmsUI)) // clamp 0..1
  const glow = 8 + pulse * 18
  const scale = 1 + pulse * 0.12

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Inoculation NPC — Audio + Text Roleplay</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Tap the mic 🎤 or type below. Speak freely—auto-stop after a pause. Max {Math.round(MAX_DURATION_MS / 1000)}s per turn.
      </p>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
        {/* Pulsing ring container */}
        <div
          style={{
            width: ringSize,
            height: ringSize,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            boxShadow: `0 0 ${glow}px ${Math.max(2, glow / 4)}px rgba(15,98,254,0.5)`,
            transition: 'box-shadow 120ms linear, transform 120ms linear',
            transform: `scale(${scale})`,
            background: isRecording ? 'rgba(15,98,254,0.08)' : 'transparent'
          }}
        >
          {/* One-tap button */}
          <button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              border: 'none',
              background: isRecording ? '#da1e28' : '#0f62fe',
              color: '#fff',
              fontSize: 18,
              cursor: 'pointer',
              boxShadow: '0 6px 16px rgba(0,0,0,0.15)'
            }}
            aria-pressed={isRecording}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
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

        <button onClick={replayLast} style={btnSecondaryStyle} disabled={!chat.some(t => t.role === 'assistant')}>
          Replay last reply
        </button>

        <button onClick={resetConversation} style={btnSecondaryStyle}>Reset</button>
        <button onClick={downloadCSV} style={btnSecondaryStyle}>Download CSV</button>
        <button onClick={downloadRecordingsZip} style={btnSecondaryStyle}>Download recordings (.zip)</button>
      </div>

      {/* Chat window */}
      <section
        style={{
          border: '1px solid #e6e6e6',
          borderRadius: 12,
          padding: 12,
          height: 420,
          overflowY: 'auto',
          background: '#fafafa'
        }}
        aria-label="Conversation"
      >
        {chat.length === 0 && (
          <div style={{ color: '#777', textAlign: 'center', marginTop: 140 }}>
            Say something 🎤 or type a message to start.
          </div>
        )}
        {chat.map((turn, i) => {
          const isUser = turn.role === 'user'
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: isUser ? 'flex-end' : 'flex-start',
                marginBottom: 10
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '10px 12px',
                  borderRadius: 14,
                  whiteSpace: 'pre-wrap',
                  background: isUser ? '#0f62fe' : '#ffffff',
                  color: isUser ? 'white' : '#111',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                }}
              >
                <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 4 }}>
                  {isUser ? 'You' : 'NPC'}
                </div>
                <div style={{ fontSize: 15 }}>{turn.content}</div>
                {turn.audioUrl && (
                  <div style={{ marginTop: 8 }}>
                    {/* Non-null assertion after conditional ensures src is string */}
                    <audio controls src={turn.audioUrl!} style={{ width: '100%' }} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={chatEndRef} />
      </section>

      {/* Text input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Type your message..."
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') sendText()
          }}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 10,
            border: '1px solid #ccc',
            fontSize: 15,
            outline: 'none'
          }}
          aria-label="Type your message"
        />
        <button
          onClick={sendText}
          style={{ ...btnSecondaryStyle, background: '#0f62fe', color: 'white' }}
          aria-label="Send message"
        >
          Send
        </button>
      </div>

      <footer style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
        Tip: You can talk 🎤 or type 💬 anytime. Voice turns and NPC speech are saved per message.
      </footer>

      {/* Debug (optional) */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer' }}>Debug: raw messages</summary>
        <ol style={{ paddingLeft: 18 }}>
          {messages.map((m, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              <strong>{m.role}:</strong> {m.content}
            </li>
          ))}
        </ol>
      </details>
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
