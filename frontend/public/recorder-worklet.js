// AudioWorklet that captures raw Float32 PCM and ships chunks to the main
// thread. We use this instead of MediaRecorder so the recording path is
// lossless (no Opus compression) before it ever leaves the browser.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._paused = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'pause') this._paused = true;
      else if (e.data?.type === 'resume') this._paused = false;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || this._paused) return true;
    // Mono: take channel 0. (We request mono in getUserMedia anyway.)
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    // Copy out of the shared buffer before posting — the buffer is reused.
    this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
