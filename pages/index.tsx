// pages/index.tsx
import React, { useState, useRef } from 'react'
import axios from 'axios'

type Msg = { role: 'user' | 'assistant' | 'system'; content: string }

export default function Home() {
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [npcReply, setNpcReply] = useState('')
  const [messages, setMessages] = useState<Msg[]>([{
    role: 'system',
    content: `You are "Aegis", an empathetic NPC whose role is to run brief inoculation roleplay exercises against political manipulation techniques. 
Be balanced, non-partisan, use the Empathetic Refutational Interview (ERI) style: listen, validate feelings, gently refute manipulative claims using simple reasoning, ask one question, and suggest one micro-action the user can test. Keep responses short (1-2 paragraphs).`
  }])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function startRecording() {
    setTranscript('')
    setNpcReply('')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream)
    mediaRecorderRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      await sendAudio(blob)
    }
    mr.start()
    setRecording(true)
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') {
      mr.stop()
      setRecording(false)
    }
  }

  async function sendAudio(blob: Blob) {
    try {
      const form = new FormData()
      form.append('audio', blob, 'voice.webm')
      const tResp = await axios.post('/api/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      const text = tResp.data.text || ''
      setTranscript(text)

      // append user message
      const newMessages = [...messages, { role: 'user', content: text }]
      setMessages(newMessages)

      // call chat
      const cResp = await axios.post('/api/chat', { messages: newMessages })
      const reply = cResp.data.text || ''
      setNpcReply(reply)

      // append assistant message to conversation for future turns
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Speak reply using browser TTS (fallback, cross-platform)
      speakText(reply)
    } catch (err) {
      console.error(err)
      alert('Error sending audio: ' + String(err))
    }
  }

  function speakText(text: string) {
    if (!text) return
    // Use Web Speech API for TTS (simple & no server cost)
    if ('speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text)
      utter.rate = 1.0
      utter.pitch = 1.0
      // set voice if you want: window.speechSynthesis.getVoices()
      window.speechSynthesis.speak(utter)
    } else {
      // fallback: just show text
      console.warn('No speechSynthesis available')
    }
  }

  // quick reset conversation but keep system
  function resetConversation() {
    setMessages([messages[0]])
    setTranscript('')
    setNpcReply('')
    window.speechSynthesis.cancel()
  }

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, Arial' }}>
      <h1>Inoculation NPC — Audio Roleplay</h1>
      <p>Press and speak to roleplay with the NPC. The NPC will listen, respond in ERI (empathetic refutation) style, and speak the reply.</p>

      <div style={{ margin: '16px 0' }}>
        {!recording ? (
          <button onClick={startRecording} style={{ padding: '10px 16px' }}>Start Recording 🎙️</button>
        ) : (
          <button onClick={stopRecording} style={{ padding: '10px 16px' }}>Stop Recording ⏹</button>
        )}
        <button onClick={resetConversation} style={{ marginLeft: 12 }}>Reset</button>
      </div>

      <section>
        <h3>Your transcript</h3>
        <div style={{ minHeight: 64, border: '1px solid #ddd', padding: 8 }}>{transcript || <em>— nothing yet —</em>}</div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h3>NPC reply</h3>
        <div style={{ minHeight: 100, border: '1px solid #ddd', padding: 8, whiteSpace: 'pre-wrap' }}>
          {npcReply || <em>NPC will reply here</em>}
        </div>
      </section>

      <section style={{ marginTop: 12 }}>
        <h4>Conversation (debug)</h4>
        <ol>
          {messages.map((m, i) => <li key={i}><strong>{m.role}:</strong> {m.content}</li>)}
        </ol>
      </section>
    </main>
  )
}
