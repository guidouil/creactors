import { EncodedPacket, EncodedVideoPacketSource } from 'mediabunny';
import { nativeAvcConfig, type ExportProfile } from './profiles';

interface FrameTiming { timestamp: number; duration: number; microseconds: number }

/**
 * Keep AVC below WebKit's four-message encoder queue limit. Some macOS
 * software encoders buffer sixteen frames before emitting output; waiting for
 * dequeue before flushing can therefore deadlock. Three-frame quality batches
 * drain explicitly, without realtime encoding or discarded frames.
 */
export class NativeAvcEncoder {
  readonly source = new EncodedVideoPacketSource('avc');
  private readonly encoder: VideoEncoder;
  private pending: FrameTiming[] = [];
  private writes: Promise<void> = Promise.resolve();
  private readonly failed: Promise<never>;
  private rejectFailure!: (error: unknown) => void;
  private failure: unknown;
  private batchSize = 0;
  private submitted = 0;
  private emitted = 0;
  private forceKeyFrame = true;
  private closed = false;

  constructor(private readonly canvas: HTMLCanvasElement, profile: ExportProfile) {
    this.failed = new Promise<never>((_resolve, reject) => { this.rejectFailure = reject; });
    // An asynchronous codec error can precede the next add()/flush() call.
    void this.failed.catch(() => {});
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => this.receive(chunk, metadata),
      error: error => this.fail(error),
    });
    try { this.encoder.configure(nativeAvcConfig(profile)); }
    catch (error) { this.abort(); throw error; }
  }

  private fail(error: unknown): void {
    if (this.closed || this.failure !== undefined) return;
    this.failure = error;
    this.rejectFailure(error);
  }

  private check(): void {
    if (this.failure !== undefined) throw this.failure;
    if (this.closed) throw new Error('The native AVC encoder is closed.');
  }

  private receive(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    if (this.closed || this.failure !== undefined) return;
    try {
      // Safari can shift canvas frame timestamps by one microsecond. Restore
      // the exact absolute frame time rather than accumulating rounded units.
      const index = this.pending.findIndex(frame => Math.abs(frame.microseconds - chunk.timestamp) <= 1);
      if (index < 0) throw new Error('The AVC encoder returned an unexpected frame timestamp.');
      const [timing] = this.pending.splice(index, 1);
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      const packet = new EncodedPacket(bytes, chunk.type, timing.timestamp, timing.duration, this.emitted++);
      this.writes = this.writes.then(() => this.source.add(packet, metadata));
      void this.writes.catch(error => this.fail(error));
    } catch (error) { this.fail(error); }
  }

  private async drain(): Promise<void> {
    await Promise.race([this.encoder.flush(), this.failed]);
    await Promise.race([this.writes, this.failed]);
    this.check();
    if (this.pending.length || this.emitted !== this.submitted) {
      throw new Error('The AVC encoder did not produce every submitted frame.');
    }
    this.batchSize = 0;
    this.forceKeyFrame = true;
  }

  async add(timestamp: number, duration: number, options: VideoEncoderEncodeOptions): Promise<void> {
    this.check();
    const microseconds = Math.round(timestamp * 1_000_000);
    const frame = new VideoFrame(this.canvas, { timestamp: microseconds, duration: Math.round(duration * 1_000_000), alpha: 'discard' });
    try {
      this.pending.push({ timestamp, duration, microseconds });
      this.encoder.encode(frame, { keyFrame: this.forceKeyFrame || options.keyFrame });
      this.forceKeyFrame = false;
      this.submitted++;
      this.batchSize++;
    } finally { frame.close(); }
    if (this.batchSize === 3) await this.drain();
    this.check();
  }

  async finish(): Promise<void> {
    this.check();
    if (this.batchSize) await this.drain();
    else await Promise.race([this.writes, this.failed]);
    this.check();
    this.encoder.close();
    this.source.close();
    this.closed = true;
  }

  abort(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending.length = 0;
    try { if (this.encoder.state !== 'closed') this.encoder.close(); }
    finally { this.source.close(); }
  }
}
