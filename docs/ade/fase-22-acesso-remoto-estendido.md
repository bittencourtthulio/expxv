# Fase 22 — Acesso remoto estendido: relay cego (E2E), PWA móvel e VPS opcional em Docker

Pedido do dono (via `DECISOES-DAS-PENDENCIAS.md`, P-42 e a fila do `PILOTO-AUTOMATICO.md`): *"Relay, app móvel e VPS 24 h: liberar — com **estudo de ameaças primeiro**"*. Esta fase **reabre** o que a
Fase 13 cortou (D-05/D-73, portão G3) e **resolve o residual R1** do controle remoto local (cliente web sem prova de integridade da página), construindo o recurso **inteiro, desligado por padrão,
com custo zero se o dono não ligar nada**.

## Objetivo e valor

1. **Controlar o ADE de fora de casa**, sem abrir porta no roteador e sem VPN própria: o celular (PWA instalável) fala com o desktop **por um relay** que só repassa bytes cifrados. O relay **nunca vê texto
   claro**: nem comandos, nem painéis, nem Missões, nem títulos.
2. **Resolver R1** com um *modelo de distribuição e integridade do app web*: o PWA é entregue com manifesto assinado, **Service Worker que fixa (pin) o shell por hash e só aceita atualização assinada** pela chave
   do dono, CSP estrita e SRI; a **impressão digital** do cliente aparece no desktop para comparação na primeira instalação.
3. **VPS opcional**: `Dockerfile`, `compose` e `Caddyfile` **versionados e endurecidos**, para quem quiser hospedar o próprio relay (e o PWA) 24 h; **nunca implantados** por esta fase (D-23).
4. **Uma identidade só**: pareamento, dispositivos, permissões, confirmação no desktop, revogação, rate limit e auditoria **reaproveitam a Fase 13** (mesma tabela de dispositivos, mesma matriz ator × permissão, mesmo SAS);
   o relay é só **mais um transporte** (ao lado de LAN e loopback).
5. **Custo zero por padrão**: sem relay configurado, sem domínio, sem servidor, sem conta; nenhum endereço de relay vem embutido (`relay.invalid`); com relay próprio, o custo é do dono e está estimado no guia.

## Portão da fase

1. **T-22.01 (estudo de ameaças) concluída e aprovada ANTES de qualquer outra task** — inclusive tipos, migrations e esqueleto de relay. O estudo decide o que existe. Reprovado = fase parada e registrada em `STATUS.md` →
   Bloqueios (a fila segue com a Fase 23).
2. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos incluindo P-160 e P-164) e `npx vitest run tests/scripts` verde (fronteira do relay, Docker estático, PWA assinado, Fase 13 intacta).
3. **E2E no Electron real contra o relay REAL em loopback** (`src/relay` rodando como processo Node de teste) **e o PWA em Chromium** (Playwright), sem rede externa, sem Docker obrigatório, sem VPS, sem celular: pareamento
   com SAS pelo relay, comando `leitura`/`mensagem_confirmada` ponta a ponta, confirmação **no desktop**, revogação derrubando o canal, pânico, relay hostil (adultera, repete, reordena, descarta, atrasa, duplica,
   fecha) e **relay que serve PWA adulterado** (o Service Worker recusa).
4. `npm run perf`: **P-160..P-169 verdes**; P-01/P-08/P-12 sem piorar; `docs/ade/perf/ultimo.json` gravado.
5. **Suíte adversarial (T-22.26) verde**: cada caso AX-01..AX-34 tem teste nomeado que **falha se a mitigação for removida** (mutação) e `tests/scripts/ameacas-fase22.test.ts` confirma que toda ameaça Alta aponta para uma task e um teste existentes.
6. **Prova de cegueira do relay (T-22.07)**: com sentinelas plantadas em todo texto que o desktop e o PWA trocam (comando, nome de Missão, saída de painel, título), **nenhum byte** visto/registrado pelo relay (memória, log, métricas,
   captura de tráfego) contém a sentinela, em nenhuma codificação (UTF-8, base64, hex, JSON-escapada).
7. Com o relay **desligado** (padrão): **0 sockets** além do MCP em loopback e do que a Fase 13 já abre quando ligada, **0 timers**, módulos de relay **nem importados** (import dinâmico).
8. **Habilitar por padrão é proibido nesta fase** (D-351): só depois de **revisão externa da criptografia** (T-22.27 entrega o pacote de revisão; a contratação é do dono, P-341). Registro no `STATUS.md` do que só a pessoa valida (VPS real,
   domínio/TLS real, celular real, iOS/Android reais, instalação do PWA, revisão externa).

## Princípios

1. **Leveza e velocidade (prioridade nº 1).** Relay desligado custa **0**; ligado, uma conexão de saída com *ping* de 25–30 s; o PWA ≤ 60 KB gz; o desktop não ganha timer novo fora da janela de conexão (P-160, P-167).
2. **Segurança é requisito de primeira classe e esta é a maior superfície do produto.** Estudo primeiro; desligado por padrão; experimental com reconhecimento obrigatório; E2E; chave por dispositivo; revogação ≤ 1 s; pânico; lista fechada de
   ações (a da Fase 13); **nada humano jamais** (D-21: merge, assinar prodx, aprovar raio ALTO, `mergex-revisar`); confirmação **sempre no desktop** (D-323).
3. **O relay é cego e burro.** Roteia quadros opacos por `canal_id`, **sem contas, sem estado persistente, sem logs de conteúdo**; autentica o *host* só por **prova de posse de chave** (assinatura) para impedir *squatting*, nunca por senha; o que
   ele vê (IP, tempo, tamanho, `canal_id` rotativo) está **declarado como metadado residual** e reduzido (padding, rotação).
4. **E2E de verdade.** O protocolo da Fase 13 (ECDH P-256 + PSK → HKDF-SHA256, `conf_s/conf_c` HMAC, SAS de 6 dígitos, assinaturas ECDSA, AES-256-GCM com contador e AAD do `sid`) vai **por dentro** do relay, **inalterado**; nenhum segredo de sessão
   passa pelo relay. **Nenhuma primitiva nova**: só `node:crypto` (host) e **WebCrypto** (PWA), com vetores de teste cruzados nos dois.
5. **Integridade do cliente é parte do modelo de segurança.** Um relay cego **não pode** ser a origem do JavaScript do PWA sem prova de integridade independente — senão ele leria tudo (R1 de volta). Logo: shell fixado por hash, atualização só assinada,
   chave pinada, comparação visual da impressão digital. O que **não** dá para eliminar por software (primeira instalação adulterada) é **declarado** (residual R-A) e leva ao app nativo (fora desta fase, P-342).
6. **Custo zero por padrão; nada implantado.** Docker e compose são arquivos; nenhuma task executa `docker push`, `compose up` contra algo remoto, `ssh`, `scp` ou chamada à API de provedor. Teste com Docker só **local e efêmero**, e **pula** sem Docker.
7. **Reuso, não duplicação.** Dispositivos, permissões, SAS, confirmação, auditoria, política de rede, pânico: **os da Fase 13**. Onde o transporte exigir mudança (extrair o tratador de protocolo do servidor LAN), os testes da Fase 13 continuam verdes **sem edição**.
8. **Nada de rede nova no núcleo (D-114).** `fetch`/`WebSocket`/`http(s)` só em `src/nucleo/rede/` (cliente de saída do host) e, **como D-322**, o relay é o **único** módulo novo que escuta (`src/relay/servidor.ts`), fora do pacote do app.
9. **Mensagem recebida é dado não confiável** (F2 da Fase 13): o texto do celular passa pela mesma redação → limite → interpretador determinístico → política → confirmação.
10. **Segredo só no cofre do SO** (`safeStorage`, Fase 9): chave de identidade do host, segredo de canal por dispositivo, chave privada do manifesto do PWA (fora do app, do CI/arquivo do dono). Nunca em log, argv, evento, banco claro, DOM ou captura de tela.
11. **Fonte honesta.** Latência, custo e "online/offline" são medidos ou aparecem como "sem medida"; relay indisponível ≠ dispositivo revogado.
12. **O ADE não escreve em `docs/**` (D-04).** Estado vive em tabelas do próprio ADE e em `preferencias.json` (D-29); nada é gravado no repositório do usuário.

## Estado atual (Fase 13 entregue; lido em 2026-10-01 — ponto de partida, não resultado)

| Item | Hoje |
|---|---|
| Servidor local | `src/nucleo/remoto/servidor.ts` (único que escuta; D-322): LAN com HTTPS autoassinado, loopback, Hosts extras, CGNAT opt-in; POST JSON ≤ 16 KiB, 404 uniforme, taxa por IP/dispositivo, 4 conexões; **desligado a cada reinício** |
| Protocolo | `protocolo.ts`: pareamento (código de 60 bits, 120 s, uso único, 5 erros fecham), ECDH P-256 efêmero + PSK → HKDF, `conf_s/conf_c` HMAC, **SAS** de 6 dígitos no desktop, sessão com assinaturas ECDSA mútuas e quadros AES-256-GCM com contador monotônico |
| Dispositivos | `dispositivos.ts` + tabela `remoto_dispositivo` (**só chave pública**), permissão `leitura` (padrão) / `mensagem_confirmada` / `mensagem_direta`, validade deslizante, revogação ≤ 1 s, conferência a cada requisição |
| Política | `politica-rede.ts`; confirmação **só** `ui`/`desktop`; `args_hash`; plano vivo reavaliado; lista fechada de nove ações |
| Residuais aceitos | **R1** cliente web e atacante ativo na rede (sem cliente web entregue); **R2** composição criptográfica própria **sem auditoria externa**; R3 pareamento não é PAKE; R4 dispositivo `mensagem_direta` desbloqueado; R5 túnel/loopback |
| Cliente | só o cliente de referência em Node (`tests/fixtures/jarvis/cliente-remoto.ts`); **T-13.17 (cliente web) não feita**; relay/VPS/app móvel **não implementados** (D-73) |
| Pendências da Fase 13 | indicador `● remoto · N` no rodapé; foco exato do painel em `abrir_pane` |

## Decisões que esta fase toma e o que ela ajusta (resumo; texto completo em `01-DECISOES.md`, D-350..D-359)

- **Ajusta D-05/D-73 e o portão G3 da Fase 13:** relay, PWA e VPS passam a existir **desligados**, **experimentais**, atrás do estudo T-22.01 (D-350). **Mantém** D-21, D-323 (confirmação no desktop) e a lista fechada de ações.
- **D-351:** nada é habilitado por padrão antes da **revisão externa** da criptografia (R2 da Fase 13).
- **D-352:** o PWA só roda com **Service Worker com shell fixado e atualização assinada**; o relay **nunca** é origem sem essa prova.
- **D-353:** `ws` (servidor WebSocket) entra **só** para o relay, como dependência de **desenvolvimento/relay**, fora do pacote do app (medido); o host usa o `WebSocket` global do Node 22 do Electron 37.
- **Respeita D-23/D-25/D-140:** nada implantado/publicado; sem telemetria; opção mais completa **construída** e desligada.
- **Numeração:** D-350..D-359, P-160..P-169 (orçamentos), P-340..P-349 (pendências), sem colisão (conferido por `grep`).

