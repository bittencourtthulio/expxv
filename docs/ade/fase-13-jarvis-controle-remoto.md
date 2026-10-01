# Fase 13 — Jarvis (voz sobre o MCP local) e controle remoto local

Valor para o dev: **comandar o ADE falando** ("o que está acontecendo?", "diz ao piloto para finalizar a publicação") sem tirar as
mãos do teclado, e **ver de longe** (celular na mesma rede) o que aguarda você e, se você permitir, mandar uma mensagem ao piloto.
Esta fase é a de **maior superfície de ataque do produto** (voz que vira ação, rede que vira controle). Por isso:

1. o plano **começa por um estudo de ameaças** (T-13.01) com critérios de saída binários; se ele não passar, nada mais é feito;
2. o padrão é o **mínimo seguro**: Jarvis como **cliente de voz sobre o MCP local** e um **controle remoto local (mesma rede, com
   pareamento)**, ambos **desligados por padrão**; **relay, app móvel e VPS NÃO são implementados** (D-73, G3).

Base: `base/D-ecossistema.md` (specs 10 e 11 e a recomendação "adiar/cortar o Bot, aproveitar só a doutrina Arms"),
`base/specs-overclock/spec-11-jarvis-open-jarvis.md` e `spec-10-overclock-bot.md` (lidas inteiras), `05-CONTRATOS.md` §3–§4,
`fase-03-orquestracao-mcp.md`, `fase-11-voz-captura.md` (STT, consentimento, cofre) e `fase-12-bench.md` (padrão de segurança).

## Portão da fase

1. **T-13.01 concluída e aprovada** (critérios de saída do estudo de ameaças, abaixo) **antes** de qualquer outra task. Sem ela
   o portão não abre e as demais tasks não iniciam.
2. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos incluindo P-69).
3. E2E no Electron real, **sem provedor de voz, sem rede externa e sem CLI paga**: motor de STT falso (Fase 11), TTS falso, MCP real
   em loopback, cliente remoto em Node (`tests/fixtures/cliente-remoto.mjs`) e o cliente web mínimo em navegador de teste
   (Playwright/Chromium). Cenários: Jarvis lista estado por voz; envia ao piloto só depois de confirmação com leitura do alvo;
   alvo inexistente; confirmação expira; origem de conteúdo nunca autoriza escrita; pareamento feliz com SAS; código reutilizado/
   expirado/errado 5×; dispositivo `leitura` tenta `pilot_send`; revogação derruba o canal; replay de quadro; Host forjado;
   IP público recusado; kill-switch.
4. `npm run perf`: P-60 a P-69 verdes; P-01/P-08/P-12 sem piorar; `ultimo.json` gravado.
5. **Suíte adversarial (T-13.19) verde**: cada caso de abuso AC-01..AC-24 tem teste nomeado que falha se a mitigação for removida
   (mutação), e `tests/scripts/ameacas.test.ts` confirma que toda ameaça de severidade Alta aponta para uma task e um teste existentes.
6. Sockets: com o controle remoto desligado **0 sockets** ouvindo além do MCP em loopback; `ps` e `lsof`-equivalente limpos ao fim da
   suíte.
7. Registro no `STATUS.md` do que só a pessoa valida (microfone real, voz do SO real, celular real na Wi-Fi de casa) e da decisão G3.

## Princípios

1. **Voz é entrada, nunca autoridade.** Quem autoriza é a **pessoa**, por gesto físico: o microfone só abre com a **tecla segurada**
   (sem palavra de ativação, sem escuta ambiente); texto vindo de painel, web, issue, chat ou resumo é **dado** e nunca é
   interpretado como comando nem como "sim". Origem de conteúdo **jamais** autoriza escrita (D-72).
2. **Mínimo poder.** Jarvis e controle remoto são **atores** novos no MCP (`ator = jarvis | remoto`), com `tools_allow` explícito e
   curto; só leem, ou enviam texto **ao piloto**. Nunca: fechar painel, abrir painel, executar comando, abrir app, calendário,
   modo anfitrião, Reflexo, ver tela (cortes D-05), merge, assinatura do prodx, aprovação de raio ALTO ou `mergex-revisar` (D-21).
3. **Confirmar o que será feito, não o que foi dito.** Toda escrita por voz ou remoto cria uma **confirmação pendente** de uso único
   (TTL 15 s) cujo conteúdo (alvo + texto) é **fixado em `args_hash`**: o que executa é exatamente o que foi mostrado, nunca um
   reenvio.
4. **Nada sai da máquina sem consentimento; tudo remoto nasce desligado.** O Jarvis em cascata (STT da Fase 11 → gramática → piloto →
   TTS local) **não abre sessão de voz remota**; qualquer provedor realtime é contrato + falso (D-71). O servidor do controle
   remoto não existe até a pessoa ligá-lo, **não religa sozinho** ao reabrir o app e só aceita IP de rede privada (D-74).
5. **Segredos nunca em log, argv, evento, banco ou resposta.** Tokens só em memória, chaves privadas no `safeStorage` (T-11.02),
   erro cita o nome, nunca o valor; chamadas externas auditadas com argumentos **redigidos**.
6. **Segurança é testada, não declarada.** Cada ameaça do estudo vira teste adversarial nomeado; mitigação sem teste não conta.
7. **Leveza e velocidade.** Nada disso existe no boot (P-65/P-69); módulos em chunks lazy; o cliente MCP do Jarvis é um `fetch`
   JSON-RPC mínimo (sem carregar o SDK no main); servidor remoto fora do caminho quente.
8. **Custo de input do Jarvis é requisito de aceite** (modo de falha nº 1 da spec 11: R$ 83/dia com sessão aberta o dia todo): sem
   sessão aberta ociosa, contexto sintético por diferenças, resumo acima de 8 000 tokens (P-60..P-62).

## T-13.01 · Estudo de ameaças (threat model) — OBRIGATÓRIO E PRIMEIRO

**Entrega:** `docs/ade/seguranca/AMEACAS-FASE-13.md` (+ `tests/scripts/ameacas.test.ts` que o valida), escrito por um agente
**antes** de qualquer código, a partir da pré-análise abaixo (que é o ponto de partida, não o resultado). Usa o formato STRIDE
por componente, o inventário de ativos e os casos de abuso numerados.

### Critérios de saída (todos binários; falhou um, a fase para)

1. O documento existe e contém: (a) diagrama das **fronteiras de confiança**; (b) **inventário de ativos** (código do piloto,
   conteúdo de painéis, chaves, tokens, áudio, repositório do usuário); (c) **atores** (usuário presente, usuário ausente, outro
   processo local, dispositivo pareado, dispositivo roubado, qualquer host da LAN, atacante ativo na LAN, relay hipotético); (d)
   tabela **STRIDE** para cada componente (microfone/STT, interpretador do Jarvis, TTS, atores MCP, pareamento, servidor remoto,
   transporte, cliente web, relay hipotético); (e) **≥ 20 casos de abuso** numerados AC-NN.
2. Cada caso de abuso tem: severidade (Alta/Média/Baixa), mitigação, **task `T-13.NN` existente nesta fase** que a implementa e **nome do
   teste** que a prova. `tests/scripts/ameacas.test.ts` lê o documento e **falha** se existir ameaça Alta sem task e teste válidos ou
   se citar task inexistente.
3. **Riscos residuais** enumerados em texto exato e submetidos ao dono (P-41); nenhum fica implícito.
4. **Decisões dos portões** G1, G2, G3 registradas (D-71..D-75 já pré-registradas em `01-DECISOES.md`; a task as confirma ou
   corrige com justificativa): G1 Jarvis em cascata = aprovado; G2 controle remoto local = aprovado **se** todas as ameaças Altas
   tiverem mitigação testável **e** os residuais R1/R2 constarem na P-41; G3 relay/app móvel/VPS = **não aprovado** (padrão).
