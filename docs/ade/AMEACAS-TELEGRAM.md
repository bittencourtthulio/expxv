# Estudo de ameaças — Fase 20 (alertas + bot do Telegram)

T-20.01. Escrito na onda 2, **depois** do núcleo (a onda 1 seguiu a pré-análise do plano e provou cada caso AB com um teste nomeado). Este documento é o estudo formal: fronteiras,
ativos, atores, STRIDE por componente, 30 casos de abuso, portões, residuais e a confirmação das decisões D-150..D-159. É validado por `tests/scripts/ameacas-fase20.test.ts`
(toda ameaça Alta aponta para uma task `T-20.NN` que existe no plano e para um teste que existe) e a defesa de cada caso é exercitada por mutação em
`tests/scripts/mutacao-fase20.mjs` (a mitigação sai, o teste precisa ficar vermelho). Herda e **não duplica** o estudo da Fase 13 (STRIDE por componente, `ConfirmacaoPendente` de uso
único, redação, matriz de risco): onde a Fase 13 ainda não existe, `telegram_aprovacao` implementa a mesma semântica (uso único, TTL, `args_hash`, atômico).

Fonte da API: `docs/ade/fase-20-alertas-comunicacao.md` ("Pesquisa: Telegram Bot API", lida em 2026-09-30). Tudo marcado **não confirmado** lá continua não confirmado aqui; o
projeto trata o lado perigoso como verdadeiro (ex.: bot não é ponta a ponta).

## 1. Fronteiras de confiança

```
                       F4 (fora do nosso controle)
   conta Telegram do  ───────────────────────────►  Telegram (empresa, nuvem)
   dono (SIM, celular)                                   ▲        │
        │ F1 pessoa ↔ app (desktop)                      │ F3     │ F3
        ▼                                                │ TLS,   ▼ TLS, host fixo api.telegram.org,
   ┌──────────────────────────  processo main (ExpxV)  ──┴────────┴─── sem proxy implícito, sem redirect
   │  renderer (sem Node) ──IPC validado──► ligação de alertas ──► canal SO (notificação local)
   │                                              │
   │   F2 mensagem do Telegram = DADO NÃO CONFIÁVEL│  poller → autorização (from.id + chat privado)
   │   ─────────────────────────────────────────► │  → limite de taxa → parser → pré-filtro de gestos
   │                                               │  → orquestrador (Maestro, por REGRAS) → política pura
   │   F5 autorização ─────────────────────────────┤  → nonce de uso único + args_hash → serviços reais
   │                                               ▼
   │   F6 texto de terceiros (PR/issue/commit/título)  ──►  redação + escape HTML + truncar antes de sair
   └─ cofre do SO (token, só nele) · banco SQLite (sem token/PIN em claro) · pânico (botão, bandeja, /parar)
```

| Fronteira | O que cruza | Controle |
|---|---|---|
| F1 pessoa ↔ app | consentimento, token (uma vez), PIN (uma vez), "Permitir" do pareamento, pânico | canais `sensivel` (log nunca imprime o payload), campos que só o main define (efemeridade, origem, destino de entrega), decisão sempre no desktop |
| F2 mensagem Telegram ↔ orquestrador | texto livre, comandos, callbacks | dado não confiável: normalizar → redigir → ≤ 2 000 → pré-filtro → envelope `<pedido_remoto tipo="dados">` → plano **por código** (a LLM nunca decide ação) |
| F3 app ↔ `api.telegram.org` | alertas redigidos, `getUpdates` | só conexão de saída; host fixo; `https`; sem redirecionamento; teto 1 MiB; caminho (com o token) nunca registrado; consentimento ou clique antes de abrir socket |
| F4 conta Telegram ↔ Telegram | tudo | **fora do nosso controle** (residuais R1, R2) |
| F5 orquestrador ↔ serviços de execução | `executarPlano` | reavaliação do plano **vivo** + `args_hash` + política na execução; ações só da lista fechada; nada humano/destrutivo |
| F6 alerta ↔ texto de terceiros | títulos de PR/issue/commit, nome de tarefa | `escaparHtml` por valor, truncar, itálico entre aspas, sem preview de link, redação na entrada **e** na saída, "ocultar títulos" |

## 2. Inventário de ativos

