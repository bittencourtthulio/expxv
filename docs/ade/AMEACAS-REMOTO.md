# Estudo de ameaças — Fase 13, onda 1 (Jarvis por texto e controle remoto local)

T-13.01 (adaptado). Escrito **depois** do núcleo desta onda (cada caso foi provado por um teste nomeado antes de virar linha aqui). Herda e **não duplica** `AMEACAS-TELEGRAM.md` (modelo de
pareamento, autorização, aprovação de uso único, redação, pânico, auditoria) e a pré-análise de `fase-13-jarvis-controle-remoto.md`. Validado por `tests/scripts/ameacas-fase13.test.ts`
(toda ameaça Alta aponta para uma task existente e para um teste existente em `src/nucleo/remoto/adversarial.test.ts`) e exercitado por mutação em
`tests/scripts/mutacao-fase13.mjs` (a mitigação sai, o teste precisa ficar vermelho).

**Escopo desta onda.** Jarvis = assistente de comando por **texto**: traduz o pedido em **ações tipadas** de uma lista fechada (`status`, `listar_missoes`, `listar_paineis`,
`consultar_consumo`, `abrir_pane`, `enviar_prompt` ao Maestro/squad, `aprovar_gate`, `pausar`, `parar`) por portas injetadas e três classes de risco (`leitura`, `escrita_leve`, `escrita`).
Controle remoto = servidor local autenticado por **dispositivo** (chave pública ECDSA; nenhum segredo de dispositivo no servidor), em LAN com HTTPS ou em loopback (túnel do próprio usuário),
sempre por opt-in com consentimento, expiração, revogação, limite de taxa, auditoria e pânico. **Fora (D-05/D-73, G3):** relay, app móvel, VPS, host mode, voz realtime. Voz entra só
pela Fase 11 (pendência de ligação; nenhum áudio passa por aqui).

## 1. Fronteiras de confiança

| | Fronteira | O que cruza | Controle |
|---|---|---|---|
| F1 | pessoa ↔ app (desktop) | texto de comando, «Sim/Não», `PERMITIR`, SAS, pânico | canais `sensivel` (log sem payload); a **confirmação só nasce e só se resolve no desktop** (`ui`/`desktop`) |
| F2 | texto de painel/issue/web/terminal ↔ interpretador | dado não confiável | `origem = conteudo_externo` nunca vira comando nem autoriza escrita; saída marcada `nao_confiavel`, sempre renderizada como texto |
| F3 | interpretador ↔ LLM classificadora (opt-in) | texto **redigido** sai, uma ação da lista volta | validador estrito da saída; texto de `enviar_prompt` é sempre o que a pessoa disse; a LLM nunca executa, confirma nem decide aprovação humana (D-21) |
| F4 | main ↔ LAN/loopback (servidor remoto) | POST JSON (≤ 16 KiB) | IP de origem privado, `Host` exato, `Origin` mesma-origem, `Content-Type` JSON, 404 uniforme, taxa por IP e por dispositivo, 4 conexões |
| F5 | celular ↔ servidor (camada de aplicação) | pareamento PSK+ECDH, sessão com assinaturas mútuas, quadros AES-256-GCM | primitivas padrão de `node:crypto`; contador monotônico por direção; AAD com o `sid` |
| F6 | orquestrador/Maestro ↔ execução | plano proposto, confirmado e **reavaliado** | `args_hash` + plano vivo + política (`avaliarPlano`/`podeExecutarDireto`) na proposta e na execução; gesto proibido barrado antes de tudo |

## 2. Ativos

1. Capacidade de pôr trabalho em andamento (pedido ao Maestro, decisão de portão, pausar/parar). 2. Conteúdo de painéis e títulos (pode ter segredo). 3. **Chave privada de identidade do servidor**
(cofre do SO). 4. Chave pública dos dispositivos e sua permissão. 5. Código de pareamento (60 bits, só memória, 120 s). 6. Auditoria (30 dias). 7. Repositório e worktrees do usuário.

## 3. Atores

