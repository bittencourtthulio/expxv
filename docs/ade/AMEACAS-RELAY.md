# Estudo de ameaças — Fase 22 (relay cego, PWA móvel e VPS opcional)

T-22.01, **bloqueante**. Escrito antes de qualquer código das ondas W0–W2 e atualizado conforme cada caso ganhou prova. Reusa e **não duplica** `AMEACAS-REMOTO.md` (Fase 13: AR-01..28) e
`AMEACAS-TELEGRAM.md` (Fase 20): mesmo formato STRIDE, mesmos ativos e atores, numeração `AX-NN` própria. Validado por `tests/scripts/ameacas-relay.test.ts`
(toda ameaça **Alta** aponta para uma task `T-22.NN` que existe em `fase-22-acesso-remoto-estendido.md` e para um nome de teste; linha marcada `pronto` tem o teste no código).

**Escopo.** O celular (PWA) fala com o desktop **por um relay** que só repassa bytes cifrados. O protocolo da Fase 13 (ECDH P-256 + PSK → HKDF, `conf_s/conf_c`, SAS, ECDSA, AES-256-GCM com
contador e AAD do `sid`) vai **por dentro**, inalterado. O relay é mais um transporte (ao lado de LAN e loopback); pareamento, dispositivos, permissões, confirmação no desktop (D-21/D-323),
revogação e pânico são **os da Fase 13**. Tudo nasce **desligado e experimental**; o padrão é `leitura`.

## 1. Fronteiras de confiança

| | Fronteira | O que cruza | Controle |
|---|---|---|---|
| F1 | pessoa ↔ desktop | SAS, «Permitir», pânico, confirmação | só `ui`/`desktop` resolvem (Fase 13) |
| F2 | texto do celular ↔ interpretador | dado não confiável | mesma redação → limite → interpretador → política → confirmação (AR-01..06) |
| F3 | desktop ↔ relay | quadros opacos por TLS (`wss://`) com E2E por dentro | `ws-cliente` só `wss://`; invólucro AES-GCM + padding; nada em claro |
| F4 | relay ↔ celular | idem | prova de posse; chave do dispositivo não extraível |
| F5 | celular ↔ **origem do PWA** | o código JavaScript do cliente | shell fixado por hash, manifesto Ed25519, SW com chave pinada, CSP/SRI (R1) |
| F6 | operador do relay/VPS | curioso ou malicioso (talvez o próprio dono, talvez terceiro) | relay cego, sem estado, sem contas; metadado residual declarado (R-B) |
| F7 | desktop ↔ cofre | chave de identidade, segredo de canal | `safeStorage`; nunca em banco, log, argv |
| F8 | build do PWA ↔ assinatura | `manifesto-pwa.json` | Ed25519; chave privada **fora** do repositório |
| F9 | imagem Docker ↔ host da VPS | contêiner do relay | usuário não-root, `read_only`, `cap_drop ALL`, base por digest (arquivos; nunca implantados) |

## 2. Ativos

1. Chave de identidade do host. 2. Segredo de canal e `canal_id` por dispositivo. 3. Chave do dispositivo (no celular, WebCrypto **não extraível**). 4. Chave privada do manifesto do PWA.
5. Conteúdo das mensagens (comandos, painéis, Missões, títulos). 6. Metadados (IP, horários, tamanhos). 7. Capacidade de executar (pedir ao Maestro, decidir portão). 8. O shell do PWA.
9. A imagem do relay. 10. Custo financeiro (VPS, tráfego).

## 3. Atores

Dono presente · dono ausente com celular · celular roubado · **operador do relay curioso** · **operador do relay malicioso (ativo)** · outro cliente do relay · atacante na rede do celular ·
atacante na rede do desktop · quem comprometeu a VPS · quem comprometeu o repositório/CI do PWA · quem roubou a chave do manifesto · desconhecido que descobriu o `canal_id` · bot/scanner na Internet.

