// pages/index.tsx
import React, { useRef, useState } from 'react'
import axios from 'axios'

type Role = 'user' | 'assistant' | 'system'
type Msg = { role: Role; content: string }

type TranscribeResp = { text: string }
type ChatResp = { text: string }

export default function Home() {
  const [recording, setRecording] = useState<boolean>(false)
  const [transcript, setTranscript] = useState<string>('')
  const [npcReply, setNpcReply] = useState<string>('')
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      content:
        `You are "Aegis", an empathetic NPC trained to inoculate users against political manipulation techniques.
Behavior rules:
1) Nonpartisan, neutral tone. Never take a political side.
2) Use Empathetic Refutational Interview (ERI):
   - Listen & validate: reflect the user's feeling.
   - Refute: briefly explain the manipulation technique (e.g., emotional framing, false cause, cherry-picking, ad hominem) and provide a concise correction or alternative view.
   - Inoculate: one-sentence definition of the tactic + a simple mental heuristic to spot it.
   - Action: suggest one micro-action the user can try now (pause, check source, ask 2 questions).
3) Keep replies short (1–2 paragraphs). Ask one clarifying question to continue the roleplay.
4) If user mentions political claims, focus on the persuasive technique rather than debating facts.
5) Use plain, respectful language suitable for older adults; avoid jargon.`
    }
  ])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  async function startRecording() {
    try {
      setTranscript('')
      setNpcReply('')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        await sendAudio(blob)
        // stop all tracks to release mic permission light
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }

      mr.start()
      setRecording(true)
    } catch (err) {
      console.error(err)
      alert('Could not start recording. Check microphone permissions.')
    }
  }

  function stopRecording() {
    try {
      const mr = mediaRecorderRef.current
      if (mr && mr.state !== 'inactive') {
        mr.stop()
      }
      setRecording(false)
    } catch (err) {
      console.error(err)
    }
  }

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

      const assistantMsg: Msg = { role: 'assistant', content: reply }
      setMessages(prev => [...prev, assistantMsg])

      speakText(reply)
    } catch (err: any) {
  console.error(err)
  const serverMsg = err?.response?.data?.error || err?.message || String(err)
  alert('Error sending audio: ' + serverMsg)
}
  }

  function speakText(text: string) {
    if (!text) return
    try {
      if ('speechSynthesis' in window) {
        // Cancel any ongoing speech first
        window.speechSynthesis.cancel()
        const utter = new SpeechSynthesisUtterance(text)
        utter.rate = 1.0
        utter.pitch = 1.0
        // Optional: choose a voice (varies by OS/Browser)
        // const voices = window.speechSynthesis.getVoices()
        // utter.voice = voices.find(v => v.lang.startsWith('ko')) ?? voices[0]
        window.speechSynthesis.speak(utter)
      } else {
        console.warn('speechSynthesis not supported in this browser.')
      }
    } catch (err) {
      console.error('TTS error:', err)
    }
  }

  function resetConversation() {
    try {
      setMessages(prev => prev.length ? [prev[0]] : [])
      setTranscript('')
      setNpcReply('')
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial, sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 8 }}>Inoculation NPC — Audio Roleplay</h1>
      <p style={{ color: '#555', marginBottom: 16 }}>
        Press and speak to roleplay with the NPC. The NPC listens, responds in ERI style, and speaks the reply.
      </p>

      <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
        {!recording ? (
          <button onClick={startRecording} style={btnStyle}>Start Recording 🎙️</button>
        ) : (
          <button onClick={stopRecording} style={btnStopStyle}>Stop Recording ⏹</button>
        )}
        <button onClick={resetConversation} style={btnSecondaryStyle}>Reset</button>
      </div>

      <section style={{ marginTop: 8 }}>
        <h3>Your transcript</h3>
        <div style={boxStyle}>
          {transcript ? transcript : <em>— nothing yet —</em>}
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
        Tip: If TTS doesn’t speak, check your browser’s autoplay/sound settings. Some browsers require a user gesture first.
      </footer>
    </main>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: '#0f62fe',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer'
}

const btnStopStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#da1e28'
}

const btnSecondaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#e0e0e0',
  color: '#111'
}

const boxStyle: React.CSSProperties = {
  minHeight: 64,
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 10,
  background: '#fafafa'
}