| Ator | Pode | Não pode (garantia) |
|---|---|---|
| Dono presente | tudo no app | — |
| Dono ausente com celular pareado `leitura` | ver status, painéis, Missões | escrever (`permissao_insuficiente`) |
| ... `mensagem_confirmada` | pedir/pausar/parar/decidir portão **com «Sim» no desktop** | executar sem o dono; ação humana (D-21) |
| ... `mensagem_direta` (digitou `PERMITIR`) | `enviar_prompt`/`pausar`/`parar` sem confirmação extra se a política de modo direto liberar | `aprovar_gate` sem confirmar; escrever com tela bloqueada |
| Celular roubado | até revogar o que a permissão dele permitia | reconectar depois de revogado (≤ 1 s), nem com quadro gravado |
| Qualquer host da LAN | tentar conectar | obter qualquer resposta útil sem pareamento (404 uniforme; IP fora da rede privada é fechado sem resposta) |
| Atacante ativo na LAN | tentar MITM/flood | autenticar sem o código (60 bits + SAS); ver conteúdo (AES-GCM) — **mas pode servir página adulterada se houver cliente web (R1)** |
| Outro processo local | conectar em loopback | autenticar sem chave de dispositivo; ler segredo (identidade só no cofre; nada de dispositivo no servidor) |
| Texto hostil em painel/issue/PR | ser exibido | virar comando, «sim», aprovação ou prompt reescrito |

## 4. STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Interpretador (regras + LLM opt-in) | gesto proibido barrado antes da ação | saída da LLM validada; texto do prompt é da pessoa | auditoria por passo | LLM só vê texto redigido | entrada ≤ 4 000, regras lineares | lista fechada; nada humano (D-21) |
| Confirmação | só `ui`/`desktop` resolvem | payload congelado + `args_hash` | `confirmacao_*` auditadas | resumo redigido | TTL, ≤ 10 pendentes | uso único; plano vivo reavaliado |
| Servidor local | IP privado, `Host`, `Origin` | corpo ≤ 16 KiB, JSON estrito | recusas contadas (não gravadas 1 a 1) | 404 uniforme, sem versão | taxa/IP, 4 conexões, timeouts | bind só no IP escolhido |
| Pareamento | código 60 bits, MAC por HKDF | transcrição no HKDF | `pareamento_*` | resposta uniforme | 5 erros fecham; 5 falhas bloqueiam o IP 10 min | desktop decide; `PERMITIR` p/ direta |
| Sessão/canal | assinatura ECDSA do dispositivo e do servidor | AES-GCM, AAD com `sid` | `sessao_iniciada`, `quadro_invalido` | chave efêmera por sessão | ≤ 8 sessões, 120 msg/min/dispositivo | revogado/expirado nunca autentica |
| Dispositivos | — | permissão só sobe pelo desktop | `dispositivo_*` | só chave pública no banco | cache em memória | validade deslizante, revogação imediata |
| Identidade/TLS | par ECDSA no cofre; certificado efêmero | — | — | nunca ao renderer/log | — | — |
| Auditoria | — | só inserções | 30 dias | redigida, sem fala/token/chave | retenção | — |

## 5. Casos de abuso

Colunas: caso · severidade · mitigação · task do plano · teste nomeado (`adversarial.test.ts`) · mutação (`mutacoes-fase13.mjs`).

