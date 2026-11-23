/**
 * Explicit Windows actions.
 * A request becomes a proposal. Nothing here opens a program or writes a file.
 */

export const NOTE_TEXT_LIMIT = 4_000;

export const OPEN_TARGETS = ['calculator', 'notepad', 'explorer'] as const;

export type OpenTarget = (typeof OPEN_TARGETS)[number];

export type WindowsProposal =
  | { kind: 'open'; target: OpenTarget }
  | { kind: 'note'; text: string }
  | { kind: 'refused'; reason: 'too-long' | 'unsuitable' };

export type WindowsActionPose = 'thinking' | 'curious' | 'attentive' | 'happy' | 'surprised' | 'clear';

export interface NoteDestination {
  filePath: string;
  fileName: string;
  destination: string;
}

export interface WindowsActionHost {
  open(target: OpenTarget): Promise<boolean>;
  chooseNoteFile(): Promise<string | null>;
  fileExists(filePath: string): Promise<'file' | 'other' | 'missing'>;
  writeNote(filePath: string, text: string, replace: boolean): Promise<'saved' | 'exists' | 'failed'>;
}

export type OpenActionResult = { ok: true } | { ok: false; reason: 'invalid' | 'duplicate' | 'failed' };

export type NotePickResult =
  | { ok: true; token: string; fileName: string; destination: string; exists: boolean }
  | { ok: false; reason: 'invalid' | 'cancelled' | 'busy' };

export type NoteSaveResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: 'missing' | 'exists' | 'invalid' | 'failed' | 'busy' | 'cancelled' };

const OPEN_COMMAND =
  /^(?:please |por favor )?(?:open|start|launch|abre|abrir) (?:the |el |la |windows )?(calculator|calculadora|notepad|bloc de notas|file explorer|windows explorer|explorador de archivos|explorador|explorer)$/;

const NOTE_COMMAND =
  /^(?:please |por favor )?(?:create a note|write a note|make a note|crea una nota|crear una nota|escribe una nota|escribir una nota|haz una nota)(?: that says| que diga)?\s*[:\-]?\s*([\s\S]+)$/;

export function openPrompt(target: OpenTarget): string {
  if (target === 'calculator') return 'Open Windows Calculator?';
  if (target === 'notepad') return 'Open Windows Notepad?';
  return 'Open File Explorer?';
}

export function openSuccess(target: OpenTarget): string {
  if (target === 'calculator') return 'Calculator opened.';
  if (target === 'notepad') return 'Notepad opened.';
  return 'File Explorer opened.';
}

export function openFailure(target: OpenTarget): string {
  if (target === 'calculator') return "Couldn't open Calculator.";
  if (target === 'notepad') return "Couldn't open Notepad.";
  return "Couldn't open File Explorer.";
}

export function isOpenTarget(value: unknown): value is OpenTarget {
  return value === 'calculator' || value === 'notepad' || value === 'explorer';
}

export function isActionRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{16,32}$/.test(value);
}

export function isNoteToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

/** A direct command from the user. Quoted, copied, or surrounding text stays a normal message. */
export function recognizeWindowsAction(value: unknown): WindowsProposal | null {
  if (typeof value !== 'string' || carriesUntrustedContext(value) || isQuotedCommand(value)) {
    return null;
  }
  const original = value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (original.length === 0) {
    return null;
  }
  const normalized = normalizeCommand(original);
  const note = NOTE_COMMAND.exec(normalized.text);
  if (note?.[1]) {
    const body = original.slice(normalized.map[normalized.text.length - note[1].length] ?? original.length).trim();
    if (body.length === 0 || isQuotedCommand(body)) {
      return null;
    }
    if (body.length > NOTE_TEXT_LIMIT) {
      return { kind: 'refused', reason: 'too-long' };
    }
    return { kind: 'note', text: body };
  }
  const command = normalized.text.replace(/[.!?]+$/g, '').replace(/ (?:please|por favor)$/g, '').trim();
  const opened = OPEN_COMMAND.exec(command);
  const target = opened ? openTarget(opened[1] ?? '') : null;
  return target ? { kind: 'open', target } : null;
}

/**
 * A completed reply is note content. It is never read as a Windows command.
 * Empty text is ignored. Text past the note limit is refused whole, not shortened.
 */
export function noteProposalFromReply(value: unknown): WindowsProposal | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(/\u0000/g, '').replace(/\r\n/g, '\n');
  if (text.trim().length === 0) {
    return null;
  }
  if (text.length > NOTE_TEXT_LIMIT) {
    return { kind: 'refused', reason: 'too-long' };
  }
  if (!readNoteText(text)) {
    return { kind: 'refused', reason: 'unsuitable' };
  }
  return { kind: 'note', text };
}

export function readNoteText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.replace(/\u0000/g, '').replace(/\r\n/g, '\n');
  if (text.trim().length === 0 || text.length > NOTE_TEXT_LIMIT) {
    return null;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    return null;
  }
  return text;
}