5. Para G3, o documento traz os **requisitos mínimos** se o dono liberar (P-42) — relay **cego** (frames opacos, sem estado, sem
   log de conteúdo), pareamento de uso único com TTL curto e canal derrubado na revogação, E2E com chave que o relay nunca vê, rate
   limit, sem conta nem senha de usuário no relay, hospedagem e custo fora do escopo — **sem task de implementação**
   (T-13.22 fica bloqueada).
6. Sem este estudo aprovado, **T-13.02 em diante não iniciam** (registrar em `STATUS.md` → Bloqueios e seguir com a próxima fase).

### Pré-análise (insumo da T-13.01)

**Fronteiras de confiança.** (F1) pessoa ↔ microfone (gesto físico) · (F2) texto de painel/web/issue ↔ interpretador (dado
não confiável) · (F3) main ↔ MCP loopback (token por ator) · (F4) main ↔ LAN (servidor remoto) · (F5) celular ↔ página servida
(JS entregue por HTTPS autoassinado) · (F6) ExpxV ↔ provedor de STT remoto (só se consentido) · (F7) ExpxV ↔ relay (**inexistente**).

**Ativos de maior valor.** Capacidade de escrever no stdin do piloto (= executar trabalho em worktree); conteúdo dos painéis (pode
ter segredo); chave privada de identidade do servidor remoto; chave do provedor de STT; áudio.

**STRIDE resumido (o estudo detalha por componente):**

| Componente | Ameaça principal | Tipo | Severidade | Mitigação planejada |
|---|---|---|---|---|
| Microfone aberto | Som ambiente aciona comando | S/E | Alta | microfone só com tecla segurada (sem wake word) — T-13.08 |
| Interpretador | Painel/web injeta "diga sim" ou comando | T/E | Alta | gramática **determinística**, conteúdo só é falado, origem ≠ `fala_do_usuario` nunca autoriza — T-13.03, T-13.06 |
| TTS → microfone | Fala do Jarvis é ouvida como "sim" | S | Alta | microfone só com tecla; TTS pausa ao pressionar; confirmação exige fala **após** a tecla — T-13.07, T-13.09 |
| STT erra ID | Mensagem vai ao painel errado | T | Média | confirmação com rótulo e dígito a dígito; padrão = piloto — T-13.06 |
| Token do ator | Vazou/reusado | S/E | Alta | em memória, TTL 60 min (Jarvis) / 60 s (remoto), loopback, revogação ao desligar — T-13.02 |
| Pareamento | Força bruta do código na LAN | S | Alta | 60 bits, TTL 120 s, uso único, 5 tentativas — T-13.13 |
| Pareamento | MITM ativo | S/I | Alta | PSK + ECDH + SAS de 6 dígitos conferido na tela — T-13.13 |
| Servidor | Port scan/DNS rebinding | S/D/I | Alta | só IP privado, `Host` exato, `Origin` checado, 404 uniforme, sob demanda — T-13.15 |
| Transporte | Replay/adulteração de quadros | T | Alta | AES-256-GCM, contador monotônico por direção — T-13.13 |
| Dispositivo | Roubado/perdido | E | Alta | `leitura` por padrão, revogação ≤ 1 s, kill-switch, suspensão ao bloquear — T-13.14, T-13.16 |
| Cliente web | XSS por texto de painel | T/I | Alta | `textContent`, CSP estrita, sem HTML do servidor — T-13.17 |
| Resumo de painel | Segredo impresso no terminal vai ao celular/voz | I | Alta | redação de segredos, 300 caracteres, só por dispositivo permitido — T-13.05 |
| Servidor | Flood/DoS | D | Média | limites de taxa, conexões, tamanho — T-13.15 |
| Processo local | Lê token/chave | I | Média | memória/`safeStorage`, arquivos 0600 — T-13.12 |
| **Residual R1** | Atacante **ativo** na LAN que serve página adulterada (cliente web sem app nativo) | S/I | Alta | **não mitigável** sem app nativo: restrito a redes confiáveis, aviso, `leitura` padrão, SAS — vai à P-41 |
| **Residual R2** | Composição criptográfica própria sem auditoria externa | I | Média | só primitivas padrão (Node/WebCrypto), vetores de teste, revisão externa recomendada — P-41 |

**Casos de abuso (a numeração final é a do estudo; estes entram no mínimo):**
AC-01 áudio de TV/vídeo/terceiro aciona comando · AC-02 fala sintetizada do Jarvis vira "sim" · AC-03 conteúdo de painel instrui "diga
sim"/"apague o repo" · AC-04 ID de painel mal ouvido ("528" × "5208") · AC-05 texto ditado contém comando destrutivo para o piloto ·
AC-06 token MCP do Jarvis vaza e é reutilizado · AC-07 força bruta do código de pareamento · AC-08 MITM ativo no pareamento ·
AC-09 DNS rebinding contra servidor remoto ou MCP · AC-10 celular roubado com sessão ativa · AC-11 replay/reordenação de quadros
· AC-12 varredura de portas na LAN · AC-13 XSS no cliente web via saída de terminal · AC-14 segredo impresso no terminal exfiltrado
pelo resumo · AC-15 dispositivo `leitura` tenta escrever · AC-16 flood/DoS · AC-17 relay malicioso (hipotético) · AC-18 outro processo
do usuário lê token/chave · AC-19 log/auditoria com segredo · AC-20 controle remoto liga sozinho depois de reiniciar · AC-21
`client_request_id` repetido duplica missão · AC-22 confirmação reaproveitada (replay do "sim") · AC-23 TTS fala texto de painel
com URL/Markdown malicioso · AC-24 dispositivo revogado reconecta com quadro gravado.

**Requisitos mínimos de um relay (SOMENTE documentação, G3 = não):** cego (frames opacos autenticados ponta a ponta), sem estado e sem
disco, sem logs de conteúdo nem de IP além do necessário a rate limit, rate limit por canal e por origem, pareamento com segredo de
uso único e TTL ≤ 120 s entregue **fora do relay**, E2E entre host e cliente (chave que o relay nunca vê), revogação encerra o canal em
≤ 5 s, canal derrubado se o host sumir por 30 s, 1 cliente ativo por canal, nenhuma porta de entrada no host, nenhuma conta nem senha de
usuário, e **um app nativo** (browser não resolve R1). Nada disso é construído nesta fase.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`)

Método comum: Playwright sobre o Electron real; provedor realtime **falso** com contador de áudio/tokens e relógio injetável;
`tests/fixtures/cliente-remoto.mjs`; `process.getProcessMemoryInfo`; `net`/`lsof`-equivalente para sockets; `ps`.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-60 | Sessão realtime **ociosa** (interface + provedor falso) | após `T_idle` = 60 s sem fala: **0** bytes de áudio e **0** tokens enviados; sessão fechada em ≤ `T_idle` + 1 s; reabre em ≤ 3 s | contadores do falso + relógio injetado |
| P-61 | Contexto injetado por turno | 1º turno ≤ 750 tokens estimados (≤ 10 painéis × 300 caracteres); turnos seguintes **só diferenças** ≤ 150; histórico resumido ao passar de 8 000 tokens | contador de tokens do falso |
| P-62 | Custo de input simulado de um dia de trabalho (40 sessões × 5 turnos) | ≤ 1,2 M tokens de input (10% do baseline observado de 12 M); alvo interno ≤ 500 k | simulação determinística |
| P-63 | Latência local do Jarvis | STT pronto → resposta da tool MCP p95 ≤ 500 ms; texto → confirmação visível p95 ≤ 100 ms | marcas no main e no renderer |
| P-64 | Controle remoto (loopback no teste) | handshake de pareamento ≤ 1 s; `pilot_send` autorizado → texto no PTY p95 ≤ 1 s | marcas no cliente de teste e no PTY de eco |
| P-65 | Servidor remoto **desligado** não existe | **0** sockets ouvindo (além do MCP) após o boot; P-01 não piora; ligar ≤ 300 ms (certificado em cache; 1ª geração ≤ 500 ms); desligar ≤ 500 ms com **0** sockets | contagem de handles de rede + marcas |
| P-66 | Memória ociosa | remoto ligado ≤ +15 MB; Jarvis ligado ≤ +10 MB | `getProcessMemoryInfo` |
| P-67 | Revogação | dispositivo conectado perde o canal em ≤ 1 s e não reconecta | marca no revogar e no `close` |
| P-68 | Orçamento de segurança do pareamento | código ≥ 60 bits; TTL ≤ 120 s; **1** uso; ≤ 5 tentativas erradas; SAS de 6 dígitos | teste de propriedades |
| P-69 | Peso no JS | bundle inicial **+ ≤ 2 KB gz**; chunk do Jarvis ≤ 25 KB gz; cliente web do remoto ≤ 15 KB gz (asset estático fora do bundle); nenhuma dependência nova | script de tamanho (P-08 estendido) |

## Arquitetura

```
src/nucleo/jarvis/
  gramatica.ts             PURO: texto PT-BR → intenção (lista fechada) + números por extenso/dígitos
  maquina.ts               PURO: desligado→ocioso→ouvindo→interpretando→(confirmando)→executando→falando
  snapshot.ts              PURO: síntese por painel (≤ 300 caracteres), diffs, sanitização, redação
  realtime/
    provedor.ts            interface ProvedorVozRealtime / SessaoRealtime (contrato; nenhum adaptador real, D-71)
    politica-custo.ts      PURO: T_idle, gate de áudio, resumo > 8 000 tokens, só diferenças, limite diário
    falso.ts               provedor falso determinístico (contadores)
