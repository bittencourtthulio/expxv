# Pedidos da Fase 20 — onda 1 (núcleo puro: alertas + Telegram)

Entregue em `src/nucleo/alertas/**`, `src/nucleo/telegram/**`, `src/compartilhado/alertas.ts`, `tests/fixtures/alertas/**` e `tests/perf/alertas.perf.ts`.
**Nada** de `main.ts`, IPC, preload, renderer, migration, `rede/` ou `cofre/` foi tocado. Tudo é programado contra **portas**, com repositório em memória
(mesmo contrato do SQL). Este arquivo lista o que o coordenador precisa ligar, criar ou decidir.

## 0. Aviso sobre o portão da fase

`docs/ade/seguranca/AMEACAS-FASE-20.md` (T-20.01) **não existe**. Em modo piloto automático a onda 1 seguiu a pré-análise do plano (30 casos AB) e entregou **um teste
nomeado por AB** em `src/nucleo/telegram/adversarial.test.ts`. O estudo formal, os portões G1–G4, os residuais R1–R3 (P-70) e `tests/scripts/ameacas-fase20.test.ts`
continuam pendentes. **Mutação:** os testes AB exercitam a defesa com o ataque real contra o servidor falso (remover a mitigação os deixa vermelhos), mas o
harness de mutação automática da T-20.40 **não foi construído**.

## 1. Migration (para a Fase 15 / coordenador) — deltas sobre o DDL do plano

O DDL do plano vale, com estas diferenças que o código já assume:

```sql
-- canal.tipo aceita 'toast' além de so|telegram|webhook
CHECK (tipo IN ('so','toast','telegram','webhook'))
-- alerta_regra: destino fixo da regra efêmera de pedido remoto
ALTER TABLE alerta_regra ADD COLUMN chat_ref TEXT;                    -- 'chat:<chat_id>' (só origem='pedido_remoto')
-- alerta_entrega: o nível e o destino ficam na entrega (a regra pode mudar/expirar antes do envio)
ALTER TABLE alerta_entrega ADD COLUMN nivel TEXT NOT NULL DEFAULT 'minimo' CHECK (nivel IN ('minimo','padrao','completo'));
ALTER TABLE alerta_entrega ADD COLUMN chat_ref TEXT;
-- para `agrupado`, `proxima_tentativa_em` guarda o instante de LIBERAÇÃO do lote/resumo (fim do silêncio, hora do digest, janela de 5 s)
-- telegram_aprovacao.acao: 'aprovar'|'editar'|'cancelar'|'parar'|'ws'|'gate_aprovar'|'gate_recusar'|'gate_confirmar'
-- telegram_aprovacao: coluna extra TEXT (só 'ws' e 'gate_*': workspace/gate escolhido pelo APP, nunca pelo usuário)
-- mensagem_entrada: texto_hash TEXT (dedupe de 2 min) e edicoes INTEGER NOT NULL DEFAULT 0 (máx. 3)
-- mensagem_entrada.estado: acrescentar o uso de 'plano_enviado' também para entradas de /ws e /aprovacoes (comando = 'ws' | 'aprovacoes')
CREATE INDEX ix_entrada_hash ON mensagem_entrada (autorizado_id, texto_hash, criado_em);
CREATE INDEX ix_aprov_plano ON telegram_aprovacao (plano_id, acao, estado);
```

Invariantes que o repositório SQL **precisa** honrar (o teste do núcleo usa a versão em memória):

- `consumirAprovacao` e `consumirAprovacaoPorPlano` são **atômicos** (`UPDATE … WHERE estado='pendente' AND expira_em>? ` e `changes()==1`); 50 chamadas concorrentes → 1 vencedor.
- `inserirEntrada` respeita `UNIQUE(canal_id, update_id)` e devolve `false` se já existir (o handler é idempotente por `update_id`).
- `alerta_entrega UNIQUE (alerta_id, canal_id, regra_id)`: `inserir` devolve `false` na repetição.
- `transacao(fn)` roda o offset (`telegram_estado.proximo_offset`) numa transação; `update_visto` é gravado **por update**, logo depois de tratá-lo (antes do offset): é isso que impede reprocessamento após queda entre processar e gravar o offset.
- Nenhuma coluna guarda token/PIN em claro (`pin_hash` = `scrypt$N$sal$hash`). Retenção: `alertas/retencao.ts` e `telegram/retencao.ts` (job ocioso 1×/dia).

