export const runtime = 'edge';
export const preferredRegion = ['icn1', 'hnd1', 'sin1'];
export const dynamic = 'force-dynamic';

type Role = 'user' | 'assistant' | 'system';
type Msg = { role: Role; content: string };

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: Msg[] };
    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: 'messages[] required' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: 'OPENAI_API_KEY missing on server' }, { status: 500 });
    }

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Use a current model name from your account's Models page
        model: 'gpt-4o-realtime-preview',
        input: messages,
        stream: true
      })
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return new Response(text || 'Upstream error', { status: upstream.status });
    }

    const headers = new Headers(upstream.headers);
    headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    headers.set('Cache-Control', 'no-cache');
    headers.set('Connection', 'keep-alive');
    return new Response(upstream.body, { status: 200, headers });
  } catch (err: any) {
    return Response.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
