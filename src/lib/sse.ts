/**
 * Minimal Server-Sent Events parser (text/event-stream), pure and transport-
 * agnostic so it can be unit-tested without a network.
 *
 * React Native ships no EventSource, and its `fetch` gives no readable body
 * stream, so the transport is XHR (see api/mbtaStream.ts) which hands us raw
 * text as it arrives. Chunk boundaries are arbitrary — a single event can be
 * split mid-field, and several events can land in one chunk — so the parser
 * keeps a buffer and only emits on a complete blank-line terminator.
 *
 * We implement only what the MBTA feed uses: `event:` and (possibly repeated)
 * `data:` lines. Per the SSE spec, repeated data lines join with "\n", a
 * leading space after the colon is stripped, and lines starting with ":" are
 * comments (heartbeats) and ignored.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export interface SseParser {
  /** Feed a chunk of text; returns every message completed by it. */
  feed(chunk: string): SseMessage[];
  /** Bytes buffered but not yet terminated (for the connection-recycle check). */
  pending(): number;
}

export function createSseParser(): SseParser {
  let buffer = '';

  return {
    feed(chunk: string): SseMessage[] {
      // Normalize CRLF/CR so a single split on "\n\n" finds every boundary.
      buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      const out: SseMessage[] = [];
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const msg = parseBlock(block);
        if (msg) out.push(msg);
        boundary = buffer.indexOf('\n\n');
      }
      return out;
    },

    pending(): number {
      return buffer.length;
    },
  };
}

function parseBlock(block: string): SseMessage | null {
  let event = '';
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank or comment/heartbeat
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // Strip exactly one leading space after the colon, per spec.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // id / retry are unused by this feed.
  }

  if (!event && data.length === 0) return null;
  return { event, data: data.join('\n') };
}