Interfaces de repositório a implementar em SQL: `RepoAlertas`, `RepoEntregas`, `RepoRegras`, `RepoCanais` (`alertas/portas.ts`), `RepoTempo` (`alertas/tempo.ts`), `RepoTelegram` (`telegram/repo.ts`).
`criarRepo*Memoria` servem de especificação executável.

## 2. Rede — `PortaRedeSegredo` sobre `src/nucleo/rede` (T-20.18, do coordenador)

O núcleo não tem `fetch`/`http`. `telegram/portas.ts` define `PortaRedeSegredo.requisitar({host, porta?, metodo, caminho_template, segredos, corpo, cabecalhos, timeout_ms, max_bytes, sinal})`.
O adaptador real precisa:

1. substituir `{token}` **dentro** do cliente e **nunca** registrar o caminho (hoje `cliente-http.ts` registra o caminho sem query: com o token no caminho isso vazaria);
2. aceitar `AbortSignal` e **abortar de verdade** o socket (o falso prova com `getUpdatesAbertos()`/`socketsAbertos()` = 0): `tests/fixtures/alertas/rede-teste.ts` mostra a semântica com `stream().cancelar()`;
3. exigir consentimento do host `api.telegram.org` (o núcleo checa `consentimentoValido()` antes, mas a camada de rede continua sendo a trava final);
4. `https` fixo, sem redirecionamento, sem proxy implícito, teto de 1 MiB; base de teste (loopback) só com `NODE_ENV=test`;
5. erros sem caminho, sem corpo e sem cabeçalho (o cliente de API já descarta a mensagem original do erro de rede, mas a defesa em profundidade é do cliente).

`assistente.apiPara(token)` precisa de consentimento **por clique** (`conceder(host)` dentro do manipulador IPC): `getMe` do passo 2 acontece antes do diálogo de consentimento do passo 3.

## 3. Portas para ligar no main

| Porta | Onde | Adaptador real |
|---|---|---|
| `Relogio`, `PortaBarramento` | `alertas/portas.ts` | `Date.now`; `barramento.emitir` (alert.* **não** coalescido) |
| `PortaCusto`, `PortaAgil`, `PortaConsumo` | `alertas/portas.ts` | F10 `custo_agregado`(card), F18, F9 (todas opcionais: ausente = "sem fonte"/"sem estimativa") |
| `RepoTempo` | `alertas/tempo.ts` | tabela `tarefa_tempo`; chamar `reconstituir(panesVivos)` no boot |
| `criarFontes(...)` | `alertas/fontes.ts` | assinar `task.updated`, `pane.state_changed`, `mission.closed`, QA e converter para `EventoTask/EventoPane/EventoMissaoFechada/EventoQa` (formato mínimo documentado no arquivo); ligar `agendador.aoVencer → fontes.aoVencer` |
| `CanalComunicacao` | `alertas/canais/{so,toast,webhook}.ts` | SO: `new Notification` + foco + preferência; toast: evento IPC; webhook: `PortaPostarJson` sobre `rede/` |
| `criarServicoAlertas`, `criarEntregador` | `alertas/servico.ts` | `contextoAvaliacao()` lê silêncio global/fuso da config; `obterAdaptador` usa `criarRegistroDeCanais` com import dinâmico do Telegram |
| `criarServicoTelegram(deps)` | `telegram/servico.ts` | importar **só por `import()` dinâmico** com saída ou entrada ligada (P-143: nada no boot) |
| `PortaOrquestrador`, `PortaRigidez` | `telegram/portas-entrada.ts` | adaptadores sobre F15 (`classificarIntencao`/`montarPlano`), F16 (Maestro/rigidez), F14 (squads). `planoAtual` precisa devolver o plano **vivo** (rigidez/branch atuais) com `args_hash` recalculado por `hashArgs` |
| `PortaConsulta`, `PortaGates` | idem | consultas **somente dos workspaces recebidos**; `PortaGates.pendentes` marca `exige_humano` para raio ALTO, assinatura do prodx, merge e `mergex-revisar` |
| `PortaCofreToken` | `telegram/assistente.ts` | cofre da F9 (`TELEGRAM_BOT_TOKEN_<CANAL>` via `nomeSegredoToken`, `sensivel`) |
| Pânico | `servico.panico.panico({parar_execucoes, origem})` | botão do cartão, item de bandeja e `/parar` chegam ao mesmo estado final; `desligarCanal` grava `entrada_ligada=0, saida_ligada=0, estado='desligado'` |
| Inatividade | `servico.verificarInatividade()` | rodar no boot e 1×/dia (AB-30) |
| `alert_raise` | `alertas/alert-raise.ts` | registrar a tool em `mcp/catalogo.ts`/`portas.ts` chamando `criarAlertRaise(...).executar(args, ctxDoToken)`; erros `invalid_args|rate_limited|forbidden` |
| Eventos | `servico` `eventos(e)` | mapear para `telegram:pareamento`, `telegram:evento`, `telegram:plano_pendente_desktop` (IPC) e `channel.state_changed` |

