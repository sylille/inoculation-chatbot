export const runtime = 'edge';
export const preferredRegion = ['icn1','hnd1','sin1'];
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY missing' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';

  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1',
    },
    body: JSON.stringify({
      model,
      modalities: ['audio','text'],
      instructions: 'You are a friendly assistant.',
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: null,
      temperature: 0.7,
      max_response_output_tokens: 200,
    }),
  });

  const text = await r.text();
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
