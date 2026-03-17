/**
 * Upload PFO Page
 * Plataforma PFO — GSE
 */

import { state } from '../state.js';
import { badge, tableEmpty } from '../components/ui.js';

/**
 * Initialize upload page event handlers.
 * Called once on app init.
 */
export function initUpload() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-in');

  if (zone && fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        showFilePreview(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) showFilePreview(fileInput.files[0]);
    });
  }
}

/**
 * Show file preview after selection.
 */
function showFilePreview(file) {
  const prev = document.getElementById('file-prev');
  if (!prev) return;

  document.getElementById('f-name').textContent = file.name;
  document.getElementById('f-size').textContent = (file.size / 1024).toFixed(1) + ' KB';
  prev.style.display = 'block';
}

/**
 * Render recent uploads table.
 */
export function renderUploads() {
  const data = state.data;
  if (!data) return;

  const pfos = (data.pfos || []).slice(0, 10);
  const tbody = document.getElementById('uploads-tbody');
  if (!tbody) return;

  if (!pfos.length) {
    tbody.innerHTML = tableEmpty(5, 'Nenhum upload recente');
    return;
  }

  tbody.innerHTML = pfos
    .map((p) => {
      const dt = p.upload?.data_hora || '—';
      const st = p.arquivo ? 'enviado' : 'pendente';
      return `<tr>
        <td style="font-size:11px;color:var(--muted)">${(p.arquivo || '—').substring(0, 30)}</td>
        <td class="td-mono">${p.projeto || '—'}</td>
        <td class="td-muted">${p.usuario || p.enviado_por || '—'}</td>
        <td class="td-muted td-mono">${dt}</td>
        <td>${badge(st)}</td>
      </tr>`;
    })
    .join('');
}
