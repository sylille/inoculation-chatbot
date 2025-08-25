'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string }

type SSEEvent = { type?: string; delta?: string; error?: { message?: string } }

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: '안녕하세요! 🎙️ Speak or type to chat.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  // ------- Speech Recognition -------
  const [isRecording, setIsRecording] = useState(false)
  const [recLang, setRecLang] = useState('auto')
  const recognitionRef = useRef<any>(null)

  const getRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SR) return null
    if (!recognitionRef.current) {
      const r = new SR()
      r.continuous = false
      r.interimResults = true
      r.maxAlternatives = 1
      recognitionRef.current = r
    }
    return recognitionRef.current
  }, [])

  const startRec = useCallback(() => {
    const r = getRecognition()
    if (!r) { alert('SpeechRecognition not supported. Try Chrome/Edge desktop or Android Chrome.'); return }
    if (isRecording) return
    try {
      r.onresult = (e: any) => {
        let finalText = '', interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]
          if (res.isFinal) finalText += res[0].transcript
          else interim += res[0].transcript
        }
        setInput(prev => (finalText ? finalText : interim || prev))
      }
      r.onend = () => setIsRecording(false)
      r.onerror = () => setIsRecording(false)
      r.lang = recLang === 'auto' ? (navigator.language || 'en-US') : recLang
      r.start()
      setIsRecording(true)
    } catch { setIsRecording(false) }
  }, [getRecognition, isRecording, recLang])

  const stopRec = useCallback(() => {
    const r = getRecognition()
    try { r?.stop?.() } catch {}
    setIsRecording(false)
  }, [getRecognition])

  // ------- Speech Synthesis -------
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoiceURI] = useState<string>('')
  const [speakReplies, setSpeakReplies] = useState(true)
  const [rate, setRate] = useState(1)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setVoices(window.speechSynthesis.getVoices())
    update()
    window.speechSynthesis.onvoiceschanged = update
  }, [])

  const voice = useMemo(() => voices.find(v => v.voiceURI === voiceURI) || null, [voiceURI, voices])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined') return
    const ssu = new SpeechSynthesisUtterance(text)
    if (voice) ssu.voice = voice
    ssu.rate = rate
    try { window.speechSynthesis.cancel() } catch {}
    window.speechSynthesis.speak(ssu)
  }, [voice, rate])

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined') return
    try { window.speechSynthesis.cancel() } catch {}
  }, [])

  // ------- SSE Chat -------
  const abortRef = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    const user: Msg = { role: 'user', content: text }
    setMessages(prev => [...prev, user, { role: 'assistant', content: '…' }])

    setLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const history = [...messages, user]
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal
      })
      if (!resp.ok || !resp.body) throw new Error(`Request failed: ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)

          for (const line of frame.split('\n')) {
            const s = line.trim()
            if (!s.startsWith('data:')) continue
            const json = s.slice(5).trim()
            if (!json || json === '[DONE]') continue
            try {
              const evt = JSON.parse(json) as SSEEvent
              if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
                acc += evt.delta
                setMessages(prev => {
                  const out = [...prev]
                  out[out.length - 1] = { role: 'assistant', content: acc }
                  return out
                })
              } else if (evt.type === 'response.refusal.delta' && typeof evt.delta === 'string') {
                acc += evt.delta
                setMessages(prev => {
                  const out = [...prev]
                  out[out.length - 1] = { role: 'assistant', content: acc }
                  return out
                })
              } else if (evt.type === 'response.error') {
                throw new Error(evt.error?.message || 'LLM error')
              }
            } catch {}
          }
        }
      }

      setMessages(prev => {
        const out = [...prev]
        out[out.length - 1] = { role: 'assistant', content: acc || '(no output)' }
        return out
      })

      if (speakReplies && acc) speak(acc)
    } catch (err: any) {
      stopSpeaking()
      setMessages(prev => {
        const out = [...prev]
        out[out.length - 1] = { role: 'assistant', content: `Error: ${err?.message || 'stream aborted'}` }
        return out
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  // push-to-talk with Space
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.code === 'Space' && !isRecording && !loading) startRec() }
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space' && isRecording) stopRec() }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [isRecording, loading, startRec, stopRec])

  const langOptions = [
    { code: 'auto', label: 'Auto' },
    { code: 'ko-KR', label: '한국어' },
    { code: 'en-US', label: 'English (US)' }
  ]

  return (
    <div className="min-h-svh grid grid-rows-[auto,1fr,auto]">
      <header className="border-b px-4 py-3 flex items-center gap-3 bg-white text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white font-semibold">AI</span>
        <h1 className="font-semibold">Voice + Chat</h1>
        {loading && <span className="ml-auto text-sm text-gray-500">Streaming…</span>}
      </header>

      <main ref={chatRef} className="px-4 py-4 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        <div className="mx-auto max-w-2xl">
          {messages.map((m, i) => (
            <div key={i} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`whitespace-pre-wrap leading-relaxed rounded-2xl px-4 py-2 max-w-[90%] shadow-sm ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-900 border dark:bg-neutral-900 dark:text-slate-100 dark:border-neutral-800'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
        </div>
      </main>

      <form onSubmit={handleSend} className="border-t px-4 py-3 bg-white dark:bg-neutral-950 dark:border-neutral-800">
        <div className="mx-auto max-w-2xl flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (isRecording ? stopRec() : startRec())}
              className={`rounded-xl px-4 py-2 border ${isRecording ? 'bg-red-600 text-white' : 'bg-black text-white'}`}
              title="Space to hold-to-talk"
            >
              {isRecording ? 'Stop' : '🎤  Talk'}
            </button>

            <select
              value={recLang}
              onChange={(e) => setRecLang(e.target.value)}
              className="rounded-lg border px-3 py-2"
              title="Recognition language"
            >
              {langOptions.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>

            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={speakReplies} onChange={(e) => setSpeakReplies(e.target.checked)} />
                Speak replies
              </label>
              <select
                value={voiceURI}
                onChange={(e) => setVoiceURI(e.target.value)}
                className="rounded-lg border px-2 py-2 text-sm"
                title="TTS voice"
              >
                <option value="">System Default Voice</option>
                {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                Rate
                <input type="range" min={0.8} max={1.4} step={0.05} value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} />
              </label>
              <button type="button" onClick={stopSpeaking} className="rounded-xl px-3 py-2 border">⏹ Stop voice</button>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? 'Please wait…' : 'Type a message (Shift+Enter = newline)'}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[56px]
                         bg-white text-slate-900 placeholder:text-slate-500
                         dark:bg-neutral-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:border-neutral-800"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl px-4 py-3 border bg-black text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
