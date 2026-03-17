/**
 * Chat Service (Agente IA)
 * Plataforma PFO — GSE
 *
 * Handles communication with the Claude AI agent via /api/chat proxy.
 *
 * BACKWARD COMPATIBILITY:
 *   - Same API contract with /api/chat
 *   - Same message format (role + content)
 *   - Enhanced with better context building
 */

import { request, ApiError } from './api.js';
import { state } from '../state.js';
import { safeNumber, formatNumber, getCurrentMonth, formatMonth } from '../utils/format.js';

/**
 * Send a message to the AI agent and get a response.
 *
 * @param {string} userMessage - The user's message
 * @returns {Promise<string>} The agent's response text
 */
export async function sendChatMessage(userMessage) {
  // Add user message to history
  state.addChatMessage({ role: 'user', content: userMessage });

  try {
    const context = buildContext();
    const response = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: buildSystemPrompt(context),
        messages: state.chatHistory,
      }),
    });

    const replyText =
      response.content?.[0]?.text || 'Sem resposta do agente.';

    state.addChatMessage({ role: 'assistant', content: replyText });
    return replyText;
  } catch (error) {
    const errorMsg = 'Erro ao conectar ao agente. Tente novamente.';
    state.addChatMessage({ role: 'assistant', content: errorMsg });
    throw new ApiError(errorMsg);
  }
}

/**
 * Build context string from current platform data.
 * @returns {string}
 */
function buildContext() {
  const data = state.data;
  if (!data) return 'Dados da plataforma não carregados.';

  const pfos = data.pfos || [];
  const centros = data.centros_custo || {};
  const aprovacoes = data.aprovacoes || {};
  const mes = getCurrentMonth();

  // Calculate key metrics
  let receitaTotal = 0;
  let custoTotal = 0;
  let aprovados = 0;
  let pendentes = 0;
  let reprovados = 0;
  let enviados = 0;

  pfos.forEach((pfo) => {
    receitaTotal += safeNumber((pfo.dre?.receita?.projetado || 0) * 1000);
    custoTotal += safeNumber((pfo.dre?.custo?.projetado || 0) * 1000);

    const key = (pfo.arquivo || '').replace(/\.xlsm$/, '').replace(/\.xlsx$/, '').replace(/\.xls$/, '');
    const apr = aprovacoes[key] || {};
    const st = apr.status || '';
    if (st === 'aprovado') aprovados++;
    else if (st === 'reprovado') reprovados++;
    else if (st.includes('aguardando') || st.includes('validacao') || st.includes('aprovacao')) enviados++;
    else if (pfo.arquivo) enviados++;
    else pendentes++;
  });

  const margem = receitaTotal > 0 ? ((receitaTotal - custoTotal) / receitaTotal * 100) : 0;

  return [
    `Ciclo: ${formatMonth(mes)}`,
    `PFOs: ${pfos.length}`,
    `Centros de custo: ${Object.keys(centros).length}`,
    `Receita total projetada: R$ ${formatNumber(receitaTotal / 1000)}k`,
    `Custo total projetado: R$ ${formatNumber(custoTotal / 1000)}k`,
    `Margem consolidada: ${margem.toFixed(1)}%`,
    `Status: ${aprovados} aprovados, ${enviados} enviados, ${pendentes} pendentes, ${reprovados} reprovados`,
    reprovados > 0 ? `ALERTA: ${reprovados} PFO(s) reprovado(s) necessitam reenvio.` : '',
  ].filter(Boolean).join('. ');
}

/**
 * Build the system prompt for Claude.
 * @param {string} context
 * @returns {string}
 */
function buildSystemPrompt(context) {
  return `Você é o Agente PFO da GSE (Global Service Engenharia). Analista financeiro especialista em gestão de obras e projetos de engenharia.

Suas capacidades:
- Analisar margens, receitas e custos dos projetos
- Identificar pendências e riscos no ciclo atual
- Fornecer resumos executivos para diretoria
- Comparar performance entre centros de custo
- Alertar sobre desvios e anomalias financeiras

Regras:
- Responda sempre em português brasileiro
- Seja executivo e direto, com dados concretos
- Use formatação com **negrito** para destacar valores importantes
- Quando não souber algo específico, sugira onde buscar a informação
- Nunca invente dados — use apenas o contexto fornecido

Contexto atual da plataforma:
${context}`;
}

/**
 * Get suggested quick prompts based on current data state.
 * @returns {Array<{label: string, prompt: string}>}
 */
export function getQuickPrompts() {
  return [
    { label: 'Status do ciclo', prompt: 'Como está o status do ciclo atual?' },
    { label: 'Pendências', prompt: 'Quais são as pendências críticas?' },
    { label: 'Margem', prompt: 'Como está a margem consolidada?' },
    { label: 'Resumo executivo', prompt: 'Faça um resumo executivo.' },
  ];
}
