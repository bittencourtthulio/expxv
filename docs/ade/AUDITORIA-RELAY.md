# Auditoria do relay — Fase 22 (T-22.30)

Escopo: relay cego (`src/nucleo/relay`), cliente do host e serviço (`src/nucleo/remoto-estendido`), extração do tratador e adições à Fase 13 (`src/nucleo/remoto`), main e IPC (`src/main/{relay,ipc/relay}.ts`),
PWA (`pwa/`), arquivos de hospedagem (`deploy/relay`). Método: (1) **mutação** das defesas (`tests/scripts/mutacao-relay.mjs`: cada mitigação é removida do fonte e o teste que a prova precisa falhar);
(2) **fuzz** determinístico dos *parsers* (`tests/fuzz`); (3) vetores cruzados host × PWA; (4) **auditoria somente leitura por agente sem o contexto de quem escreveu** (seção 3); (5) leitura do próprio autor.
Regra: achado corrigido tem teste que falha sem a correção; nenhum Alto aberto.

## 1. Resultado da mutação

`node tests/scripts/mutacao-relay.mjs` → **52/52 mutantes mortos** (ver a lista: relay, cliente do host, canal/padding, serviço, pareamento, revogação/pânico, PWA, SW).
`tests/scripts/mutacao-relay.test.ts` impede a lista de apodrecer (trecho existe uma vez, teste existe, `-t` aponta para teste real). Primeira rodada: **34/41**; os 7 sobreviventes viraram os achados F-1, F-2, F-4, F-5
abaixo (o oitavo, `CONNECT` sem ouvinte, é equivalente e está explicado na lista). Segunda rodada, depois das correções: 41/41; a auditoria independente acrescentou mutantes (um por correção A-xx) e a rodada final fecha em **52/52**; o AX-16c voltou a sobreviver quando a revogação passou a apagar o segredo também, e ganhou teste de camada própria (`revogacao.test.ts`).

## 2. Achados da execução (corrigidos e testados)

| # | Sev. | Achado | Prova | Correção e teste |
|---|---|---|---|---|
| F-1 | Média | O cliente do relay aceitava `pong` **espontâneo** e zerava o backoff: um relay hostil que aceita, manda `pong` e derruba transformava o host em gerador de tempestade de reconexão (só o teto de 12/min segurava) | mutante AX-19a/b sobreviveram (uma defesa mascarava a outra) | só vale `pong` que responde a um `ping` nosso; `aplicarTeto` extraída. Testes `ax19_backoff_reconexao (camada do backoff)` e `(camada do teto)`; mutantes AX-19a, 19b, 19c mortos |
| F-2 | Baixa | O teste de fronteira de dependências (`ax33`) não via `import "x"` de efeito colateral, `import("x")` nem `require("x")`: o relay poderia ganhar uma biblioteca de terceiros sem o teste notar | mutante AX-33 sobreviveu | regex do teste cobre as quatro formas; mutante AX-33 morto |
| F-3 | Média | Quadro **autêntico** cujo JSON é `null`/escalar/lista dava `TypeError` no transporte do relay (rejeição não tratada no cliente do host: derrubaria o processo). Achado pelo fuzz | `tests/fuzz/regressoes.test.ts` R-FUZZ-01 | o transporte responde 400 `quadro_invalido`; caso fixo de regressão |
| F-4 | Baixa | A regra do `/healthz` (só GET, sem query, interface interna, sem `X-Forwarded-For`) não era testável de fora: o teste só enxergava o loopback | mutante AX-32 sobreviveu | função pura `healthzPermitido` + teste `ax32_relay_nao_e_proxy (puro)`; mutante morto |
| F-5 | Baixa | Sem teste para o binário enviado **depois do `hello` e antes da prova de posse** (o roteador fechava, mas só a checagem de estado impede o repasse ao host); e o teste de quadro > 64 KiB tinha nome que o filtro de mutação não pegava | mutantes AX-18a/18b sobreviveram | testes `ax18_flood_relay: quadro binário depois do hello e ANTES da prova…`; mutantes mortos |
| F-6 | Baixa | `assinaturaValida` (PWA) aceitava a mesma assinatura em duas grafias (base64 não canônico). Inofensivo para a segurança do Ed25519, mas a entrada do verificador não era única. Achado pelo fuzz | R-FUZZ-02 | `pwa/verificar.js` exige base64 canônico; mutante AX-09c morto |
| F-7 | Baixa | O leitor de quadros WebSocket do relay (primeiro código a tocar bytes hostis) não tinha fuzz | revisão própria | `tests/fuzz/ws-servidor.fuzz.test.ts` (200 000 entradas, fragmentação aleatória, limite por quadro, nada depois de erro): sem falha |
| F-8 | Baixa | Mexer na configuração do relay com ele desligado montava o núcleo (importava o cliente e o `ws-cliente`; nenhum socket/timer, mas contra P-160) | revisão própria | `main/relay.ts` grava a configuração sem montar o núcleo; teste `relay_desligado_zero` cobre `configDefinir` |
| F-9 | Baixa | O indicador do rodapé (`● relay · N`) somava ao JS inicial | P-160b | medido em 1,89 KB gz (≤ 2 KB), com o QR e o resto da aba em chunk próprio (5,6 KB gz, P-160c) |