| AR | Caso | Sev. | Mitigação | Task | Teste | Mutação |
|---|---|---|---|---|---|---|
| AR-01 | Texto de painel/issue/web instrui «apague tudo»/«aprove» e vira comando | Alta | `conteudo_externo` nunca é interpretado nem escreve | T-13.03 | `ar01_conteudo_externo_nao_vira_comando` | AR-01a, AR-01b |
| AR-02 | «sim», «ok», «o painel disse: diga sim» confirma um pedido pendente | Alta | confirmação só por id em `jarvis:confirmar`/desktop; texto «sim» é `sem_intencao` | T-13.03 | `ar02_sim_textual_nao_confirma` | — (estrutural: não existe rota de texto para confirmar) |
| AR-03 | Prompt injection pela LLM classificadora (ação fora da lista, texto reescrito) | Alta | validador estrito; texto = o que a pessoa disse; LLM nunca executa | T-13.06 | `ar03_llm_so_classifica` | AR-03a, AR-03b |
| AR-04 | Gesto humano (merge, assinar prodx, raio ALTO, `mergex-revisar`, apagar) por Jarvis/remoto | Alta | `gestoProibidoNoTexto` + portão `exige_humano` + política | T-13.03 | `ar04_gestos_humanos_nunca` | AR-04a, AR-04b |
| AR-05 | Confirmação reaproveitada (replay do «sim»); resolver por voz/remoto | Alta | uso único, só `ui`/`desktop` | T-13.03 | `ar05_confirmacao_uso_unico` | AR-05a, AR-05b |
| AR-06 | Pedido alterado depois de mostrado; plano mudou entre proposta e execução | Alta | payload congelado, `args_hash`, plano vivo reavaliado | T-13.03 | `ar06_args_hash_e_plano_vivo` | AR-06a, AR-06b |
| AR-07 | Força bruta do código de pareamento | Alta | 60 bits, 120 s, uso único, 5 erros fecham, 5 falhas bloqueiam IP | T-13.13 | `ar07_forca_bruta_pareamento` | AR-07a, AR-07b |
| AR-08 | MITM no pareamento sem conhecer o código | Alta | PSK no HKDF, `conf_s`/`conf_c` por HMAC, SAS de 6 dígitos no desktop | T-13.13 | `ar08_mitm_sem_codigo` | AR-07b |
| AR-09 | DNS rebinding / `Host` forjado | Alta | `Host` exato; 404 uniforme | T-13.15 | `ar09_dns_rebinding_host` | AR-09a, AR-09b |
| AR-10 | CSRF de página de terceiro (POST simples, `Origin` estranho, preflight) | Alta | `Origin` mesma-origem, `Content-Type: application/json`, sem CORS | T-13.15 | `ar10_csrf_origin_e_content_type` | AR-10a, AR-10b, AR-10c |
| AR-11 | Replay/reordenação/adulteração de quadros | Alta | AES-256-GCM, contador estrito, AAD com `sid`, sessão fecha | T-13.13 | `ar11_replay_quadros` | AR-11 |
| AR-12 | Varredura de portas/rotas descobre o produto | Média | 404 idêntico, sem versão nem nome | T-13.15 | `ar12_404_uniforme` | — |
| AR-13 | IP público ou fora da rede privada conecta | Alta | origem privada (ou loopback no túnel); fecha sem resposta | T-13.15 | `ar13_ip_publico_recusado` | AR-13 |
| AR-14 | Dispositivo `leitura` escreve | Alta | matriz ator × permissão | T-13.16 | `ar14_leitura_nao_escreve` | AR-14 |
| AR-15 | Permissão sobe sozinha (pelo celular, sem `PERMITIR`) | Alta | só o desktop altera; `PERMITIR` exato | T-13.14 | `ar15_permissao_so_pelo_desktop` | AR-15 |
| AR-16 | Flood/DoS (taxa, corpo, conexões) | Média | taxa por IP (30/min sem auth, 240/min canal), 120/min por dispositivo, corpo 16 KiB, 4 conexões | T-13.15 | `ar16_flood` | AR-16 |
| AR-17 | Dispositivo roubado/revogado reconecta (sessão aberta, quadro gravado, assinatura) | Alta | revogado/expirado nunca autentica, conferido a cada requisição; assinatura ECDSA; nonce anti-replay | T-13.14 | `ar17_revogado_nunca_autentica` | AR-17a..AR-17e |
| AR-18 | Servidor liga/religa sozinho ou sem consentimento | Alta | nasce desligado; consentimento versionado; `persistido: false` | T-13.15 | `ar18_nao_religa_sozinho` | AR-18 |
| AR-19 | Auditoria/log com segredo, fala integral ou caminho | Alta | `redigirParaCanal` na entrada da linha; canais sensíveis sem log de payload | T-13.02 | `ar19_sem_segredo_em_auditoria` | AR-19a |
| AR-20 | Segredo impresso no terminal vaza pelo resumo de painéis | Alta | redação + 300 caracteres + só rótulo/estado do banco (sem cauda bruta) | T-13.05 | `ar20_resumo_redige_segredo` | AR-20 |
| AR-21 | `client_request_id` repetido duplica o pedido | Média | idempotência por (ator, dispositivo, id) 24 h | T-13.04 | `ar21_idempotencia` | AR-21 |
| AR-22 | Servidor impostor engana o celular | Alta | o celular fixa a identidade (MAC do pareamento) e verifica a assinatura da sessão | T-13.13 | `ar22_identidade_fixada` | AR-22 |
| AR-23 | Saída de terminal com HTML/script executa na tela | Média | `nao_confiavel: true`; JSX/`textContent`; sem HTML do servidor | T-13.17 | `ar23_saida_nao_confiavel_marcada` | — (jsdom: `Tela.test.tsx`) |
| AR-24 | Pânico/kill-switch não fecha tudo | Alta | pânico: revoga todos, desliga, cancela pendências | T-13.16 | `ar24_panico_fecha_tudo` | AR-24 |
| AR-25 | Escrita remota com a tela bloqueada | Média | suspensa (proposta e execução) | T-13.16 | `ar25_tela_bloqueada` | AR-25 |
| AR-26 | Chave de identidade vaza (arquivo, estado, auditoria) | Alta | só no cofre pela porta de segredos; nunca ao renderer | T-13.12 | `ar26_identidade_so_no_cofre` | — |
| AR-27 | Bind em `0.0.0.0`/`::`/IP público | Alta | `ipDeBindPermitido`; `tests/scripts/servidor-remoto-fronteira.test.ts` | T-13.15 | `ar27_bind_nunca_curinga` | AR-27 |
| AR-28 | Segredo de dispositivo roubado do servidor/banco | Média | o servidor só guarda chave pública | T-13.14 | `ar28_sem_segredo_de_dispositivo_no_servidor` | — |