src/nucleo/seguranca/
  risco.ts                 PURO: classes leitura|escrita_leve|escrita|proibida; origem × classe; matriz por ator
  confirmacao.ts           PURO: ConfirmacaoPendente (uso único, TTL 15 s, args_hash), armazém em memória
  redacao.ts               (Fase 11) padrões de segredo, reutilizado
src/nucleo/remoto/
  certificado.ts           X.509 autoassinado mínimo (ECDSA P-256), validado por X509Certificate
  protocolo.ts             PURO: pareamento (código 60 bits, ECDH + PSK + HKDF, SAS), canal AES-256-GCM, envelope
  dispositivos.ts          regras de permissão, revogação, rotação de identidade
  politica-rede.ts         PURO: IP privado, Host exato, limites de taxa/conexões/tamanho
src/nucleo/mcp/
  tokens.ts                +claims `ator`; emissão em memória com TTL curto; revogação por ator/dispositivo
  tools/externas.ts        workspace_list, pane_summary, pilot_send, pane_send (ator), mission_create (idempotente)
  catalogo.ts              +matriz por ator (jarvis, remoto)
src/main/
  jarvis.ts                ServicoJarvis (lazy): STT (Fase 11) → gramática → confirmação → cliente MCP → fala
  cliente-mcp.ts           JSON-RPC mínimo sobre fetch (loopback, Bearer), sem o SDK
  remoto.ts                ServicoRemoto (lazy): https, ciclo de vida, kill-switch, token curto por requisição
  remoto-cliente-web/      HTML/JS/CSS estáticos (≤ 15 KB gz), copiados para dist/ no build
  ipc/jarvis.ts · ipc/remoto.ts
src/renderer/jarvis/       tts.ts (speechSynthesis só vozes locais), usarJarvis.ts
src/renderer/telas/config/SecaoJarvis.tsx · SecaoRemoto.tsx · telas/terminais/BotaoJarvis.tsx · casca/IndicadorRemoto.tsx
tests/fixtures/cliente-remoto.mjs · tests/fixtures/provedor-voz-falso.ts
docs/ade/seguranca/AMEACAS-FASE-13.md       (produto da T-13.01)
```

Fluxo do Jarvis (cascata, sem sessão remota, sem LLM no meio):

```
tecla SEGURADA ─► mic (Fase 11) ─► soltou ─► motor STT (Fase 11) ─► texto ─► gramática (lista fechada)
   ├─ leitura ─► cliente MCP (token ator=jarvis) ─► síntese ─► TTS local + legenda
   ├─ escrita_leve (trocar workspace atual, focar painel) ─► executa e fala "feito"
   ├─ escrita (enviar ao piloto/painel, criar missão livre) ─► confirmação pendente (fala/legenda: alvo + texto + dígitos)
   │        ├─ nova fala com a tecla: "sim"/"manda" (≤ 15 s) ─► executa os args FIXADOS ─► log ─► "feito"
   │        └─ "não", Esc, 15 s ou clique "Não" ─► negado
   └─ sem intenção ─► "Não entendi. Enviar isto ao piloto?" ─► confirmação como acima
conteúdo de painel/web/issue: só entra por pane_summary, só é FALADO, jamais é gramática, jamais confirma
```

Fluxo do controle remoto (LAN):

```
pessoa liga o remoto ─► ServicoRemoto cria https na interface privada escolhida (porta fixa persistida) ─► "Parear" mostra
código de 12 caracteres (60 bits) + endereço ─► celular abre https://IP:porta, aceita o aviso do certificado, digita o código
 ─► ECDH + PSK ─► ambos mostram o mesmo SAS de 6 dígitos ─► pessoa confere no desktop e permite ─► dispositivo gravado
 (chave pública do celular; o celular fixa a chave pública do servidor) ─► reconexão: ECDH efêmero + assinaturas mútuas
 ─► canal AES-GCM ─► comandos viram chamadas MCP com TOKEN CURTO (60 s) `ator=remoto` e tools conforme a permissão do dispositivo
