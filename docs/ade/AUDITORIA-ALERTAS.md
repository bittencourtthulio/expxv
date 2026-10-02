# Auditoria — Fase 20, onda 2 (ligação de alertas + bot do Telegram)

Escopo: `src/main/alertas*.ts`, `src/main/ipc/{alertas,telegram}.ts`, as edições em `main.ts`, `tray.ts`, `orquestracao.ts` (`task.updated`), o MCP `alert_raise`, a extensão `sinal` do cliente de
rede, a migration `0013-alertas` e os repositórios SQL, mais o núcleo `nucleo/{alertas,telegram}/**` (contexto). Estudo de ameaças: `AMEACAS-TELEGRAM.md`.

Método: auditoria **independente, somente leitura** (um agente sem o contexto de quem escreveu leu o código contra o plano e tentou romper cada fronteira; o envelope de dados foi reproduzido em
script), seguida de correção de TODOS os achados, cada um com teste que falha sem a correção. As correções de maior risco entram no harness de mutação
(`node tests/scripts/mutacao-fase20.mjs`): a mitigação sai, o teste precisa ficar vermelho.

Resultado: **nenhum achado Alto**. 8 Médios e 8 Baixos, todos corrigidos e testados (abaixo). Verificado sem achados: token só no caminho da URL dentro do adaptador de rede (cliente próprio sem `log`,
erros só com código nominal, formato validado antes da rede, cofre `sensivel`, canais `token_*` e `autorizado_config` sensíveis, UI só vê o mascarado); consentimento antes de qualquer socket, host fixo,
redirecionamento só no mesmo host, base de teste só com `NODE_ENV=test` e loopback; autorização só por `from.id` + chat privado (grupos, encaminhadas, `via_bot`, `sender_chat`, editadas, bots
ignorados; desconhecido em silêncio); nonce de uso único atômico ligado a usuário, chat e mensagem; dedupe de update; pareamento de 50 bits; TOCTOU do `args_hash` (plano relido na aprovação e na execução);
modo `direto` inalcançável hoje (raio sempre `MEDIO`); pré-filtro de gestos proibidos e lista fechada de ações; `alert_raise` com identidade só do token e texto redigido; SQL todo parametrizado e o índice
com `COALESCE(regra_id,'')`; saída em HTML com escape por valor; validadores de IPC estritos (o main força `efemera_ate`, `origem` e `chat_ref`).

## Achados corrigidos

