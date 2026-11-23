import { createMemoryToken, memoryFailure, type MemoryProposal } from '../shared/personalMemory';
import type { ChatBridge } from '../shared/ipc';

export interface MemoryCard {
  propose: (proposal: MemoryProposal) => void;
  dismiss: () => void;
  isPending: () => boolean;
}

export function mountMemoryCard(
  doc: Document,
  bridge: ChatBridge,
  hooks: { onShow: () => void; onDismiss: () => void; onSaved: () => void },
): MemoryCard {
  const card = doc.querySelector<HTMLElement>('#memory-card');
  const title = doc.querySelector<HTMLElement>('#memory-card-title');
  const editor = doc.querySelector<HTMLTextAreaElement>('#memory-card-text');
  const list = doc.querySelector<HTMLUListElement>('#memory-card-list');
  const note = doc.querySelector<HTMLElement>('#memory-card-note');
  const save = doc.querySelector<HTMLButtonElement>('#memory-card-save');
  const cancel = doc.querySelector<HTMLButtonElement>('#memory-card-cancel');
  if (!card || !title || !editor || !list || !note || !save || !cancel) {
    return { propose() {}, dismiss() {}, isPending: () => false };
  }

  let pending = false;
  let busy = false;
  let generation = 0;
  let revision = 0;

  const setBusy = (next: boolean): void => {
    busy = next;
    save.disabled = next;
    cancel.disabled = next;
  };

  const dismiss = (): void => {
    const wasPending = pending;
    generation += 1;
    pending = false;
    setBusy(false);
    card.hidden = true;
    title.textContent = '';
    editor.value = '';
    editor.hidden = true;
    list.replaceChildren();
    list.hidden = true;
    note.hidden = true;
    note.textContent = '';
    save.hidden = true;
    if (wasPending) {
      hooks.onDismiss();
    }
  };

  const saveMemory = async (): Promise<void> => {
    if (!pending || busy) {
      return;
    }
    const mine = generation;
    const text = editor.value;
    setBusy(true);
    const result = await bridge.saveMemory({ token: createMemoryToken(), text, revision });
    if (mine !== generation) {
      return;
    }
    setBusy(false);
    if (!result.ok) {
      note.hidden = false;
      note.textContent = memoryFailure(result.reason);
      return;
    }
    title.textContent = 'Memory saved.';
    editor.hidden = true;
    save.hidden = true;
    note.hidden = true;
    bridge.notifyActionPose('happy');
    hooks.onSaved();
    window.setTimeout(() => {
      if (mine === generation) {
        dismiss();
      }
    }, 900);
  };

  save.addEventListener('click', () => {
    void saveMemory();
  });

  cancel.addEventListener('click', () => {
    dismiss();
    bridge.notifyActionPose('clear');
  });

  bridge.onMemoryCleared(() => {
    dismiss();
  });

  const showRecall = async (): Promise<void> => {
    const mine = generation;
    const view = await bridge.memorySnapshot();
    if (mine !== generation) {
      return;
    }
    list.replaceChildren();
    editor.hidden = true;
    save.hidden = true;
    if (!view.ok || !view.readable) {
      title.textContent = memoryFailure(!view.ok ? view.reason : view.available ? 'unreadable' : 'unavailable');
      list.hidden = true;
      return;
    }
    if (view.items.length === 0) {
      title.textContent = 'Nothing has been saved yet.';
      list.hidden = true;
      return;
    }
    title.textContent = 'Saved memories';
    for (const item of view.items) {
      const row = doc.createElement('li');
      row.textContent = item.text;
      list.append(row);
    }
    list.hidden = false;
  };

  return {
    isPending: () => pending,
    dismiss: () => {
      if (pending) {
        dismiss();
      }
    },
    propose(proposal) {
      if (pending) {
        return;
      }
      pending = true;
      generation += 1;
      card.hidden = false;
      note.hidden = true;
      note.textContent = '';
      hooks.onShow();
      if (proposal.kind === 'recall') {
        title.textContent = 'Saved memories';
        editor.hidden = true;
        save.hidden = true;
        list.hidden = true;
        void showRecall();
        bridge.notifyActionPose('attentive');
        return;
      }
      if (proposal.kind === 'refused') {
        title.textContent = memoryFailure(proposal.reason);
        editor.hidden = true;
        save.hidden = true;
        list.hidden = true;
        bridge.notifyActionPose('surprised');
        return;
      }
      title.textContent = 'Save this memory?';
      editor.hidden = false;
      editor.value = proposal.text;
      list.hidden = true;
      save.hidden = false;
      save.disabled = true;
      bridge.notifyActionPose('attentive');
      void bridge.memorySnapshot().then((view) => {
        if (!pending || !view.ok || !view.readable) {
          if (pending) {
            note.hidden = false;
            note.textContent = memoryFailure(!view.ok ? view.reason : view.available ? 'unreadable' : 'unavailable');
          }
          return;
        }
        revision = view.revision;
        save.disabled = false;
      });
    },
  };
}
