/**
 * Relatórios Page
 * Plataforma PFO — GSE
 *
 * Mostly static — links to Streamlit app.
 * Initialized once on app start.
 */

import { STREAMLIT_URL } from './shared.js';

/**
 * Initialize report card click handlers.
 */
export function initRelatorios() {
  const cards = document.querySelectorAll('.report-card[data-report]');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      window.open(STREAMLIT_URL, '_blank');
    });
  });
}