## 4. STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Cliente do host (`cliente-relay`) | prova de posse assinada | invólucro AES-GCM + contador interno | `relay_evento` sem conteúdo | só quadros opacos ao relay | backoff 1→60 s com jitter | tratador da Fase 13 não afrouxa por `origem:"relay"` |
| Roteador do relay | slot do cliente exige prova de posse | repasse opaco, nunca interpreta | log sem payload, IP truncado + sal diário | sem estado persistente, sem fila | cotas por IP/canal/global, backpressure | nenhuma — não executa nada |
| Servidor do relay | só `/healthz` e `/v1/canal/*` | quadro ≤ 1 KiB pré-auth, ≤ 64 KiB depois | métricas agregadas | 404 uniforme | handshake ≤ 5 s, limites de conexão | sem fetch de saída, sem proxy |
| Prova de posse | ECDSA P-256 sobre `desafio‖canal‖papel` | desafio novo por conexão | — | relay guarda só chave pública, em memória | prova inválida custa 1 mensagem | — |
| Canal rotativo | `HKDF(segredo, "id"‖época)` | — | — | relay não liga épocas | — | — |
| Padding | — | — | — | blocos 256 B / 1 KiB / 4 KiB | — | — |
| Pareamento via relay | PSK de 60 bits fora do relay + SAS | transcrição no HKDF | `pareamento_*` | PSK no fragmento `#` | 5 erros fecham, TTL 120 s | desktop decide; nasce `leitura` |
| PWA shell / Service Worker | manifesto assinado, chave pinada | hash por arquivo antes de servir | versão monotônica | CSP, Trusted Types | — | atualização só assinada |
| Cripto no navegador | `CryptoKey` não extraível | vetores cruzados com `node:crypto` | — | nada em `localStorage` | — | — |
| Revogação / pânico | autoritativa no host | — | `revogado`, `panico` | — | pânico ⇒ 0 sockets ≤ 1 s | — |
| Docker / compose / Caddy | base fixada por digest | sem segredo em camada | — | `.dockerignore` | `mem_limit`, `cpus`, `pids_limit` | não-root, sem `privileged` |

## 5. Casos de abuso

Colunas: caso · severidade · mitigação · task do plano (`T-22.NN` existente) · teste nomeado · estado (`pronto` = o teste existe no código; `Wn` = onda em que ganha prova).

