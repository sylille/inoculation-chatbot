// lib/openaiHeaders.ts
export function openAIHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
  }
  if (json) h['Content-Type'] = 'application/json'
  if (process.env.OPENAI_ORG) h['OpenAI-Organization'] = process.env.OPENAI_ORG!
  if (process.env.OPENAI_PROJECT) h['OpenAI-Project'] = process.env.OPENAI_PROJECT!
  return h
}