## Pesquisa (fontes públicas; leitura somente; sem enviar nada) — insumo da T-22.01

| Fato | Fonte | Status |
|---|---|---|
| WebCrypto cobre `ECDH` P-256, `ECDSA`, `HKDF`, `HMAC`, `AES-GCM` e chaves **não extraíveis** (`extractable:false`) guardáveis em IndexedDB | https://www.w3.org/TR/WebCryptoAPI/ | confirmado ⇒ a composição da Fase 13 é portável ao navegador **sem biblioteca** |
| Service Worker: um *update check* ocorre na navegação e a cada 24 h; o script do SW é **sempre** buscado da rede (ignora cache HTTP > 24 h) — o servidor que serve o SW pode trocá-lo | https://www.w3.org/TR/service-workers/ | confirmado ⇒ o SW **não** é âncora de confiança contra uma origem maliciosa **depois** do 1º install; ele só **verifica o shell** com a **chave pública embutida no seu próprio script**; um SW trocado por um adulterado vence. **Mitigação:** a chave pinada fica no **desktop** (impressão digital) e a PWA mostra o *hash do SW instalado* (`fetch` do próprio script) para comparação; **residual declarado** |
| SRI (`integrity=`) vale para `<script>`/`<link>`; **não** protege o documento HTML raiz | https://www.w3.org/TR/SRI/ | confirmado ⇒ o HTML raiz é mínimo, sem lógica, e carrega **um** script com SRI + SW |
| CSP (`default-src 'none'`, `script-src 'self'`, `connect-src wss://<relay>`, `frame-ancestors 'none'`, Trusted Types) | https://www.w3.org/TR/CSP3/ | confirmado |
| `ws` (npm) é o servidor WebSocket de referência para Node, sem módulos nativos obrigatórios, licença MIT | https://github.com/websockets/ws | confirmado; **custo a medir** (tamanho, memória por conexão) em T-22.08 |
| Node 22 expõe `WebSocket` global (cliente, undici) sem flag | https://nodejs.org/docs/latest-v22.x/api/globals.html#websocket | confirmado; **comportamento em Electron 37: medir** (T-22.05) |
| Web Push exige serviço de push do fornecedor do navegador (Apple/Google/Mozilla) e chave VAPID: **sai metadado para terceiro** | RFC 8030/8292 | confirmado ⇒ **fora do padrão**; extensão P2 desligada (T-22.33) |
| iOS só instala PWA pelo menu "Adicionar à Tela de Início" e restringe notificações/armazenamento do SW | documentação pública da Apple | **não confirmado nesta pesquisa em detalhe** ⇒ checklist manual do dono (P-342) |
| Rotacionar identificadores por época impede correlação de longo prazo pelo relay, mas não esconde IP | conhecimento geral | decisão de projeto (D-355) |

## T-22.01 · Estudo de ameaças — OBRIGATÓRIO E PRIMEIRO (BLOQUEANTE)

**Entrega:** `docs/ade/seguranca/AMEACAS-FASE-22.md` + `tests/scripts/ameacas-fase22.test.ts`, escritos **antes** de qualquer código, a partir da pré-análise abaixo. **Reusa e estende** `AMEACAS-REMOTO.md` (Fase 13) e `AMEACAS-TELEGRAM.md`
(Fase 20): o formato STRIDE, os ativos, os atores e a numeração (aqui `AX-NN`; `AR-NN` e `AB-NN` ficam com as fases dona).

**Herdado da Fase 13/20 (não duplicado):** AR-01..06 (texto como dado, confirmação, `args_hash`), AR-07/08 (pareamento: força bruta, MITM), AR-11 (replay de quadros), AR-14/15/17 (permissão, revogação), AR-16 (flood), AR-19/20 (auditoria, resumo),
AR-24 (pânico), AR-26 (identidade no cofre). **Novo nesta fase:** terceiro de confiança que **roteia** (relay), origem do código do cliente (PWA/SW), metadados, DoS **contra o relay** e **pelo relay**, hospedagem (VPS/Docker), custo como superfície,
persistência (um relay comprometido guarda para sempre?), disponibilidade (relay fora do ar), correlação entre canais.

### Critérios de saída (binários; falhou um, a fase para)

1. Diagrama das **fronteiras de confiança**: **F1** pessoa↔desktop, **F2** texto do celular↔interpretador (dado não confiável), **F3** desktop↔relay (TLS + E2E por dentro), **F4** relay↔celular, **F5** celular↔**origem do PWA** (código), **F6** operador do relay/VPS
   (outro ator, possivelmente o próprio dono, possivelmente terceiro), **F7** desktop↔cofre, **F8** build do PWA↔assinatura do manifesto, **F9** imagem Docker↔host da VPS.
2. **Inventário de ativos**: chave de identidade do host; segredo e `canal_id` por dispositivo; chave de dispositivo (no celular, WebCrypto não extraível); chave privada do manifesto do PWA; conteúdo das mensagens; metadados (IP, horários, tamanhos); capacidade de executar;
   o shell do PWA; a imagem do relay; custo financeiro.
3. **Atores**: dono presente; dono ausente com celular; celular roubado; **operador do relay curioso**; **operador do relay malicioso (ativo)**; outro cliente do relay; atacante na rede do celular; atacante na rede do desktop; quem comprometeu a VPS; quem comprometeu o repositório/CI do PWA;
   quem roubou a chave do manifesto; desconhecido que descobriu o `canal_id`; bot/scanner na Internet.
4. Tabela **STRIDE** por componente (cliente do host, roteador do relay, servidor do relay, prova de posse, derivação e rotação de canal, padding, pareamento via relay, QR/fragmento, PWA shell, Service Worker, cripto no navegador, armazenamento de chave no navegador,
   revogação em dois níveis, pânico, Docker/compose/Caddy, custo/limites, auditoria).
5. **≥ 30 casos de abuso** `AX-NN` (os 34 abaixo entram no mínimo): severidade, mitigação, **task `T-22.NN` existente neste arquivo** e **nome do teste** que prova. `ameacas-fase22.test.ts` lê o documento e **falha** se houver ameaça Alta sem task/teste válidos.
6. **Riscos residuais** em texto exato, enviados ao dono (P-340): **R-A** primeira instalação do PWA a partir de origem adulterada (só app nativo elimina); **R-B** o relay vê metadados (IP, horário, tamanho aproximado, `canal_id` do dia); **R-C** relay malicioso pode **negar serviço**
   (descartar, atrasar) — nunca ler nem forjar; **R-D** composição criptográfica própria sem auditoria externa (R2 da Fase 13): **pré-requisito de habilitar por padrão**; **R-E** celular roubado e desbloqueado age até a revogação; **R-F** SW trocado pela origem depois do 1º install exige comparação humana do hash.
7. **Portões** registrados: **G1** relay (transporte) = aprovado **se** E2E, cegueira provada, prova de posse, revogação ≤ 1 s e pânico tiverem teste; **G2** PWA = aprovado **se** shell fixado, manifesto assinado, SW recusa adulterado, CSP/SRI testados, e R-A/R-F constarem em P-340;
   **G3** VPS/Docker = aprovado **só como arquivos endurecidos e testados estaticamente (nunca implantados)**; **G4** habilitar por padrão = **não aprovado** até revisão externa (D-351); **G5** Web Push, voz e app nativo = **não aprovados** (extensões P2 com estudo próprio).
8. Confirma ou corrige D-350..D-359 (pré-registradas).
9. Sem o estudo aprovado, **T-22.02 em diante não iniciam**.

### Pré-análise (insumo): casos de abuso mínimos

