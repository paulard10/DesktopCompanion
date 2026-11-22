import {
  CLIPBOARD_TEXT_LIMIT,
  composeClipboardQuestion,
  type ClipboardAction,
  type ClipboardOffer,
} from '../shared/clipboardContext.ts';
import type { ChatBridge } from '../shared/ipc.ts';

export function mountCopiedText(
  doc: Document,
  bridge: ChatBridge,
  hooks: { busy: () => boolean; onAuthorize: () => void },
): () => void {
  const panel = doc.querySelector<HTMLElement>('#copied');
  const note = doc.querySelector<HTMLElement>('#copied-note');
  const preview = doc.querySelector<HTMLTextAreaElement>('#copied-text');
  const actions = doc.querySelector<HTMLElement>('#copied-actions');
  const question = doc.querySelector<HTMLInputElement>('#copied-question');
  const sendButton = doc.querySelector<HTMLButtonElement>('#copied-send');
  const closeButton = doc.querySelector<HTMLButtonElement>('#copied-close');
  const explain = doc.querySelector<HTMLButtonElement>('#copied-explain');
  const summarize = doc.querySelector<HTMLButtonElement>('#copied-summarize');
  const translate = doc.querySelector<HTMLButtonElement>('#copied-translate');
  const ask = doc.querySelector<HTMLButtonElement>('#copied-ask');
  if (!panel || !note || !preview || !actions || !question || !sendButton || !closeButton || !explain || !summarize || !translate || !ask) {
    return () => {};
  }
  const buttons: Record<ClipboardAction, HTMLButtonElement> = {
    explain, summarize, translate, ask,
  };
  let action: ClipboardAction | null = null;

  const showNote = (message: string): void => {
    note.textContent = message;
    note.hidden = false;
  };
  const hideNote = (): void => {
    note.textContent = '';
    note.hidden = true;
  };
  const setAction = (next: ClipboardAction | null): void => {
    action = next;
    for (const [name, button] of Object.entries(buttons)) {
      button.setAttribute('aria-pressed', name === next ? 'true' : 'false');
    }
    question.hidden = next !== 'ask';
    if (next) {
      bridge.notifyContextPose('attentive');
    }
    refresh();
  };
  const refresh = (): void => {
    if (preview.hidden) {
      return;
    }
    const text = preview.value;
    if (text.length > CLIPBOARD_TEXT_LIMIT) {
      showNote(`This text is ${text.length} characters. The limit is ${CLIPBOARD_TEXT_LIMIT}. Shorten it before sending.`);
    } else if (text.trim().length === 0) {
      showNote('The preview is empty. Restore the words you want to ask about, or close this panel.');
    } else {
      hideNote();
    }
    const composed = action
      ? composeClipboardQuestion({ action, text, question: question.value })
      : { ok: false as const, reason: 'empty' as const };
    sendButton.disabled = hooks.busy() || !composed.ok;
  };
  const closePanel = (): void => {
    action = null;
    preview.value = '';
    question.value = '';
    question.hidden = true;
    hideNote();
    for (const button of Object.values(buttons)) {
      button.setAttribute('aria-pressed', 'false');
    }
    sendButton.disabled = true;
    panel.hidden = true;
    bridge.dismissCopiedText();
    bridge.notifyContextPose('clear');
  };
  const showOffer = (offer: ClipboardOffer): void => {
    action = null;
    question.value = '';
    question.hidden = true;
    for (const button of Object.values(buttons)) {
      button.setAttribute('aria-pressed', 'false');
    }
    if (offer.kind === 'clear') {
      closePanel();
      return;
    }
    panel.hidden = false;
    if (offer.kind === 'empty') {
      preview.value = '';
      preview.hidden = true;
      actions.hidden = true;
      sendButton.hidden = true;
      showNote('Copy text with Ctrl+C in another app, then choose Ask about copied text again.');
      return;
    }
    if (offer.kind === 'too-long') {
      preview.value = '';
      preview.hidden = true;
      actions.hidden = true;
      sendButton.hidden = true;
      showNote(`That copy is ${offer.length} characters. The limit is ${offer.limit}, so nothing was kept. Copy a shorter selection.`);
      return;
    }
    preview.hidden = false;
    actions.hidden = false;
    sendButton.hidden = false;
    preview.value = offer.text;
    hideNote();
    sendButton.disabled = true;
    preview.focus();
  };
  const send = (): void => {
    if (!action || sendButton.disabled || hooks.busy()) {
      return;
    }
    const composed = composeClipboardQuestion({
      action,
      text: preview.value,
      question: question.value,
    });
    if (!composed.ok) {
      refresh();
      return;
    }
    const message = composed.message;
    preview.value = '';
    question.value = '';
    panel.hidden = true;
    action = null;
    hooks.onAuthorize();
    bridge.notifyContextPose('clear');
    bridge.sendContextMessage(message);
  };

  closeButton.addEventListener('click', closePanel);
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  });
  sendButton.addEventListener('click', send);
  preview.addEventListener('input', refresh);
  question.addEventListener('input', refresh);
  for (const [name, button] of Object.entries(buttons)) {
    button.addEventListener('click', () => {
      setAction(name as ClipboardAction);
      if (name === 'ask') {
        question.focus();
      }
    });
  }
  bridge.onCopiedText(showOffer);
  return refresh;
}