## 6. Portões (decisões D-320..D-325 em `01-DECISOES.md`)

- **G1 Jarvis** — aprovado **por texto**, lista fechada, LLM opt-in só para intenção (D-320).
- **G2 Controle remoto local** — aprovado: todas as ameaças Altas têm mitigação testável e mutante morto; residuais **R1**, **R2** e **R3** abaixo seguem para o dono (D-321, D-324).
- **G3 Relay/app móvel/VPS** — **não implementado** (D-05/D-73 mantidos). Requisitos mínimos, se o dono liberar: os de `fase-13-jarvis-controle-remoto.md` (relay cego, pareamento fora do relay, app nativo).

## 7. Riscos residuais (texto exato, para o dono)

- **R1** — Um atacante **ativo** na mesma rede que sirva uma página adulterada a um navegador de celular pode enganar quem usa um **cliente web**. Esta onda **não entrega cliente web** (só o cliente de referência em Node
  nos testes); com um app nativo o risco some, com navegador não. Mitigações: rede confiável, aviso na tela, `leitura` por padrão, SAS, identidade do servidor fixada pelo dispositivo.
- **R2** — A composição criptográfica é própria (ECDH + PSK + HKDF + assinaturas + AES-GCM), feita só com primitivas padrão de `node:crypto` e vetores de teste, **sem auditoria externa**. Revisão externa recomendada
  antes de uso fora de rede doméstica.
- **R3** — O pareamento não é um PAKE: um atacante **ativo** que consiga conversar com o servidor enquanto a janela está aberta pode testar palpites do código **offline** contra `conf_s` (60 bits ≈ 10^18 palpites; a janela dura 120 s e
  fecha ao primeiro uso). Aceito; o SAS no desktop é a segunda barreira.
- **R4** — Quem controla um dispositivo `mensagem_direta` desbloqueado age até a revogação (≤ 1 s depois do clique). Mitigação: tela bloqueada suspende a escrita; `aprovar_gate` continua pedindo o desktop.
- **R5** — Dois programas na mesma máquina em modo `loopback` podem tentar conectar: só autenticam com chave de dispositivo pareada. O túnel que o usuário abre por conta própria (SSH, Tailscale) está **fora do nosso controle**.
