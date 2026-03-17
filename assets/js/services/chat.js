/**
 * Chat Service (Agente IA)
 * Plataforma PFO — GSE
 *
 * Handles communication with the Claude AI agent via /api/chat proxy.
 *
 * BACKWARD COMPATIBILITY:
 *   - Same API contract with /api/chat
 *   - Same message format (role + content)
 *   - Enhanced with better context building and error handling
 */

import { request, ApiError } from './api.js';
import { state } from '../state.js';
import { safeNumber, formatNumber, getCurrentMonth, formatMonth } from '../utils/format.js';
import { getStatus } from '../pages/shared.js';

/**
 * Send a message to the AI agent and get a response.
 *
 * @param {string} userMessage - The user's message
 * @returns {Promise<string>} The agent's response text
 */
export async function sendChatMessage(userMessage) {
  // Add user message to state history
  state.addChatMessage({ role: 'user', content: userMessage });

  try {
    const context = buildContext();

    // Build clean message history for the API (exclude error messages)
    const apiMessages = state.chatHistory.filter(
      (m) => m.role === 'user' || (m.role === 'assistant' && !m._isError)
    );

    const response = await request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: buildSystemPrompt(context),
        messages: apiMessages,
      }),
    });

    const replyText =
      response.content?.[0]?.text || 'Sem resposta do agente.';

    state.addChatMessage({ role: 'assistant', content: replyText });
    return replyText;
  } catch (error) {
    console.error('[Chat] Error:', error.message);
    const errorMsg = 'Erro ao conectar ao agente. Verifique se a chave ANTHROPIC_API_KEY está configurada no Vercel.';
    // Mark error messages so they don't get sent to API
    state.addChatMessage({ role: 'assistant', content: errorMsg, _isError: true });
    throw new ApiError(errorMsg);
  }
}

/**
 * Build context string from current platform data.
 * Provides rich context about the current state of the platform.
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

    const st = getStatus(pfo, aprovacoes);
    if (st === 'aprovado') aprovados++;
    else if (st === 'reprovado') reprovados++;
    else if (st === 'enviado') enviados++;
    else pendentes++;
  });

  const margem = receitaTotal > 0 ? ((receitaTotal - custoTotal) / receitaTotal * 100) : 0;
  const resultado = receitaTotal - custoTotal;

  // Build context lines
  const lines = [
    `Ciclo: ${formatMonth(mes)}`,
    `Total de PFOs: ${pfos.length}`,
    `Centros de custo ativos: ${Object.keys(centros).length}`,
    `Receita total projetada: R$ ${formatNumber(receitaTotal / 1000)}k`,
    `Custo total projetado: R$ ${formatNumber(custoTotal / 1000)}k`,
    `Resultado projetado: R$ ${formatNumber(resultado / 1000)}k`,
    `Margem consolidada: ${margem.toFixed(1)}%`,
    `Status: ${aprovados} aprovados, ${enviados} enviados, ${pendentes} pendentes, ${reprovados} reprovados`,
  ];

  // Add specific alerts
  if (reprovados > 0) {
    lines.push(`ALERTA CRÍTICO: ${reprovados} PFO(s) reprovado(s) necessitam reenvio urgente.`);
  }
  if (margem < 5 && pfos.length > 0) {
    lines.push(`ALERTA: Margem de ${margem.toFixed(1)}% está abaixo da meta de 5%.`);
  }
  if (pendentes > 3) {
    lines.push(`ALERTA: ${pendentes} centros ainda não enviaram PFO.`);
  }

  // Add top 5 projects by revenue for context
  if (pfos.length > 0) {
    const topPfos = [...pfos]
      .sort((a, b) => safeNumber(b.dre?.receita?.projetado || 0) - safeNumber(a.dre?.receita?.projetado || 0))
      .slice(0, 5);

    lines.push('\nPrincipais projetos por receita:');
    topPfos.forEach((pfo) => {
      const rc = safeNumber((pfo.dre?.receita?.projetado || 0) * 1000);
      const cs = safeNumber((pfo.dre?.custo?.projetado || 0) * 1000);
      const mg = rc > 0 ? ((rc - cs) / rc * 100) : 0;
      const st = getStatus(pfo, aprovacoes);
      lines.push(`- ${pfo.projeto || pfo.arquivo || '—'}: receita R$ ${formatNumber(rc / 1000)}k, margem ${mg.toFixed(1)}%, status ${st}`);
    });
  }

  return lines.join('\n');
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
- Recomendar ações corretivas

Regras:
- Responda sempre em português brasileiro
- Seja executivo e direto, com dados concretos quando disponíveis
- Use formatação com **negrito** para destacar valores importantes
- Quando não souber algo específico, sugira onde buscar a informação
- Nunca invente dados — use apenas o contexto fornecido
- Quando os dados estiverem vazios, informe que o ciclo pode não ter PFOs enviados ainda

Contexto atual da plataforma:
${context}`;
}

/**
 * Get suggested quick prompts.
 * @returns {Array<{label: string, prompt: string}>}
 */
export function getQuickPrompts() {
  return [
    { label: 'Status do ciclo', prompt: 'Como está o status do ciclo atual?' },
    { label: 'Pendências', prompt: 'Quais são as pendências críticas?' },
    { label: 'Margem', prompt: 'Como está a margem consolidada e quais projetos estão em risco?' },
    { label: 'Resumo executivo', prompt: 'Faça um resumo executivo completo do ciclo atual.' },
  ];
}