1. **Token do bot** (cofre; mascarado na UI). 2. **Capacidade de iniciar execução** na máquina do dono (a entrada remota). 3. **Conteúdo dos alertas** (títulos, tempos, tokens, pontos).
4. **`user_id` autorizado** e seus workspaces/modo. 5. **Offset/`update_id`** do poller. 6. **Código de pareamento** (50 bits, 5 min, só memória). 7. **Auditoria** (`telegram_auditoria`, 90 d).
8. **Repositório do usuário** (worktrees, branches, histórico). 9. **PIN** (só o hash `scrypt`). 10. **Nonces de aprovação** (só o `sha256`).

## 3. Atores

| Ator | Pode | Não pode (garantia) |
|---|---|---|
| Dono presente | tudo, no app | — |
| Dono ausente (celular) | consultar; pedir e aprovar planos de baixo risco nos workspaces que liberou | rigidez ≥ 4, raio ALTO, branch protegida, destrutivo, mudar rigidez/permissão, ler arquivo |
| Conta Telegram do dono sequestrada (SIM swap) | o mesmo que o dono ausente (R2) | o que o dono ausente não pode; PIN opcional; `/parar` e pânico no app |
| Desconhecido que achou o `@bot` | mandar mensagem | obter qualquer resposta (silêncio total, sem oráculo); só incrementa um contador sem texto |
| Outro processo local | ler o banco (sem token/PIN) | obter o token (só no cofre do SO) |
| Quem roubou o token | enviar mensagens falsas ao dono; drenar updates (R3) | executar algo: aprovação só por nonce do banco; 409/webhook detectam |
| Telegram (empresa) | ler o conteúdo das mensagens do bot (R1) | — (não ponta a ponta; conteúdo mínimo por padrão) |
| Rede hostil | tentar MITM | TLS padrão, host único, sem redirecionamento, sem CA custom |

## 4. STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Cliente Bot API (`api.ts`, `alertas-rede.ts`) | host fixo, template `/bot{token}/<método>` | corpo só JSON | erros tipados | token só dentro do cliente, sem `log`, erro sem caminho | teto 1 MiB, timeout, `AbortSignal` com aborto real | consentimento antes do socket |
| Poller | `allowed_updates` + filtro defensivo | offset só depois do lote, mesma transação | `telegram_auditoria` | — | backoff, 429, 409 para | uma instância por token (trava) |
| Autorização | `from.id` + `chat.id` privado, nunca `username` | `args_hash` do plano | `pareamento_*` auditado | silêncio para desconhecido | token bucket 20/min | validade 30 d, revogação |
| Pareamento | código 50 bits, `timingSafeEqual` | só memória | auditoria | resposta uniforme | ≤ 5 erradas, fecha | o **desktop** decide ("Permitir") |
| Parser de comandos | sufixo `@outro_bot` ignorado | texto normalizado e redigido | `mensagem_entrada` | respostas ≤ 1 500, sem arquivo/terminal | ≤ 2 000, mídia ignorada | pré-filtro de gestos proibidos |
| Orquestrador remoto | via `telegram` (só sobe rigidez) | plano por código | recibo do Maestro | — | timeout de proposta | ações só da lista fechada |
| Aprovação | nonce opaco ligado a (user, chat, message, plano, hash) | uso único atômico | `aprovado_por` | — | ≤ 3 planos pendentes | política reavaliada na execução; PIN opcional |
| Saída/formatador | HTML com escape | valores escapados | — | redação na entrada e na saída | fila 1 msg/s, rajada vira resumo | só tipos ligados, nível mínimo |
| Cofre | — | `safeStorage` | — | token nunca em arquivo/log/evento | — | recusa se indisponível |
| Auditoria | — | só inserções | 90 dias | sem segredo, sem texto integral | retenção | export fora de `docs/**` |
| Pânico | — | — | `panico` auditado | — | 0 sockets em ≤ 1 s | revoga todos, desliga entrada e saída |

## 5. Casos de abuso (AB-01..AB-30)

Colunas: severidade · mitigação (resumo) · task do plano · teste do núcleo (`src/nucleo/telegram/adversarial.test.ts`) · prova na ligação da onda 2.