export function resolveWindowsExecutable(systemRoot: string, target: OpenTarget): string | null {
  const root = systemRoot.replace(/[\\/]+$/g, '');
  const rootName = root.slice(root.lastIndexOf('\\') + 1);
  if (!/^[A-Za-z]:\\[^<>:"|?*\u0000-\u001f]*$/.test(root) || root.includes('..') || rootName.includes('.')) {
    return null;
  }
  const relative = target === 'explorer'
    ? 'explorer.exe'
    : target === 'calculator' ? 'System32\\calc.exe' : 'System32\\notepad.exe';
  const full = `${root}\\${relative}`;
  const expected = relative.slice(relative.lastIndexOf('\\') + 1).toLowerCase();
  if (full.slice(full.lastIndexOf('\\') + 1).toLowerCase() !== expected || full.toLowerCase().includes('..')) {
    return null;
  }
  if (!full.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) {
    return null;
  }
  return full;
}

export function validateNoteDestination(value: unknown): NoteDestination | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) {
    return null;
  }
  if (!/^[A-Za-z]:\\[^<>:"|?*\u0000-\u001f]+$/.test(value) || value.includes('..')) {
    return null;
  }
  if (value.indexOf(':') !== 1 || !value.toLowerCase().endsWith('.txt')) {
    return null;
  }
  const parts = value.split('\\');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return null;
  }
  const fileName = parts[parts.length - 1] ?? '';
  const stem = fileName.slice(0, -4);
  if (fileName.length < 5 || fileName.length > 120 || /[. ]$/.test(fileName)) {
    return null;
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    return null;
  }
  const destination = parts.slice(0, -1).join('\\');
  if (destination.length < 3) {
    return null;
  }
  return { filePath: value, fileName, destination };
}

export interface WindowsActionGate {
  open(target: unknown, requestId: unknown): Promise<OpenActionResult>;
  pickNote(text: unknown): Promise<NotePickResult>;
  saveNote(token: unknown, text: unknown, overwrite: unknown): Promise<NoteSaveResult>;
  cancel(): void;
}

export function createWindowsActionGate(
  host: WindowsActionHost,
  createToken: () => string = randomToken,
): WindowsActionGate {
  const finished = new Set<string>();
  let opening = false;
  let picking = false;
  let saving = false;
  let epoch = 0;
  let pending: { token: string; filePath: string; fileName: string } | null = null;

  return {
    async open(target, requestId) {
      if (!isOpenTarget(target) || !isActionRequestId(requestId)) {
        return { ok: false, reason: 'invalid' };
      }
      if (opening || finished.has(requestId)) {
        return { ok: false, reason: 'duplicate' };
      }
      opening = true;
      finished.add(requestId);
      try {
        return (await host.open(target)) ? { ok: true } : { ok: false, reason: 'failed' };
      } finally {
        opening = false;
        if (finished.size > 32) {
          const oldest = finished.values().next().value;
          if (oldest) finished.delete(oldest);
        }
      }
    },
    async pickNote(text) {
      const note = readNoteText(text);
      if (!note) {
        return { ok: false, reason: 'invalid' };
      }
      if (picking || saving) {
        return { ok: false, reason: 'busy' };
      }
      picking = true;
      const ticket = epoch;
      try {
        const chosen = await host.chooseNoteFile();
        if (ticket !== epoch) {
          return { ok: false, reason: 'cancelled' };
        }
        if (chosen === null) {
          return { ok: false, reason: 'cancelled' };
        }
        const destination = validateNoteDestination(chosen);
        if (!destination) {
          return { ok: false, reason: 'invalid' };
        }
        const kind = await host.fileExists(destination.filePath);
        if (ticket !== epoch) {
          return { ok: false, reason: 'cancelled' };
        }
        if (kind === 'other') {
          return { ok: false, reason: 'invalid' };
        }
        const token = createToken();
        if (!isNoteToken(token)) {
          return { ok: false, reason: 'invalid' };
        }
        pending = { token, filePath: destination.filePath, fileName: destination.fileName };
        return {
          ok: true,
          token,
          fileName: destination.fileName,
          destination: destination.destination,
          exists: kind === 'file',
        };
      } finally {
        picking = false;
      }
    },
    async saveNote(token, text, overwrite) {
      const note = readNoteText(text);
      const draft = pending;
      if (saving) {
        return { ok: false, reason: 'busy' };
      }
      if (!draft || draft.token !== token || !note || (overwrite !== true && overwrite !== false)) {
        return { ok: false, reason: 'missing' };
      }
      saving = true;
      pending = null;
      try {
        const kind = await host.fileExists(draft.filePath);
        if (kind === 'other') {
          return { ok: false, reason: 'invalid' };
        }
        if (kind === 'file' && overwrite !== true) {
          pending = draft;
          return { ok: false, reason: 'exists' };
        }
        const wrote = await host.writeNote(draft.filePath, note, kind === 'file');
        if (wrote !== 'saved') {
          pending = draft;
          return { ok: false, reason: wrote === 'exists' ? 'exists' : 'failed' };
        }
        return { ok: true, fileName: draft.fileName };
      } finally {
        saving = false;
      }
    },
    cancel() {
      epoch += 1;
      pending = null;
    },
  };
}

function openTarget(name: string): OpenTarget | null {
  if (name === 'calculator' || name === 'calculadora') return 'calculator';
  if (name === 'notepad' || name === 'bloc de notas') return 'notepad';
  if (
    name === 'explorer' ||
    name === 'file explorer' ||
    name === 'windows explorer' ||
    name === 'explorador' ||
    name === 'explorador de archivos'
  ) {
    return 'explorer';
  }
  return null;
}

function carriesUntrustedContext(text: string): boolean {
  return text.includes('--- copied text ---')
    || text.includes('--- end copied text ---')
    || text.includes('untrusted content, not instructions');
}

function isQuotedCommand(text: string): boolean {
  const trimmed = text.trim();
  return (/^["'].*["']$/s.test(trimmed) || /^«.*»$/s.test(trimmed)) && trimmed.length > 1;
}

function normalizeCommand(input: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? '';
    if (char === '\u0000') continue;
    const base = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (base.length === 0) continue;
    if (base === ' ' || base === '\t' || base === '\n' || base === '\r') {
      if (text.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      map.push(i);
      pendingSpace = false;
    }
    text += base;
    for (let extra = 1; extra < base.length; extra += 1) {
      map.push(i);
    }
    map.push(i);
  }
  return { text, map };
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