| AX | Caso de abuso | Sev. | Mitigação (resumo) | Task | Teste (nome) |
|---|---|---|---|---|---|
| AX-01 | **Relay lê o conteúdo** (operador curioso/malicioso) | Alta | E2E AES-256-GCM por dentro; nenhum segredo de sessão no relay; relay sem chaves de conteúdo; prova de cegueira com sentinelas | T-22.06, T-22.07 | `ax01_relay_nunca_ve_texto_claro` |
| AX-02 | **Relay forja/adultera/injeta quadro** | Alta | autenticação GCM + contador + AAD do `sid` (Fase 13); `conf_s/conf_c`; sessão fecha ao primeiro quadro inválido | T-22.10 | `ax02_relay_nao_forja_quadro` |
| AX-03 | **Relay repete/reordena/descarta/atrasa** | Média | contador monotônico; descarte vira timeout e reconexão; nada executa duas vezes (`client_request_id`, AR-21) | T-22.10 | `ax03_relay_replay_reordem` |
| AX-04 | **MITM ativo no pareamento via relay** (relay troca as chaves públicas) | Alta | PSK de 60 bits **fora do relay** (tela do desktop / fragmento do QR) entra no HKDF; **SAS** no desktop; impressão digital da identidade do host **no QR** pinada pelo celular | T-22.11 | `ax04_mitm_relay_no_pareamento` |
| AX-05 | **Squatting do `canal_id`** (alguém registra o canal antes do host / ocupa o slot do cliente) | Alta | registro exige **assinatura Ed25519/ECDSA do host** sobre desafio do relay; slot do cliente exige **prova de posse** da chave do dispositivo; `canal_id` de 128 bits aleatórios, rotação por época | T-22.06, T-22.09 | `ax05_squatting_de_canal` |
| AX-06 | **Descoberta/enumeração de canais** (varredura) | Média | 128 bits; resposta uniforme para canal inexistente/ocupado/sem permissão; atraso uniforme; limite por IP | T-22.07 | `ax06_enumeracao_uniforme` |
| AX-07 | **Correlação de longo prazo** (mesmo canal por semanas) | Média | `canal_id = HKDF(segredo_de_canal, época)`; época diária; sem identificador estável no relay | T-22.09 | `ax07_canal_rotativo` |
| AX-08 | **Vazamento por tamanho/tempo** (adivinhar comando pelo tamanho do quadro) | Média | padding para blocos de 256 B/1 KiB/4 KiB; *keep-alive* uniforme; sem eco de tamanho no log | T-22.09 | `ax08_padding_de_quadros` |
| AX-09 | **PWA servido adulterado** (relay/VPS/host estático entrega JS malicioso) | Alta | manifesto assinado; SW verifica hash de cada arquivo do shell com a chave pinada; falha ⇒ **não executa**; CSP/SRI | T-22.13, T-22.16 | `ax09_shell_adulterado_nao_executa` |
| AX-10 | **Atualização maliciosa do PWA** (SW novo/shell novo assinado por outra chave) | Alta | chave aceita só a **pinada** (atual + próxima); versão monotônica; revogação por versão mínima; rollback proibido | T-22.16 | `ax10_atualizacao_so_assinada` |
| AX-11 | **Primeira instalação a partir de origem adulterada** | Alta | **residual R-A**; mitigação: impressão digital do cliente exibida no desktop e comparada; instalação alternativa **servida pelo desktop** (LAN, hash embutido no app) | T-22.17 | `ax11_impressao_digital_comparavel` |
| AX-12 | **XSS no PWA** (texto de painel/Missão renderizado como HTML) | Alta | `textContent` somente; **Trusted Types**; CSP sem `unsafe-inline`; saída marcada `nao_confiavel` (AR-23) | T-22.15 | `ax12_saida_so_texto` |
| AX-13 | **Chave do dispositivo exfiltrada do navegador** | Alta | `CryptoKey` **não extraível** em IndexedDB; nada em `localStorage`; autolock; sem *export*; revogação | T-22.14, T-22.15 | `ax13_chave_nao_extraivel` |
| AX-14 | **Celular roubado desbloqueado** | Alta | permissão `leitura` por padrão; confirmação **no desktop**; autolock 5 min com **PIN local do PWA** (opcional→recomendado→obrigatório); revogação ≤ 1 s (R-E) | T-22.12, T-22.15 | `ax14_celular_roubado_limitado` |
| AX-15 | **Revogação não chega** (relay descarta o aviso; celular offline) | Alta | **dois níveis**: (1) desktop para de aceitar o dispositivo (E2E, autoritativo); (2) desregistra o canal no relay (otimização). Conferência a cada quadro | T-22.12 | `ax15_revogacao_autoritativa_no_host` |
| AX-16 | **Pânico não fecha tudo** | Alta | pânico: fecha WS do relay, revoga todos, cancela pendências, 0 sockets ≤ 1 s | T-22.12 | `ax16_panico_zero_sockets` |
| AX-17 | **Relay liga sozinho / sem consentimento** | Alta | nasce desligado; consentimento versionado; experimental com reconhecimento; **não religa após reinício** (como Fase 13); sem URL padrão | T-22.21 | `ax17_relay_nao_liga_sozinho` |
| AX-18 | **DoS contra o relay** (flood de conexões/quadros, Slowloris, mensagens gigantes) | Alta | limites por IP/canal/global; quadro ≤ 64 KiB (pré-auth ≤ 1 KiB); *handshake* ≤ 5 s; pings; backpressure; memória por canal limitada | T-22.07, T-22.08 | `ax18_flood_relay` |
| AX-19 | **DoS pelo relay** ao desktop (reconexão em tempestade, amplificação) | Média | *backoff* exponencial com jitter 1→60 s; teto de tentativas por minuto; nenhuma resposta maior que a requisição | T-22.10 | `ax19_backoff_reconexao` |
| AX-20 | **Custo descontrolado** (VPS/tráfego/conexões) | Média | custo zero por padrão; teto de conexões/banda por canal; imagem com limites de memória/CPU; guia de custo; sem *autoscale* | T-22.18, T-22.20 | `ax20_limites_de_recurso` |
| AX-21 | **Imagem Docker insegura** (root, capabilities, segredo na imagem, base sem fixar) | Alta | usuário não-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, sem `privileged`/`network_mode: host`/socket do Docker, imagem base **fixada por digest**, sem segredo em camada | T-22.18, T-22.19 | `ax21_dockerfile_endurecido` |
| AX-22 | **TLS ausente/fraco no relay** | Alta | Caddy com ACME automático; relay só escuta interno; cliente do host **só `wss://`** (e `ws://` só em loopback de teste com `NODE_ENV=test`); sem `rejectUnauthorized:false`; sem CA customizada silenciosa | T-22.05, T-22.18 | `ax22_so_wss_fora_do_teste` |
| AX-23 | **Logs do relay vazam metadado/conteúdo** | Média | log sem payload; IP **truncado/hash com sal diário**; retenção em memória; nenhum arquivo de conteúdo; métricas agregadas | T-22.08 | `ax23_log_sem_conteudo_nem_ip_cru` |
| AX-24 | **Segredo no repositório** (chave do manifesto, `.env` do deploy, domínio) | Alta | só nomes de variável; `.env.example` sem valor; varredura de sentinelas; chave privada fora do repo | T-22.16, T-22.19 | `ax24_sem_segredo_versionado` |
| AX-25 | **Relay compartilhado com terceiros** (multi-tenant): um cliente atrapalha outro | Média | isolamento por canal; cotas; sem estado compartilhado exposto; sem listagem de canais | T-22.07 | `ax25_isolamento_de_canais` |
| AX-26 | **QR/fragmento interceptado** (foto da tela) | Média | PSK de uso único, TTL ≤ 120 s; SAS no desktop; o desktop mostra quem se pareou e exige "Permitir" (como AR-07/08) | T-22.11 | `ax26_qr_uso_unico_ttl` |
| AX-27 | **Pareamento reutilizado/expirado** | Alta | herdado de AR-07: uso único, 5 erros fecham, janela única; relay descarta o canal de pareamento no primeiro uso | T-22.11 | `ax27_pareamento_via_relay_uso_unico` |
| AX-28 | **Conta/dispositivo "novo" com permissão maior** | Alta | permissão sobe **só pelo desktop** (AR-15); dispositivo novo nasce `leitura` | T-22.11 | `ax28_dispositivo_nasce_leitura` |
| AX-29 | **Texto hostil do celular vira comando/aprovação** | Alta | herdado de AR-01/02/03/04: pré-filtro, lista fechada, confirmação por id no desktop | T-22.10 | `ax29_texto_do_celular_e_dado` |
| AX-30 | **Falha do relay derruba o app do desktop** | Média | erro isolado; `on("error")` permanente; nunca bloqueia o main; relay fora do ar = "indisponível", **não** revogação | T-22.10, T-22.21 | `ax30_relay_fora_nao_derruba_app` |
| AX-31 | **Cliente web de outra origem** conecta ao relay fingindo ser o PWA | Média | autenticação é por **chave do dispositivo**, não por origem; `Origin` apenas informativo; sem CORS permissivo | T-22.07 | `ax31_origem_nao_autentica` |
| AX-32 | **Relay vira proxy aberto/HTTP aberto** (SSRF, `CONNECT`, rotas extras) | Alta | só `/healthz` interno e `/v1/canal/*` WS; 404 uniforme; nenhum *fetch* de saída no relay; teste de fronteira | T-22.08 | `ax32_relay_nao_e_proxy` |
| AX-33 | **Dependência do relay comprometida** (`ws`) | Média | versão exata; lockfile; SBOM; relay sem outras dependências de execução; imagem mínima | T-22.08, T-22.18 | `ax33_dependencias_do_relay_minimas` |
| AX-34 | **Habilitado por padrão sem revisão externa** | Alta | `experimental:true` fixo no código; teste falha se `habilitado` padrão ≠ `false`; UI com reconhecimento | T-22.21, T-22.27 | `ax34_nao_habilita_por_padrao` |

**Riscos residuais (texto exato para P-340):** ver critério 6 (R-A..R-F). **Sem app nativo, R-A e R-F não se eliminam; sem revisão externa, R-D não se elimina; o metadado (R-B) é inerente a qualquer relay.**

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; numeração P-160..P-169)

Método comum: Playwright sobre o Electron real + **relay real em loopback** + PWA em Chromium (emulação de celular, CPU 4× e rede 4G rápida quando indicado); relógio injetado nos testes de unidade; contagem de handles; `process.getProcessMemoryInfo`; `ps`.
Referência: Mac Apple Silicon, `EXPXV_PERF_FATOR`. Estourou, a task **não fecha**.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-160 | Relay **desligado** não existe | 0 sockets, 0 timers, módulos `remoto/relay` e `rede/ws` **não importados**, P-01 não piora, **+≤ 2 KB gz** no JS inicial, chunk lazy da aba Relay ≤ 20 KB gz | handles + script de tamanho (P-08 estendido) |
| P-161 | Latência fim a fim via relay (comando do PWA → desktop → resposta) | acréscimo do relay p95 ≤ 40 ms sobre o loopback direto; ida e volta de status p95 ≤ 250 ms; **aprovação** (celular pede → desktop confirma → celular vê) ≤ 400 ms sem contar a pessoa | marcas nos 3 pontos, 200 amostras |
| P-162 | Memória/conexão do **relay** | ≤ 20 KB de heap por conexão ociosa; 1 000 canais conectados ≤ 64 MB de RSS; CPU ociosa < 1 %; **0** alocação por quadro além do buffer | `process.memoryUsage` + carga sintética |
| P-163 | Vazão e *event loop* do relay | ≥ 5 000 quadros/s em 1 núcleo, **nenhuma tarefa > 50 ms**, *handshake* (`hello` + prova de posse) p95 ≤ 5 ms, rejeição de flood ≤ 1 ms | carga sintética + monitor de event loop |
| P-164 | PWA: peso e carga | JS ≤ 60 KB gz (sem framework), HTML ≤ 4 KB, CSS ≤ 12 KB gz; interativo ≤ 1,5 s (CPU 4× + 4G) frio e ≤ 400 ms com SW; instalável (manifesto + SW + ícones) | `scripts/tamanho-pwa.mjs` + Playwright com *throttling* |
| P-165 | Pareamento via relay | do toque/leitura do QR até o **SAS** exibido no desktop ≤ 3 s; SAS visível no desktop ≤ 500 ms depois do cliente; janela de 120 s respeitada (relógio injetado) | marcas + relógio |
| P-166 | Revogação e pânico | revogar ⇒ canal derrubado no desktop ≤ 1 s e relay purgado ≤ 1 s; **pânico ⇒ 0 sockets ≤ 1 s** e pendências canceladas; quadro gravado antes da revogação **não** autentica depois | contagem de handles + replay |
| P-167 | Reconexão e ocioso do host | *backoff* 1→60 s com jitter (±20 %); ≤ 2 requisições/min ocioso (*ping* 25–30 s); CPU média < 0,2 % em 60 s; **1** timer | relógio injetado + `cpuUsage` |
| P-168 | Imagem e *runtime* do relay (Docker) | imagem ≤ 150 MB; inicia ≤ 2 s; `HEALTHCHECK` verde; roda com `--memory=128m --cpus=0.5` sem OOM sob P-162/P-163; usuário não-root | `docker build/run` **local e efêmero** (pula sem Docker; na CI roda) |
| P-169 | Tráfego e custo | sobrecarga por mensagem ≤ 64 B + *bucket* de padding; ocioso ≤ 100 KB/h por dispositivo; **custo zero com relay desligado** (0 B); estimativa de VPS (CPU/RAM/banda) documentada | contadores do relay e do host |