| AX | Caso | Sev. | Mitigação | Task | Teste | Estado |
|---|---|---|---|---|---|---|
| AX-01 | Relay lê o conteúdo (operador curioso/malicioso) | Alta | E2E AES-256-GCM por dentro; relay sem chave de conteúdo; cegueira provada com sentinelas | T-22.07 | `ax01_relay_nunca_ve_texto_claro` | pronto |
| AX-02 | Relay forja/adultera/injeta quadro | Alta | invólucro AES-GCM + contador e AAD do `sid` (Fase 13); quadro inválido fecha | T-22.10 | `ax02_relay_nao_forja_quadro` | pronto |
| AX-03 | Relay repete/reordena/descarta/atrasa/duplica | Média | duplicata descartada; contador monotônico; nada executa duas vezes | T-22.10 | `ax03_relay_replay_reordem` | pronto |
| AX-04 | MITM ativo no pareamento via relay | Alta | PSK fora do relay entra no HKDF; SAS no desktop; impressão digital do host no QR | T-22.11 | `ax04_mitm_relay_no_pareamento` | pronto |
| AX-05 | Squatting do `canal_id` | Alta | host assina o desafio; slot do cliente exige prova de posse; 128 bits; rotação por época | T-22.06 | `ax05_squatting_de_canal` | pronto |
| AX-06 | Enumeração de canais | Média | 128 bits; resposta única para inexistente/ocupado/sem prova; atraso uniforme | T-22.07 | `ax06_enumeracao_uniforme` | pronto |
| AX-07 | Correlação de longo prazo | Média | `canal_id = HKDF(segredo, "id"‖época diária)` | T-22.09 | `ax07_canal_rotativo` | pronto |
| AX-08 | Vazamento por tamanho/tempo | Média | padding para 256 B/1 KiB/4 KiB; quadros de enchimento | T-22.09 | `ax08_padding_de_quadros` | pronto |
| AX-09 | PWA servido adulterado | Alta | manifesto assinado; SW confere hash de cada arquivo; falha ⇒ não executa | T-22.16 | `ax09_shell_adulterado_nao_executa` | pronto |
| AX-10 | Atualização maliciosa do PWA | Alta | só chave pinada (atual + próxima); versão monotônica; sem rollback | T-22.16 | `ax10_atualizacao_so_assinada` | pronto |
| AX-11 | Primeira instalação a partir de origem adulterada | Alta | residual R-A; impressão digital comparável; instalação servida pelo desktop | T-22.17 | `ax11_impressao_digital_comparavel` | pronto |
| AX-12 | XSS no PWA | Alta | `textContent`; Trusted Types; CSP sem `unsafe-inline` | T-22.15 | `ax12_saida_so_texto` | pronto |
| AX-13 | Chave do dispositivo exfiltrada do navegador | Alta | `CryptoKey` não extraível; nada em `localStorage`; sem export | T-22.14 | `ax13_chave_nao_extraivel` | pronto |
| AX-14 | Celular roubado desbloqueado | Alta | `leitura` por padrão; confirmação no desktop; autolock + PIN; revogação ≤ 1 s (R-E) | T-22.12 | `ax14_celular_roubado_limitado` | pronto |
| AX-15 | Revogação não chega (relay descarta o aviso) | Alta | dois níveis: host autoritativo e desregistro no relay | T-22.12 | `ax15_revogacao_autoritativa_no_host` | pronto |
| AX-16 | Pânico não fecha tudo | Alta | fecha o WebSocket, revoga todos, cancela pendências, 0 sockets ≤ 1 s | T-22.12 | `ax16_panico_zero_sockets` | pronto |
| AX-17 | Relay liga sozinho / sem consentimento | Alta | nasce desligado; consentimento versionado; não religa após reinício; sem URL padrão | T-22.21 | `ax17_relay_nao_liga_sozinho` | pronto |
| AX-18 | DoS contra o relay | Alta | limites por IP/canal/global; quadro ≤ 64 KiB (pré-auth ≤ 1 KiB); handshake ≤ 5 s; backpressure | T-22.07 | `ax18_flood_relay` | pronto |
| AX-19 | DoS pelo relay ao desktop (reconexão em tempestade) | Média | backoff exponencial com jitter 1→60 s; teto de tentativas/min | T-22.10 | `ax19_backoff_reconexao` | pronto |
| AX-20 | Custo descontrolado | Média | custo zero por padrão; tetos por canal; limites de recurso na imagem | T-22.18 | `ax20_limites_de_recurso` | pronto |
| AX-21 | Imagem Docker insegura | Alta | não-root, `read_only`, `cap_drop ALL`, base por digest, sem segredo em camada | T-22.19 | `ax21_dockerfile_endurecido` | pronto |
| AX-22 | TLS ausente/fraco | Alta | cliente do host só `wss://` (`ws://` só loopback com `NODE_ENV=test`); sem `rejectUnauthorized:false` | T-22.05 | `ax22_so_wss_fora_do_teste` | pronto |
| AX-23 | Logs do relay vazam metadado/conteúdo | Média | log sem payload; IP truncado + hash com sal diário; retenção em memória | T-22.08 | `ax23_log_sem_conteudo_nem_ip_cru` | pronto |
| AX-24 | Segredo no repositório | Alta | só nomes de variável; chave privada fora do repo; varredura de sentinelas | T-22.16 | `ax24_sem_segredo_versionado` | pronto |
| AX-25 | Relay compartilhado: um cliente atrapalha outro | Média | isolamento por canal; cotas; sem listagem de canais | T-22.07 | `ax25_isolamento_de_canais` | pronto |
| AX-26 | QR/fragmento interceptado | Média | PSK de uso único, TTL ≤ 120 s; SAS no desktop | T-22.11 | `ax26_qr_uso_unico_ttl` | pronto |
| AX-27 | Pareamento reutilizado/expirado | Alta | uso único, 5 erros fecham, janela única (AR-07) | T-22.11 | `ax27_pareamento_via_relay_uso_unico` | pronto |
| AX-28 | Dispositivo «novo» com permissão maior | Alta | permissão sobe só pelo desktop (AR-15); nasce `leitura` | T-22.11 | `ax28_dispositivo_nasce_leitura` | pronto |
| AX-29 | Texto hostil do celular vira comando/aprovação | Alta | herdado de AR-01..04: lista fechada, confirmação por id no desktop | T-22.10 | `ax29_texto_do_celular_e_dado` | pronto |
| AX-30 | Falha do relay derruba o app | Média | erro isolado; `on("error")` permanente; relay fora = «indisponível», não revogação | T-22.10 | `ax30_relay_fora_nao_derruba_app` | pronto |
| AX-31 | Cliente web de outra origem finge ser o PWA | Média | autenticação por chave do dispositivo, não por origem; `Origin` informativo | T-22.07 | `ax31_origem_nao_autentica` | pronto |
| AX-32 | Relay vira proxy aberto / HTTP aberto | Alta | só `/healthz` e `/v1/canal/*`; 404 uniforme; nenhum fetch de saída | T-22.08 | `ax32_relay_nao_e_proxy` | pronto |
| AX-33 | Dependência do relay comprometida | Média | relay só com `node:*`, sem dependência de execução (D-365) | T-22.08 | `ax33_dependencias_do_relay_minimas` | pronto |
| AX-34 | Habilitado por padrão sem revisão externa | Alta | `habilitado:false` e `experimental:true` fixos; teste falha se mudar | T-22.21 | `ax34_nao_habilita_por_padrao` | pronto |

