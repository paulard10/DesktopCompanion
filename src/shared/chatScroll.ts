/** Transcript stickiness. Imports nothing. */

export const SCROLL_STICK_PX = 48;

export function shouldFollowTranscript(distanceFromBottom: number): boolean {
  return distanceFromBottom < SCROLL_STICK_PX;
}
