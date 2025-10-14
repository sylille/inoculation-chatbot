// pages/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'

type Role = 'user' | 'assistant' | 'system'
type Msg = { role: Role; content: string }
type TranscribeResp = { text: string }
type ChatResp = { text: string }

type LogRow = { ts: string; user: string; npc: string }

// UI-level chat item; we keep audioUrl for zipping/replay (not rendered as players)
type ChatTurn = {
  role: Role
  content: string
  audioUrl?: string
}

const VISIBLE = 100 // window the chat to last 100 turns for faster rendering

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [inputText, setInputText] = useState('')

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      content:
        "You are 'Ari', an empathetic NPC trained to inoculate Korean elderly users against political manipulation techniques. You suggest roleplay with them to help them understand various manipulation techniques commonly used in political media. After each roleplay, refer specific instructions on how to avoid these manipulation on digital media. You can offer to teach them how to reset social media's algorithm by giving specific instructions by platforms. \n\nManipulation techniques:\n1. Trolling people, i.e., deliberately provoking people to react emotionally, thus evoking outrage.\n2. Exploiting emotional language, i.e., trying to make people afraid or angry about a particular topic.\n3. Artificially amplifying the reach and popularity of certain messages, for example through social media bots or by buying fake followers.\n4. Creating and spreading conspiracy theories, i.e., blaming a small, secretive and nefarious organization for events going on in the world.\n5. Polarizing audiences by deliberately emphasizing and magnifying inter-group differences.\n\nBehavior rules:\n In this experiment you must discuss with the elderly about the possible anipulation techniques digital media can do. Keep in mind these elders are not aware that algorithm can behave negatively. You do not scare them, but offer insights using inoculation techniques. then, offer a roleplay on a specific scenario, such as showing a headline that can be manipulative. Do not refer to real, specific, political events, but to a health or food related facts that is clearly false. \n1) For the sake of roleplay, you must act as the manipulator in a short scenario line. Make it clear before and afterward that this was roleplay.\n2) After roleplay, immediately step out of role and use Empathetic Refutational Interview (ERI):  \n   - Listen & validate feelings concisely.  \n   - Refute by naming the manipulation technique (e.g., trolling, conspiracy theory) and offer a one-sentence correction. \n   - Inoculate: give a one-sentence mental heuristic to spot it next time.  \n   - Action: suggest one small action the user can try now.\n3) Keep replies short (1–2 sentences). Always ask ONE clarifying question at the end."
    }
  ])
      
  const [chat, setChat] = useState<ChatTurn[]>([])
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // options / logs
  const [useServerVoice, setUseServerVoice] = useState<boolean>(true)
  const [logs, setLogs] = useState<LogRow[]>([])

  // audio capture / detection
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const maxDurTimerRef = useRef<number | null>(null)

  // UI perf: set CSS var on the chat container instead of React state updates
  const chatSectionRef = useRef<HTMLElement | null>(null)

  // Max duration cap (ms) — preserved from original
  const MAX_DURATION_MS = 30000

  // Shared audio element for auto-play TTS & replay
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

  // ---------- Recording with adaptive silence + throttled UI + max duration ----------
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      // Audio graph (for silence detection)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512 // smaller FFT for lower cost
      source.connect(analyser)
      analyserRef.current = analyser

      // Collect audio in smaller chunks to reduce memory pressure
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        if (maxDurTimerRef.current) window.clearTimeout(maxDurTimerRef.current)
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
        // reset CSS var glow
        chatSectionRef.current?.style.setProperty('--recGlow', '0')

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (blob.size > 0) await handleRecordedBlob(blob)
      }

      // Start capture with timeslices (smaller, incremental chunks)
      mr.start(250) // 250ms slices
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

  async function calibrateSilence(analyser: AnalyserNode) {
    const data = new Float32Array(analyser.fftSize)
    const samples: number[] = []
    const start = performance.now()
    while (performance.now() - start < 600) {
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

    const startTalk = Math.max(ambient * 3, 0.02)
    const stopTalk  = Math.max(ambient * 1.5, 0.012)

    const MIN_SPEECH_MS = 400
    const MIN_SILENCE_MS = 1000

    let state: 'silent' | 'talking' = 'silent'
    let stateSince = performance.now()
    let lastUI = 0 // throttle UI to ~24fps

    const loop = (now: number) => {
      analyser.getFloatTimeDomainData(data)
      const rms = rmsFromFloat(data)

      // Throttled UI: set CSS var once ~every 42ms instead of React state
      if (now - lastUI > 42) {
        const glow = Math.min(1, rms * 6)
        chatSectionRef.current?.style.setProperty('--recGlow', String(glow))
        lastUI = now
      }

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

// above downloadRecordingsZip

async function loadJSZipFromCDN(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('JSZip is only available in the browser')
  }
  const w = window as any
  if (w.JSZip) return w.JSZip

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load JSZip from CDN'))
    document.head.appendChild(s)
  })
  return (window as any).JSZip
}

  // ---------- Voice path helpers ----------
  async function handleRecordedBlob(blob: Blob) {
    try {
      // 1) Transcribe (fetch + FormData)
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')

      const tResp = await fetch('/api/transcribe', { method: 'POST', body: form })
      if (!tResp.ok) throw new Error(await tResp.text())
      const tJson = (await tResp.json()) as TranscribeResp
      const text = String(tJson?.text ?? '').trim()
      const userAudioUrl = URL.createObjectURL(blob)

      // 2) Add user turn (voice)
      addUserTurn(text || '(no speech detected)', userAudioUrl)

      // 3) Ask the model
      await requestAssistantReply(text || '(no speech detected)')
    } catch (err: any) {
      console.error(err)
      alert('Error sending audio: ' + (err?.message || String(err)))
    }
  }

  function addUserTurn(text: string, audioUrl?: string) {
    setChat(prev => [...prev, { role: 'user', content: text, audioUrl }])
    setMessages(prev => [...prev, { role: 'user', content: text }])
  }

  async function requestAssistantReply(latestUserText: string) {
    const newMessages = messages.concat({ role: 'user', content: latestUserText })
    try {
      const cResp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages })
      })
      if (!cResp.ok) throw new Error(await cResp.text())
      const cJson = (await cResp.json()) as ChatResp
      const reply = String(cJson?.text ?? '')

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
        window.speechSynthesis.speak(u) // auto-plays
      }
    } catch (e) {
      console.error('Browser TTS failed', e)
    }
  }

  // returns URL if server TTS succeeds (kept for ZIP/replay); auto-plays
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
        await audioPlayerRef.current.play().catch(() => {/* autoplay can be blocked before first interaction */})
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
    if (useServerVoice) assistantAudioUrl = await speakServer(reply)
    else speakBrowser(reply)

    setChat(prev => [...prev, { role: 'assistant', content: reply, audioUrl: assistantAudioUrl }])
  }

  // Replay last reply (uses saved server TTS if available; else re-synth)
  async function replayLast() {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'assistant') {
        if (chat[i].audioUrl && audioPlayerRef.current) {
          audioPlayerRef.current.src = chat[i].audioUrl!
          await audioPlayerRef.current.play().catch(() => {})
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
    addUserTurn(text)
    await requestAssistantReply(text)
  }

  // ---------- CSV export (UTF-8 BOM for Korean) ----------
  function downloadCSV() {
    const header = ['timestamp', 'user', 'npc']
    const rows = logs.map(r => [r.ts, csvEscape(r.user), csvEscape(r.npc)])
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n')

    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
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

  // ---------- Recordings ZIP (dynamic import for smaller initial bundle) ----------
async function downloadRecordingsZip() {
  try {
    const turnsWithAudio = chat
      .map((t, idx) => ({ ...t, idx }))
      .filter(t => !!t.audioUrl)

    if (turnsWithAudio.length === 0) {
      alert('No recordings to download yet.')
      return
    }

    // ⬇️ no build-time dependency, loads at runtime in the browser
    const JSZip = await loadJSZipFromCDN()
    const zip = new JSZip()

    for (const t of turnsWithAudio) {
      try {
        const url = t.audioUrl!
        const res = await fetch(url)
        const blob = await res.blob()
        let ext = 'bin'
        if (blob.type.includes('webm')) ext = 'webm'
        else if (blob.type.includes('mpeg') || blob.type.includes('mp3')) ext = 'mp3'
        else if (blob.type.includes('wav')) ext = 'wav'
        const who = t.role === 'user' ? 'user' : 'assistant'
        const idxStr = String(t.idx + 1).padStart(3, '0')
        const base = `${idxStr}_${who}`
        zip.file(`${base}.${ext}`, blob)
        zip.file(`${base}.txt`, `[${who}] ${t.content}\n`)
      } catch (e) {
        console.warn('Failed to include one recording:', e)
      }
    }

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
  const viewChat = useMemo(
    () => (chat.length > VISIBLE ? chat.slice(-VISIBLE) : chat),
    [chat]
  )

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Inoculation NPC — Audio + Text Roleplay</h1>
      <p style={{ color: '#555', marginBottom: 12 }}>
        Click the chat area to speak (auto-stop on pause), or type below to send a message.
      </p>

      {/* Chat window (click to toggle recording) */}
      <section
        ref={(el) => { chatSectionRef.current = el }}
        onClick={() => (isRecording ? stopRecording() : startRecording())}
        title={isRecording ? '녹음을 멈추려면 눌러주세요' : '녹음을 시작하려면 눌러주세요'}
        style={{
          border: `1px solid ${isRecording ? '#0f62fe' : '#e6e6e6'}`,
          boxShadow: `0 0 calc(var(--recGlow,0) * 18px) rgba(15,98,254,0.35)`,
          borderRadius: 12,
          padding: 12,
          height: 460,
          overflowY: 'auto',
          background: '#fafafa',
          cursor: 'pointer',
          userSelect: 'none'
        }}
        aria-label="Conversation (click to talk)"
        role="button"
      >
        {viewChat.length === 0 && (
          <div style={{ color: '#777', textAlign: 'center', marginTop: 160 }}>
            Click here to talk 🎤 or type below.
          </div>
        )}
        {viewChat.map((turn, i) => (
          <Bubble key={`${turn.role}-${i}`} turn={turn} />
        ))}
        <div ref={chatEndRef} />
        {/* Recording indicator */}
        {isRecording && (
          <div
            aria-live="polite"
            style={{
              position: 'sticky',
              bottom: 8,
              left: 0,
              right: 0,
              margin: '8px auto 0',
              width: 'fit-content',
              padding: '6px 10px',
              borderRadius: 999,
              background: '#0f62fe',
              color: 'white',
              fontSize: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
            }}
          >
            Recording… click to stop
          </div>
        )}
      </section>

      {/* Text input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="메세지를 입력하세요..."
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
          } as React.CSSProperties}
          aria-label="Type your message"
        />
        <button
          onClick={sendText}
          style={{ padding: '10px 12px', background: '#0f62fe', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          aria-label="메세지 보내기"
        >
          Send
        </button>
      </div>

      {/* Bottom toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
        <button onClick={replayLast} style={btnSecondaryStyle} disabled={!chat.some(t => t.role === 'assistant')}>
          지난 답변 다시 듣기
        </button>
        <button onClick={downloadCSV} style={btnSecondaryStyle}>CSV 다운로드</button>
        <button onClick={downloadRecordingsZip} style={btnSecondaryStyle}>녹음 다운로드
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', fontSize: 14 }}>
          <input
            type="checkbox"
            checked={useServerVoice}
            onChange={e => setUseServerVoice(e.target.checked)}
          />
          Better voice (server TTS)
        </label>
        <button onClick={resetConversation} style={btnSecondaryStyle}>재설정</button>
      </div>

      <footer style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
        참조: 에이전트 음성은 자동 재생 됩니다. 모든 오디오는 다운로드를 위해 저장됩니다.
      </footer>
    </main>
  )
}

// Memoized chat bubble to avoid unnecessary re-renders
const Bubble = React.memo(function Bubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user'
  return (
    <div
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
        {/* No per-turn audio players (kept lightweight) */}
      </div>
    </div>
  )
})

const btnSecondaryStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: '#e0e0e0',
  color: '#111',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer'
}
