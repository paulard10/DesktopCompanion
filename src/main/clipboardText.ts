import { clipboard } from 'electron';
import { inspectClipboardText, type ClipboardOffer } from '../shared/clipboardContext.js';

/** One plain-text read. The caller decides when the user asked for it. */
export async function readCopiedText(
  readText: () => string | Promise<string> = () => clipboard.readText(),
): Promise<ClipboardOffer> {
  try {
    return inspectClipboardText(await readText());
  } catch {
    console.log('desktop-companion: clipboard-read failed');
    return { kind: 'empty' };
  }
}