## Arquitetura e pastas

```
src/compartilhado/relay.ts                          tipos de IPC/eventos (EstadoRelay, ConfigRelay, PareamentoRelay, DispositivoRelay…) — só o coordenador edita
src/nucleo/remoto/relay/                            LADO DO DESKTOP (sem Electron; transporte injetado; sem rede própria)
  canal.ts                                          derivação: canal_id = HKDF(segredo_de_canal, "id"‖época); prova de posse; rotação por época diária
  padding.ts                                        blocos 256 B / 1 KiB / 4 KiB; quadros de enchimento; (de)serialização
  quadro.ts                                         envelope relay: {tipo, canal, seq?, corpo opaco}; limites; parser estrito (fuzzável)
  transporte-relay.ts                               adaptador: entrega ao MESMO tratador de protocolo da Fase 13 (ver T-22.04) e devolve respostas
  cliente-relay.ts                                  máquina de conexão: registrar → manter → reconectar (backoff com jitter) → encerrar; 0 sockets quando desligado
  pareamento-relay.ts                               janela de pareamento via relay: canal efêmero, QR/fragmento, SAS reaproveitado
  revogacao.ts                                      revogação em dois níveis + pânico
  impressao-digital.ts                              impressão digital da identidade do host e do cliente web (SHA-256 em grupos legíveis)
  servico.ts · index.ts                             fachada `ServicoRelay` (liga/desliga/estado/dispositivos)
src/nucleo/rede/ws-cliente.ts                       cliente WebSocket de saída (WebSocket global do Node/Electron), wss obrigatório, host da config, sinal, tetos (coordenador)
src/relay/                                          RELAY (processo próprio; NÃO entra no pacote do app; tsconfig.relay.json)
  protocolo.ts                                      hello, desafio/prova de posse, tipos de quadro, limites (puro)
  roteador.ts                                       PURO: canais, slots host/cliente, repasse opaco, cotas, TTL, purga; sem I/O
  limites.ts                                        token buckets por IP/canal/global; backpressure
  servidor.ts                                       ÚNICO que escuta: http/upgrade → ws; /healthz; 404 uniforme; sem fetch de saída
  main.ts                                           lê configuração SÓ de variáveis de ambiente por NOME; encerra limpo
  log.ts                                            log sem payload; IP truncado + sal diário em memória
src/pwa/                                            CLIENTE WEB (build próprio; vanilla TS; sem framework)
  index.html · manifest.webmanifest · icones/       HTML mínimo (um script com SRI), manifesto instalável
  sw.ts                                             Service Worker: cache do shell, verificação de hash por arquivo, chave pinada, recusa de atualização não assinada
  cripto.ts                                         WebCrypto: ECDH P-256, HKDF, HMAC, AES-GCM, ECDSA; chave de dispositivo NÃO extraível; vetores cruzados com o host
  protocolo-cliente.ts                              pareamento + sessão + quadros (espelho do host)
  ui/{pareamento,status,paineis,missoes,mensagem,configuracao}.ts   telas (textContent apenas; Trusted Types)
  trava.ts                                          autolock + PIN local opcional
scripts/{build-pwa,assinar-pwa,verificar-pwa,tamanho-pwa}.mjs   build, manifesto assinado (Ed25519; chave por env/arquivo FORA do repo), verificação, tamanho
vite.pwa.config.ts · tsconfig.pwa.json · tsconfig.relay.json    builds separados; o app Electron não os importa
deploy/relay/                                       NUNCA implantado por esta fase
  Dockerfile · compose.yaml · Caddyfile · .env.example (só nomes) · LEIA-ME.md (guia: custo, TLS, backup, rotina, o que o relay vê)
  verificar.mjs                                     lint estático local (YAML/Dockerfile)
src/main/{relay}.ts · src/main/ipc/relay.ts         serviço no main (lazy, import dinâmico) e canais IPC (validadores estritos; payloads de pareamento `sensivel`)
src/renderer/telas/configuracoes/{AcessoRemotoRelay,RelayPareamento,RelayDispositivos,RelayGuia}.tsx · estado/relay.ts · casca/IndicadorRemoto.tsx
tests/fixtures/relay/{relay-hostil,cliente-pwa-falso,cenarios}.ts · tests/fixtures/pwa/{origem-adulterada}.ts
docs/ade/seguranca/AMEACAS-FASE-22.md · docs/ade/AUDITORIA-RELAY.md · docs/ade/REVISAO-EXTERNA-CRIPTO.md · tests/scripts/{ameacas-fase22,relay-fronteira,relay-docker,pwa-assinado,mutacao-fase22}.test.ts
```

Fluxo (comando do celular):

```
PWA (WebCrypto) ─ quadro AES-GCM [padding] ─► wss ─► RELAY (roteia por canal_id; cego) ─► wss ─► cliente-relay (desktop)
   └─► transporte-relay ─► MESMO tratador da Fase 13 (sessão, assinatura, contador, permissão por dispositivo) ─► interpretador/política ─► (confirmação NO DESKTOP) ─► serviço real
resposta: tratador ─► quadro AES-GCM [padding] ─► cliente-relay ─► RELAY ─► PWA
```

Pareamento via relay:

```
desktop: abrir janela (120 s) ─► gera PSK de 60 bits (só memória) + canal efêmero + registra no relay (assinatura do host sobre o desafio)
         ─► mostra QR = relay_url · canal_efêmero · impressão digital do host · impressão digital esperada do PWA · PSK no FRAGMENTO (#) | e/ou código digitável
celular: lê o QR (ou digita) ─► abre o PWA ─► conecta ao canal efêmero ─► handshake da Fase 13 (ECDH + PSK + HKDF + conf_s/conf_c)
         ─► confere a impressão digital do host (pin) ─► SAS de 6 dígitos nos DOIS lados ─► desktop: "Permitir" (nasce `leitura`) ─► troca de segredo_de_canal por dentro do E2E
         ─► canal efêmero destruído; dali em diante canal_id = HKDF(segredo_de_canal, época)
```

## Modelo de dados e migration

Uma migration `NNNN-remoto-relay.ts` (**próximo número livre** na execução; em transação; só o coordenador a cria — T-22.03). Estende a Fase 13 **sem alterar colunas existentes**:

```sql
ALTER TABLE remoto_dispositivo ADD COLUMN transporte TEXT NOT NULL DEFAULT 'lan' CHECK (transporte IN ('lan','relay'));   -- idem: aceita 'ambos' se T-22.03 decidir
CREATE TABLE relay_canal (
  dispositivo_id TEXT PRIMARY KEY REFERENCES remoto_dispositivo(id) ON DELETE CASCADE,
  epoca_ultima INTEGER NOT NULL,                 -- última época derivada (diária)
  registrado_em TEXT NOT NULL, revogado_em TEXT, ultimo_visto_em TEXT);
CREATE TABLE relay_evento (                       -- auditoria própria (30 dias), sem conteúdo
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('ligado','desligado','conectado','desconectado','pareamento_aberto','pareamento_concluido','pareamento_falhou','revogado','panico','quadro_invalido','relay_indisponivel')),
  dispositivo_id TEXT, motivo TEXT, criado_em TEXT NOT NULL);
CREATE INDEX ix_relay_evento_criado ON relay_evento (criado_em DESC);
```

O **segredo de canal** de cada dispositivo vai **só ao cofre** (`safeStorage`); a configuração (`relay_config`: `url`, `habilitado:false`, `experimental:true`, `consentimento_versao`, `reconhecimento_experimental`, `padding`, `pwa_origem`) vive em `preferencias.json` (D-29), **sem segredo**.
Nenhuma coluna aceita chave, PSK, `canal_id` em claro ou texto de mensagem (varredura do schema por `token|senha|psk|segredo|canal_id` em claro). Retenção: `relay_evento` 30 dias (job idle 1×/dia ≤ 50 ms).

## Contratos novos (o coordenador os mescla em `05-CONTRATOS.md` na T-22.31 e antecipa os tipos na T-22.02)

Canais IPC (lista fechada, validador estrito, autorização por remetente; pareamento e SAS são `sensivel`, **nunca** logados):

| Canal | Entrada | Saída |
|---|---|---|
| `relay:estado` | `{}` | `EstadoRelay` (`ligado`, `conectado`, `url`, `latencia_ms?`, `dispositivos`, `experimental`) |
| `relay:config_obter` · `relay:config_definir` | `{}` · `ConfigRelay` parcial (`url` só `wss://`, `habilitado`, `reconhecimento_experimental`, `consentimento_versao`, `padding`, `pwa_origem`) | `ConfigRelay` |
| `relay:ligar` · `relay:desligar` | `{}` | `{ok, motivo?}` (recusa sem consentimento/reconhecimento/URL válida) |
| `relay:parear_iniciar` | `{ permissao_inicial: "leitura" }` (a única permissão inicial) | `{ qr, codigo, expira_em, impressao_host, impressao_cliente_esperada }` **sensível** |
| `relay:parear_sas` · `relay:parear_decidir` | `{}` · `{ permitir: boolean }` | `{ sas }` **sensível** · `{ok}` |
| `relay:dispositivos` · `relay:revogar` | `{}` · `{ dispositivo_id }` | `DispositivoRelay[]` · `{ok}` |
| `relay:panico` | `{}` | `{ok}` (também na bandeja e no atalho do Fase 13) |
| evento `relay:evento` | — | `EstadoRelay` coalescido |

Eventos (inglês `snake_case`): `relay.connected`, `relay.disconnected`, `relay.pairing_opened`, `relay.device_paired`, `relay.device_revoked`, `relay.panic`, `relay.unavailable`. Alertas da Fase 20 (se ligada): `remoto_dispositivo_novo`, `remoto_dispositivo_revogado`, `relay_indisponivel` (fonte `remoto`, texto mínimo).
**Protocolo do relay** (`src/relay/protocolo.ts`, versão `expxv-relay.1`): `hello{papel, canal, ts, nonce}` → `desafio{nonce_relay}` → `prova{assinatura}` → `ok|erro{codigo}` (códigos nominais uniformes) → quadros binários opacos; `fechar{motivo}`; *ping/pong*. **Arquivos gravados no repositório do usuário: nenhum.**

## UI (compacta, D-32)