Herdado sem duplicar: AR-01..06, AR-07/08, AR-11, AR-14/15/17, AR-16, AR-19/20, AR-24, AR-26.

## 6. Riscos residuais (texto exato, para o dono)

- **R-A** — A **primeira instalação** do PWA a partir de uma origem adulterada não tem como ser detectada por software; só um app nativo elimina. Mitigação: impressão digital do cliente exibida no desktop e comparada; instalação alternativa servida pelo desktop.
- **R-B** — O relay vê **metadados**: IP, horário, tamanho aproximado do quadro (em blocos de padding) e o `canal_id` do dia. Nunca vê conteúdo.
- **R-C** — Um relay malicioso pode **negar serviço** (descartar, atrasar, fechar). Nunca ler nem forjar. Relay fora do ar é «indisponível», não revogação.
- **R-D** — A composição criptográfica é própria (primitivas padrão, vetores cruzados), **sem auditoria externa** (R2 da Fase 13). **Pré-requisito para discutir habilitar por padrão** (D-351).
- **R-E** — Celular roubado e desbloqueado age, dentro da permissão dele (`leitura` por padrão), até a revogação (≤ 1 s depois do clique no desktop).
- **R-F** — Um Service Worker trocado pela origem **depois** da primeira instalação exige comparação humana do hash do SW, exibido na configuração do PWA.

## 7. Portões

- **G1 relay (transporte)** — **aprovado** (W0–W6): E2E, cegueira provada (sentinelas em socket real com TAP), prova de posse, revogação ≤ 1 s e pânico ≤ 1 s têm teste (`ax01`, `ax05`, `ax15`, `ax16`, P-166) e 52 mutantes das defesas morrem (`tests/scripts/mutacao-relay.mjs`).
- **G2 PWA** — **aprovado**: shell fixado, manifesto assinado, SW recusa adulterado (também no Chromium real: `tests/pwa-navegador.e2e.test.ts`), CSP/SRI testados; R-A/R-F seguem declarados ao dono (P-340).
- **G3 VPS/Docker** — **aprovado só como arquivos endurecidos e testados estaticamente** (`deploy/relay`, nunca implantados; digest da base pendente: P-360).
- **G4 habilitar por padrão** — **não aprovado** até revisão externa (D-351).
- **G5 Web Push, voz, app nativo** — **não aprovados** (extensões P2 com estudo próprio).

## 8. Decisões

Confirma D-350..D-359 (já registradas). W0–W2 acrescentaram D-365..D-369 em `01-DECISOES.md`: relay sem `ws` (WebSocket mínimo sobre `node:http`), localização dos módulos, exceções explícitas da
varredura de empacotamento (servidor do relay e `ws-cliente`), PWA em JavaScript puro com mini-build sem dependência e o desenho do invólucro, da prova de posse e do backoff. W3–W6 acrescentam D-374..D-379 (QR local,
pareamento por relay e as adições à Fase 13, serviço no main e invariantes, revogação/pânico e achados da mutação, como se prova, hospedagem e pacote de revisão). Auditoria independente: `AUDITORIA-RELAY.md`.

**Conclusão: estudo aprovado para W0–W2.** Nenhuma ameaça Alta ficou sem task e teste nomeados; as de W3+ têm task existente e ficam `pendente` até a onda delas.
