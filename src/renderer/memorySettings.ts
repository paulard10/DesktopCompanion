import { MEMORY_TEXT_LIMIT, createMemoryToken, memoryFailure } from '../shared/personalMemory';
import type { ChatBridge, MemoryView } from '../shared/ipc';

export interface MemorySettings {
  reload: () => Promise<void>;
  closeEditor: () => void;
}

export function mountMemorySettings(
  doc: Document,
  bridge: ChatBridge,
): MemorySettings {
  const use = doc.querySelector<HTMLInputElement>('#memory-use');
  const state = doc.querySelector<HTMLElement>('#memory-state');
  const list = doc.querySelector<HTMLElement>('#memory-list');
  const editor = doc.querySelector<HTMLElement>('#memory-editor');
  const draft = doc.querySelector<HTMLTextAreaElement>('#memory-draft');
  const save = doc.querySelector<HTMLButtonElement>('#memory-save');
  const cancel = doc.querySelector<HTMLButtonElement>('#memory-cancel-edit');
  const add = doc.querySelector<HTMLButtonElement>('#memory-add');
  const clear = doc.querySelector<HTMLButtonElement>('#memory-clear');
  const clearCancel = doc.querySelector<HTMLButtonElement>('#memory-clear-cancel');
  if (!use || !state || !list || !editor || !draft || !save || !cancel || !add || !clear || !clearCancel) {
    return { async reload() {}, closeEditor() {} };
  }

  let revision = 0;
  let editing: string | null | undefined;
  let busy = false;
  let clearArmed = false;

  const closeEditor = (): void => {
    editing = undefined;
    draft.value = '';
    editor.hidden = true;
  };

  const disarmClear = (): void => {
    clearArmed = false;
    clear.textContent = 'Clear all';
    clearCancel.hidden = true;
  };

  const render = (view: MemoryView): void => {
    if (!view.ok || !view.readable) {
      use.checked = false;
      use.disabled = true;
      add.disabled = true;
      clear.disabled = true;
      list.replaceChildren();
      state.textContent = memoryFailure(!view.ok ? view.reason : view.available ? 'unreadable' : 'unavailable');
      return;
    }
    revision = view.revision;
    use.disabled = false;
    use.checked = view.useInChat;
    add.disabled = busy;
    clear.disabled = busy || view.count === 0;
    list.replaceChildren();
    if (view.items.length === 0) {
      state.textContent = 'Nothing has been saved yet.';
    } else if (state.textContent === 'Nothing has been saved yet.') {
      state.textContent = '';
    }
    for (const item of view.items) {
      const row = doc.createElement('article');
      row.className = 'memory-row';
      const copy = doc.createElement('p');
      copy.textContent = item.text;
      const controls = doc.createElement('div');
      controls.className = 'memory-row-actions';
      const edit = doc.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        disarmClear();
        editing = item.id;
        draft.value = item.text;
        editor.hidden = false;
        draft.focus();
      });
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        if (remove.dataset.armed !== 'yes') {
          remove.dataset.armed = 'yes';
          remove.textContent = 'Confirm delete';
          return;
        }
        void commitDelete(item.id);
      });
      controls.append(edit, remove);
      row.append(copy, controls);
      list.append(row);
    }
  };

  const reload = async (): Promise<void> => {
    render(await bridge.memorySnapshot());
  };

  const commitDelete = async (id: string): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    const result = await bridge.deleteMemory({ token: createMemoryToken(), id, revision });
    busy = false;
    state.textContent = result.ok ? '' : memoryFailure(result.reason);
    await reload();
  };

  add.addEventListener('click', () => {
    disarmClear();
    editing = null;
    draft.value = '';
    editor.hidden = false;
    draft.focus();
  });

  cancel.addEventListener('click', () => {
    closeEditor();
  });

  save.addEventListener('click', () => {
    if (busy || editing === undefined) {
      return;
    }
    const text = draft.value;
    if (text.trim().length === 0 || text.length > MEMORY_TEXT_LIMIT) {
      state.textContent = memoryFailure(text.trim().length === 0 ? 'empty' : 'too-long');
      return;
    }
    const id = editing;
    busy = true;
    const request = id
      ? bridge.updateMemory({ token: createMemoryToken(), id, text, revision })
      : bridge.saveMemory({ token: createMemoryToken(), text, revision });
    void request.then(async (result) => {
      busy = false;
      state.textContent = result.ok ? 'Memory saved.' : memoryFailure(result.reason);
      if (result.ok) {
        closeEditor();
      }
      await reload();
    });
  });

  clear.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clear.textContent = 'Confirm clear';
      clearCancel.hidden = false;
      return;
    }
    if (busy) {
      return;
    }
    busy = true;
    void bridge.clearMemories({ token: createMemoryToken(), revision }).then(async (result) => {
      busy = false;
      disarmClear();
      closeEditor();
      state.textContent = result.ok ? 'Memories cleared.' : memoryFailure(result.reason);
      await reload();
    });
  });

  clearCancel.addEventListener('click', () => {
    disarmClear();
  });

  use.addEventListener('change', () => {
    const enabled = use.checked;
    void bridge.setMemoryUse({ token: createMemoryToken(), enabled, revision }).then(async (result) => {
      if (!result.ok) {
        state.textContent = memoryFailure(result.reason);
      }
      await reload();
    });
  });

  bridge.onMemoryCleared(() => {
    closeEditor();
    disarmClear();
  });

  void reload();
  return { reload, closeEditor };
}
