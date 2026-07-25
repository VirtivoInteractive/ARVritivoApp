/**
 * GaussianLoader
 *
 * Streams a binary .splat file over HTTP and delivers it in chunks so the
 * scene can update progressively without waiting for the full download.
 *
 * .splat format: 32 bytes per splat (see GaussianCloud.js for layout).
 *
 * Usage:
 *   const loader = new GaussianLoader({
 *     onProgress: (ratio) => console.log(ratio * 100 + '%'),
 *     onChunk:    (buffer) => cloud.addSplats(buffer),
 *     onDone:     () => console.log('finished'),
 *     onError:    (err) => console.error(err),
 *   });
 *   await loader.load('https://example.com/scene.splat');
 *
 * Progressive vs. instant loading:
 *   Both modes use the same code path.  With progressive loading the server
 *   streams the response and onChunk fires multiple times as data arrives.
 *   With a server that returns the full body at once (e.g. a static file
 *   served without chunked transfer encoding) onChunk fires once at the end —
 *   this is effectively "instant" loading.
 */

const BYTES_PER_SPLAT = 32;

export class GaussianLoader {
  /**
   * @param {object}   options
   * @param {function} [options.onProgress]  called with a ratio in [0,1] as data arrives
   * @param {function} [options.onChunk]     called with each aligned ArrayBuffer chunk
   * @param {function} [options.onDone]      called when the stream is complete
   * @param {function} [options.onError]     called on network / parse errors
   */
  constructor({ onProgress, onChunk, onDone, onError } = {}) {
    this.onProgress = onProgress ?? (() => {});
    this.onChunk    = onChunk    ?? (() => {});
    this.onDone     = onDone     ?? (() => {});
    this.onError    = onError    ?? ((e) => { throw e; });

    /** Set to true to abort an in-progress load. */
    this._aborted = false;
    this._controller = null;
  }

  /**
   * Start streaming the splat file at `url`.
   * Returns a Promise that resolves when the load completes or rejects on error.
   *
   * @param {string} url
   * @returns {Promise<void>}
   */
  async load(url) {
    this._aborted = false;
    this._controller = new AbortController();

    let response;
    try {
      response = await fetch(url, { signal: this._controller.signal });
    } catch (err) {
      this.onError(err);
      return;
    }

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} loading splat from "${url}"`);
      this.onError(err);
      return;
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes    = contentLength ? parseInt(contentLength, 10) : null;

    const reader = response.body.getReader();
    let receivedBytes = 0;
    // Accumulate partial bytes that don't yet fill a complete splat
    let remainder = new Uint8Array(0);

    try {
      while (!this._aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Prepend any leftover bytes from the previous iteration
        let chunk;
        if (remainder.length > 0) {
          chunk = new Uint8Array(remainder.length + value.length);
          chunk.set(remainder);
          chunk.set(value, remainder.length);
        } else {
          chunk = value;
        }

        receivedBytes += value.length;

        // Report progress
        if (totalBytes !== null) {
          this.onProgress(Math.min(receivedBytes / totalBytes, 1));
        }

        // Deliver only whole splats; save the trailing bytes for next iteration
        const completeSplats  = Math.floor(chunk.length / BYTES_PER_SPLAT);
        const alignedByteLen  = completeSplats * BYTES_PER_SPLAT;

        if (completeSplats > 0) {
          // slice() creates a copy — safe to hand off to the renderer
          this.onChunk(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + alignedByteLen));
        }

        remainder = chunk.slice(alignedByteLen);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.onError(err);
        return;
      }
    } finally {
      reader.releaseLock();
    }

    if (!this._aborted) {
      this.onProgress(1);
      this.onDone();
    }
  }

  /** Cancel the current in-progress load. */
  abort() {
    this._aborted = true;
    this._controller?.abort();
  }
}