| AB | Caso | Sev. | Mitigação | Task | Teste (núcleo) | Prova na ligação (onda 2) |
|---|---|---|---|---|---|---|
| AB-01 | Roubo do token (arquivo, log, argv, evento, URL, DOM) | Alta | cofre; mascarado; cliente de rede sem log; erros sem caminho | T-20.18 | `ab01_token_nunca_vaza` | `alertas-telegram.test.ts` (varredura de TODAS as tabelas + eventos + avisos), `alertas-rede.test.ts` |
| AB-02 | Mensagem falsa de token roubado ("aprove aqui") | Alta | aprovação só por nonce do banco; o app nunca envia link nem pede segredo | T-20.30 | `ab02_mensagem_falsa_nao_aprova` | callback forjado em `alertas.e2e.test.ts` |
| AB-03 | Conta Telegram sequestrada | Alta | rigidez ≥ 4, raio ALTO, branch protegida, destrutivo, automático, > 3 painéis só no desktop; PIN; inatividade; `/parar` | T-20.28 | `ab03_conta_sequestrada_limitada` | `alertas-orquestrador.test.ts` (política sobre o plano real do Maestro) |
| AB-04 | Spoofing (nome, encaminhada, `via_bot`, `sender_chat`) | Alta | só `from.id` + chat privado; ignora o resto | T-20.25 | `ab04_spoof_por_nome_encaminhada` | mutação AB-04 |
| AB-05 | Desconhecido acha o `@bot` | Média | silêncio; contador sem texto | T-20.25 | `ab05_nao_autorizado_silencio` | `alertas-telegram.test.ts` ("usuário desconhecido") |
| AB-06 | Força bruta do código de pareamento | Alta | 50 bits, TTL 5 min, 1 uso, ≤ 5 erradas | T-20.26 | `ab06_forca_bruta_pareamento` | mutação AB-06 |
| AB-07 | Código reutilizado/expirado | Alta | uso único, memória, desktop confirma | T-20.26 | `ab07_codigo_reutilizado_expirado` | pareamento pelo poller REAL em `alertas-telegram.test.ts` |
| AB-08 | Replay de update | Alta | `update_id` deduplicado; offset depois do lote; idade ≤ 10 min | T-20.24 | `ab08_replay_update` | mutação AB-08 |
| AB-09 | Callback forjado/reutilizado | Alta | nonce opaco, uso único atômico (`UPDATE … WHERE estado='pendente'`) | T-20.30 | `ab09_callback_forjado_reutilizado` | `alertas.contrato.test.ts` (50 concorrentes, 1 vencedor), mutação AB-09 |
| AB-10 | Injeção de prompt no pedido | Alta | texto = dado dentro do envelope; plano por código; LLM não decide | T-20.29 | `ab10_injecao_na_mensagem` | `alertas-orquestrador.test.ts` ("injeção no texto"), mutação AB-10 |
| AB-11 | Texto de terceiros no alerta | Média | escape por valor, truncar, itálico, sem preview | T-20.21 | `ab11_texto_de_terceiro_escapado` | — |
| AB-12 | Exfiltração por alerta (segredo no título/handoff/`alert_raise`) | Alta | redação na entrada e na saída; `alert_raise` ≤ 3/h/Pane e fora de canal externo por curinga | T-20.04, T-20.15 | `ab12_sentinela_nao_sai` | `alertas-telegram.test.ts` (sentinela `sk-ant` no título do card não sai), `tools-alertas.test.ts`, mutação AB-12 |
| AB-13 | Abuso de taxa | Média | 20 msgs/min, 3 `/pedir`/10 min, 3 planos; saída 1 msg/s, rajada vira resumo | T-20.14, T-20.22 | `ab13_flood_entrada_e_saida` | — |
| AB-14 | Comando destrutivo/humano pelo bot | Alta | pré-filtro de gestos; `acao_humana`/entrega bloqueados; lista fechada de ações | T-20.28 | `ab14_destrutivo_bloqueado` | `alertas-telegram.test.ts` ("rigidez 4 … texto destrutivo nem chega ao Maestro"), mutação AB-14 |
| AB-15 | Persistência após revogação | Alta | revogar anula nonces/planos; poller descarta | T-20.32 | `ab15_revogado_nao_volta` | pânico em `alertas-telegram.test.ts` |
| AB-16 | Mensagem de grupo/canal | Alta | só `chat.type == "private"` | T-20.25 | `ab16_grupo_ignorado` | mutação AB-16 |
| AB-17 | Dois pollers / 409 | Alta | 409 para, `conflito`, alerta crítico, exige "Retomar" | T-20.24 | `ab17_409_para_e_exige_retomar` | `alertas-telegram.test.ts` ("409"), mutação AB-17 |
| AB-18 | Webhook plantado | Alta | `getWebhookInfo` antes de retomar; nunca `deleteWebhook` em operação | T-20.24, T-20.23 | `ab18_webhook_plantado_alerta` | `retomar()` em `alertas-telegram.ts`; webhook no assistente em `alertas-telegram.test.ts` |
| AB-19 | MITM/rede hostil | Média | TLS padrão, host único, sem redirect, sem proxy implícito | T-20.18 | `ab19_tls_host_fixo` | `alertas-rede.test.ts`, mutações AB-19 e AB-TESTE |
| AB-20 | Token na URL parar em log/erro | Alta | caminho por template; erro só com código nominal | T-20.18, T-20.20 | `ab20_url_com_token_nao_loga` | `alertas-rede.test.ts` ("erro de rede nunca carrega o caminho"), mutação AB-20 |
| AB-21 | DoS por mensagem gigante/mídia | Média | ≤ 2 000, só texto, `limit=20`, 1 MiB | T-20.24, T-20.29 | `ab21_mensagem_gigante_e_midia` | `alertas-rede.test.ts` ("resposta acima do teto") |
| AB-22 | Pedido duplicado | Média | dedupe por hash em 2 min; aprovar atômico | T-20.29, T-20.30 | `ab22_pedido_duplicado` | duplo toque em `alertas-telegram.test.ts` (1 confirmação) |
| AB-23 | TOCTOU do plano | Alta | `args_hash` do plano **vivo** na execução; política reavaliada | T-20.30 | `ab23_plano_alterado_nao_executa` | `alertas-orquestrador.test.ts` (rigidez sobe, nada confirma), mutação AB-23 |
| AB-24 | Rigidez/branch protegida exige desktop | Alta | `PortaRigidez` na proposta e na execução; falha da porta = desktop | T-20.28 | `ab24_rigidez_exige_desktop` | `alertas-orquestrador.test.ts`, mutação AB-24 |
| AB-25 | Pânico continua recebendo | Alta | `AbortController`, 0 sockets ≤ 1 s, fila cancelada, host fora da allowlist | T-20.32 | `ab25_panico_zero_sockets` | `alertas-telegram.test.ts` ("pânico"), `alertas-rede.test.ts` (aborto real), mutação AB-25 |
| AB-26 | Offset perdido | Média | descarte inicial + dedupe + filtro de idade | T-20.24 | `ab26_offset_perdido` | — |
| AB-27 | "Dono falso" com botão sem nonce | Alta | botões só com nonce válido do banco | T-20.30 | `ab27_botao_sem_nonce_ignorado` | callback forjado em `alertas.e2e.test.ts` |
| AB-28 | Título sensível indo ao Telegram | Média | "ocultar títulos" (`ocultar_titulos_externos`); consentimento lista o que sai | T-20.12, T-20.37 | `ab28_ocultar_titulos` | `opcoesMensagem` em `src/main/alertas.ts` |
| AB-29 | Relógio/skew | Baixa | idade medida com relógio injetado; 120 s de skew | T-20.24 | `ab29_skew_e_idade` | relógio vivo nos testes da ligação |
| AB-30 | Autorização eterna | Média | validade deslizante de 30 dias; `verificarInatividade` no boot | T-20.26, T-20.35 | `ab30_autorizacao_expira` | `retomarSeLigado()` chama `verificarInatividade()`; mutação AB-30 |

