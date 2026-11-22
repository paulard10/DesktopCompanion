import {
  openFailure,
  openPrompt,
  openSuccess,
  readNoteText,
  type WindowsProposal,
} from '../shared/windowsAction';
import type { ChatBridge } from '../shared/ipc';

export interface WindowsActionCard {
  propose: (proposal: WindowsProposal) => void;
  dismiss: () => void;
  isPending: () => boolean;
}

export function mountWindowsAction(
  doc: Document,
  bridge: ChatBridge,
  hooks: { onShow: () => void; onDismiss: () => void },
): WindowsActionCard {
  const card = doc.querySelector<HTMLElement>('#windows-action');
  const title = doc.querySelector<HTMLElement>('#windows-action-title');
  const note = doc.querySelector<HTMLTextAreaElement>('#windows-action-note');
  const destination = doc.querySelector<HTMLElement>('#windows-action-destination');
  const choose = doc.querySelector<HTMLButtonElement>('#windows-action-choose');
  const confirm = doc.querySelector<HTMLButtonElement>('#windows-action-confirm');
  const overwrite = doc.querySelector<HTMLButtonElement>('#windows-action-overwrite');
  const cancel = doc.querySelector<HTMLButtonElement>('#windows-action-cancel');
  if (!card || !title || !note || !destination || !choose || !confirm || !overwrite || !cancel) {
    return { propose() {}, dismiss() {}, isPending: () => false };
  }

  let pending = false;
  let busy = false;
  let requestId = '';
  let token = '';
  let exists = false;
  let hideTimer = 0;
  let generation = 0;

  const setBusy = (next: boolean): void => {
    busy = next;
    choose.disabled = next;
    confirm.disabled = next;
    overwrite.disabled = next;
    cancel.disabled = next;
  };
  const dismiss = (remote = false): void => {
    generation += 1;
    if (hideTimer !== 0) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    const wasOpen = pending || !card.hidden;
    pending = false;
    busy = false;
    token = '';
    exists = false;
    requestId = '';
    card.hidden = true;
    note.value = '';
    destination.textContent = '';
    setBusy(false);
    if (!wasOpen) {
      return;
    }
    if (!remote) {
      bridge.cancelWindowsAction();
      bridge.notifyActionPose('clear');
    }
    hooks.onDismiss();
  };
  const finish = (ok: boolean, message: string): void => {
    pending = false;
    setBusy(false);
    title.textContent = message;
    choose.hidden = true;
    confirm.hidden = true;
    overwrite.hidden = true;
    cancel.hidden = true;
    note.hidden = true;
    bridge.notifyActionPose(ok ? 'happy' : 'surprised');
    hideTimer = window.setTimeout(() => dismiss(true), 1700);
  };
  const showNoteDestination = (fileName: string, folder: string, already: boolean): void => {
    exists = already;
    destination.hidden = false;
    destination.textContent = already
      ? `${fileName} already exists in ${folder}.`
      : `Save ${fileName} in ${folder}.`;
    confirm.hidden = already;
    overwrite.hidden = !already;
    choose.hidden = false;
  };

  choose.addEventListener('click', () => {
    if (busy) return;
    const text = readNoteText(note.value);
    if (!text) {
      title.textContent = 'Write the note before choosing a destination.';
      return;
    }
    setBusy(true);
    const ticket = generation;
    void bridge.pickNoteDestination(text).then((result) => {
      if (ticket !== generation) return;
      setBusy(false);
      if (!pending) return;
      if (!result.ok) {
        if (result.reason === 'cancelled') return;
        title.textContent = "Couldn't use that destination.";
        bridge.notifyActionPose('surprised');
        return;
      }
      token = result.token;
      title.textContent = result.exists ? 'Overwrite this note?' : 'Save this note?';
      showNoteDestination(result.fileName, result.destination, result.exists);
    });
  });
  confirm.addEventListener('click', () => {
    if (busy || !pending) return;
    setBusy(true);
    const ticket = generation;
    const proposal = card.dataset.kind;
    if (proposal === 'open' && (card.dataset.target === 'calculator' || card.dataset.target === 'notepad' || card.dataset.target === 'explorer')) {
      const target = card.dataset.target;
      void bridge.openWindowsApp(target, requestId).then((result) => {
        if (ticket !== generation) return;
        if (!result.ok && result.reason === 'duplicate') {
          setBusy(false);
          return;
        }
        finish(result.ok, result.ok ? openSuccess(target) : openFailure(target));
      });
      return;
    }
    const text = readNoteText(note.value);
    if (!text || token.length === 0 || exists) {
      setBusy(false);
      return;
    }
    void bridge.saveNote(token, text, false).then((result) => {
      if (ticket !== generation) return;
      if (!result.ok && result.reason === 'exists') {
        setBusy(false);
        exists = true;
        title.textContent = 'Overwrite this note?';
        confirm.hidden = true;
        overwrite.hidden = false;
        return;
      }
      if (!result.ok && result.reason === 'busy') {
        setBusy(false);
        return;
      }
      finish(result.ok, result.ok ? `Saved ${result.fileName}.` : "Couldn't save the note.");
    });
  });
  overwrite.addEventListener('click', () => {
    if (busy || !pending || token.length === 0) return;
    const text = readNoteText(note.value);
    if (!text) {
      title.textContent = 'Write the note before saving.';
      return;
    }
    setBusy(true);
    const ticket = generation;
    void bridge.saveNote(token, text, true).then((result) => {
      if (ticket !== generation) return;
      if (!result.ok && result.reason === 'busy') {
        setBusy(false);
        return;
      }
      finish(result.ok, result.ok ? `Saved ${result.fileName}.` : "Couldn't save the note.");
    });
  });
  cancel.addEventListener('click', () => dismiss(false));
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || card.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(false);
  });
  bridge.onWindowsCleared(() => dismiss(true));

  return {
    propose(proposal) {
      if (pending || !card.hidden) dismiss(false);
      pending = true;
      requestId = createRequestId();
      token = '';
      exists = false;
      card.dataset.kind = proposal.kind === 'open' ? 'open' : proposal.kind;
      card.dataset.target = proposal.kind === 'open' ? proposal.target : '';
      note.value = proposal.kind === 'note' ? proposal.text : '';
      note.hidden = proposal.kind !== 'note';
      destination.hidden = true;
      destination.textContent = '';
      choose.hidden = proposal.kind !== 'note';
      confirm.hidden = proposal.kind !== 'open';
      overwrite.hidden = true;
      cancel.hidden = false;
      setBusy(false);
      title.textContent = proposal.kind === 'open'
        ? openPrompt(proposal.target)
        : proposal.kind === 'note'
          ? 'Save this note?'
          : 'That note is longer than 4,000 characters, so nothing was prepared.';
      if (proposal.kind === 'refused') {
        choose.hidden = true;
        confirm.hidden = true;
      }
      card.hidden = false;
      hooks.onShow();
    },
    dismiss() {
      dismiss(false);
    },
    isPending: () => pending,
  };
}

function createRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
