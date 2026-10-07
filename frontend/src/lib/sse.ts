/**
 * Read a Server-Sent Events response body, invoking `onEvent` once per `data:`
 * frame.
 *
 * The reason this exists rather than a `decoder.decode(value).split('\n')` loop
 * per call site: that shape loses tokens in three separate ways, and all three
 * were live in the chat consumers.
 *
 *   1. `decode()` without `{ stream: true }` decodes each chunk as a complete
 *      UTF-8 sequence, so a multi-byte character split across a chunk boundary
 *      comes out as a replacement character.
 *   2. A chunk boundary landing mid-frame yields two halves that are not valid
 *      `data:` lines, and both get discarded — the token is silently gone.
 *   3. A single chunk can carry several frames, or one frame can span several
 *      chunks, so nothing may be assumed about the chunk/frame relationship.
 *
 * `[DONE]` (the backend's end-of-stream sentinel) ends the read. A frame whose
 * payload is not valid JSON is skipped rather than aborting the stream, which
 * matches the per-line `try/catch` behaviour each call site had.
 *
 * Returns when the stream ends, when `[DONE]` arrives, or when the request is
 * aborted. An abort surfaces to the caller as a rejected `reader.read()`, not
 * as a return — decide there whether that is a failure or a user pressing
 * Stop.
 */
export async function readSseStream<T>(
  response: Response,
  onEvent: (data: T) => void,
): Promise<void> {
  if (!response.body) throw new Error('Response has no body to stream')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Drains every complete frame in the buffer. Returns true once [DONE] is
  // seen, so the caller can stop reading.
  const drainFrames = (): boolean => {
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep).trim()
      buffer = buffer.slice(sep + 2)
      if (!frame.startsWith('data:')) continue

      const payload = frame.slice(5).trim()
      if (payload === '[DONE]') return true

      try {
        onEvent(JSON.parse(payload) as T)
      } catch {
        // An unparseable frame is not a reason to abandon the whole stream.
      }
    }
    return false
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (drainFrames()) return
    }

    // Flush the decoder's trailing bytes, then treat end-of-body as a frame
    // boundary so a final frame that arrives without its blank line is kept.
    buffer += decoder.decode()
    buffer += '\n\n'
    drainFrames()
  } finally {
    // Matters on abort and on the [DONE] return: without it the connection
    // stays open and the server keeps generating into a stream nobody reads.
    void reader.cancel().catch(() => {})
  }
}