Casos novos da onda 2 (a ligação cria superfícies que o núcleo não tinha):

| AB | Caso | Sev. | Mitigação | Task | Teste |
|---|---|---|---|---|---|
| AB-31 | Renderer forjando regra de pedido remoto (destino fixo, efemeridade, origem) para desviar alertas a outro chat | Alta | validador recusa `efemera_ate`/`chat_ref`/`origem=pedido_remoto`; o main ignora o que vier | T-20.02 | `src/main/ipc/alertas.test.ts`, `src/main/alertas.test.ts`, mutação AB-IPC |
| AB-32 | Poller ligado só para parear e esquecido ligado | Média | o poller do pareamento para quando a janela fecha (pareou, negou, expirou, cancelou) e a entrada não está ligada | T-20.26 | `alertas-telegram.test.ts` ("o poller liga SÓ para receber o /start") |
| AB-33 | Token válido com webhook ativo trava o assistente em loop e empurra o usuário a repetir o token | Baixa | guarda no cofre e mostra "Limpar webhook" (único `deleteWebhook`, por clique) | T-20.23 | `alertas-telegram.test.ts` ("webhook ativo") |
| AB-34 | Notificação antiga (`notificar.ts`) duplicando o canal SO | Baixa | uma só fonte: a sinaleira emite alerta; o aviso antigo só como reserva quando o emissor não trata o evento | T-20.17 | `alertas.test.ts` ("sinaleira dos terminais livres") |

