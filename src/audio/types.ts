/** Decoded locally, never uploaded. The excerpt from offset to the end repeats. */
export interface AudioTrack {
  buffer: AudioBuffer;
  offset: number;
  volume: number;
}

export type AudioSelection = AudioTrack;