```

## Modelo de dados

Preferências (`preferencias.json`, D-29): `jarvis_ligado=false`, `jarvis_atalho` (mac `Cmd+Shift+J`, Win/Linux `Ctrl+Shift+J`),
`jarvis_apelido` (opcional, nunca fixo no código), `jarvis_voz`, `jarvis_velocidade`, `jarvis_eventos_falados=false`,
`remoto_interface` (`auto|<ip>`), `remoto_porta` (aleatória 49152–65535, gerada uma vez), `remoto_ocioso_min=60`,
`remoto_suspender_ao_bloquear=true`. **`remoto_ligado` não existe**: o servidor nasce desligado a cada início do app (D-74, AC-20).
Banco: migration `NNNN-externos.ts` (próximo número livre).

| Tabela / armazém | Campos-chave |
|---|---|
| `dispositivo_remoto` | `id` (`dev_…`), `nome` (≤ 40), `chave_publica` (SPKI base64, ECDSA P-256), `permissao` (`leitura\|mensagem_confirmada\|mensagem_direta`), `criado_em`, `ultimo_uso_em`, `ultimo_ip`, `revogado_em` — **sem segredo de dispositivo no servidor** (só chave pública) |
| identidade do servidor (cofre `safeStorage`) | par ECDSA P-256 de longo prazo (fixado pelo celular no pareamento) + par/certificado TLS da interface atual (regenerado se o IP mudar); nunca devolvido ao renderer |
| `chamada_externa` | `id`, `ator` (`jarvis\|remoto`), `dispositivo_id` (null no Jarvis), `tool`, `risco` (`leitura\|escrita_leve\|escrita`), `origem` (`fala_do_usuario\|ui\|remoto_confirmado\|remoto_direto`), `args_redigidos_json`, `confirmado_por` (`nenhum\|voz\|ui\|desktop`), `ok`, `codigo_erro`, `latencia_ms`, `criado_em` — retenção 30 dias |
| `idempotencia` | `ator`, `client_request_id`, `resultado_json`, `criado_em` — único por (ator, id); TTL 24 h |
| memória (nunca em disco) | token do ator (Jarvis: sessão ≤ 60 min; remoto: ≤ 60 s por requisição), confirmações pendentes, segredos de handshake, SAS, código de pareamento |

Invariantes: dispositivo `revogado_em ≠ null` nunca autentica (nem com quadro gravado); `permissao` nunca sobe sem ação do usuário no
desktop (digitar `PERMITIR` para `mensagem_direta`); `args_redigidos_json` jamais contém texto de fala, token ou chave; confirmação é
de **uso único** e atrelada a `args_hash`; `mission_create` com o mesmo (ator, `client_request_id`) devolve a mesma missão.

## Contratos novos (a mesclar em `05-CONTRATOS.md` na T-13.21)

**Claims do token MCP** ganham `ator: "pane" | "jarvis" | "remoto"` (padrão `pane`, comportamento atual intacto), `origem?` e
`dispositivo_id?`. Para `ator ≠ pane`, `pane_id` é sintético (`jarvis` / `rem_<dispositivo>`), `mission_id` é a Missão atual ou
null, `role = piloto` **não** é concedido (o ator é humano falando, não agente): a matriz é própria.

**Matriz de tools por ator** (nomes em inglês `snake_case`):

| Tool | `jarvis` | `remoto` `leitura` | `remoto` `mensagem_*` | Classe |
|---|---|---|---|---|
| `workspace_list` | sim | sim | sim | leitura |
| `mission_list`, `pane_list` | sim | sim | sim | leitura |
| `pane_summary` | sim | sim | sim | leitura (saída **não confiável**, sanitizada e redigida) |
| `pilot_send` | sim (confirma) | **não** | sim (`mensagem_confirmada`: confirma no desktop; `mensagem_direta`: sem confirmação extra) | escrita |
| `pane_send` (por `display_id`) | sim (confirma, dígitos) | não | não | escrita |
| `mission_create` (só modo `free`, idempotente) | sim (confirma) | não | não | escrita |
| trocar workspace atual / focar painel | ação interna do app (IPC), sem tool | não | não | escrita_leve |
| `pane_spawn`, `pane_close`, `mission_complete`, `handoff_submit`, `provider_*`, `catalog_list`, `bench_*` | **não** | **não** | **não** | proibida |

Tools novas (entrada → saída; erro `{code, subcode?, message}` como no §3; códigos novos: `confirmation_required`,
`confirmation_expired`, `duplicate_request`, `no_pilot`, `untrusted_origin`):

| Tool | Entrada | Saída |
|---|---|---|
| `workspace_list` | `{}` | `[{workspace_id, name, current}]` |
| `pane_summary` | `{pane_id?, display_id?, mission_id?}` | `{pane_id, display_id, label, state, last_message ≤ 300, pending_question \| null, updated_at, untrusted: true}` |
| `pilot_send` | `{text ≤ 4000, client_request_id, mission_id?}` | `{delivered, pane_id}` · `no_pilot` se a Missão não tem piloto vivo |
| `pane_send` | `{display_id, text ≤ 4000, client_request_id}` (ator `jarvis`) | `{delivered}` |
| `mission_create` | `{title ≤ 120, goal ≤ 1000, mode: "free", client_request_id}` | `{mission_id}` · repetição → mesma missão |

`mission_id`, `pane_id` e `ator` **vêm do token**, nunca do argumento; os argumentos `display_id`/`mission_id` são validados dentro do
`workspace_id` do token.

**IPC (`window.ade`)**, validadores estritos:

```ts
"jarvis:estado":        { entrada: undefined; saida: EstadoJarvis }   // {ligado, estado, voz_local_disponivel, motor_stt_pronto, confirmacao: Pendente|null}
"jarvis:ligar|desligar":{ entrada: undefined; saida: EstadoJarvis }   // ligar exige motor de STT pronto (Fase 11); revoga o token ao desligar
"jarvis:config_gravar": { entrada: { patch: Partial<ConfigJarvis> }; saida: EstadoJarvis }
"jarvis:confirmar":     { entrada: { confirmacao_id: string; aprovado: boolean }; saida: boolean }   // origem 'ui'
"jarvis:historico":     { entrada: { depois: string|null }; saida: Pagina<ChamadaExterna> }          // args redigidos
// eventos main → renderer / envios renderer → main
"jarvis:estado_mudou":           { estado: EstadoSessao }
"jarvis:legenda":                { papel: "usuario"|"jarvis"; texto: string; final: boolean }
"jarvis:confirmacao_pendente":   { id: string; alvo_rotulo: string; resumo: string; expira_em: string }
"jarvis:falar":                  { id: string; texto: string; prioridade: "normal"|"alta" }   // → TTS local
envio "jarvis:fala_terminou":    { id: string }   |   envio "jarvis:interromper": {}          // tecla pressionada = barge-in

"remoto:estado":          { entrada: undefined; saida: EstadoRemoto }   // {ligado, endereco, porta, dispositivos[], pareando, ultimo_ip}
"remoto:ligar":          { entrada: { interface: string }; saida: EstadoRemoto | { erro: "sem_rede_privada"|"porta_ocupada" } }
"remoto:desligar":       { entrada: undefined; saida: EstadoRemoto }        // kill-switch: fecha sockets, revoga tokens, derruba canais
"remoto:parear_iniciar": { entrada: { permissao: Permissao }; saida: { codigo: string /* exibido uma vez */; expira_em: string } }
"remoto:parear_cancelar":{ entrada: undefined; saida: boolean }
"remoto:parear_confirmar_sas": { entrada: { igual: boolean; confirmacao_permissao: string|null }; saida: Dispositivo | null }
"remoto:revogar":        { entrada: { dispositivo_id: string }; saida: boolean }
"remoto:permissao_definir": { entrada: { dispositivo_id: string; permissao: Permissao; confirmacao: string|null }; saida: Dispositivo | null }
"remoto:aprovar_mensagem":  { entrada: { pedido_id: string; aprovado: boolean }; saida: boolean }
// eventos
"remoto:mudou":          { estado: EstadoRemoto }
"remoto:sas":            { sas: string /* 6 dígitos */ }
"remoto:pedido_pendente":{ pedido_id: string; dispositivo: string; resumo: string; expira_em: string }
```

**Protocolo da LAN** (HTTPS no IP privado escolhido; porta persistida): `GET /` e `GET /app.js|app.css` (estáticos, CSP estrita);
`POST /v1/pareamento/inicio` e `/v1/pareamento/fim` (≤ 16 KiB); `WS /v1/canal` (frames ≤ 16 KiB). Envelope do canal:
`{v:1, n:<contador por direção>, c:<AES-256-GCM base64>}`; tipos internos: `estado.snapshot`, `estado.evento`, `piloto.enviar`,
`piloto.pedido_status`, `erro`. Erros: `nao_autorizado`, `dispositivo_revogado`, `permissao_insuficiente`, `limite_de_taxa`,
`quadro_invalido`, `pareamento_expirado`, `confirmacao_pendente`. **Nenhuma** rota devolve versão, nome do produto ou lista de
dispositivos antes da autenticação; qualquer rota desconhecida = 404 idêntico.

**Primitivas** (só as padrão de `node:crypto`/WebCrypto, **sem criptografia própria**): ECDH P-256, ECDSA P-256/SHA-256, HKDF-SHA-256,
HMAC-SHA-256, AES-256-GCM (nonce = contador de 96 bits por direção). Chave de sessão = `HKDF(ecdh ‖ psk, salt = hash da
transcrição)` no pareamento; `HKDF(ecdh, salt = hash da transcrição)` nas reconexões, com **assinaturas mútuas** da transcrição
(servidor com a identidade fixada; dispositivo com a chave registrada).

Eventos de domínio: `jarvis.confirmation_requested|resolved`, `remote.device_paired|revoked|connected`, `remote.server_started|stopped`
(sem texto, sem token, sem IP além do último na tabela).

## UI (compacta, D-32)

- **Jarvis**: um botão `J` de 22 px **na linha única de controles** de Terminais, ao lado do microfone da Fase 11; estados por forma e
  `aria-label` (desligado, pronto, ouvindo, interpretando, aguardando confirmação, falando, erro). **Sem orb 3D**, sem janela
  flutuante (cortes de peso e de superfície): a legenda é **uma linha** de 11 px sobre o rodapé, some em 4 s.
- **Confirmação**: barra inline de 28 px acima do rodapé — `Enviar ao piloto #3: "…texto…" [Sim ↵] [Não Esc] 12 s`; o rótulo do alvo
  é o do painel (`#<display_id> · <CLI> · <papel> · <missão>`); em `pane_send` mostra o número **dígito a dígito**. Contagem regressiva
  em texto (não só cor).
