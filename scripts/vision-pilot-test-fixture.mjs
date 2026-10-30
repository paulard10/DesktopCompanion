/** Test-only checkout replica: identical first-party runtime, independent receipts. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'desktop-companion-vision-test-';
export const VISION_TEST_FILES = Object.freeze([
  'dist/main/visionPilotReceipt.js', 'dist/main/qwenVisionTransport.js',
  'dist/main/qwenVisionAdapter.js', 'dist/main/visionImage.js',
  'dist/main/visionPilotFixture.js', 'dist/main/qwenVisionMock.js',
  'dist/main/screenVisionRequest.js', 'dist/main/screenVisionBridgeFake.js',
  'dist/shared/qwenEndpoint.js', 'dist/shared/providerErrors.js', 'dist/shared/offlineVision.js',
  'scripts/vision-pilot-collector.mjs', 'scripts/vision-pilot-offline.mjs',
  'scripts/vision-pilot-offline-worker.mjs', 'scripts/vision-live-preflight.mjs',
]);

export function createVisionPilotTestFixture() {
  const temporary = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporary, PREFIX));
  let disposed = false, unclosed = false;
  const modulePath = relative => {
    if (!VISION_TEST_FILES.includes(relative)) throw new Error('Not an approved vision test module.');
    return path.join(directory, relative);
  };
  const dispose = () => {
    if (disposed) return;
    if (unclosed) throw new Error('Vision test child closure unconfirmed; owned fixture retained.');
    const resolved = fs.realpathSync(directory);
    if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith(PREFIX) ||
        fs.lstatSync(directory).isSymbolicLink()) throw new Error('Refuse unsafe vision fixture cleanup.');
    fs.rmSync(resolved, { recursive: true, force: true });
    if (fs.existsSync(resolved)) throw new Error('Vision fixture cleanup incomplete.');
    disposed = true;
  };
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
    for (const relative of VISION_TEST_FILES) {
      const destination = modulePath(relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(project, relative), destination);
    }
  } catch (error) { dispose(); throw error; }
  return {
    directory, modulePath, moduleUrl: relative => pathToFileURL(modulePath(relative)).href,
    markUnclosed: () => { unclosed = true; }, dispose,
  };
}
