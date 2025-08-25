export const runtime = 'edge';
export const preferredRegion = ['icn1', 'hnd1', 'sin1'];
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ ok: false, error: 'OPENAI_API_KEY missing' }, { status: 500 });
  }
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: [{ role: 'user', content: 'pong' }]
    })
  });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
