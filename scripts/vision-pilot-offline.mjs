/** ONLY offline child launch. No live option, credential implementation or native fetch. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectPilotProcess } from './vision-pilot-collector.mjs';
const require = createRequire(import.meta.url);
const { RECEIPT_DIRECTORY } = require('../dist/main/visionPilotReceipt.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function launchOfflinePilot(scenario='success',testId=randomUUID()) {
  if (!['success','400','401','429','500','timeout','connection','before','after','empty','malformed','cancel','expired','blocked','noisy'].includes(scenario) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(testId)) throw new Error('Invalid offline scenario/id.');
  fs.mkdirSync(RECEIPT_DIRECTORY,{recursive:true});
  if (fs.lstatSync(RECEIPT_DIRECTORY).isSymbolicLink() || fs.realpathSync(RECEIPT_DIRECTORY)!==RECEIPT_DIRECTORY) throw new Error('Unsafe diagnostic directory.');
  try { const fd = fs.openSync(path.join(RECEIPT_DIRECTORY,testId+'.launch'),'wx',0o600);fs.fsyncSync(fd);fs.closeSync(fd); }
  catch { return {testId,terminal:'BLOCKED',collectorError:'duplicate-or-reservation',childClosed:true}; }
  const env = {};
  for (const key of ['SystemRoot','WINDIR','TEMP','TMP']) if (process.env[key]) env[key] = process.env[key];
  return collectPilotProcess({testId,spawnChild:()=>spawn(process.execPath,
    [path.join(root,'scripts/vision-pilot-offline-worker.mjs'),scenario,testId],
    {cwd:root,env,shell:false,windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']})});
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await launchOfflinePilot(process.argv[2]??'success'))); }
  catch { console.error('Offline collector failed. No live request or automatic retry.');process.exitCode=1; }
}
