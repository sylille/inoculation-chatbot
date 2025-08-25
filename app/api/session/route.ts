export const runtime = 'edge';
export const preferredRegion = ['icn1','hnd1','sin1'];
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

async function createSession(overrides?: Record<string, unknown>) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ ok: false, error: 'OPENAI_API_KEY missing' }, { status: 500, headers: CORS });
    }

    const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';

    const payload = {
      model,
      modalities: ['audio', 'text'],
      instructions: 'You are a friendly assistant.',
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: null,
      temperature: 0.7,
      max_response_output_tokens: 200,
      ...(overrides || {}),
    };

    const upstream = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    // Try to parse JSON; if not JSON, expose the first part of the body for debugging
    let data: any;
    try { data = JSON.parse(text); } catch { data = { nonJsonBody: text.slice(0, 500) }; }

    const token = data?.client_secret?.value ?? null;
    const expires_at = data?.client_secret?.expires_at ?? null;

    if (!upstream.ok || !token) {
      // Normalize error shape so the client can show a useful message
      const message =
        data?.error?.message ||
        data?.nonJsonBody ||
        `Upstream status ${upstream.status}`;
      return Response.json(
        { ok: false, status: upstream.status, error: message, raw: data },
        { status: upstream.status, headers: CORS }
      );
    }

    // Success: return a clean shape the client can rely on
    return Response.json(
      {
        ok: true,
        token,
        expires_at,
        model: data?.model || model,
        session_id: data?.id || null,
      },
      { status: 200, headers: CORS }
    );
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || 'Server error' }, { status: 500, headers: CORS });
  }
}

export async function GET() {
  return createSession();
}

export async function POST(req: Request) {
  let overrides = {};
  try { overrides = await req.json(); } catch {}
  return createSession(overrides);
}