| # | Sev. | Achado | Correção | Teste (falha sem a correção) | Mutação |
|---|---|---|---|---|---|
| M1 | Média | PIN e modo `consulta` não valiam para os gates de `/aprovacoes` (conta comprometida liberava portões sem PIN e em workspace só-leitura) | a lista só considera workspaces fora de `consulta`; com PIN a lista não tem botão; a CONFIRMAÇÃO reconfere PIN e modo | `entrada.test.ts` "M1" | AUD-M1 |
| M2 | Média | `PlanoRemoto.workspace` era o NOME, mas o código o tratava como ID: o modo/permissão do workspace nunca era relido na execução e a auditoria gravava o nome como id | `PlanoRemoto.workspace_id` (o id); política, consultas e auditoria usam `wsIdDe(plano)`; na execução o workspace precisa continuar liberado e o modo é relido | `entrada.test.ts` "M2" (x2), `alertas-orquestrador.test.ts` | AUD-M2 |
| M3 | Média | O pânico não era atômico com o lote em voo: um callback do mesmo lote ainda executava depois do `/parar` | `processarLote` para no meio (sem confirmar o resto); `executarAprovado` reconfere que o autorizado não foi revogado/expirado, em silêncio | `poller.test.ts` "pânico no MEIO do lote" | AUD-M3 |
| M4 | Média | O consentimento não caía quando passava a sair MAIS do que o consentido (nível completo, `agente_mensagem`) e `hash_texto` nunca era conferido | o consentimento cobre todos os tipos que podem sair por padrão + a marca "nível completo e mensagens de agente"; regra do usuário que excede isso derruba o consentimento (`null`, evento `canais:estado`) e nada sai até aceitar de novo | `alertas-telegram.test.ts` "M4" | AUD-M4 |
| M5 | Média | Reiniciar o app religava o poller depois de `conflito`/`webhook_suspeito`, contradizendo "não retoma sozinho" | `retomarSeLigado` não religa se o canal está em `conflito`/`erro` | `alertas-telegram.test.ts` ("reinício") | AUD-M5 |
| M6 | Média | A entrega em lote juntava alertas de regras, níveis e destinos diferentes: o acompanhamento efêmero de um chat vazava para os outros e o nível vinha só do primeiro | a rajada agrupa por (regra, chat, nível) e a mensagem do lote leva o `chat_ref` | `entregador.test.ts` "rajada NÃO mistura destinos" | AUD-M6 |
| M7 | Média | Push e PR (`mergex.pr`) passavam como plano comum em workspace automático (sem etapa de confirmação) | `mergex.pr` fora de `confirmar` marca `acao_humana` (bloqueado); com confirmação o pipeline pausa no desktop | `alertas-orquestrador.test.ts` "M7" | AUD-M7 |
| M8 | Média | PIN de 4 dígitos com limite só em memória (3 por 10 min) cairia em semanas; sem aviso | 6 falhas em 24 h REVOGAM a autorização, anulam os nonces e emitem alerta `erro_sistema` | `entrada.test.ts` "M8" | AUD-M8 |
| B1 | Baixa | Envelope `<pedido_remoto>` quebrável por aninhamento (`</pedido_</pedido_remoto>remoto>`) | remove as tags até estabilizar e elimina o resíduo | `texto.test.ts` "tags aninhadas" | AB-10 (2 edições) |
| B2 | Baixa | Poller do pareamento processava tudo (inclusive `/pedir` de autorizado antigo) e só fechava a janela ao ser consultado | `somentePareamento`: só `/start <código>`/`/parear` chegam à entrada; vigia de 5 s (só existe durante a janela) fecha o poller | `alertas-telegram.test.ts` "B2" | — |
| B3 | Baixa | O pânico da bandeja engolia falhas (`.catch(() => undefined)`) | `panicoTelegram`: se o fluxo completo falhar, desliga entrada e saída direto no banco, cancela a fila e avisa | `alertas-telegram.test.ts` "B3" | — |
| B4 | Baixa | Retenção do Telegram não apagava `mensagem_entrada` (texto redigido até 2 000 caracteres), nonces nem desconhecidos antigos; só rodava com o módulo carregado | `apagarEntradasAntesDe` (30 d, cascata) nos dois repositórios; o job carrega só o módulo minúsculo de retenção e tem `.catch` | `alertas.contrato.test.ts` (memória e SQL), `extras.test.ts` | — |
| B5 | Baixa | `/silenciar tudo 2h` não silenciava críticos (`void criticos`) | o main grava `telegram.silencio` e o avaliador de regras o usa como `silencio_canal` com `incluir_criticos` | `alertas-telegram.test.ts` "B5" | — |
| B6 | Baixa | Cancelar não cancelava a proposta no Maestro; a aprovação no desktop ignorava o TTL | `cancelarPlano` chama `pararPlano`; `decidirNoDesktop` expira em `plano_ttl_min` | `entrada.test.ts` "B6" (x2) | — |
| B7 | Baixa | `alert_raise`: limite só por `pane_id` (respawnar contornava) e mapa sem poda | teto global de 30/h e poda do mapa | `extras.test.ts` "teto GLOBAL" | AB-12 |
| B8 | Baixa | `revogarHost` no pânico era incoerente com o comentário (a allowlist é reposta a cada chamada autorizada) | comentário corrigido: quem barra é `autorizado()` (consentimento OU clique); nada abre socket em segundo plano depois do pânico | `alertas-telegram.test.ts` "pânico" | — |

## Achados do próprio harness de mutação (lacunas de PROVA, não de código)