## 3. Auditoria independente (agente sem contexto, somente leitura)

Auditor sem o contexto de quem escreveu, somente leitura, leu o **código** (não a documentação) nos dez eixos (cegueira, prova de posse, E2E, pareamento, revogação/pânico, PWA/SW/CSP, Docker, fronteira de rede,
invariantes/IPC, DoS) e provou os achados por execução (6 de 6 reproduzidos). **Veredito: nenhum achado Alto**; nenhum caminho para um relay ativo ler, forjar ou reordenar conteúdo com efeito, nem para um
dispositivo revogado autenticar; nenhum XSS no PWA; fronteira de rede íntegra. Dos 14 achados (Médio/Baixo), **12 foram corrigidos agora, cada um com teste que falha sem a correção** (e mutante morto),
e 2 são riscos residuais aceitos, com texto ao dono.

| # | Sev. | Achado | Correção e teste (falha sem a correção) |
|---|---|---|---|
| A-01 | Média | O PWA apagava o pareamento inteiro em qualquer 401 do início da sessão; o host responde igual a relógio fora de ±60 s, nonce repetido (um relay hostil reenvia um pedido antigo) e dispositivo desconhecido: dano permanente (repareamento) | o PWA nunca apaga sozinho: tenta de novo, depois de 3 recusas avisa («relógio errado ou revogado») e deixa o «Esquecer este aparelho» com a pessoa; volta sozinho quando o relógio acerta. `pareamento-relay.integracao.test.ts` (A-01); mutante AX-14b |
| A-02 | Baixa | `desconectar` de um cliente VELHO zerava o slot do cliente NOVO (quadros do host descartados em silêncio) | `roteador.ts` só zera se o slot ainda é dele. `roteador.test.ts` (A-02) |
| A-03 | Média-Baixa | `canal_segredo` concorrente entregava dois segredos distintos e deixava um cliente órfão (sem dono para revogação/pânico) | permissão consumida ANTES do `await` (falha de cofre a devolve); `iniciarCliente` com reserva síncrona. `pareamento-relay.test.ts` (concorrentes); mutante AX-28d |
| A-04 | Baixa | Replay do quadro EXTERNO é aceito fora da janela de 4 096 nonces e em transporte novo | **aceito**: o invólucro externo não é a camada de autenticação (a sessão interna tem contador, `ts`+nonce e assinaturas); o único efeito (derrubar a sessão) deixou de apagar o pareamento com o A-01 |
| A-05 | Média | Cota por IP usava o endereço IPv6 completo: um /64 (2^64 endereços) escapava de todas as cotas e esgotava os 5 000 canais | `chaveDeIp`: IPv6 vira /64, IPv4 mapeado vira IPv4; o servidor a aplica a todo IP de origem. `limites.test.ts`, `relay-fronteira.test.ts`; mutantes AX-18c e AX-18d |
| A-06 | Média | A URL documentada (`wss://relay.exemplo.com`, sem caminho) nunca conectava pelo host (o relay só atende `/v1/canal/*`) | `urlDoCanalRelay` no host (igual ao PWA). `relay.test.ts`, `cliente-relay.test.ts` (A-06); mutante AX-19d |
| A-07 | Baixa | `validarUrlRelay` aceitava nome local com ponto final (`localhost.`, `api.local.`) | ponto final removido antes dos filtros (host, UI e PWA). `relay.test.ts` (A-07); mutante AX-22b |
| A-08 | Média-Baixa | Revogar com o relay DESLIGADO não apagava o segredo do cofre; e desligar/pânico no meio da leitura do cofre deixava um cliente com socket | revogação trata quem tem canal registrado mesmo desligado (e o main monta o serviço para isso); `iniciarCliente` revalida `ligado` e o dispositivo depois do `await`. `servico.test.ts` (A-08, pânico e desligar na subida); mutantes AX-15c e AX-16e |
| A-09 | Baixa-Média | As respostas do Service Worker perdiam os cabeçalhos de segurança (`frame-ancestors`, `nosniff`, referrer, COOP, permissões) | o SW repõe os cabeçalhos (CSP do build embutida) nas respostas do cache. `tests/pwa-navegador.e2e.test.ts` (Chromium real); mutante AX-09d |
| A-10 | Média (supply chain) | Dockerfile com `typescript@5` flutuante e sem digest no estágio de build; digest zerado passava no lint; Caddy sem digest | versão EXATA (`5.9.3`, `--ignore-scripts`), digest exigido em TODO `FROM` e em toda imagem do compose, aviso explícito para os marcadores (P-360, três). `mutacao-relay-docker.test.ts` |
| A-11 | Baixa | Caddy sem volume em `/data` (perde a chave TLS e arrisca o limite do ACME a cada recriação) e sem `read_only` | volumes `caddy_dados`/`caddy_config`, `read_only` e `tmpfs`; regras novas no verificador. `mutacao-relay-docker.test.ts` |
| A-12 | Baixa | Sem piso de versão no SW: depois de limpar o armazenamento, manifesto assinado antigo voltava | piso = versão do próprio SW menos 1. `manifesto.test.ts` (A-12); mutante AX-10b |
| A-13 | Baixa | O hash do `sw.js` mostrado na tela é informado pelo próprio SW: não prova nada contra origem hostil | texto da tela diz isso (só vale comparado com o do seu build); residual R-F inalterado |
| A-14 | Baixa | PIN de 4 a 12 dígitos é forçável offline por quem lê o IndexedDB | **aceito e documentado**: o PIN só protege o segredo de canal; a chave do dispositivo continua não extraível |

