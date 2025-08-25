'use client'

import { useRef, useState } from 'react'

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string }

export default function Page() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: '안녕하세요! 🎙️ Voice/Text via Realtime. Press Talk or type.' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('idle')

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const accRef = useRef<string>('') // accumulate assistant text
  const connectPromiseRef = useRef<Promise<void> | null>(null)

  function waitForIce(pc: RTCPeerConnection, timeoutMs = 8000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), timeoutMs)
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve() }
      })
    })
  }

  function waitForDCOpen(dc: RTCDataChannel, timeoutMs = 15000) {
    if (dc.readyState === 'open') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Data channel open timeout')), timeoutMs)
      const onOpen = () => { clearTimeout(t); cleanup(); resolve() }
      const onClose = () => { clearTimeout(t); cleanup(); reject(new Error('Data channel closed')) }
      const cleanup = () => { dc.removeEventListener('open', onOpen); dc.removeEventListener('close', onClose) }
      dc.addEventListener('open', onOpen); dc.addEventListener('close', onClose)
    })
  }

  async function ensureRealtime() {
    if (pcRef.current && dcRef.current?.readyState === 'open') return
    if (connectPromiseRef.current) return connectPromiseRef.current

    connectPromiseRef.current = (async () => {
      setStatus('session')

      // 1) Fetch ephemeral session (MUST return { ok:true, token, model })
      const res = await fetch('/api/session')
      const bodyText = await res.text()
      let sess: any
      try { sess = JSON.parse(bodyText) } catch {
        throw new Error(`Expected JSON from /api/session; got: ${bodyText.slice(0,200)}`)
      }
      if (!res.ok || !sess?.ok) {
        throw new Error(`Session error (${res.status}): ${sess?.error || bodyText.slice(0,200)}`)
      }
      const token: string | undefined = sess.token
      const model = encodeURIComponent(sess.model || 'gpt-4o-realtime-preview')
      if (!token) throw new Error('Missing ephemeral token in /api/session response')

      // 2) Create RTCPeerConnection + data channel
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
      pcRef.current = pc
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.onopen = () => console.log('RTC data channel open')
      dc.onclose = () => console.log('RTC data channel closed')

      // Play remote audio
      pc.ontrack = (e) => {
        const a = document.getElementById('remoteAudio') as HTMLAudioElement
        if (a) { a.srcObject = e.streams[0]; a.play().catch(() => {/* user gesture will trigger later */}) }
      }

      // Status
      pc.oniceconnectionstatechange = () => setStatus(pc.iceConnectionState)

      // Receive model events (handle both text delta event names)
      dc.onmessage = (ev) => {
        try {
          const evt = JSON.parse(ev.data)
          // text delta variants
          if ((evt.type === 'response.text.delta' || evt.type === 'response.output_text.delta') && typeof evt.delta === 'string') {
            accRef.current += evt.delta
            setMessages(prev => {
              const out = [...prev]
              if (out[out.length - 1]?.role !== 'assistant') out.push({ role: 'assistant', content: '' })
              out[out.length - 1] = { role: 'assistant', content: accRef.current }
              return out
            })
          } else if (evt.type === 'response.done' || evt.type === 'response.completed') {
            accRef.current = ''
          } else if (evt.type === 'response.error') {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${evt.error?.message || 'unknown'}` }])
          }
        } catch {
          // ignore non-JSON keepalives
        }
      }

      // 3) Optional mic
      try {
        const local = await navigator.mediaDevices.getUserMedia({ audio: true })
        pc.addTrack(local.getTracks()[0])
      } catch (e) {
        console.warn('Mic not available; continuing text-only.', e)
      }

      // 4) Offer/Answer (wait for ICE so SDP includes candidates)
      setStatus('creating-offer')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      setStatus('gathering-ice')
      await waitForIce(pc)

      setStatus('sdp-post')
      const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: pc.localDescription?.sdp || offer.sdp,
      })
      const answerSdp = await sdpResp.text()
      if (!sdpResp.ok) throw new Error(`SDP exchange failed (${sdpResp.status}): ${answerSdp.slice(0,300)}`)
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // 5) Wait for DC open before returning
      setStatus('opening-dc')
      await waitForDCOpen(dc)
      setStatus('connected')
    })()

    try { await connectPromiseRef.current } finally { connectPromiseRef.current = null }
  }

  // ✅ Correct Realtime flow: add a user item, then ask for a response
  function sendRealtimeText(text: string) {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') throw new Error('Realtime not connected')

    // Add the user's message to the default conversation
    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    }))

    // Trigger the model to respond (uses session defaults; returns audio+text)
    dc.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text']
        // You can also specify: instructions: "..." or conversation: "none"
      }
    }))
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])

    try {
      setLoading(true)
      await ensureRealtime()      // waits until DC is open
      sendRealtimeText(text)      // safe to send now
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err?.message || 'failed to send'}` }])
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-svh grid grid-rows-[auto,1fr,auto]">
      <header className="border-b px-4 py-3 flex items-center gap-3 bg-white text-slate-900 dark:bg-neutral-950 dark:text-slate-100">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white font-semibold">AI</span>
        <h1 className="font-semibold">Realtime Voice + Chat</h1>
        <span className="ml-auto text-sm text-gray-500">{loading ? 'Connecting…' : status}</span>
      </header>

      <main className="px-4 py-4 overflow-auto bg-neutral-50 dark:bg-neutral-900">
        <audio id="remoteAudio" autoPlay playsInline />
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
        <div className="mx-auto max-w-2xl flex items-end gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-xl border p-3 bg-white text-slate-900 dark:bg-neutral-900 dark:text-slate-100"
          />
          <button type="submit" className="rounded-xl px-4 py-3 border bg-black text-white">Send</button>
          <button
            type="button"
            onClick={() => ensureRealtime()}
            className="rounded-xl px-4 py-3 border"
            title="Connect mic + realtime"
          >
            🎤 Talk
          </button>
        </div>
      </form>
    </div>
  )
}
