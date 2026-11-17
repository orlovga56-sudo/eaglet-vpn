import { describe, expect, it } from 'vitest'
import { readLimitedText } from '../src/main/vpn/free-sources'

function streamedResponse(chunks: Uint8Array[], prefix?: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix) controller.enqueue(new TextEncoder().encode(prefix))
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
  return new Response(body)
}

describe('catalog download limit', () => {
  it('reads a body that fits inside the budget', async () => {
    const text = await readLimitedText(
      streamedResponse([new TextEncoder().encode('one\ntwo\n'), new TextEncoder().encode('three')]),
      1024
    )
    expect(text).toBe('one\ntwo\nthree')
  })

  it('counts the bytes of multi-byte characters', async () => {
    const encoded = new TextEncoder().encode('привет') // 12 UTF-8 bytes
    const text = await readLimitedText(streamedResponse([encoded]), 12)
    expect(text).toBe('привет')
    await expect(readLimitedText(streamedResponse([encoded]), 11)).rejects.toThrow(/larger|больше/)
  })

  it('rejects an oversized response instead of buffering it', async () => {
    const chunk = new Uint8Array(600)
    await expect(readLimitedText(streamedResponse([chunk, chunk]), 1000)).rejects.toThrow(/larger|больше/)
  })

  it('falls back to response.text() when the body is not streamed', async () => {
    const response = new Response('plain', {
      headers: { 'content-type': 'text/plain' }
    })
    // Node's Response exposes a stream even for simple bodies, so force the
    // non-streamed branch the same way a stub would.
    Object.defineProperty(response, 'body', { value: null })
    await expect(readLimitedText(response, 1024)).resolves.toBe('plain')
  })
})