## 4. Riscos residuais aceitos (texto ao dono)

- **R-A, R-B, R-C, R-D, R-E, R-F** de `AMEACAS-RELAY.md` §6, sem mudança. R-D só se elimina com a revisão externa (`REVISAO-EXTERNA-RELAY.md`, pendência P-341); habilitar por padrão continua proibido.
- **A-04 e A-14** (acima): replay do invólucro externo e PIN curto forçável offline, aceitos com as justificativas da tabela.
- **Segredo de canal sem PIN:** sem PIN local o segredo de canal fica em claro no IndexedDB do PWA (com PIN, cifrado por PBKDF2). Ele só dá o `canal_id` do dia e a chave do invólucro; **sem a chave do dispositivo (não extraível) não há
  autenticação nem sessão**. A tela recomenda o PIN.
- **Janela do pareamento:** o relay encerra o canal efêmero 120 s depois de criado (D-375); quem demorar a decidir no desktop recomeça. Não há risco: só falha o pareamento.
- **Digest da imagem base** (P-360) e **P-168 não medido** sem Docker/imagem local: o dono troca o marcador e roda o perf.
- **E2E do Electron** (`tests/relay.e2e.test.ts`) escrito e type-checado, não executado (exige `npm run build`, e o `dist/` está em uso pelo `npm run dev` do dono). Os espelhos sem Electron
  (`servico.test.ts`, `tests/pwa-navegador.e2e.test.ts` no Chromium real, perf P-161/P-165/P-166) rodam e passam.