A 1ª execução do harness deixou 4 mutantes vivos (as defesas existiam, mas o teste não as provava sozinho): **AB-08** (replay: o teste de núcleo não repetia de fato o `update_id`), **AB-16** (grupo: a igualdade de `chat.id` mascarava a checagem de tipo), **AB-24** (a rigidez era checada em duas camadas) e **AB-30** (o teste usava a própria constante mutada). Correções: o AB-08 passou a apontar para `poller.test.ts` (replay real), o `ab16_grupo_ignorado` ganhou o caso discriminante (mesmo `from.id` e `chat.id`, chat NÃO privado) e as defesas em camadas viraram mutações de várias edições (todas as camadas somem). Estado final: ver "Mutação" abaixo.

## Mutação (T-20.40, sem dependência nova)

`node tests/scripts/mutacao-fase20.mjs` (todas) ou `... AB-23 AUD-M3` (algumas). Cada mutação troca UM trecho exato do fonte (ou vários, quando a defesa tem camadas), roda os testes que a provam e exige que FALHEM; o fonte é sempre restaurado (try/finally + sinais + cópia fora do repositório). `tests/scripts/mutacao-fase20.test.ts` roda no `vitest` e garante que cada trecho continua aparecendo exatamente uma vez e que os testes apontados existem. **26 mutações**: AB-04, 06, 08, 09, 10, 12, 14, 16, 17, 19, 20, 23, 24, 25, 30, `AB-CONSENT`, `AB-TESTE`, `AB-IPC` e `AUD-M1..M8`. Resultado da última execução completa: **26/26 mutantes mortos** (~2 min).

## Conformidade com `DECISOES-DAS-PENDENCIAS.md` (opção mais completa) — o que ficou de fora desta onda

Registrado como pendência de implementação (nada disso é segurança; o padrão seguro já vale):

- **P-71** PIN em 3 níveis por workspace (hoje: opcional por usuário; falta o nível "obrigatório" por política da organização).
- **P-72** restrições do modo `direto` configuráveis pelo usuário dentro de limites seguros (hoje: fixas; o raio de trabalho novo é `MEDIO`, então `direto` nem dispara).
- **P-74** extensões opcionais desligadas: grupos com allowlist, voz (STT da Fase 11) e anexos.
- **P-77** canais extras como adaptadores: webhook genérico assinado (o núcleo tem `criarCanalWebhook`; falta a ligação no main e a tela), Slack, Discord e e-mail. O canal `toast` do núcleo também não foi ligado (o Centro e o painel do topo já mostram o alerta; um toast de borda é só conforto).
- **P-79** parâmetros de "atrasada" por workspace e por tipo de task (hoje: globais em `alertas.config.atraso`, editáveis por `alertas:config_gravar`).
- **P-75** "ocultar títulos": o main aplica `ocultar_titulos_externos`, mas a tela ainda não tem o interruptor (o canal `alertas:config_gravar` aceita a chave).
- **Fontes sem evento no app (D-276):** `pr_aberto`, `pr_mesclado`, `checks_falhando` (o VCS não publica evento no barramento) e `relatorio_pronto` (a Fase 19 só tem evento de IPC). Os tipos seguem `fonte_indisponivel` e aparecem em cinza em Regras.
- **Orçamentos que exigem Electron/SQLite reais:** P-141 (Centro com 1 000 alertas), P-143 (bundle com canais desligados), P-145 (`/pedir` até o plano com o Maestro real), P-147 (memória do canal). O e2e (`tests/alertas.e2e.test.ts`) está escrito e type-checado, NÃO executado (exige `npm run build`, e há um `npm run dev` do dono ativo). P-147 de banco (100 000 alertas, página <= 5 ms) está provado em `alertas.contrato.test.ts`.
- **Checklist manual do dono (D-23):** um bot descartável real para comparar o texto/código do 409 e do `getUpdates` com webhook, o limite de 4 096, o `callback_data` e a rotação do token (P-78).
