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

  // Realtime state
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const accRef = useRef<string>('') // accumulate assistant text for current turn
  const connectPromiseRef = useRef<Promise<void> | null>(null)

  // --- helpers ---------------------------------------------------------------

  function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 8000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), timeoutMs) // don't fail hard; proceed
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer)
          resolve()
        }
      })
    })
  }

  function waitForDataChannelOpen(dc: RTCDataChannel, timeoutMs = 15000) {
    if (dc.readyState === 'open') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Data channel open timeout')), timeoutMs)
      const onOpen = () => { clearTimeout(timer); cleanup(); resolve() }
      const onClose = () => { clearTimeout(timer); cleanup(); reject(new Error('Data channel closed')) }
      const cleanup = () => {
        dc.removeEventListener('open', onOpen)
        dc.removeEventListener('close', onClose)
      }
      dc.addEventListener('open', onOpen)
      dc.addEventListener('close', onClose)
    })
  }

  // --- main connect flow -----------------------------------------------------

  async function ensureRealtime() {
    // Already open?
    if (pcRef.current && dcRef.current?.readyState === 'open') return

    // In-flight connect? await it
    if (connectPromiseRef.current) return connectPromiseRef.current

    connectPromiseRef.current = (async () => {
      setStatus('starting')

      // 1) Get a session + ephemeral token (robust JSON handling)
      const res = await fetch('/api/session') // or '/api/realtime/session' if that's your path
      const bodyText = await res.text()
      let sess: any
      try { sess = JSON.parse(bodyText) } catch {
        throw new Error(`Expected JSON from /api/session; got: ${bodyText.slice(0, 200)}`)
      }
      if (!res.ok || !sess?.ok) {
        throw new Error(`Session error (${res.status}): ${sess?.error || bodyText.slice(0, 200)}`)
      }
      const token: string | undefined = sess.token
      const model = encodeURIComponent(sess.model || 'gpt-4o-realtime-preview')
      if (!token) throw new Error('Missing ephemeral token in /api/session response')

      // 2) Create PC and data channel
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.onopen = () => console.log('RTC data channel open')
      dc.onclose = () => console.log('RTC data channel closed')

      // remote audio
      pc.ontrack = (e) => {
        const a = document.getElementById('remoteAudio') as HTMLAudioElement
        if (a) a.srcObject = e.streams[0]
      }

      // helpful logs
      pc.oniceconnectionstatechange = () => {
        console.log('iceConnectionState:', pc.iceConnectionState)
        setStatus(pc.iceConnectionState)
      }

      // Receive model events and stream text
      dc.onmessage = (ev) => {
        try {
          const evt = JSON.parse(ev.data)
          if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
            accRef.current += evt.delta
            setMessages(prev => {
              const out = [...prev]
              if (out[out.length - 1]?.role !== 'assistant') out.push({ role: 'assistant', content: '' })
              out[out.length - 1] = { role: 'assistant', content: accRef.current }
              return out
            })
          } else if (evt.type === 'response.completed') {
            accRef.current = ''
          } else if (evt.type === 'response.error') {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${evt.error?.message || 'unknown'}` }])
          }
        } catch {
          // non-JSON keepalives or other payloads
        }
      }

      // 3) Mic → PC (optional: text-only still works)
      try {
        const local = await navigator.mediaDevices.getUserMedia({ audio: true })
        pc.addTrack(local.getTracks()[0])
      } catch (e) {
        console.warn('Mic not available; continuing with text only.', e)
      }

      // 4) WebRTC offer/answer with OpenAI Realtime
      setStatus('creating-offer')
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Wait for ICE gathering so the SDP we send includes all candidates
      setStatus('gathering-ice')
      await waitForIceGatheringComplete(pc)

      setStatus('posting-sdp')
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
      if (!sdpResp.ok) {
        throw new Error(`SDP exchange failed (${sdpResp.status}): ${answerSdp.slice(0, 300)}`)
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      // 5) Wait for data channel to be OPEN before returning
      setStatus('opening-datachannel')
      await waitForDataChannelOpen(dc)

      setStatus('connected')
    })()
    try {
      await connectPromiseRef.current
    } finally {
      connectPromiseRef.current = null
    }
  }

  function sendRealtimeText(text: string) {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') throw new Error('Realtime not connected')
    dc.send(JSON.stringify({
      type: 'response.create',
      response: {
        input: [{ role: 'user', content: text }],
        modalities: ['audio', 'text'],
      },
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
      await ensureRealtime()          // waits for DC to be open
      sendRealtimeText(text)          // now safe to send
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
        <audio id="remoteAudio" autoPlay />
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
