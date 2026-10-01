# Specs de implementação do Overclock

Specs normativas das funcionalidades do produto, destiladas dos [módulos lógicos](../modulos-logicos/README.md). Objetivo: outro software (ou equipe/agente) implementar cada funcionalidade só com a spec.

Comece pela [spec-00](spec-00-visao-arquitetura-e-glossario.md): arquitetura, glossário canônico, modelo de dados compartilhado, planos/entitlements, requisitos transversais e ordem de implementação.

## Como ler os selos

| Selo | Significado |
|---|---|
| `[OBS]` | Observado nas lives ou nos módulos lógicos (com fonte: módulo e dia) |
| `[DEC]` | Decisão da autora da spec, porque implementar exige e o material não diz |
| `[LAC]` | Lacuna: o material não define e o dono do produto precisa decidir |

`[DEC]` nunca é comportamento comprovado do original. Cada spec lista suas `[LAC]` em "Questões em aberto".

## Índice

| Spec | Funcionalidade | Origem | Tamanho |
|---|---|---|---|
| [00](spec-00-visao-arquitetura-e-glossario.md) | Visão, arquitetura e glossário | todos | 31 KB |
| [01](spec-01-terminais-paineis-workspaces.md) | Terminais, painéis e workspaces | construído | 50 KB |
| [02](spec-02-orquestracao-modo-agentico.md) | Orquestração e modo agêntico | parcial | 38 KB |
| [03](spec-03-harness-roteamento-decisor.md) | Harness, roteamento e decisor | parcial | 40 KB |
| [04](spec-04-providers-e-modelos.md) | Providers e modelos | construído | 43 KB |
| [05](spec-05-catalogo-skills-mcp-hooks.md) | Catálogo de skills, MCPs e hooks | parcial | 25 KB |
| [06](spec-06-over-memory.md) | Over Memory | parcial | 21 KB |
| [07](spec-07-overclock-voice.md) | Overclock Voice | construído | 16 KB |
| [08](spec-08-overclock-shot.md) | Overclock Shot | construído | 11 KB |
| [09](spec-09-overclock-headline.md) | Overclock Headline | construído | 12 KB |
| [10](spec-10-overclock-bot.md) | Overclock Bot (mobile, relay, VPS) | parcial | 36 KB |
| [11](spec-11-jarvis-open-jarvis.md) | Jarvis e Open Jarvis | parcial | 37 KB |
| [12](spec-12-overclick.md) | Overclick (com Zero e Overrunner como integrações) | construído | 39 KB |
| [14](spec-14-bench.md) | Bench | parcial | 46 KB |

Não há spec-13, 15, 16, 17, 18, 19 nem 20. Esses módulos não são funcionalidade do produto ou estão cobertos na spec-00 (planos em §6, infra em §7) e na spec-12 (Zero e Overrunner). A justificativa de cada um está na §11 da spec-00.

## Ajustes feitos depois da escrita

As specs foram escritas em paralelo, sem ver umas às outras. Depois disso:

- Referências a `spec-16`, `spec-17` e `spec-18`, que não existem, foram trocadas por ponteiros à spec-00 (§6 e §7) ou ao módulo lógico 16.
- `pane_open` (specs 02 e 05) foi unificado em `pane_spawn`, o nome que aparece nas lives (spec-10).

## Inconsistências conhecidas entre specs

Nomes de tools MCP são quase todos `[DEC]` (o original citou de 10 a 54 tools sem listar). Ainda divergem entre specs e precisam ser reconciliados antes de implementar:

| Operação | Nome canônico sugerido | Variante em outra spec |
|---|---|---|
| Listar painéis | `pane_list` (specs 01, 05, 10) | `list_panes` (spec-11) |
| Enviar texto/prompt ao painel | `pane_send` (specs 02, 05) | `send_prompt` (spec-11) |
| Criar missão | `mission_create` | `create_mission` (spec-11) |
| Listar missões | `mission_list` (specs 05, 10) | — |

Também não foram reconciliados: o esquema de tools do MCP do Headline (spec-09, nomes inventados) com o restante do catálogo da spec-05, e o esquema de estados do Card (spec-12) com o de Task da spec-00.

## Fontes consultadas pelos autores

A maioria das specs foi escrita só a partir dos módulos lógicos, sem conferir as transcrições brutas. Exceção parcial: a spec-00 (leu módulos 01 a 06, 12, 18 e 19 e passou pelos demais). Detalhes específicos, como valores, prompts e atalhos, devem ser conferidos contra `projeto-bruto` antes de virarem requisito.

## Lacunas gerais

- Preços e gating de planos conflitam entre lives (Voice, Jarvis, Squads e Overclick cloud aparecem em planos diferentes).
- Migração Electron para Rust/Tauri, licença atrelada a IP contra uso em VPS e mobile, contagem de tools MCP (10, 20, 29, 52, 54) e o algoritmo final de roteamento de conta seguem em aberto.
- Prompts reais do sistema (piloto, cloquinho, decisor, juiz do bench, refino do Voice) não foram registrados nas lives. As specs trazem prompts-base `[DEC]`.
