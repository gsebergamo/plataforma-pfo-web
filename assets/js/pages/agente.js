/**
 * Agente IA Page
 * Plataforma PFO — GSE
 */

import { sendChatMessage, getQuickPrompts } from '../services/chat.js';
import { getCurrentUser } from '../auth.js';
import { renderMarkdown } from '../components/ui.js';

let _initialized = false;

/**
 * Initialize chat event handlers. Called once.
 */
export function initAgente() {
  if (_initialized) return;
  _initialized = true;

  const input = document.getElementById('chat-in');
  const sendBtn = document.getElementById('send-btn');

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', handleSend);
  }

  // Quick prompt buttons
  const container = document.getElementById('quick-prompts');
  if (container) {
    const prompts = getQuickPrompts();
    container.innerHTML = prompts
      .map(
        (p) =>
          `<button class="btn secondary btn-sm" data-prompt="${p.prompt}">${p.label}</button>`
      )
      .join('');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-prompt]');
      if (btn) {
        const input = document.getElementById('chat-in');
        if (input) input.value = btn.dataset.prompt;
        handleSend();
      }
    });
  }
}

/**
 * Handle sending a message.
 */
async function handleSend() {
  const input = document.getElementById('chat-in');
  const sendBtn = document.getElementById('send-btn');
  const msg = input?.value.trim();
  if (!msg) return;

  input.value = '';
  input.style.height = 'auto';
  addMessageToUI('user', msg);

  if (sendBtn) sendBtn.disabled = true;
  const typingId = addTypingIndicator();

  try {
    const reply = await sendChatMessage(msg);
    removeTypingIndicator(typingId);
    addMessageToUI('agent', reply);
  } catch {
    removeTypingIndicator(typingId);
    addMessageToUI('agent', 'Erro ao conectar ao agente. Tente novamente.');
  }

  if (sendBtn) sendBtn.disabled = false;
  input?.focus();
}

/**
 * Add a message to the chat UI.
 */
function addMessageToUI(role, text) {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return;

  const user = getCurrentUser();
  const initials = user?.initials || 'U';

  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'user' ? initials : '◉'}</div>
    <div class="msg-bubble">${renderMarkdown(text)}</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

/**
 * Add a typing indicator.
 * @returns {string} Element ID
 */
function addTypingIndicator() {
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return '';

  const id = 't-' + Date.now();
  const div = document.createElement('div');
  div.className = 'chat-msg agent';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">◉</div>
    <div class="msg-bubble">
      <div class="typing"><span></span><span></span><span></span></div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

/**
 * Remove typing indicator.
 */
function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}
