# ExpxV — plano de construção (ADE do método Expx)

Este plano foi escrito **sem sprintx e sem runx**, a pedido do dono. Ele é executável de ponta a
ponta por um agente, sem perguntas. Quem retomar o trabalho (inclusive depois de perder o contexto)
lê **este arquivo, depois `STATUS.md`**, e continua da primeira task pendente.

## O que é o produto

**ExpxV** é um app Electron (macOS e Windows) que funciona como **ADE** (Agentic Development
Environment) para o método Expx: terminais reais de CLIs de IA (Claude Code, Codex, Gemini,
OpenCode…), orquestração piloto/workers, Missões com worktree git e integração de primeira classe
com o que o `expxdev` grava em `docs/` (sprintx, runx, prodx, mergex…). As funcionalidades vêm das
specs do Overclock; o "jeito da casa" (stack, tokens visuais, padrões de PTY, segurança de janela)
vem do ExpxMedia. É um **app separado**: só compartilha identidade visual.

Nome do produto: constante única em `src/nucleo/produto.ts` (decisão D-01). Hoje: `ExpxV`.

## Prioridade número um: leveza e velocidade

Pedido explícito do dono: telas leves, transições fluidas, nada demora para abrir, nada trava.
Isso é **requisito de aceite**, não intenção: `03-ORCAMENTOS-DESEMPENHO.md` tem números, e o teste
`npm run perf` falha quando estoura. Toda task de UI herda esses orçamentos.

## Mapa dos documentos

| Arquivo | Conteúdo |
|---|---|
| `DECISOES-DAS-PENDENCIAS.md` | **override**: decisões das pendências do dono (sempre a opção mais completa); ler ANTES de implementar qualquer fase |
| `PILOTO-AUTOMATICO.md` | protocolo da execução contínua sem o dono (fila de fases, regras, como retomar) |
| `STATUS.md` | **fonte da verdade do andamento**: fase atual, task atual, log, bloqueios |
| `PENDENCIAS-DO-DONO.md` | decisões que só o dono pode tomar (cada uma com o padrão já adotado) |
| `01-DECISOES.md` | decisões de arquitetura e produto (D-NN), com alternativa descartada |
| `02-ARQUITETURA.md` | processos, módulos, pastas, fluxo de dados |
| `03-ORCAMENTOS-DESEMPENHO.md` | orçamentos medidos de leveza e velocidade |
| `04-UI-UX.md` | layout, menus, telas, atalhos, tokens, estados |
| `05-CONTRATOS.md` | schema do banco, IPC, tools MCP, eventos, arquivos gravados |
| `06-FASES.md` | visão das fases (MVP detalhado, pós-MVP resumido) |
| `fase-NN-*.md` | tasks de cada fase do MVP, com critério de aceite binário |
| `base/` | base de conhecimento: specs do Overclock e os seis resumos técnicos |

## Protocolo de execução autônoma

Laço por task, na ordem das fases, respeitando `depende_de`:

1. Ler a task na `fase-NN-*.md` e o que ela cita em `base/`, `05-CONTRATOS.md` e `04-UI-UX.md`.
2. **Teste primeiro**: escrever os testes da task e vê-los falhar pelo motivo certo.
3. Implementar o mínimo para passar.
4. Rodar `npm run verificar` (typecheck + testes + regra de marca + orçamentos estáticos). Verde.
5. Marcar a task em `STATUS.md` (`[x]`, data, observação de uma linha).
6. Decisão nova que não está nos documentos: **escolher o padrão mais seguro e simples**, registrar
   em `01-DECISOES.md` (D-NN) e, se for do dono, em `PENDENCIAS-DO-DONO.md`. Nunca parar para perguntar.
7. Bloqueio real (ferramenta ausente, rede fora): registrar em `STATUS.md` → "Bloqueios", pular a
   task, seguir com a próxima independente.

Fim de fase: rodar o portão da fase (lista no topo de cada `fase-NN`), registrar no `STATUS.md`.

### Paralelismo

Tasks sem dependência entre si e com arquivos disjuntos podem ir para subagentes em paralelo
(uma área de arquivos por agente). O agente principal integra, roda `npm run verificar` e atualiza
`STATUS.md`. Ninguém edita os mesmos arquivos ao mesmo tempo.

## Regras invioláveis

1. **Nada sai da máquina.** Sem `git push`, sem publicar, sem chamada paga, sem envio de dados.
   Testes usam CLIs falsas e stubs locais.
2. **Nunca ler nem escrever `.env` de ninguém.** Erros citam o nome da variável, nunca o valor.
3. **Sem commits** enquanto o dono não pedir. O trabalho fica na árvore de trabalho da `main`.
4. **Os projetos de origem são somente leitura**: `../ExpxMedia` e as specs do Overclock só se lê.
   Código do ExpxMedia pode ser **adaptado** (é do mesmo dono), nunca editado lá.
5. **TDD**: teste antes, falhando antes de passar. Suíte verde ao fim de cada task.
6. **Contratos primeiro**: `05-CONTRATOS.md` manda. Divergir exige mudar o contrato, não contornar.
7. **Segurança de janela** (contextIsolation, sandbox, sem nodeIntegration) e **validação de todo
   payload de IPC** na borda do main.
8. **Sem dependência nova sem justificar custo** (tamanho, startup, nativo). Ver D-03 e D-05.
9. **Caminhos relativos** em artefatos gravados pelo app (relativos à raiz do workspace).
10. Idioma: prosa em PT-BR com acento; identificadores de domínio em PT sem acento; nomes de
    protocolo externo (tools MCP, eventos) em inglês `snake_case`.

## Definição de pronto

- **Task**: critério de aceite cumprido, testes escritos antes, `npm run verificar` verde.
- **Fase**: todas as tasks `[x]`, portão da fase verde, orçamentos da fase medidos.
- **MVP**: fases 0 a 5 completas, `npm run perf` verde, pacote local gerado e verificado
  (`npm run test:pacote`), auditoria final registrada em `docs/ade/AUDITORIA-MVP.md`.