- **Configurações → Jarvis**: ligar/desligar, atalho (segurar), apelido, voz local (lista filtrada a `localService`), velocidade,
  eventos falados (desligado), histórico de chamadas (args redigidos, 30 dias), "limpar". Sem vozes locais: o Jarvis funciona só
  com legenda e a tela diz isso.
- **Configurações → Remoto**: aviso em destaque azul no topo ("só use em rede confiável; o celular não consegue provar a página que
  recebe") + `Ligar` (escolhe a interface privada), `Parear` (mostra código `XXXX-XXXX-XXXX`, endereço `https://IP:porta` e o **SAS**
  de 6 dígitos para conferir), lista de dispositivos (nome, permissão, último uso, `Revogar`), permissão por dispositivo
  (`leitura` padrão; `mensagem_direta` exige digitar `PERMITIR`), "desligar após N min ociosos", "suspender escrita ao bloquear a tela".
- **Indicador permanente** no rodapé (26 px) enquanto o servidor estiver ligado: `● remoto · N` (forma + texto; vermelho-claro
  quando um dispositivo está conectado) e item **"Desligar controle remoto"** na bandeja (kill-switch em um clique).
- **Cliente web** (celular): uma tela só, fonte 14 px, lista de painéis com sinaleira, missões, e — **só se permitido** — caixa
  "Dizer ao piloto" com botão Enviar; tudo renderizado por `textContent`; estados de conexão e de pedido pendente em texto.