Eventos de domínio de VCS/PR, cota, sprint e relatório (T-20.10): **não foram criadas fontes** porque os nomes reais dependem de §7 do `05-CONTRATOS.md`; no catálogo esses tipos estão
`fonte_indisponivel: true` (`pr_*`, `checks_falhando`, `sprint_*`, `relatorio_pronto`). `cota_atingida`/`conta_trocada`/`limite_consumo` têm tipo e template, falta só a fonte (F9). Ao ligar, trocar a marca no catálogo.

## 4. Contratos novos / decisões tomadas (registrar em `01-DECISOES.md` e `05-CONTRATOS.md`)

- **Callback do botão:** `^[aecpwgry]:[A-Za-z0-9_-]{22}$` (o plano previa `aecp`): `w` = escolher workspace (`/ws`), `g`/`r` = aprovar/recusar um gate (pede confirmação), `y` = confirmar. Nunca carrega dado do plano.
- **Config** (`config.json`, sem segredo): `telegram.rajada_msg` (5) além das chaves do plano.
- **Comandos extras** pedidos pelo coordenador: `/missoes`, `/consumo`, `/aprovacoes` (gates de baixo risco com botão + **confirmação**; os que exigem humano aparecem **sem botão**). Todos de classe `leitura`.
- **`/parar`** responde uma vez e executa o pânico com `parar_execucoes = true` (padrão "sim" do plano): depois da revogação o usuário não poderia mais tocar um botão de confirmação.
- **Pré-filtro de gestos proibidos** (`politica.gestoProibidoNoTexto`): antes de chamar o orquestrador, texto com apagar/descartar/push forçado/merge/assinar prodx/aprovar raio ALTO/`mergex-revisar`/encerrar Pane/abortar Missão/instalar MCP/alterar rigidez/ler arquivo de segredo vira "só no desktop". É conservador (falso positivo = fazer no desktop). O `avaliarPlano` continua sendo a defesa final (ações fora da lista, `acao_humana`).
- **`PlanoRemoto`** ganhou `branch_protegida`, `acao_humana?`, `workspace_automatico?` (derivados pelo adaptador do orquestrador).
- **Com PIN** o botão [Aprovar] não é nem mostrado (o plano diz `/aprovar #ID PIN`); 3 tentativas de PIN por 10 min.
- **Alerta crítico** nunca espera lote/digest; **rajada** (> 3 entregas pendentes no canal) vira UMA mensagem-resumo (0 alertas perdidos); silêncio libera UM resumo no fim da janela.
- **Dedupe do emissor:** chave `tipo|workspace|entidade|estado`, janela de 10 min, só alerta NÃO lido; flood: > 30/min do mesmo tipo vira 1 alerta-resumo com contador.
- **`ConfirmacaoPendente` (T-13.03)** não existe: `telegram_aprovacao` implementa a mesma semântica (uso único, TTL, `args_hash`, atômico). Unificar quando a Fase 13 chegar.
- **Tipos de alerta** acrescentados ao plano: `tarefa_tempo`, `tarefa_tokens`, `tarefa_story_points`, `limite_consumo`, `missao_aguardando_aprovacao` (pedido do coordenador). Canal `toast` (aviso no app).
- Fixture do servidor falso mora em `tests/fixtures/alertas/telegram-falso.ts` (o plano previa `tests/fixtures/telegram/`); texto exato do 409 de webhook segue `forma_presumida`. Ele não reaproveita `rede/servidor-falso.ts` porque precisa contar **sockets abertos** (prova de pânico), não só conexões acumuladas.

