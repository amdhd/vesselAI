import { describe, it, expect } from 'vitest'
import { readSseStream } from './sse'

const encoder = new TextEncoder()

// A Response whose body delivers exactly the given chunks, in order.
function streamingResponse(chunks: (string | Uint8Array)[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
  return new Response(body)
}

async function collect(chunks: (string | Uint8Array)[]) {
  const events: { text: string }[] = []
  await readSseStream<{ text: string }>(streamingResponse(chunks), (d) => events.push(d))
  return events.map((e) => e.text)
}

describe('readSseStream', () => {
  it('emits one event per frame when a chunk carries several frames', async () => {
    const chunks = ['data: {"text":"a"}\n\ndata: {"text":"b"}\n\ndata: [DONE]\n\n']
    expect(await collect(chunks)).toEqual(['a', 'b'])
  })

  it('reassembles a frame split across two chunks', async () => {
    // The whole point of the buffer: split mid-payload, so neither half is a
    // parseable frame on its own.
    const chunks = ['data: {"te', 'xt":"split"}\n\n', 'data: [DONE]\n\n']
    expect(await collect(chunks)).toEqual(['split'])
  })

  it('keeps a multi-byte character split across a chunk boundary', async () => {
    // "—" is E2 80 94. Cut it after the first byte so a byte-wise decode would
    // produce a replacement character rather than the dash.
    const frame = encoder.encode('data: {"text":"a—b"}\n\ndata: [DONE]\n\n')
    const cut = frame.indexOf(0xe2) + 1
    const chunks = [frame.slice(0, cut), frame.slice(cut)]
    expect(await collect(chunks)).toEqual(['a—b'])
  })

  it('stops reading at the [DONE] sentinel', async () => {
    const chunks = ['data: {"text":"first"}\n\ndata: [DONE]\n\ndata: {"text":"after"}\n\n']
    expect(await collect(chunks)).toEqual(['first'])
  })

  it('skips a malformed frame without dropping the rest of the stream', async () => {
    const chunks = ['data: not json\n\ndata: {"text":"still here"}\n\ndata: [DONE]\n\n']
    expect(await collect(chunks)).toEqual(['still here'])
  })

  it('ignores non-data lines such as keepalive comments', async () => {
    const chunks = [': keepalive\n\ndata: {"text":"kept"}\n\ndata: [DONE]\n\n']
    expect(await collect(chunks)).toEqual(['kept'])
  })

  it('keeps a final frame that arrives without its blank-line delimiter', async () => {
    const chunks = ['data: {"text":"last"}\n\ndata: {"text":"no trailing delimiter"}']
    expect(await collect(chunks)).toEqual(['last', 'no trailing delimiter'])
  })
})
