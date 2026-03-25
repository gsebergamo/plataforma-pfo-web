# Plataforma PFO Web

Dashboard Financeiro Executivo — **Global Service Engenharia**

## Visão Geral

Plataforma de monitoramento financeiro para diretores e gestores, com:

- **Dashboard Executivo** — KPIs de receita, margem, pendências
- **Ciclos & Governança** — Fluxo de aprovação de PFOs
- **Upload de PFO** — Envio de arquivos .xlsx
- **Aprovações** — Fila de aprovações por diretoria
- **Centros de Custo** — Listagem e busca de centros
- **Agente IA** — Chat com Claude para análise financeira
- **Relatórios** — Links para relatórios e exportações

## Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | JavaScript (ES Modules), HTML5, CSS3 |
| Backend | Vercel Serverless Functions (Node.js) |
| Dados | GitHub API (JSON) |
| IA | Anthropic Claude Sonnet 4 |
| Deploy | Vercel |

## Estrutura do Projeto

```
plataforma-pfo-web/
├── index.html                  # SPA — HTML shell
├── package.json                # Configuração do projeto
├── api/
│   ├── chat.js                 # Proxy para API Claude
│   └── data.js                 # Proxy para GitHub API
├── assets/
│   ├── css/
│   │   └── main.css            # Design system completo
│   └── js/
│       ├── app.js              # Entry point
│       ├── router.js           # SPA router (hash-based)
│       ├── state.js            # State management com cache
│       ├── auth.js             # Abstração de autenticação
│       ├── services/
│       │   ├── api.js          # HTTP client base
│       │   ├── github.js       # Serviço de dados GitHub
│       │   └── chat.js         # Serviço do agente IA
│       ├── pages/
│       │   ├── shared.js       # Utilitários compartilhados
│       │   ├── dashboard.js    # Página Dashboard
│       │   ├── ciclos.js       # Página Ciclos
│       │   ├── upload.js       # Página Upload
│       │   ├── aprovacoes.js   # Página Aprovações
│       │   ├── centros.js      # Página Centros de Custo
│       │   ├── agente.js       # Página Agente IA
│       │   └── relatorios.js   # Página Relatórios
│       ├── components/
│       │   └── ui.js           # Componentes reutilizáveis
│       └── utils/
│           └── format.js       # Utilitários de formatação
└── tests/
    └── utils.test.js           # Testes unitários
```

## Setup Local

```bash
# Servir localmente
npx serve . -l 3000

# Rodar testes
npm test
```

## Variáveis de Ambiente (Vercel)

| Variável | Descrição |
|----------|-----------|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (Claude) |
| `GITHUB_TOKEN` | Token de acesso ao GitHub |
| `GITHUB_REPO` | Repositório de dados (default: `gsebergamo/plataforma-pfo`) |

## Arquitetura

```
Browser (SPA)
    │
    ├── /api/data  ──→  GitHub API  ──→  dados/plataforma.json
    │
    └── /api/chat  ──→  Anthropic API  ──→  Claude Sonnet 4
```

- **Dados**: JSON armazenado no GitHub como pseudo-banco de dados
- **Cache**: 5 minutos no client-side, 2 minutos no CDN
- 
- **Autenticação**: Abstração preparada para integração futura
- **Estado**: Centralizado em `state.js` com subscriptions