## 6. Portões

- **G1 — alertas de saída ao Telegram: APROVADO.** Há consentimento versionado (texto + hash, recusa de texto desatualizado), redação na entrada e na saída, conteúdo mínimo por padrão, token só no cofre e nenhuma chamada sem
  consentimento ou clique. Testes: `alertas-telegram.test.ts`, `alertas-rede.test.ts`, `adversarial.test.ts`.
- **G2 — entrada (pedir pelo bot): APROVADO**, porque todas as ameaças Altas (AB-01..04, 06..10, 12, 14..18, 20, 23..25, 27, 31) têm mitigação testável (tabela acima) e R1–R3 constam como P-70.
- **G3 — modo "executar direto": NÃO é o padrão.** Implementado, desligado, por workspace, exige digitar `DIRETO`, nunca com rigidez ≥ 4, raio ALTO, branch protegida ou destrutivo. Como o adaptador marca o raio de trabalho novo como `MEDIO`
  (nunca `BAIXO`, ver decisão D-160 abaixo), o modo `direto` **não dispara para trabalho novo** até haver evidência de raio BAIXO.
- **G4 — grupos, canais, mídia e relay: NÃO APROVADOS.** Ignorados por construção.

## 7. Riscos residuais (texto exato para P-70)

- **R1** O Telegram (empresa) tem acesso técnico ao conteúdo das mensagens do bot (não são ponta a ponta).
- **R2** Quem controlar a conta Telegram do dono (por exemplo, por troca de chip) consegue pedir e aprovar, **pelo chat**, planos classificados como baixo risco no workspace permitido —
  limitado pela política (AB-03/AB-14/AB-24), pelo PIN opcional e pela validade por inatividade.
- **R3** Quem roubar o token do bot consegue enviar mensagens falsas ao dono (sem poder executar nada) até a rotação do token.

Sem app nativo e sem E2E, R1 e R3 não se eliminam.

## 8. Confirmação das decisões D-150..D-159

Todas **confirmadas** sem mudança de substância. Ajustes de implementação (registrados em `01-DECISOES.md`):

- D-150 (long polling de saída): confirmada; o poller **não** nasce no boot — só liga com a janela do pareamento (AB-32) ou, em ocioso na onda 2, com entrada ligada + consentimento + token + autorizado.
- D-151 (atrasada operacional e alertas como dados do ADE): confirmada; o emissor, o agendador de vencimentos e a definição de atraso são os do núcleo, ligados ao `task.updated` e ao `pane.state_changed` reais.
- D-152 (entrada): confirmada; o orquestrador é o **Maestro** (Fase 16) com `via: "telegram"`; o pedido entra no envelope de dados.
- D-153 (pareamento e allowlist por `user_id`): confirmada; o desktop decide ("Permitir"), o pedido de pareamento chega a qualquer tela por `telegram:pareamento` e o código aparece uma única vez.
- D-154 (token): confirmada; `PedidoRede` ganhou `sinal` (aditivo) para o aborto real do socket, e o cliente de rede do bot é uma instância própria **sem `log`**.
- D-155 (poller conservador): confirmada; o 409 usa só o código, o `getWebhookInfo` roda antes do "Retomar" e o app nunca chama `deleteWebhook` em operação.
- D-156 (conteúdo mínimo, HTML, templates sem lógica): confirmada; "ocultar títulos" ganhou a chave `ocultar_titulos_externos` (padrão desligada).
- D-157 (canais): `criarNotificador` ficou como **reserva** (não removido): vale só quando o emissor de alertas não trata o evento (alertas desligados ou ainda não prontos).
- D-158 (segurança compartilhada; agentes não usam o canal): confirmada; a única tool MCP é `alert_raise` (piloto, opt-in do token, ≤ 3/h/Pane, fora de canal externo por curinga).
- D-159 (eventos/pânico): confirmada; o item de pânico da bandeja só aparece com o canal ligado.
