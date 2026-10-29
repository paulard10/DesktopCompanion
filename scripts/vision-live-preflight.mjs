// Default: public fixture metadata only, NO Electron/credential/network access.
// Previous live approval is consumed. CLI and native transport remain blocked.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { visionPilotSpecification, createVisionPilotFixture } = require('../dist/main/visionPilotFixture.js');
const { encodeSyntheticCrop } = require('../dist/main/visionImage.js');
const EXPECTED_FIXTURE_HASH = '8275b81da5ae7f12e8cc42f65be1e224d16f9a08608c6f5b657b1d96e5586b06';
const EXPECTED_QUESTION = 'Read the arithmetic expression in this image and describe the colored shape.';
export async function runReviewedPilotOnce(pilot, approvalInput, domain) {
  if (domain !== 'offline-http-test') return { result: { ok: false, code: 'disabled', message: 'LIVE TEST NOT AUTHORIZED' }, diagnostics: pilot.diagnostics() };
  const image = visionPilotSpecification();
  if (image.width !== 384 || image.height !== 256 || image.bytes !== 2278 || image.sha256 !== EXPECTED_FIXTURE_HASH || image.question !== EXPECTED_QUESTION)
    throw new Error('Authorized fixture specification changed. No send.');
  encodeSyntheticCrop(createVisionPilotFixture()); // Signature/CRC/structure/pixel/encoding checks before approval.
  const reviewed = pilot.review();
  if (!reviewed.ok) return { result: reviewed, diagnostics: pilot.diagnostics() };
  const r = reviewed.review;
  if (r.domain !== domain || r.imageSha256 !== EXPECTED_FIXTURE_HASH || r.question !== EXPECTED_QUESTION || r.model !== 'qwen3.7-plus' || r.maxTokens !== 160) {
    pilot.cancel(); throw new Error('Review differs from authorized scope. No send.');
  }
  const statement = await approvalInput(r);
  const permit = pilot.authorize(r.id, statement);
  if (!permit) return { result: { ok: false, code: 'authorization', message: 'Missing/expired single-use authorization. No send.' }, diagnostics: pilot.diagnostics() };
  const result = await pilot.run(permit);
  return { result, diagnostics: pilot.diagnostics() };
}
const flag = '--desktop-companion-synthetic-vision-test';
const interactive = process.argv.includes(flag);
const preflight = {
  status: 'LIVE TEST BLOCKED', consent: 'NOT YET GIVEN', provider: 'Alibaba Cloud Model Studio', region: 'Singapore',
  model: 'qwen3.7-plus', method: 'POST', endpoint: 'https://<configured-workspace>.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
  image: visionPilotSpecification(), outputParameter: 'max_completion_tokens', outputTokens: 160,
  stream: false, requests: 1, retries: 0, fallback: false,
  timeoutMs: 20_000, accountAccess: 'UNVERIFIED', remainingQuota: 'UNVERIFIED', billing: 'UNVERIFIED',
  apiUncertainty: 'Official sources conflict on enable_thinking:false support. Resolve before a live test; no automatic thinking-mode switch.',
  publishedListUsdPerMillionTokens: { input: 0.40, output: 1.60, checked: '2026-10-29', accountRate: 'UNVERIFIED' },
  conditionalEstimateUsd: { assumedInputTokens: 248, requestedCompletionTokens: 160, estimate: 0.0003552,
    withTenExtraCompletionTokens: 0.0003712, hardCurrencyCap: false },
  retention: 'Standard policy: normally at most 30 days, with legal/security exceptions. ZDR is enterprise/workspace/model-specific and UNVERIFIED here; safety/metadata exceptions apply.',
  disclosure: 'Synthetic PNG + fixed question + system instruction + API metadata would leave this device. Provider retention and possible charges apply. No desktop capture or chat history.',
  credential: 'Existing secure vault; not opened by this default preflight.',
};
const isEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntry) {
  console.log(JSON.stringify({ ...preflight, authorization: 'LIVE TEST NOT AUTHORIZED; prior approval consumed' }, null, 2));
  // Fail before Electron, provider settings, credential-store imports or process creation.
  if (interactive) process.exitCode = 1;
}