- Estados vazios e de erro dizem o próximo passo (sem motor de STT: "configure o ditado na Fase 11"; sem rede privada: "conecte-se a
  uma rede local").

## Tarefas

Formato: `T-13.NN · título` — entrega · aceite binário · depende. TDD (teste antes, falhando antes), `npm run verificar` verde; UI
herda P-01..P-14 e D-32. **Nenhuma task depois da T-13.01 inicia sem o estudo aprovado.**

### 13A — Estudo de ameaças
- **T-13.01 · Estudo de ameaças e portões G1/G2/G3** — ver a seção "T-13.01" acima: `docs/ade/seguranca/AMEACAS-FASE-13.md`,
  `tests/scripts/ameacas.test.ts`, confirmação/ajuste de D-71..D-75. Aceite: os **6 critérios de saída** verdes; o teste de
  consistência falha se uma ameaça Alta perder a task ou o teste; G3 registrado como "não implementar". · F3 (MCP), Fase 11
  (desenho do STT/consentimento).

### 13B — Fundação comum (atores, risco, confirmação, tools, síntese)
- **T-13.02 · Atores no MCP, tokens curtos e auditoria** — `tokens.ts` ganha `ator`, `origem`, `dispositivo_id`; emissão **em
  memória** para `jarvis` (≤ 60 min, revogada ao desligar) e `remoto` (≤ 60 s por requisição); revogação por ator/dispositivo; hook
  `aoChamar` no servidor grava `chamada_externa` (args **redigidos**, sem texto de fala/token) para `ator ≠ pane`; `tools/list` filtrado
  pela matriz do ator. Aceite: tokens de pane continuam idênticos (testes atuais verdes); token `jarvis` expirado/revogado →
  `unauthorized`; `tools_allow` do ator nunca excede a matriz; auditoria sem segredo (varredura); `ator` do argumento ignorado
  (AC-06, AC-19). · T-13.01, T-03.01.
- **T-13.03 · Política de risco, origem e confirmação pendente** — `nucleo/seguranca/{risco,confirmacao}.ts` (puros, relógio
  injetado): classes `leitura|escrita_leve|escrita|proibida`; **origem × classe** (origem `conteudo_externo`/`pane`/`web`/`issue`
  nunca autoriza `escrita`); `ConfirmacaoPendente` de uso único, TTL 15 s, atrelada a `args_hash`, resolvida só por `voz` (fala
  **depois** da tecla), `ui` ou `desktop`; reaproveitamento → recusa. Aceite: tabela completa origem × classe; "sim" gravado antes
  da confirmação não vale (AC-22); args alterados depois de mostrados → `args_hash` não confere e nada executa; expirada = negada;
  segunda resolução = recusa. · T-13.01.
- **T-13.04 · Tools MCP para atores externos** — `nucleo/mcp/tools/externas.ts` (`workspace_list`, `pane_summary`, `pilot_send`,
  `pane_send`, `mission_create` idempotente via `idempotencia`), `catalogo.ts` com a matriz por ator, erros novos. Aceite: matriz da
  tabela acima verificada por teste (ator × tool × permissão); `pilot_send` resolve o piloto da Missão pelo token (`no_pilot` se
  inexistente) e escreve no PTY sem alterar o texto além da sanitização; `mission_create` repetido com o mesmo
  `client_request_id` devolve a mesma missão (AC-21); `mode ≠ free` recusado; nenhuma tool proibida aparece em `tools/list` do
  ator; `display_id` de outro workspace → `not_found`. · T-13.02, T-13.03, T-03.02.
- **T-13.05 · Síntese de situação e redação** — `nucleo/jarvis/snapshot.ts`: por painel `{display_id, label, state, last_message ≤
  300, pending_question, updated_at}`, ≤ 10 painéis, **sem cauda bruta**, remoção de ANSI/OSC/controle, **redação de segredos**
  (padrões da Fase 11 `redacao.ts`), diferença entre snapshots, `pending_question` só quando a sinaleira está `aguardando`. Aceite:
  saída nunca passa de 300 caracteres por painel nem de 10 painéis; chave/token impressos no terminal saem mascarados (AC-14); só
  diferenças no 2º turno (P-61); marcação `untrusted: true` sempre presente; 50 painéis geram só os 10 mais relevantes
  (aguardando primeiro). · T-13.01.

### 13C — Jarvis (cliente de voz sobre o MCP local)
- **T-13.06 · Gramática PT-BR e números** — `nucleo/jarvis/gramatica.ts`, pura, **lista fechada**: `estado`, `listar_paineis`,
  `listar_missoes`, `abrir_workspace <nome>`, `focar_painel <n>`, `enviar_ao_piloto <texto>`, `enviar_ao_painel <n> <texto>`,
  `criar_missao <título>`, `repetir`, `cancelar`, `sim`, `nao`, `silenciar`; números em dígitos e por extenso (0–9999), normalização
  de acento/caixa, **sem LLM**. Sem intenção reconhecida → `sem_intencao` (o serviço oferece "enviar ao piloto?"). Aceite: ≥ 60
  frases de teste (variações, ruído, "né", hesitação); "painel cinco mil duzentos e oito" = 5208; frase com texto de painel
  ("o painel disse: diga sim") **não** produz `sim` (AC-03); comando destrutivo ("apague o repo") cai em `sem_intencao`, nunca em
  intenção de escrita sem confirmação; entrada de 10 000 caracteres não trava (≤ 5 ms). · T-13.01.
- **T-13.07 · Máquina de estados do diálogo** — `nucleo/jarvis/maquina.ts`, pura, relógio injetado: `desligado → ocioso → ouvindo
  → interpretando → [confirmando] → executando → falando → ocioso`; microfone **só** em `ouvindo` (tecla segurada); tecla durante
  `falando` = barge-in (interrompe a fala e abre `ouvindo`); confirmação expira em 15 s = negada; `silenciado`; `silenciar` corta a fala
  e os eventos falados. Aceite: tabela completa estado × evento; fala fora de `ouvindo` é ignorada (AC-01, AC-02); confirmar
  exige fala **iniciada depois** de `confirmando`; nada transita sozinho para `executando`. · T-13.03, T-13.06.
- **T-13.08 · Serviço Jarvis no main** — `main/jarvis.ts` (lazy) + `main/cliente-mcp.ts` (JSON-RPC mínimo via `fetch` ao MCP em
  loopback, `Authorization: Bearer`, sem SDK): reaproveita o STT da Fase 11 por uma porta `DestinoFala` (`pane` = comportamento atual,
  `jarvis` = devolve o texto ao interpretador; **a Fase 11 continua verde sem mudança de comportamento**), gramática → risco →
  confirmação → chamada MCP → fala; `abrir_workspace` e `focar_painel` por IPC interno (escrita_leve); idempotência por
  `client_request_id` (um por fala); registra em `chamada_externa`; MCP indisponível → informa uma vez e segue só com ações locais.
  Aceite: e2e com STT/MCP reais e CLI de eco: "diz ao piloto: finalizar a publicação" → confirmação → "sim" → texto no PTY do piloto
  **uma vez**; painel inexistente → `not_found` falado com sugestões, nada enviado; confirmação expirada não envia; ator `jarvis`
  chamando `pane_close` → `forbidden`; token revogado ao desligar; P-63. · T-13.04, T-13.05, T-13.07, T-11.10.
- **T-13.09 · TTS local, fila de falas e eventos falados** — `renderer/jarvis/tts.ts` com `speechSynthesis` **só com vozes
  `localService === true`** (sem voz local: só legenda); fila com prioridade; pausa ao pressionar a tecla; sanitização do que é
  falado (sem URL/Markdown/controle: AC-23); eventos falados **desligados por padrão**, quando ligados: `pane.state_changed →
  aguardando` e `handoff.submitted`, no máximo 1 evento / 10 s por painel e 6 / min no total, sem repetir "piloto bloqueado".
  Aceite: voz remota nunca é escolhida (teste com lista simulada); texto com `https://x` e `**` é falado sem símbolos; 10 eventos
  em 3 s geram no máximo 1 fala por painel; pressionar a tecla interrompe em ≤ 100 ms. · T-13.07.
- **T-13.10 · Contrato realtime remoto, política de custo e provedor falso** — `nucleo/jarvis/realtime/{provedor,politica-custo,
  falso}.ts`: interface `ProvedorVozRealtime`/`SessaoRealtime` (abrir, enviar áudio, receber áudio/transcrição/chamada de tool,
  responder tool, fechar) **sem nenhum adaptador real** (D-71, P-40); política pura: `T_idle` 60 s, gate (só envia áudio com
  atividade de voz e fora de `falando`), resumo de histórico acima de 8 000 tokens, **só diferenças** do snapshot, limite diário de
  minutos (padrão 15), reconexão com resumo em ≤ 3 s e retry 1/2/4 s (máx. 3), contador de tokens/áudio. Aceite: P-60, P-61, P-62
  com o falso e relógio injetado; "dia de trabalho" simulado ≤ 1,2 M tokens; chamada de tool do falso passa pela mesma matriz de
  risco/confirmação do Jarvis em cascata; nenhum import de rede em `nucleo/jarvis/realtime`. · T-13.05, T-13.03.
- **T-13.11 · IPC `jarvis:*` e UI do Jarvis** — validadores, preload, `BotaoJarvis.tsx`, barra de confirmação, legenda de uma linha,
  `SecaoJarvis.tsx`, histórico, entrada na paleta ⌘K, atalho de segurar `Cmd/Ctrl+Shift+J`. Aceite: RTL dos estados (rótulo ≠ só
  cor); confirmação mostra alvo e texto exatos e contagem em texto; `jarvis:confirmar` de outra janela/subframe recusado; sem
  motor de STT, `Ligar` explica o que fazer; linha única preservada (fração da altura ≥ 0,90, D-32); chunk ≤ 25 KB gz (P-69). ·
  T-13.08, T-13.09.

### 13D — Controle remoto local
- **T-13.12 · Certificado autoassinado mínimo e identidade do servidor** — `nucleo/remoto/certificado.ts` (DER mínimo de X.509 v3
  ECDSA P-256 com SAN de IP e `basicConstraints` CA:FALSE; assinatura por `crypto.sign`), identidade de longo prazo e chave TLS no
  cofre (`safeStorage`, T-11.02), regeneração quando o IP da interface muda. **Sem dependência nova.** Aceite: `new
  X509Certificate()` lê o certificado, `verify(chavePublica)` e `checkIP` passam; `openssl x509 -text` concorda (teste pulado
  se não houver `openssl`); um `https.request` do teste com `ca` = certificado conecta; chave privada nunca em claro no disco nem
  no log (AC-18); 1ª geração ≤ 500 ms (P-65). · T-13.01, T-11.02.
- **T-13.13 · Protocolo de pareamento e canal cifrado** — `nucleo/remoto/protocolo.ts`, puro, com vetores de teste: código de 12
  caracteres base32 (60 bits), TTL 120 s, **uso único**, janela fecha após 5 tentativas erradas; ECDH efêmero + PSK → HKDF →
  confirmações HMAC → **SAS de 6 dígitos**; chaves públicas trocadas e fixadas (celular fixa a do servidor; servidor registra a do
  celular); reconexão com ECDH efêmero e **assinaturas mútuas**; canal AES-256-GCM com contador monotônico por direção (nonce = contador),
  quadro repetido/fora de ordem/adulterado → fecha o canal. Aceite: cliente de teste em Node completa o pareamento e a
  reconexão; código errado 5× fecha a janela; segundo uso do código → `pareamento_expirado`; atacante que não conhece o código não
  chega a SAS igual (AC-07, AC-08); quadro repetido ou com contador menor é recusado (AC-11, AC-24); nenhuma primitiva própria
  (varredura de imports só de `node:crypto`); P-68 e P-64 (handshake ≤ 1 s). · T-13.01, T-13.12.
- **T-13.14 · Armazém de dispositivos e permissões** — `nucleo/remoto/dispositivos.ts` + tabela `dispositivo_remoto` (migration):
  criar só com SAS confirmado no desktop, permissão `leitura` por padrão, subir permissão só por ação no desktop (`mensagem_direta`
  exige digitar `PERMITIR`), `revogar` derruba o canal na hora, `ultimo_uso_em`/`ultimo_ip`. Aceite: dispositivo revogado nunca
  autentica, nem com quadro gravado (AC-10, AC-24); permissão não sobe por mensagem do celular; consulta quente ≤ 5 ms (P-14); P-67.
  · T-13.13.
- **T-13.15 · Servidor HTTPS da LAN** — `nucleo/remoto/politica-rede.ts` (pura) + `main/remoto.ts` (lazy): `listen` **somente** no IP
  privado escolhido (nunca `0.0.0.0`), recusa origem fora de 10/8, 172.16/12, 192.168/16 (e loopback no teste), `Host` exatamente
  `IP:porta`, `Origin` conferido no WebSocket, 404 idêntico para rota desconhecida, sem cabeçalho de versão, limites (HTTP ≤ 16 KiB,
  quadro ≤ 16 KiB, 4 conexões, 30 requisições/min por IP antes de autenticar, 5 pareamentos falhos → bloqueio de 10 min do IP),
  batimento de 20 s e fecho por ociosidade (60 min padrão), **não persiste "ligado"**, `desligar` fecha sockets, revoga tokens e
  derruba canais. Aceite: IP público/`Host` forjado/`Origin` estranho recusados (AC-09, AC-12); flood não passa dos limites e não
  derruba o app (AC-16, P-12); desligado = 0 sockets (P-65); reiniciar o app deixa o servidor desligado (AC-20); ligar sem rede
  privada → `sem_rede_privada`. · T-13.12, T-13.13.
- **T-13.16 · API remota, permissões e confirmação no desktop** — `ServicoRemoto` traduz comandos do canal em chamadas MCP com **token
  curto** (`ator=remoto`, ≤ 60 s, `tools_allow` conforme a permissão do dispositivo): `leitura` = `workspace_list`, `mission_list`,
  `pane_list`, `pane_summary`; `mensagem_confirmada` = + `pilot_send` **só depois de `remoto:aprovar_mensagem` no desktop** (TTL
  30 s, texto fixado por `args_hash`); `mensagem_direta` = + `pilot_send` sem confirmação extra, **suspensa ao bloquear a tela**
  (padrão) e sempre com log; snapshots enviados ao celular passam por T-13.05 (sanitizados, redigidos, `untrusted`); **nenhuma**
  ação humana do método (D-21). Aceite: dispositivo `leitura` chamando `pilot_send` → `permissao_insuficiente` (AC-15); `mensagem_
  confirmada` sem aprovar no desktop não envia; tela bloqueada suspende `mensagem_direta`; resumo com segredo impresso chega
  mascarado (AC-14); P-64. · T-13.04, T-13.05, T-13.14, T-13.15.
- **T-13.17 · Cliente web mínimo** — `src/main/remoto-cliente-web/{index.html,app.js,app.css}` (≤ 15 KB gz, sem dependência,
  CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`,
  sem inline), WebCrypto para ECDH/ECDSA/AES-GCM, chave do celular em IndexedDB, **fixa a chave pública do servidor** no pareamento e
  recusa reconexão se mudar; tudo renderizado com `textContent`; copiado para `dist/` e declarado no `electron-builder.yml`.
  Aceite: e2e em Chromium de teste: pareia, vê painéis, envia mensagem quando permitido; saída de terminal com `<img onerror=…>` e
  `<script>` aparece como texto (AC-13); página trocada por outra chave pública do servidor → recusa; tamanho dentro de P-69;
  `test:pacote` encontra o cliente no pacote. · T-13.13, T-13.15.
- **T-13.18 · IPC `remoto:*`, UI e indicador** — validadores, preload, `SecaoRemoto.tsx` (aviso, ligar, parear com código/endereço/SAS,
  dispositivos, permissões, ociosidade), `IndicadorRemoto.tsx` no rodapé, item de bandeja "Desligar controle remoto", diálogo de
  aprovação de mensagem. Aceite: RTL (indicador por forma + texto); `PERMITIR` obrigatório para `mensagem_direta`; o código só
  aparece uma vez e some ao expirar; `remoto:desligar` pela bandeja fecha tudo; canal sem validador falha o teste de contrato; chunk
  de configuração dentro de P-69. · T-13.16, T-13.17.

### 13E — Fecho
- **T-13.19 · Suíte adversarial** — `tests/seguranca-fase13.e2e.test.ts`: um teste nomeado por AC-01..AC-24 (cada um falha se a mitigação
  for removida — mutação); inclui áudio simulado fora da tecla, "sim" gravado antes da confirmação, conteúdo de painel com
  instruções, token expirado, replay de quadro, `Host`/`Origin` forjados, IP público, XSS no cliente, segredo impresso no terminal,
  dispositivo `leitura` escalando, flood, kill-switch, servidor religando sozinho, `client_request_id` repetido. Aceite: todos
  verdes; `tests/scripts/ameacas.test.ts` verde (toda ameaça Alta com task e teste existentes). · T-13.11, T-13.18.
- **T-13.20 · Perf, sockets e pacote** — P-60..P-69 em `tests/perf`; teste de sockets/processos (desligado = 0; fim da suíte = 0);
  `test:pacote` confere o cliente web e a ausência de dependência nova; chunk lazy do Jarvis. Aceite: `ultimo.json` verde com os 10
  orçamentos; nenhum socket/processo de teste vivo. · T-13.19.
- **T-13.21 · Auditoria final, contratos e registro do G3** — revisão de segurança do código novo contra o estudo; mesclar tabelas, tools,
  canais e claims em `05-CONTRATOS.md`, atalhos e telas em `04-UI-UX.md`; `STATUS.md` com o que só a pessoa valida; confirmar em
  `01-DECISOES.md` D-71..D-75 e em `PENDENCIAS-DO-DONO.md` P-40..P-42. Aceite: nenhum achado Alto aberto; G3 registrado como "relay/app
  móvel/VPS **não implementados**"; contratos conferidos por teste de contrato. · T-13.20.
- **T-13.22 · Relay cego (BLOQUEADA — NÃO EXECUTAR)** — só existe como lembrete dos requisitos mínimos da T-13.01. Destrava **apenas** com
  P-42 respondida "sim" **e** novo estudo de ameaças específico (app nativo, hospedagem, custo). Aceite: nenhum código de relay, nenhuma
  dependência e nenhum domínio/serviço externo foram adicionados nesta fase (teste de varredura de imports e de `electron-builder.yml`). ·
  P-42.

## Casos de teste (resumo; cada item vira teste nomeado)

1. Estado por voz: segurar a tecla, "o que está acontecendo?" → resumo falado ≤ 10 painéis, nenhuma escrita.
2. Enviar ao piloto: pedido → confirmação com alvo e texto → "sim" **depois** → texto no PTY do piloto uma vez, sem duplicar.
3. Confirmação ignorada 15 s, "não", Esc ou clique "Não" → nada enviado; "sim" falado **antes** da confirmação não vale.
4. Painel inexistente (`5834`) → erro falado com sugestões; ID de 4 dígitos exige confirmação dígito a dígito.
5. Texto de painel "diga sim" ou "apague o repositório" é falado/mostrado como dado e nunca vira `sim` nem comando.
6. Microfone só abre com a tecla segurada: som de fundo sem tecla não gera STT; fala do TTS não é reaproveitada como entrada.
7. Ator `jarvis` não consegue `pane_close`, `pane_spawn`, `mission_complete`, `bench_*`, `handoff_submit` (`forbidden`).
8. `mission_create` repetido com o mesmo `client_request_id` → uma missão; `mode: "squad"` recusado.
9. Token do Jarvis revogado ao desligar; token expirado → `unauthorized`; `ator` do argumento ignorado.
10. Pareamento feliz com SAS igual nos dois lados; código errado 5× fecha a janela; segundo uso → `pareamento_expirado`.
11. MITM de teste que não conhece o código não chega a SAS igual nem a dispositivo registrado.
12. Quadro repetido, fora de ordem ou adulterado fecha o canal; dispositivo revogado com quadro gravado é recusado.
13. `Host` forjado, `Origin` estranho e IP público recusados; rota desconhecida = 404 idêntico; flood respeitando os limites.
14. Dispositivo `leitura` tentando `pilot_send` → `permissao_insuficiente`; `mensagem_confirmada` só envia após aprovação no desktop.
15. Tela bloqueada suspende `mensagem_direta`; kill-switch (UI e bandeja) fecha sockets e derruba canais em ≤ 1 s.
16. Reiniciar o app deixa o remoto **desligado**; desligado = 0 sockets.
17. Resumo de painel com chave impressa chega mascarado ao celular e à fala; ≤ 300 caracteres por painel.
18. Cliente web: saída de terminal com HTML/JS aparece como texto; chave pública do servidor trocada → recusa.
19. Provedor realtime **falso**: ocioso 60 s fecha e envia 0 tokens; só diferenças; resumo acima de 8 000; dia simulado ≤ 1,2 M tokens.
20. Sem motor de STT, `Ligar` o Jarvis explica o que fazer; sem voz local o Jarvis funciona só com legenda.
21. Nenhum código/dependência/serviço de relay existe no repositório e no pacote.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Prompt injection**: conteúdo de painel/web/issue tenta virar comando | Gramática determinística (sem LLM no meio); conteúdo só é falado/exibido como dado `untrusted`; origem ≠ fala do usuário nunca autoriza escrita; confirmação com `args_hash` (AC-03, AC-22) |
| **Custo de input do Jarvis com sessão aberta** (R$ 83/dia na spec 11) | Cascata sem sessão remota; para o realtime opcional: `T_idle` 60 s, gate de áudio, só diferenças, resumo > 8 000 tokens, limite diário, P-60..P-62 medidos com falso |
| **Voz que vira ação** (som ambiente, eco do TTS, STT errado) | Microfone só com tecla segurada, TTS pausa ao pressionar, confirmação **depois** da tecla, ID dígito a dígito, padrão = piloto |
| **Relay precisa ser cego, pareamento de uso único, TTL curto** | Relay **não implementado** (D-73/G3); requisitos mínimos documentados na T-13.01; T-13.22 bloqueada; sem app nativo o risco R1 não se resolve |
| **Atacante ativo na LAN** serve página adulterada (cliente web) | Não mitigável sem app nativo: restrito a redes confiáveis, aviso na UI, permissão `leitura` padrão, SAS, chave do servidor fixada pelo celular, residual R1 levado ao dono (P-41) |
| **Composição criptográfica própria** | Só primitivas padrão (`node:crypto`/WebCrypto), vetores de teste, sem biblioteca nova; **revisão externa recomendada** antes de uso fora de rede doméstica (P-41, residual R2) |
| **DNS rebinding / varredura da LAN** | Bind só no IP privado escolhido, `Host`/`Origin` exatos, 404 uniforme, servidor sob demanda e desligado por padrão |
| **Dispositivo roubado** | `leitura` por padrão, revogação ≤ 1 s, kill-switch, ociosidade, escrita suspensa ao bloquear a tela |
| **Segredo no terminal exfiltrado por resumo/voz** | Redação de padrões de segredo, 300 caracteres, só por dispositivo/ator permitido; o resumo não é cauda bruta |
| **Token do ator vazado** | Só em memória, TTL curto, loopback, `tools_allow` mínimo, revogação ao desligar/revogar, auditoria sem segredo |
| **Escalada de privilégio** (remoto → ações humanas do método) | D-21: ações humanas nunca por voz/remoto; matriz de tools testada; `proibida` não aparece em `tools/list` |
| **TLS autoassinado**: aviso do navegador acostuma a pessoa a aceitar | Texto explicativo, SAS, pin da chave do servidor no app-layer; o aviso é parte do desenho, não escondido |
| **Permissões do SO** (microfone, voz do sistema) e Windows sem validação | Herdadas da Fase 11 (T-11.01); voz local do SO opcional; Windows só em unidade (D-26) |
| **Vazamento de sockets/processos** em teste | `finally` em tudo, contagem de handles, `ps` ao fim da suíte |
| Fonética de IDs ("528" × "5208") | Confirmação dígito a dígito + rótulo do painel; `pane_send` só com `display_id` do workspace |

## Ordem de execução e paralelismo

```
T-13.01 (estudo — GATE) ─┬─► T-13.02 ─► T-13.04 ─┐
                         ├─► T-13.03 ────────────┤
                         ├─► T-13.05 ────────────┼─► T-13.08 ─► T-13.11 ─┐
                         ├─► T-13.06 ─► T-13.07 ─┘      T-13.09 ─────────┤
                         │                              T-13.10 ─────────┤
                         └─► T-13.12 ─► T-13.13 ─► T-13.14 ─► T-13.15 ─► T-13.16 ─► T-13.17 ─► T-13.18 ─┤
                                                                                                          ▼
                                                                          T-13.19 ─► T-13.20 ─► T-13.21   (T-13.22 bloqueada)
```

Depois do portão T-13.01, frentes **em paralelo** (áreas de arquivo disjuntas):

| Frente | Tasks | Áreas |
|---|---|---|
| A — segurança comum (puro) | T-13.03, T-13.05 | `src/nucleo/seguranca/**`, `src/nucleo/jarvis/snapshot.ts` |
| B — Jarvis puro | T-13.06, T-13.07, T-13.10 | `src/nucleo/jarvis/{gramatica,maquina,realtime}/**`, `tests/fixtures/provedor-voz-falso.ts` |
| C — remoto puro | T-13.12, T-13.13, T-13.14 | `src/nucleo/remoto/**` |
| D — cliente web | T-13.17 | `src/main/remoto-cliente-web/**` |
| E — TTS e UI do Jarvis | T-13.09, parte de T-13.11 | `src/renderer/jarvis/**`, `src/renderer/telas/config/SecaoJarvis.tsx`, `telas/terminais/BotaoJarvis.tsx` |

Integração (agente principal, em série): T-13.02, T-13.04, T-13.08, T-13.15, T-13.16, T-13.18, T-13.19..T-13.21 (tocam
`nucleo/mcp/*`, `main/*`, `main/ipc/*`, `compartilhado/ipc.ts`, `preload.ts`, `main.ts`, `electron-builder.yml`). Ninguém edita esses
arquivos fora da integração. **Fase 11 deve estar fechada** (T-11.10 e T-11.02 em especial) antes de T-13.08 e T-13.12.

## Decisões [LAC] resolvidas (resumo; texto completo em `01-DECISOES.md`)

| [LAC] das specs 10 e 11 | Decisão |
|---|---|
| Wake word "Olá, Jarvis" (como detectar; custo e privacidade) | [DEC] **cortada**: microfone só com tecla segurada (hotkey físico); nada escuta o ambiente (D-72) |
| Provedor de voz realtime (Gemini Live/OpenAI Realtime) e quem paga | [DEC] cascata local-first; realtime = interface + falso, adaptador real só com P-40 (D-71) |
| Schemas reais das tools MCP do Overclock | [DEC] o MCP é do ExpxV: tools novas definidas aqui, nomes em inglês `snake_case` |
| `auto_approve_voice` e cache de aprovação TTL 10 min | [DEC] **não existem**: toda escrita confirma, a cada vez, com `args_hash` (a decisão mais arriscada da spec 11) |
| Chat-como-backlog, modo anfitrião, Reflexo/JEV, `view_screen`, `run_command`, `open_app`, calendário | [DEC] cortados (D-05); sem exec por voz |
| Endereçamento de painel por ID ditado | [DEC] `display_id` do workspace, dígito a dígito + rótulo; padrão = piloto |
| Trial/Ultra/`bot_access`/`jarvis` (entitlements) | [DEC] cortados (D-05) |
| Relay: cifra, hospedagem, QR, Tailscale, app iOS, VPS 24h, bridge de voz | [DEC] **não implementados** (D-73); requisitos mínimos só em documentação (T-13.01); QR fora (sem biblioteca) |
| Arms (~54 tools), allowlist, `ArmsCallLog`, "nunca main", heartbeat | [DEC] doutrina aproveitada: matriz por ator + `chamada_externa` + sem exec; "nunca main" já é D-36; heartbeat do MCP é da Fase 3 |
| Controle remoto sem relay | [DEC] só LAN, HTTPS autoassinado, pareamento PSK+ECDH+SAS, permissões graduadas, desligado por padrão (D-74); residuais R1/R2 → P-41 |
| Atores e confirmação pendente | [DEC] `ator` nos tokens e confirmação de uso único com `args_hash` (D-75) |