**Desktop — Configurações › Acesso remoto › Relay (experimental)**: estado (desligado/conectando/conectado/indisponível, forma **e** texto), URL do relay (`wss://`, sem padrão), **consentimento versionado** listando **exatamente** o que o relay vê (IP, horários, tamanho aproximado, `canal_id` do dia) e o que **não** vê (conteúdo), reconhecimento
"experimental e sem revisão externa", chave Ligar/Desligar, **pânico**, dispositivos (transporte, permissão, último visto, Revogar), **Parear celular** (QR + código + SAS + "Permitir"), impressões digitais (host e cliente web) para comparação, **guia de hospedagem** (custo, Docker, TLS) e indicador `● relay · N` no rodapé.
**PWA (celular)**: Parear · Status · Painéis (texto, `nao_confiavel`) · Missões · Enviar mensagem ao piloto (se permissão) · Configuração (impressão digital do cliente, travar, esquecer este dispositivo). Alvos de toque ≥ 44 px, tema claro/escuro, `prefers-reduced-motion`, leitor de tela.
Compacta, azul de destaque (D-31), estados por forma e texto, chunks lazy.

## Tarefas

Formato: `T-22.NN · título` — arquivos · entrega · **aceite binário** · testes · depende. TDD (teste antes, falhando pelo motivo certo), `npm run verificar` verde; UI herda P-01..P-14, P-160, P-164 e D-32.
**Nenhuma task depois da T-22.01 inicia sem o estudo aprovado.** Só o **coordenador** edita: `src/compartilhado/{ipc,relay}.ts`, `src/preload/preload.ts`, `src/nucleo/rede/**`, migrations, `package.json`, `05-CONTRATOS.md`, `04-UI-UX.md`, `STATUS.md`.

### 22A — Estudo de ameaças (GATE)

- **T-22.01 · Estudo de ameaças, portões G1–G5 e residuais** — `docs/ade/seguranca/AMEACAS-FASE-22.md`, `tests/scripts/ameacas-fase22.test.ts`. Entrega: os 9 critérios de saída acima (≥ 30 casos AX, STRIDE, residuais R-A..R-F enviados a P-340, G1–G5, confirmação de D-350..D-359).
  **Aceite:** o documento cita, para cada AX Alta, uma task `T-22.NN` **existente neste arquivo** e um nome de teste; o teste de consistência **falha** se uma Alta perder task/teste ou citar task inexistente; herdado da Fase 13/20 marcado (mesma estrutura, sem copiar). Depende: Fase 13 (`AMEACAS-REMOTO.md`, `AUDITORIA-REMOTO.md`), Fase 20 (`AMEACAS-TELEGRAM.md`).

### 22B — Fundação (contratos, dados, tratador independente de transporte, rede)

- **T-22.02 · Contratos e tipos** — `src/compartilhado/relay.ts`, `src/compartilhado/ipc.ts` (canais `relay:*`), `src/preload/preload.ts` (espelho inline, D-30), `src/main/ipc/relay.ts` (**só validadores**; `parear_iniciar`/`parear_sas` marcados `sensivel`), `src/relay/protocolo.ts` (tipos).
  **Aceite:** todo canal tem validador campo a campo; `url` só `wss://` sem credencial; campo extra/tamanho excedido recusado; `permissao_inicial` só `leitura`; payloads sensíveis nunca logados; teste de contrato do preload. Testes: `validadores.test.ts`, `preload.contrato.test.ts`. Depende: T-22.01.
- **T-22.03 · Migration `remoto-relay` e repositórios** — `src/nucleo/banco/migracoes/NNNN-remoto-relay.ts` (+ `index.ts`), `src/nucleo/remoto/relay/repo.ts`. Cria `relay_canal`, `relay_evento` e a coluna `transporte` **sem alterar** o que a Fase 13 usa; retenção 30 d.
  **Aceite:** migration idempotente e não altera dados de `remoto_dispositivo`; `CHECK`s rejeitam estados inválidos; consulta quente ≤ 5 ms (P-14); nenhuma coluna aceita segredo/PSK/`canal_id` em claro (varredura do schema); `ON DELETE CASCADE` ao esquecer o dispositivo. Testes: `migracao.test.ts`, `repo.test.ts`, `retencao.test.ts`. Depende: T-22.02.
- **T-22.04 · Extrair o tratador de protocolo independente de transporte (Fase 13)** — `src/nucleo/remoto/tratador.ts` (novo), edição **mínima** em `src/nucleo/remoto/servidor.ts`/`servico.ts` (o servidor LAN passa a chamar o tratador; o único que escuta continua sendo o servidor, D-322).
  `tratar(requisicao: {rota, corpo, origem: "lan"|"loopback"|"relay", dispositivo?}) → resposta` com a mesma semântica de hoje. **Aceite:** **todos os testes da Fase 13 passam sem edição** (`protocolo`, `servidor`, `dispositivos`, `servico`, `adversarial`, `servidor-remoto-fronteira`); `origem: "relay"` **não** afrouxa nenhuma checagem (taxa, permissão, conferência a cada requisição); o tratador não importa `node:http`/`node:net`. Testes: `tratador.test.ts` + suíte da Fase 13 inalterada. Depende: T-22.01.
- **T-22.05 · Cliente WebSocket de saída em `rede/`** — `src/nucleo/rede/ws-cliente.ts` (coordenador). `WebSocket` global (medir no Electron 37 antes de adotar; se faltar, fallback documentado), **só `wss://`** (e `ws://127.0.0.1` apenas com `NODE_ENV=test`), host vindo da configuração, `sinal` de cancelamento, tetos de quadro e fila, sem log de URL/caminho, erros com código nominal, redirecionamento recusado, sem proxy autoconfigurado silencioso.
  **Aceite:** URL com credencial/IP privado/`ws://` fora do teste recusada; cancelar fecha o socket ≤ 100 ms; nenhuma mensagem de erro contém URL; 0 sockets após `fechar()`; `fronteiras.test.ts` da rede continua verde (único lugar de `WebSocket`). Testes: `ws-cliente.test.ts` (servidor local de teste). Depende: T-22.02.

### 22C — Relay, canais, E2E e pareamento

- **T-22.06 · Protocolo do relay e prova de posse (puro)** — `src/relay/protocolo.ts`, `src/nucleo/remoto/relay/{canal,quadro}.ts`. `hello` → desafio → prova (assinatura ECDSA P-256 do host/dispositivo sobre `desafio‖canal‖papel`); parser **estrito** (limites 1 KiB pré-autenticação, 64 KiB depois); derivação `canal_id = HKDF(segredo_de_canal, "id"‖época)`; códigos de erro **uniformes**.
  **Aceite:** vetores conhecidos (HKDF/ECDSA) reproduzidos; prova com chave errada/sinal truncado/papel trocado recusada; época diferente ⇒ canal diferente; parser nunca lança (propriedades); sem import de `net`/`http`. Testes: `protocolo.test.ts`, `canal.test.ts`, `quadro.test.ts` (AX-05/07). Depende: T-22.02.
- **T-22.07 · Roteador cego (puro) e prova de cegueira** — `src/relay/{roteador,limites}.ts`. Estado só em memória: canais, slots host/cliente, repasse **opaco** (nunca interpreta o corpo), cotas por IP/canal/global, TTL, purga, backpressure, resposta uniforme para canal inexistente/ocupado/sem prova.
  **Aceite:** com sentinelas (UTF-8/base64/hex/JSON-escapada) em **todo** quadro trocado, nenhum byte guardado, logado, medido ou exposto por métricas contém a sentinela (AX-01); 1 000 canais ≤ 64 MB (P-162); isolamento entre canais (AX-25); enumeração devolve respostas indistinguíveis em conteúdo **e** tempo (variação < 2 ms); origem **não** autentica (AX-31). Testes: `roteador.test.ts`, `cegueira.test.ts`, `limites.test.ts`, `enumeracao.test.ts`. Depende: T-22.06.
- **T-22.08 · Servidor do relay (processo próprio)** — `src/relay/{servidor,main,log}.ts`, `tsconfig.relay.json`, `package.json` (`ws` **versão exata** em `devDependencies`/grupo do relay, custo medido e registrado em D-353), `electron-builder.yml` (`!dist/relay/**` e `!node_modules/ws/**`).
  Único módulo que escuta; só `/healthz` e `/v1/canal/*` (upgrade WS); 404 uniforme; **nenhum fetch de saída**; configuração **só** por variáveis de ambiente por nome; log sem payload e com IP truncado/hash com sal diário em memória; encerramento limpo (SIGTERM ≤ 2 s).
  **Aceite:** `tests/scripts/relay-fronteira.test.ts` prova que só `servidor.ts` escuta e que nada em `src/relay` faz requisição de saída; `app.asar` **não contém** `dist/relay` nem `ws`; flood/Slowloris/mensagem gigante não passam de P-163; `/healthz` só em interface interna; logs sem conteúdo (AX-18/23/32/33). Testes: `servidor.test.ts` (loopback), `relay-fronteira.test.ts`, `pacote-sem-relay.test.ts`. Depende: T-22.07.
- **T-22.09 · Rotação de canal e padding** — `src/nucleo/remoto/relay/{canal,padding}.ts`. Época diária (relógio injetado, tolerância de ±1 época na transição), *buckets* 256 B/1 KiB/4 KiB, quadros de enchimento, *keep-alive* uniforme.
  **Aceite:** o mesmo dispositivo usa `canal_id` diferente a cada época e o relay não consegue ligar os dois; dois comandos de tamanhos diferentes dentro do mesmo *bucket* são indistinguíveis por tamanho; sobrecarga ≤ P-169; transição de época não derruba a sessão aberta. Testes: `rotacao.test.ts`, `padding.test.ts` (AX-07/08). Depende: T-22.06.
- **T-22.10 · Cliente do host (conexão, E2E por dentro, backoff)** — `src/nucleo/remoto/relay/{cliente-relay,transporte-relay}.ts`. Registra o canal (prova de posse), mantém *ping* 25–30 s, entrega quadros ao **tratador** (T-22.04) como `origem:"relay"`, devolve respostas, reconecta com *backoff* exponencial com jitter 1→60 s (teto de tentativas/min), erro isolado, `fechar()` ≤ 1 s, **nunca** religa após reinício.
  **Aceite:** relay hostil (adultera, repete, reordena, descarta, atrasa, duplica, fecha) ⇒ nunca executa duas vezes, nunca aceita quadro inválido, sessão fecha ao primeiro quadro adulterado (AX-02/03); texto do celular só vira ação pelo caminho da Fase 13 (AX-29); relay fora do ar = "indisponível" (não revogação) e o app segue de pé (AX-30); P-161/P-167. Testes: `cliente-relay.test.ts` (relay hostil), `reconexao.test.ts`, `adversarial-relay.test.ts`. Depende: T-22.04, T-22.05, T-22.09.