## 5. Mapa AB → teste (`src/nucleo/telegram/adversarial.test.ts`, nome exato)

`ab01_token_nunca_vaza` · `ab02_mensagem_falsa_nao_aprova` · `ab03_conta_sequestrada_limitada` · `ab04_spoof_por_nome_encaminhada` · `ab05_nao_autorizado_silencio` · `ab06_forca_bruta_pareamento` · `ab07_codigo_reutilizado_expirado` ·
`ab08_replay_update` · `ab09_callback_forjado_reutilizado` · `ab10_injecao_na_mensagem` · `ab11_texto_de_terceiro_escapado` · `ab12_sentinela_nao_sai` · `ab13_flood_entrada_e_saida` (saída: `integracao-alertas.test.ts`, P-144) ·
`ab14_destrutivo_bloqueado` · `ab15_revogado_nao_volta` · `ab16_grupo_ignorado` · `ab17_409_para_e_exige_retomar` · `ab18_webhook_plantado_alerta` · `ab19_tls_host_fixo` · `ab20_url_com_token_nao_loga` ·
`ab21_mensagem_gigante_e_midia` · `ab22_pedido_duplicado` · `ab23_plano_alterado_nao_executa` · `ab24_rigidez_exige_desktop` · `ab25_panico_zero_sockets` · `ab26_offset_perdido` · `ab27_botao_sem_nonce_ignorado` ·
`ab28_ocultar_titulos` · `ab29_skew_e_idade` · `ab30_autorizacao_expira`.

## 6. Orçamentos (medidos em Node, `tests/perf/alertas.perf.ts`, gravados em `docs/ade/perf/ultimo.json`)

P-140 (núcleo) 0,05 ms · P-142 1,8 req/min e CPU extrapolada 0,01 % · P-144 p95 4,2 ms (caminho; o espaçamento de 1,1 s é contratual) e 100 alertas → 1 mensagem, 0 perdidos · P-146 (50 bits, 300 s, 5 erradas, Δtempo 0 ms) · P-148 0,04 ms/task, 1 timer com 200 tasks, recálculo 0,02 ms ·
P-149 4 KB 0,08 ms, 100 KB 0,3 ms, pânico até 0 sockets ≈ 300 ms. **Faltam** (precisam de Electron/SQLite): P-141 (Centro), P-143 (0 sockets/timers/imports e tamanho de bundle com canais desligados), P-145 (`/pedir` → plano com orquestrador real), P-147 (memória do canal e consulta de 100 000 alertas no banco real).
O núcleo cumpre P-143 por construção: `src/nucleo/alertas/index.ts` e `telegram/index.ts` não criam socket, timer nem processo ao serem importados.

## 7. O que só o dono valida (checklist da "Validação real", D-23)

`getMe` e `sendMessage` com um bot descartável; `/start código` real; **comparar o texto/código reais do 409 (dois pollers) e do `getUpdates` com webhook ativo** com o que o falso emite (`forma_presumida`); limite de 4096 e `parse_mode=HTML`;
`callback_data` de 24 bytes e `answerCallbackQuery`; `/setjoingroups` desabilitado; rotação do token pelo `/mybots` com o app aberto (deve ir a `erro/token_invalido` sem laço); se um bot pode iniciar conversa com quem nunca falou com ele (não confirmado: o pareamento já parte do `/start` do usuário).

## 8. Pendências desta onda

T-20.01 (estudo) · T-20.02 (IPC/preload/validadores) · T-20.03 (migration + repos SQL) · T-20.17 (migração do `notificar.ts`) · T-20.18 (extensão de `rede/`) · T-20.33 (serviços no main + lazy import) · T-20.34–38 (UI) · T-20.40 (mutação) · T-20.41 (e2e Electron) · T-20.42 (pacote) · T-20.43 (contratos).
Também: fontes VCS/consumo/sprint/relatório (§3), `ameacas-fase20.test.ts`, e a decisão do coordenador sobre `docs/ade/seguranca/`.
