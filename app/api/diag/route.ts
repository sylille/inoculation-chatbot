export const runtime = 'edge';
export const dynamic = 'force-dynamic';   // <-- force runtime evaluation
export const revalidate = 0;              // <-- disable ISR/static caching

export async function GET() {
  const hasKey = !!process.env.OPENAI_API_KEY;
  const env = process.env.VERCEL_ENV || 'local';
  const region = process.env.VERCEL_REGION || 'unknown';

  return new Response(JSON.stringify({
    ok: true,
    hasKey,
    env,
    region,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',        // <-- prevent any cache layer
    },
  });
}