- **T-22.11 · Pareamento via relay (QR/fragmento, impressões digitais, SAS)** — `src/nucleo/remoto/relay/{pareamento-relay,impressao-digital}.ts`. Canal efêmero (TTL ≤ 120 s, 1 slot de cliente, destruído no primeiro uso), PSK de 60 bits **só em memória**, QR com `relay_url`, canal efêmero, **impressão digital do host** e **impressão digital esperada do PWA**; o PSK vai no **fragmento (`#`)** do link (nunca enviado a servidor) e também como código digitável; handshake da Fase 13 inalterado; SAS nos dois lados; dispositivo nasce `leitura`; segredo de canal trocado **por dentro** do E2E.
  **Aceite:** relay que troca chaves públicas é detectado por pin + SAS (AX-04); código/QR reutilizado ou expirado recusado, 5 erros fecham (AX-26/27); permissão inicial sempre `leitura` e só o desktop a sobe (AX-28); o PSK não aparece em nenhum byte visto pelo relay nem em log; P-165. Testes: `pareamento-relay.test.ts` (relay hostil MITM), `impressao-digital.test.ts`. Depende: T-22.10.
- **T-22.12 · Revogação em dois níveis, pânico e dispositivo perdido** — `src/nucleo/remoto/relay/revogacao.ts`. (1) **Autoritativa no host**: dispositivo revogado nunca autentica (conferido a cada quadro, como a Fase 13); (2) **otimização**: desregistra o canal no relay (assinado). Pânico: fecha o WebSocket, revoga todos, cancela pendências, 0 sockets ≤ 1 s. Mensagem de "esquecer dispositivo" iniciada pelo celular.
  **Aceite:** relay que **descarta** o aviso de revogação não impede que o host recuse o dispositivo (AX-15); quadro gravado antes da revogação **não** autentica depois; pânico ⇒ P-166; revogar um não afeta os outros; celular roubado com `leitura` só vê o que `leitura` permite (AX-14). Testes: `revogacao.test.ts`, `panico.test.ts` (contagem de handles). Depende: T-22.10, T-22.11.

### 22D — PWA (cliente web) e integridade (resolve R1)

