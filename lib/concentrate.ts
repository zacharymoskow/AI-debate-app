/**
 * Single helper for talking to the Concentrate AI Responses API.
 *
 * Reads CONCENTRATE_API_KEY from the environment.
 */

const CONCENTRATE_URL = 'https://api.concentrate.ai/v1/responses';

interface ResponsesContentPart {
  text?: unknown;
  output_text?: unknown;
}

interface ResponsesOutputItem {
  type?: unknown;
  content?: unknown;
  text?: unknown;
}

interface ResponsesBody {
  output?: unknown;
  response?: { output?: unknown };
  choices?: Array<{ message?: { content?: unknown } }>;
  content?: unknown;
  text?: unknown;
}

function extractText(body: ResponsesBody): string {
  const choiceContent = body.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;

  const output = Array.isArray(body.output)
    ? body.output
    : Array.isArray(body.response?.output)
      ? body.response.output
      : [];

  const messageItem = output.find((item): item is ResponsesOutputItem => {
    return typeof item === 'object' && item !== null && (item as ResponsesOutputItem).type === 'message';
  });
  const target =
    messageItem || output.find((item): item is ResponsesOutputItem => typeof item === 'object' && item !== null);

  if (target?.content) {
    if (typeof target.content === 'string') return target.content;
    if (Array.isArray(target.content)) {
      const text = target.content
        .map((part: ResponsesContentPart) => {
          if (typeof part.text === 'string') return part.text;
          if (typeof part.output_text === 'string') return part.output_text;
          return '';
        })
        .filter(Boolean)
        .join('');
      if (text) return text;
    }
  }

  if (typeof target?.text === 'string') return target.text;
  if (typeof body.content === 'string') return body.content;
  if (typeof body.text === 'string') return body.text;

  return '';
}

export async function callConcentrateText({
  model,
  input,
  maxOutputTokens,
  timeoutMs = 45000,
}: {
  model: string;
  input: string;
  maxOutputTokens: number;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = process.env.CONCENTRATE_API_KEY;
  if (!apiKey) {
    throw new Error('CONCENTRATE_API_KEY is not set. Add it to your .env file.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(CONCENTRATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input,
        stream: false,
        temperature: 0.7,
        max_output_tokens: maxOutputTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[Concentrate] Request failed', {
        model,
        status: response.status,
        body: text.slice(0, 300),
      });
      throw new Error(`${model} could not respond. Try another model or a shorter prompt.`);
    }

    const body = (await response.json()) as ResponsesBody;
    return extractText(body).trim();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${model} took too long to respond. Try again or remove that model.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
