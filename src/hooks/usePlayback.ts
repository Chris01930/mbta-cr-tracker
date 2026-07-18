import { useEffect } from 'react';
import { CONFIG } from '../config';
import { useStore } from '../state/store';

/**
 * Drives the playback timeline: while playing, advance the frame index on a
 * fixed tick, stepping by the current speed multiplier. Stops automatically at
 * the end of the day (handled in the store's stepPlayback). Runs only in
 * playback mode.
 */
export function usePlayback(): void {
  const mode = useStore((s) => s.mode);
  const playing = useStore((s) => s.playbackPlaying);
  const speed = useStore((s) => s.playbackSpeed);
  const stepPlayback = useStore((s) => s.stepPlayback);

  useEffect(() => {
    if (mode !== 'playback' || !playing) return;
    const id = setInterval(() => stepPlayback(speed), CONFIG.playbackTickMs);
    return () => clearInterval(id);
  }, [mode, playing, speed, stepPlayback]);
}