- **T-22.13 · Build do PWA, CSP e Service Worker** — `src/pwa/{index.html,manifest.webmanifest,sw.ts}`, `vite.pwa.config.ts`, `tsconfig.pwa.json`, `scripts/build-pwa.mjs`, `scripts/tamanho-pwa.mjs`. HTML mínimo com **um** script com SRI; CSP (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src wss://…; img-src 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'`) por cabeçalho **e** `<meta>` de reserva; SW com cache do shell e política "rede só para dados, nunca cachear conteúdo decifrado".
  **Aceite:** saída em `dist-pwa/` independente do app Electron (este não a importa); P-164 (≤ 60 KB gz JS, ≤ 4 KB HTML); sem `unsafe-inline`/`unsafe-eval`; Lighthouse/Playwright confirma instalável; conteúdo decifrado nunca vai a `Cache`/`localStorage`. Testes: `build-pwa.test.ts`, `csp.test.ts`, `pwa.instalavel.e2e`. Depende: T-22.02.
- **T-22.14 · Criptografia no navegador (WebCrypto) com vetores cruzados** — `src/pwa/{cripto,protocolo-cliente}.ts`. Espelho do host: ECDH P-256, HKDF-SHA256, HMAC, AES-256-GCM, ECDSA P-256; chave de dispositivo **não extraível** em IndexedDB; nenhuma biblioteca de criptografia.
  **Aceite:** **vetores de teste cruzados** — o mesmo transcrito produzido por `node:crypto` (host) e por WebCrypto (Playwright/Chromium) dá bytes idênticos (HKDF, MAC, GCM, SAS); chave não é exportável (`exportKey` falha) e não aparece em `localStorage`; nonce/contador nunca repetem em 100 000 quadros; quadro adulterado fecha a sessão (AX-13). Testes: `cripto.test.ts` (Node), `cripto.cruzado.e2e` (Chromium). Depende: T-22.13, T-22.06.
- **T-22.15 · Telas do PWA** — `src/pwa/ui/**`, `src/pwa/trava.ts`. Pareamento (câmera via `BarcodeDetector` quando existir, senão código digitável), Status, Painéis (texto, `nao_confiavel`), Missões, Enviar mensagem (conforme permissão), Configuração (impressão digital do cliente, travar, esquecer), autolock 5 min com **PIN local opcional** (recomendado; obrigatório por política) que protege o uso da chave (desbloqueia a `CryptoKey`), alvos ≥ 44 px, a11y.
  **Aceite:** texto de painel com HTML/`<script>`/`javascript:` vira texto (Trusted Types, AX-12); sem ação humana (D-21) na interface; confirmação aparece como "aguardando o desktop"; travar apaga o estado em memória; leitor de tela navega as telas. Testes: `ui.test.ts` (jsdom), `pwa.e2e` (Playwright móvel), `a11y`. Depende: T-22.14.
- **T-22.16 · Manifesto assinado do PWA, Service Worker com chave pinada e atualização só assinada** — `scripts/{assinar-pwa,verificar-pwa}.mjs`, `src/pwa/sw.ts`. `manifesto-pwa.json` lista `arquivo → sha256` e `versao`, assinado **Ed25519** (reusa o padrão e as chaves do manifesto da Fase 21/T-21.28 **quando existirem**, senão gera par próprio); a chave privada vem de `EXPXV_PWA_CHAVE_PRIVADA` ou arquivo **fora do repo**; o SW tem a **pública** (e a próxima) embutida e **verifica o hash de cada arquivo** antes de servir; atualização só se `versao` maior **e** assinatura válida; falha ⇒ mantém o shell anterior e mostra aviso; o PWA exibe o **hash do script do SW instalado** para comparação (R-F).
  **Aceite:** origem adulterada (JS trocado, arquivo extra, manifesto sem assinatura, assinatura de outra chave, versão menor) ⇒ o SW **recusa** e o shell antigo continua (AX-09/10); rotação de chave com duas aceitas funciona; chave privada nunca impressa/gravada em `dist-pwa/`; varredura de sentinelas (AX-24). Testes: `pwa-assinado.test.ts`, `sw.test.ts` (Chromium), `origem-adulterada.e2e` (fixture). Depende: T-22.13.
- **T-22.17 · Hospedagem alternativa: PWA servido pelo próprio desktop e comparação de impressão digital** — `src/nucleo/remoto/relay/{impressao-digital}.ts`, `src/main/remoto-cliente-web/**` (estende a pendência T-13.17), `src/nucleo/remoto/servidor.ts` (rota estática **somente** do shell assinado, `origem` LAN/loopback). O app embute o **hash do shell** do seu próprio build; o desktop mostra a impressão digital do cliente; o celular pode instalar **do desktop** (LAN, HTTPS autoassinado) e depois usar o relay.
  **Aceite:** o desktop só serve arquivos listados no manifesto embutido; hash do shell exibido == hash conferido pelo PWA (comparação visual testada com os dois lados); a rota estática **não** amplia a superfície (404 uniforme para o resto; taxa; `Host`/`Origin` da Fase 13) (AX-11). Testes: `servir-shell.test.ts`, `impressao-digital.e2e`. Depende: T-22.13, T-22.16, T-22.04.

### 22E — VPS opcional em Docker (nunca implantado)

- **T-22.18 · Dockerfile, compose e Caddyfile versionados** — `deploy/relay/{Dockerfile,compose.yaml,Caddyfile,.env.example}`. Dockerfile multi-estágio (build com Node 22; *runtime* `gcr.io/distroless/nodejs22` **fixado por digest** ou imagem mínima equivalente), `USER` não-root, sem *shell*, `HEALTHCHECK`; compose: serviço `relay` (`read_only: true`, `tmpfs` para `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit`, `cpus`, `pids_limit`, sem `ports` publicados), serviço `caddy` (perfil `tls`; 80/443; ACME automático; HSTS; CSP e cabeçalhos do PWA se hospedado), rede interna; `.env.example` **só com nomes** (`RELAY_DOMINIO`, `RELAY_MAX_CANAIS`…), sem valor.
  **Aceite:** `deploy/relay/verificar.mjs` passa; nenhuma task executa `docker push`/`compose up` remoto; sem segredo em camada/arquivo (AX-21/22/24). Testes: `relay-docker.test.ts` (estático, T-22.19). Depende: T-22.08.
- **T-22.19 · Endurecimento verificável (estático) e teste de imagem local** — `tests/scripts/relay-docker.test.ts`, `deploy/relay/verificar.mjs`. Estático em qualquer SO: parse do YAML e do Dockerfile; regras: não-root, `read_only`, `cap_drop ALL`, `no-new-privileges`, sem `privileged`/`network_mode: host`/montagem do *socket* do Docker/`pid: host`, base **fixada por digest**, `HEALTHCHECK`, limites de recurso, nenhuma porta publicada pelo `relay`, nenhum `ENV` com valor de segredo, `.dockerignore` exclui `.env*`/chaves/`docs`. **Opcional e local/efêmero** (só se `docker` existir; **pula** sem ele; na CI roda): `docker build` + `run` com limites + P-168, sempre removido no `finally`.
  **Aceite:** cada regra tem caso negativo (arquivo mutado) que o teste pega; imagem ≤ 150 MB e inicia ≤ 2 s quando Docker existe; nada fica vivo (`docker ps`). Testes: o próprio arquivo + `mutacao-fase22`. Depende: T-22.18.
- **T-22.20 · Guia de hospedagem, custo e operação** — `deploy/relay/LEIA-ME.md`. Passo a passo para o dono (VPS de entrada, domínio, DNS, TLS, `compose up`, atualização, backup (nada a salvar: relay sem estado), rotação de imagem, monitoramento do `/healthz`), **o que o relay vê** (R-B), **o que fazer se for comprometido** (rotacionar segredo de canal = reparear), **estimativa de custo** (VPS/banda), alternativas **gratuitas** sem relay (modo LAN/loopback + túnel próprio da Fase 13) e a observação de que este repositório **não implanta nada**.
  **Aceite:** teste confere que todo comando do guia referencia arquivo/serviço/variável **existentes** em `deploy/relay/`, que não há valor de segredo, e que os números de custo citam "estimativa — confirme com seu provedor". Testes: `guia.test.ts`. Depende: T-22.18.

### 22F — Serviço, interface e integração

- **T-22.21 · Serviço no main, IPC e consentimento** — `src/main/relay.ts` (lazy; `import()` só depois da onda 2 e do consentimento), `src/main/ipc/relay.ts` (handlers), `main.ts`, bandeja (pânico), `src/nucleo/remoto/relay/servico.ts`.
  **Aceite:** com `habilitado:false` o módulo **não é importado** e há 0 sockets/0 timers (P-160); ligar exige URL `wss://`, consentimento versionado **e** reconhecimento "experimental"; **reiniciar o app deixa desligado** (como a Fase 13); `habilitado` padrão `false` é **invariante** (teste falha se mudar, AX-34); relay fora do ar não derruba o app; pânico pela bandeja ⇒ P-166. Testes: `servico.test.ts`, `relay-desligado-zero.test.ts`, `ipc.test.ts`. Depende: T-22.10, T-22.11, T-22.12, T-22.03.
- **T-22.22 · UI do desktop** — `src/renderer/telas/configuracoes/{AcessoRemotoRelay,RelayPareamento,RelayDispositivos,RelayGuia}.tsx`, `src/renderer/estado/relay.ts`, via coordenador a entrada em `casca/telas.ts`. Estados por forma e texto, QR por SVG gerado **localmente** (sem biblioteca externa: gerador mínimo ou reaproveitado; decisão e custo em D-NN), SAS grande e legível, "Permitir"/"Recusar" explícitos, impressões digitais em grupos de 4, aviso fixo "experimental, sem revisão externa", pânico em destaque.
  **Aceite:** abre ≤ 50 ms (P-02) e chunk ≤ 20 KB gz (P-160); nada de rede ao abrir; QR e código somem ao expirar/usar/cancelar e **não** reaparecem (como A-05 da Fase 13); a11y sem violação; sem `backdrop-filter`. Testes: `AcessoRemotoRelay.test.tsx`, `RelayPareamento.test.tsx` (jsdom), `a11y`. Depende: T-22.21.
- **T-22.23 · Alertas e indicador** — `src/renderer/casca/IndicadorRemoto.tsx` (pendência da Fase 13: `● remoto · N`), `src/nucleo/alertas/fontes/remoto.ts` (se a Fase 20 existir; senão evento no barramento). Alertas: dispositivo novo pareado, dispositivo revogado, relay indisponível > 5 min, pânico acionado; **texto mínimo**, sem IP, sem `canal_id`, sem nome do dispositivo se "ocultar títulos" estiver ligado.
  **Aceite:** o indicador aparece só com relay/LAN ativos e some desligado; alertas passam pela redação da Fase 20; relay indisponível ≠ revogado no texto. Testes: `IndicadorRemoto.test.tsx`, `fonte-remoto.test.ts`. Depende: T-22.21, Fase 20 (opcional).

### 22G — Segurança, medição e fecho

- **T-22.24 · Fuzz determinístico dos *parsers*** — `tests/fuzz/{quadro,hello,manifesto-pwa}.fuzz.test.ts`. Gerador com semente fixa (sem dependência nova): mutações de bits/tamanhos/UTF-8 inválido em `quadro.ts`, `hello`, manifesto do PWA e no tratador. **Aceite:** 200 000 entradas por parser sem exceção não tratada, sem alocação > limite, sem tarefa > 50 ms; qualquer *crash* vira caso fixo de regressão. Depende: T-22.06, T-22.16.
- **T-22.25 · Fronteira de sockets e rede** — `tests/scripts/relay-fronteira.test.ts` (estendido), `tests/scripts/servidor-remoto-fronteira.test.ts` (atualizado, **sem relaxar**). Prova: só `src/relay/servidor.ts` e `src/nucleo/remoto/servidor.ts` escutam; só `src/nucleo/rede/ws-cliente.ts` abre `WebSocket`; nada em `src/relay` faz requisição de saída; `src/pwa` e `src/relay` fora do `app.asar`; `dist-pwa` fora do pacote. **Aceite:** o teste falha ao introduzir um segundo ouvinte/cliente de rede. Depende: T-22.08, T-22.05.
- **T-22.26 · Suíte adversarial e mutação** — `src/nucleo/remoto/relay/adversarial.test.ts`, `src/relay/adversarial.test.ts`, `tests/scripts/mutacao-fase22.mjs`, `tests/scripts/mutacao-fase22.test.ts`. Cada AX-01..AX-34 tem teste nomeado que **falha se a mitigação for removida** (harness de mutação sem dependência nova, como `mutacao-fase13/20`); o teste de consistência lista mutantes por caso. **Aceite:** meta 100 % de mutantes mortos; vivo vira achado e correção na auditoria. Depende: T-22.06..T-22.22.
- **T-22.27 · Pacote de revisão externa da criptografia (D-351)** — `docs/ade/REVISAO-EXTERNA-CRIPTO.md`, `tests/vetores/relay-e-pareamento.json`, `tests/scripts/vetores.test.ts`. Escopo para um revisor independente: especificação **escrita** do protocolo (mensagens, derivações, transcrição, AAD, contadores, erros), modelo de ameaças, vetores de teste, mapa do código, o que **não** é garantia (PAKE, metadados), critérios de aprovação e **o que muda quando aprovar** (condição para discutir "habilitar por padrão"). **Não é enviado a ninguém** (D-23): o dono contrata (P-341).
  **Aceite:** os vetores do arquivo reproduzem no host (`node:crypto`) e no PWA (WebCrypto); a especificação cobre 100 % das mensagens do `protocolo.ts` (teste compara a lista de tipos); `ax34_nao_habilita_por_padrao` referencia este documento. Depende: T-22.11, T-22.14.
- **T-22.28 · E2E** — `tests/relay.e2e.test.ts`. Electron real + relay real em loopback (`src/relay` como processo de teste) + PWA em Chromium (Playwright): pareamento com SAS, comando `leitura`, `mensagem_confirmada` com confirmação **no desktop**, revogação derrubando, pânico, relay hostil, origem adulterada recusada pelo SW, sentinelas, relay desligado = 0 sockets, reinício deixa desligado. **Aceite:** `ps` limpo; nenhuma porta fora de `127.0.0.1`; sem segredo/URL em logs. Depende: T-22.21, T-22.22, T-22.15, T-22.16.
- **T-22.29 · Perf** — `tests/perf/relay.perf.ts`, `registro.ts`. P-160..P-169 (P-168 só com Docker; senão marca "não medido: sem Docker", **nunca** verde falso). **Aceite:** `ultimo.json` com todas as chaves; reprova ao estourar orçamento simulado. Depende: T-22.28.
- **T-22.30 · Auditoria independente** — `docs/ade/AUDITORIA-RELAY.md`. Auditoria **somente leitura** por agente sem o contexto de quem escreveu: cegueira do relay, prova de posse, E2E, pareamento, revogação, PWA/SW/CSP, Docker/compose, fronteira de rede, residuais; cada achado corrigido com teste que falha sem a correção; **mutação** rodada. **Aceite:** nenhum achado Alto aberto; achados Médios/Baixos corrigidos ou aceitos com texto ao dono. Depende: T-22.26, T-22.28.
- **T-22.31 · Contratos e fechamento** — `05-CONTRATOS.md`, `04-UI-UX.md`, `STATUS.md`, `AGENTS.md` (mapa e regra sobre `src/relay`, `src/pwa`, `deploy/`), `01-DECISOES.md`, `PENDENCIAS-DO-DONO.md`. Atualiza `AMEACAS-REMOTO.md` §6 (G3: "relay agora desligado, experimental") **sem apagar** o histórico. **Aceite:** portão da fase verde; checklist "Validação real (manual, do dono)" gravado. Depende: todas.
- **T-22.32 · [P2] Adaptador do relay em Cloudflare Workers/Durable Objects** — `src/relay/adaptadores/workers/**`. O roteador puro (T-22.07) atrás de um adaptador de Durable Object (hibernação de WebSocket); **não implantado**; mesma suíte de cegueira/limites. **Aceite:** a suíte do roteador roda inalterada contra o adaptador em teste local (Miniflare) **se** a ferramenta existir; custo gratuito/limites documentados no guia. Estudo curto próprio antes. Depende: T-22.07, T-22.30.
- **T-22.33 · [P2] Notificação *push* opcional (desligada, com estudo próprio)** — Web Push (VAPID) **sem conteúdo** (só "há algo para você"), por serviço de push do navegador (**metadado sai para terceiro**: Apple/Google/Mozilla). Estudo curto na própria task, consentimento específico, desligado; sem payload sensível. **Aceite:** só entra se o estudo aprovar; payload sempre vazio/fixo; teste de que nenhuma string de conteúdo/nome entra no push. Depende: T-22.30.

## Validação real (manual, do dono) — não faz parte dos testes automáticos (D-23)

1. Contratar uma VPS **pequena** e um domínio; `deploy/relay` com `compose --profile tls up`; conferir TLS e `/healthz`. 2. Instalar o PWA num **iPhone e num Android** reais; conferir instalação, câmera do QR, autolock, comportamento do Service Worker em segundo plano.
3. Parear de fora da rede doméstica (4G), conferir latência (P-161) e o *indicador* no rodapé. 4. **Comparar a impressão digital** do cliente web (desktop × celular) na primeira instalação. 5. Revogar pelo desktop e conferir que o celular perde acesso ≤ 1 s;
acionar o pânico. 6. Gerar o par Ed25519 do manifesto do PWA e guardar a privada **fora** do repositório. 7. **Contratar a revisão externa da criptografia** com o pacote de `REVISAO-EXTERNA-CRIPTO.md` (P-341). 8. Decidir sobre app nativo (R-A) (P-342).

## Casos de teste de aceitação (cada item vira teste nomeado; os de abuso estão também na suíte T-22.26)

| Área | Casos |
|---|---|
| Relay | prova de posse correta/errada; canal inexistente/ocupado/sem prova indistinguíveis; cotas por IP/canal/global; flood/Slowloris/gigante; 1 000 canais em P-162; purga ao desconectar; só `/healthz` e `/v1/canal/*`; sem fetch de saída |
| E2E | sentinelas ausentes de tudo que o relay vê; quadro adulterado/repetido/reordenado/descartado/atrasado; sessão fecha ao primeiro quadro inválido; nada executa duas vezes |
| Pareamento | QR/fragmento/código; MITM do relay detectado (pin + SAS); uso único; 5 erros fecham; nasce `leitura`; só o desktop sobe permissão |
| Revogação/pânico | host autoritativo; relay descartando o aviso não ajuda; quadro gravado não autentica; pânico ⇒ 0 sockets ≤ 1 s; revogar um não afeta outros |
| PWA | CSP/Trusted Types; HTML de painel vira texto; chave não extraível; vetores cruzados Node × WebCrypto; manifesto assinado; SW recusa shell/atualização adulterados; autolock/PIN; instalável; P-164 |
| Docker | regras estáticas com casos negativos; imagem ≤ 150 MB e inicia ≤ 2 s (se Docker); sem segredo; sem porta publicada pelo relay |
| Fase 13 | **toda a suíte da Fase 13 passa sem edição** depois de T-22.04 |
| Padrão desligado | `habilitado:false` ⇒ 0 sockets/timers/import; reinício deixa desligado; `habilitado` padrão `false` é invariante |

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Relay malicioso lê o conteúdo** | E2E por dentro; prova de cegueira com sentinelas; relay sem chaves de conteúdo (AX-01) |
| **Origem do PWA adulterada (R1 reaparece)** | shell por hash, manifesto assinado, SW com chave pinada, CSP/SRI, impressão digital comparável, instalação alternativa pelo desktop; **R-A e R-F declarados** (app nativo é a única eliminação) |
| **Metadado exposto ao relay (R-B)** | `canal_id` rotativo, padding, sem contas, IP truncado/hash no log; declarado ao dono |
| **Criptografia própria sem auditoria (R-D)** | só primitivas padrão, vetores cruzados, mutação, pacote de revisão externa, **não habilita por padrão** (D-351) |
| **Custo inesperado** | custo zero por padrão; limites de recurso; guia de custo; sem *autoscale*; nada implantado |
| **VPS comprometida** | relay sem estado e cego: o pior caso é negação de serviço; reparear rotaciona o segredo de canal |
| **DoS ao relay/ao desktop** | cotas, backpressure, *backoff* com jitter, tetos por IP/canal/global (AX-18/19) |
| **Fase 13 quebra ao extrair o tratador** | T-22.04 com a suíte da Fase 13 **sem edição**; `origem:"relay"` não afrouxa nada |
| **`ws` e o app** | `ws` só no relay, fora do pacote do app (teste do asar) |
| **WebSocket global no Electron 37 diferente do Node** | medir em T-22.05; fallback documentado; teste de `wss://` real em loopback com certificado de teste |
| **PWA em iOS limitado** | checklist manual (P-342); nenhuma funcionalidade do núcleo depende de *push* ou *background sync* |
| **Texto do celular vira comando/aprovação** | herdado da Fase 13: lista fechada, confirmação **só** no desktop (AX-29) |
| **Segredo no repositório (chave do manifesto, `.env` do deploy)** | só nomes de variável, `.env.example` sem valor, sentinelas, chave privada fora do repo (AX-24) |
| **Vazamento de sockets/processos em teste** | `finally` em tudo; contagem de handles; `ps` ao fim da suíte; Docker sempre removido |

## Ordem de execução e paralelismo

```
T-22.01 (estudo — GATE BLOQUEANTE) ─► T-22.02 ─┬─► T-22.03 ───────────────────────────────────────────┐
                                               ├─► T-22.05 ─┐                                         │
                                               ├─► T-22.06 ─┼─► T-22.07 ─► T-22.08 ─► T-22.18 ─► T-22.19 ─► T-22.20
                                               │            └─► T-22.09 ─┐                            │
                  T-22.04 (extrair tratador) ──┴────────────────────────┴─► T-22.10 ─► T-22.11 ─► T-22.12 ─┐
                                               └─► T-22.13 ─► T-22.14 ─► T-22.15 ─┐                     │
                                                      └─► T-22.16 ─► T-22.17 ──────┤                     │
T-22.21 ─► T-22.22 ─► T-22.23 ◄──────────────────────────────────────────────────┴─────────────────────┘
T-22.24 · T-22.25 ─► T-22.26 ─► T-22.27 ─► T-22.28 ─► T-22.29 ─► T-22.30 ─► T-22.31 · [P2] T-22.32 · T-22.33
```

**Ondas e agentes (≤ 5 simultâneos; ninguém no mesmo arquivo):**

| Onda | Quem | Tasks | Áreas de arquivo (disjuntas) |
|---|---|---|---|
| W0 (serial) | Coordenador | T-22.01 (com agente de segurança), T-22.02, T-22.03, T-22.05 | `docs/ade/seguranca/**`, `src/compartilhado/**`, `preload`, migrations, `src/nucleo/rede/**`, `src/main/ipc/relay.ts` (validadores) |
| W1 | A = relay puro | T-22.06, T-22.07 | `src/relay/{protocolo,roteador,limites}.ts`, `tests/fixtures/relay/**` |
| W1 | B = extração do tratador | T-22.04 | `src/nucleo/remoto/{tratador,servidor,servico}.ts` (**única** onda que toca arquivos da Fase 13) |
| W1 | C = PWA base | T-22.13 | `src/pwa/{index.html,manifest.webmanifest,sw.ts}`, `vite.pwa.config.ts`, `tsconfig.pwa.json`, `scripts/{build,tamanho}-pwa.mjs` |
| W2 | A | T-22.08, T-22.09 | `src/relay/{servidor,main,log}.ts`, `tsconfig.relay.json`, `src/nucleo/remoto/relay/{canal,padding}.ts` |
| W2 | B | T-22.10 | `src/nucleo/remoto/relay/{cliente-relay,transporte-relay,quadro}.ts` |
| W2 | C | T-22.14, T-22.16 | `src/pwa/{cripto,protocolo-cliente}.ts`, `scripts/{assinar,verificar}-pwa.mjs` |
| W3 | B | T-22.11, T-22.12 | `src/nucleo/remoto/relay/{pareamento-relay,impressao-digital,revogacao}.ts` |
| W3 | C | T-22.15, T-22.17 | `src/pwa/ui/**`, `src/pwa/trava.ts`, `src/main/remoto-cliente-web/**` |
| W3 | D = Docker | T-22.18, T-22.19, T-22.20 | `deploy/relay/**`, `tests/scripts/relay-docker.test.ts` |
| W4 | Coordenador | T-22.21 | `src/main/relay.ts`, handlers IPC, `main.ts`, bandeja, `src/nucleo/remoto/relay/{servico,index}.ts` |
| W5 | E = UI | T-22.22 → T-22.23 | `src/renderer/**` (só T-22.22 mexe em `casca/telas.ts` via coordenador) |
| W6 (serial) | F = segurança/testes | T-22.24, T-22.25 → T-22.26 → T-22.27 → T-22.28 → T-22.29 → T-22.30 → T-22.31 | `tests/**`, `docs/ade/REVISAO-EXTERNA-CRIPTO.md`, contratos, `STATUS.md` |
| W7 (P2) | G | T-22.32, T-22.33 | `src/relay/adaptadores/**`, `src/pwa/push/**` |

**Antes de começar:** Fase 13 entregue (tratador, dispositivos, política, pânico), Fase 9 (cofre `safeStorage`, `rede/`), Fase 20 (alertas, opcional), Fase 21 (padrão de manifesto assinado Ed25519; opcional: sem ela, T-22.16 gera o próprio par).
**Caminho crítico:** T-22.01 → 02 → 04 → 06 → 07 → 10 → 11 → 12 → 21 → 28 → 30 (relay e pareamento) e T-22.13 → 14 → 16 → 15 → 28 (PWA). **Se faltar tempo:** entregam-se T-22.01–T-22.12 + T-22.21 (relay e E2E com cliente de referência, **sem PWA**) e, depois, o PWA (T-22.13–T-22.17) e o Docker (T-22.18–T-22.20), **nunca** sem T-22.24–T-22.26 e T-22.27.

## Decisões `[LAC]` resolvidas

| Lacuna | Decisão |
|---|---|
| Relay terminaria TLS e leria o corpo? | [DEC] TLS protege só o salto; **E2E por dentro** (protocolo da Fase 13 inalterado); o relay é cego (D-350) |
| Autenticar o host no relay | [DEC] **prova de posse** de chave (assinatura do desafio), sem contas/senha; o relay guarda **só** chaves públicas em memória |
| Identificador do canal | [DEC] 128 bits aleatórios por pareamento e **derivado por época diária** (`HKDF`), sem identificador estável (D-355) |
| Quem serve o PWA | [DEC] **nunca o relay sem prova**; shell por hash + manifesto Ed25519 + SW com chave pinada; alternativas de hospedagem: o desktop (LAN), host estático do dono, o Caddy da VPS (D-352) |
| R1 | [DEC] resolvido **na medida do software**: comparação de impressão digital, SW com chave pinada, CSP/SRI, instalação pelo desktop; **R-A/R-F** residuais vão ao dono; app nativo é pendência (P-342) |
| Biblioteca de WebSocket do relay | [DEC] `ws` só para o relay (fora do app); cliente do host usa o `WebSocket` global (D-353) |
| Framework do PWA | [DEC] nenhum (vanilla TS) para caber em ≤ 60 KB gz; sem componente de terceiros (D-10) |
| Cripto no PWA | [DEC] WebCrypto, sem biblioteca; vetores cruzados com `node:crypto` |
| Chave do dispositivo no celular | [DEC] `CryptoKey` não extraível em IndexedDB; PIN local protege o uso; sem `localStorage` |
| Web Push | [DEC] fora do padrão (metadado a terceiro); extensão P2 sem conteúdo e desligada (T-22.33) |
| Persistência no relay | [DEC] **nenhuma**: sem *store-and-forward*; celular offline = host descarta; sem fila |
| Relay compartilhado entre pessoas | [DEC] suportado tecnicamente (isolamento por canal, cotas), mas **cada dono hospeda o seu**; sem relay público do projeto (custo zero, D-23) |
| Persistência do liga/desliga | [DEC] **desligado a cada reinício**, como a Fase 13 (diferente do Telegram da Fase 20) |
| Habilitar por padrão | [DEC] **proibido** até revisão externa (D-351, G4) |
| Docker/VPS | [DEC] arquivos endurecidos, testados estaticamente, **nunca implantados**; `docker` local só efêmero e opcional |
| Voz, app nativo, Web Push, relay em Workers | [DEC] fora do padrão; extensões P2 com estudo curto próprio (G5) |

## Fronteiras com outras fases

- **Fase 13 (Jarvis/controle remoto):** base de tudo; `AMEACAS-REMOTO.md` §6 (G3) é **atualizado**, não apagado; a única edição em arquivos da Fase 13 é a extração do tratador (T-22.04), com a suíte da Fase 13 **sem edição**; T-13.17 (cliente web) é **entregue aqui** (T-22.13..T-22.17).
- **Fase 20 (alertas/Telegram):** alertas `remoto_*`/`relay_indisponivel` pela mesma fonte e redação; o Telegram **não** passa pelo relay; as duas entradas remotas coexistem e **só podem subir** a rigidez (P-320).
- **Fase 21 (distribuição):** o padrão de manifesto assinado Ed25519 e a política de chaves são reaproveitados para o PWA; o relay/PWA têm **distribuição própria** (não passam pelo atualizador do app); `src/relay`, `src/pwa` e `deploy/` ficam **fora** do `app.asar`.
- **Fase 15/16 (chat, Maestro, rigidez):** o celular **pede** ao Maestro pelo caminho da Fase 13; rigidez e travas valem como em qualquer origem.
- **Fases 9/10 (cofre, `rede/`, custo):** cofre e `rede/` usados como estão, com a extensão `ws-cliente.ts` (coordenador); custo/consumo visíveis ao PWA apenas como a Fase 13 permite (texto).
- **Fase 11 (voz):** nenhum áudio passa por esta fase.
- **D-04/D-21/D-23/D-25:** o ADE não escreve em `docs/**`; nada humano por canal remoto; nada implantado/publicado; sem telemetria.
