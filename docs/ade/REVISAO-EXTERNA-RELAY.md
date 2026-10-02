# Pacote de revisão externa da criptografia — relay, pareamento e PWA (Fase 22, T-22.27)

**Este pacote não foi enviado a ninguém** (D-23: nada sai da máquina). Ele existe para o dono contratar uma revisão independente (pendência P-341) e entregar a um revisor um escopo fechado,
a especificação escrita, os vetores de teste e o mapa do código. Enquanto a revisão não acontecer, o relay é **EXPERIMENTAL e desligado por padrão** (D-350/D-351, AX-34, R-D de
`AMEACAS-RELAY.md`): `habilitado:false` e `experimental:true` são invariantes do código, e a tela exige um reconhecimento a cada ligação.

## 1. O que está em escopo

A composição criptográfica que o celular (PWA) e o desktop usam por um relay que só repassa bytes: **(a)** o protocolo do relay (`hello` → `desafio` → `prova`), **(b)** o canal rotativo e o
invólucro com padding, **(c)** o protocolo da Fase 13 que vai POR DENTRO (pareamento por código de 60 bits + ECDH, SAS, reconexão com assinaturas mútuas, canal AES-GCM com contador),
**(d)** a entrega do segredo de canal e a revogação, **(e)** a integridade do cliente web (manifesto Ed25519 e Service Worker). Fora de escopo: o resto do app, o Telegram (Fase 20),
a hospedagem do relay (arquivos de `deploy/relay`, nunca implantados) e a interface visual.

Só primitivas padrão: ECDH P-256, HKDF-SHA-256, HMAC-SHA-256, AES-256-GCM, ECDSA P-256 (assinatura IEEE P1363, 64 bytes) e Ed25519 (só no manifesto do PWA). No host vêm de `node:crypto`, no
navegador de WebCrypto; **nenhuma biblioteca de criptografia** e nenhuma primitiva própria. A COMPOSIÇÃO é nossa, e é isso que se pede para revisar.

Notação: `lp(a, b, …)` = concatenação de cada parte precedida pelo comprimento de 4 bytes (big-endian); `‖` = concatenação simples; `H` = SHA-256; `HKDF(ikm, sal, info, n)` = HKDF-SHA-256 com `n` bytes.
Os vetores (entradas fixas e saídas em hexadecimal) estão em `tests/vetores/relay-e-pareamento.json` e são reproduzidos byte a byte pelo host e pelo PWA em `tests/scripts/vetores.test.ts`.

## 2. Camada 1 — protocolo do relay (`src/nucleo/relay/protocolo.ts`, versão `<id do produto>-relay.1`)

Mensagens de controle (JSON em quadro de texto; parser estrito que nunca lança; campo extra ou tipo errado = recusa; teto de 1 KiB antes da prova de posse e de 64 KiB depois):

| Tipo | Sentido | Campos | Observação |
|---|---|---|---|
| `hello` | conexão → relay | `t, v, papel ("host"\|"cliente"), canal (32 hex), ts, nonce (16 B base64)` | abre o handshake; relógio do `ts` é só informativo |
| `desafio` | relay → conexão | `t, n (16 B base64)` | desafio novo por conexão |
| `prova` | conexão → relay | `t, pub (SPKI P-256), sig (64 B), cli? (SPKI), ef? (1)` | `cli` e `ef` só o host usa |
| `ok` | relay → conexão | `t` | slot ocupado; a partir daqui só quadros binários opacos |
| `erro` | relay → conexão | `t, c ("recusado"\|"limite")` | código UNIFORME: nunca diz o motivo |
| `ping` / `pong` | ambos | `t` | o host manda a cada 25–30 s; sem `pong` a conexão cai |
| `fechar` | ambos | `t` | encerra |
| `desregistrar` | host → relay | `t` | o relay esquece o canal (otimização; a revogação é do host) |

**Prova de posse.** O signatário assina `dados = lp("relay-prova-v1", desafio, nonce_do_hello, canal, papel, cli ? H(lp(cli)) : "", ef ? "ef" : "")` com ECDSA P-256/SHA-256 (P1363). O relay
**verifica sempre e antes de qualquer regra de slot** (o custo e o passo da recusa não dependem de o canal existir). Host: a chave é a **identidade do host** da Fase 13 (a mesma que o dispositivo fixa
no pareamento); ele declara em `cli` a chave pública do único dispositivo que poderá ocupar o slot do cliente (omitido no canal efêmero). Cliente: a chave do dispositivo (`CryptoKey` não extraível).
Outro dono tentando registrar um canal já registrado, canal inexistente, canal ocupado, prova inválida e chave de cliente diferente da declarada geram **a mesma recusa** (vetor `prova_de_posse`).

O relay guarda só chaves públicas e o estado de slots **em memória**: sem contas, sem fila, sem *store-and-forward*, sem arquivo. Repassa binários sem interpretá-los (prova de cegueira com sentinelas em
`src/nucleo/relay/cegueira.test.ts` e `src/nucleo/remoto-estendido/integracao-relay.test.ts`, com um TAP de TCP).

## 3. Camada 2 — canal rotativo e invólucro (`src/nucleo/remoto-estendido/{canal,quadro,padding}.ts`; espelho em `pwa/{cripto,padding}.js`)

- **Segredo de canal** `S`: 32 bytes aleatórios por dispositivo, gerados no host e entregues dentro da sessão cifrada (§5). No host vive no cofre do SO; no celular, no IndexedDB.
- **`canal_id`** (vetor `canal_id`): `hex(HKDF(S, "", "xv/relay/canal/id" ‖ época_u64_BE, 16))`, época diária (`⌊ms / 86 400 000⌋`). O relay não consegue ligar o canal de hoje ao de ontem. O host troca de canal na virada de época;
  o celular tenta época atual, anterior e próxima (tolerância de relógio).
- **`chave_envelope`** (vetor `chave_envelope`): `HKDF(S, "", "xv/relay/envelope/<rótulo>", 32)`; rótulos `sessao` (canal definitivo) e `pareamento` (canal efêmero).
- **`padding`** (vetores `padding` e `padding_enchimento`): `[tipo:1 (0 dado, 1 enchimento)] [comprimento:2 BE] [conteúdo] [bytes aleatórios]` até o bloco de 256 B, 1 KiB ou 4 KiB (acima disso, múltiplos de 4 KiB).
  O enchimento é um quadro de tipo 1, comprimento 0 e 256 B, enviado junto a cada `ping`: depois de selado é indistinguível de um dado.
- **`envelope`** (vetor `envelope`): `iv (12 B aleatórios) ‖ AES-256-GCM(chave_envelope, iv, AAD = "xv-relay-env-v1|<c2h|h2c>", padded) ‖ tag (16 B)`. A **direção** no AAD impede refletir um quadro. O receptor guarda os últimos 4 096 `iv`
  vistos e descarta duplicata (o relay pode repetir); quadro que não abre fecha a conexão.
- Mensagem interna: JSON `{r, id, corpo}` (celular → host; `r` ∈ `pareamento_inicio`, `pareamento_fim`, `pareamento_status`, `sessao_inicio`, `canal`) e `{id, status, corpo}` (host → celular).

## 4. Camada 3 — protocolo da Fase 13 por dentro (`src/nucleo/remoto/protocolo.ts`, sem alteração)

**Pareamento** (vetores `segredo_efemero` e `pareamento`). O desktop abre uma janela de 120 s e mostra o código `K` (12 símbolos de um alfabeto de 32 = 60 bits; uso único; 5 erros fecham a janela).
O canal efêmero nasce de `K`: `S_ef = H("xv/relay/pareamento-segredo|" ‖ K_normalizado)`, `canal_id = canal_id(S_ef, época 0)`, `chave_envelope(S_ef, "pareamento")`. O relay só vê o `canal_id`; adivinhar `K` custa 2^60
tentativas dentro de uma janela de 120 s. Dentro do canal: ECDH P-256 efêmero dos dois lados; `ikm = ecdh ‖ H("psk" ‖ K)`; `transcrição = H(lp("par-v1", epk_c, spk, nonce_c, nonce_s))`;
`conf = HKDF(ikm, transcrição, "xv/remoto/pareamento/conf", 32)`; `SAS = HMAC(conf, lp("sas", transcrição))` (primeiros 4 bytes, módulo 10^6, 6 dígitos);
`conf_s = HMAC(conf, lp("srv", transcrição))` (o servidor prova que conhece `K`); `conf_c = HMAC(conf, lp("cli", transcrição, H(pub_dispositivo), nome))`; `mac_pareado = HMAC(conf, lp("ok", transcrição, dispositivo_id, SPKI_do_host))`
(autentica a identidade do host que o dispositivo vai fixar). O **SAS** aparece nos dois lados; quem decide é o **desktop** («Permitir»/«Recusar»); o dispositivo nasce com permissão `leitura`. O QR leva ainda a **impressão digital do
host** (vetor `impressao_digital`: SHA-256 do SPKI, 16 primeiros bytes, 32 hex em grupos de 4) para um segundo pin independente.

**Sessão** (vetor `sessao`). `dados_assinados_cliente = lp("sess-c-v1", dispositivo_id, epk_c, nonce_c, ts)` assinado pela chave do dispositivo; o host confere, responde `spk`, `nonce_s` e assina a
`transcrição = H(lp("sess-v1", dispositivo_id, epk_c, spk, nonce_c, nonce_s, ts))` com a identidade fixada; `(c2s ‖ s2c) = HKDF(ecdh, transcrição, "xv/remoto/sessao", 64)`. Janela de `ts` de ±60 s e anti-replay do par (dispositivo, nonce).

**Canal de sessão** (vetor `canal_sessao`). AES-256-GCM, nonce de 12 bytes com o contador de 64 bits em big-endian nos 8 últimos, `AAD = "v1|<sid>|<n>"`; contador estritamente crescente por direção, só avança com quadro **autêntico**;
quadro repetido, fora de ordem ou adulterado **fecha a sessão**; teto de 16 KiB. O dispositivo revogado ou expirado deixa de autenticar a CADA quadro (não só no início da sessão).

## 5. Entrega do segredo de canal, revogação e pânico (`src/nucleo/remoto-estendido/{pareamento-relay,revogacao,servico}.ts`)

Depois do «Permitir», o celular abre uma sessão no canal efêmero e envia, **dentro do canal de sessão**, `{"t":"canal_segredo"}`. O host só responde (uma vez, dentro de 180 s) ao dispositivo pareado AGORA por este relay:
gera `S`, grava no cofre (`RELAY_CANAL_<hash do id>`, nunca no banco), registra `relay_canal` (só a última época; nunca `S` nem `canal_id`) e devolve `{"t":"canal_segredo","segredo":<b64>,"epoca":<n>}`. O canal efêmero morre no primeiro uso.
**Revogação em dois níveis:** (1) autoritativa no host (acima); (2) otimização: `desregistrar` no relay e apagar `S` do cofre. **Pânico:** fecha todos os sockets, cancela o pareamento, revoga todos os dispositivos e apaga os segredos.
«Esquecer este dispositivo» é uma mensagem do celular (`{"t":"esquecer"}`) que o host executa como revogação.

## 6. Integridade do cliente web (`pwa/{verificar,sw-fonte,assinar}.mjs/js`)

`manifesto-pwa.json` lista `arquivo → {sha256, tamanho}` e `versao`; é assinado com **Ed25519** (chave privada fora do repositório). O Service Worker embute a(s) chave(s) pública(s) e só instala um shell cujo manifesto tem assinatura
válida, `versao` maior que a instalada e **cada arquivo** conferido por tamanho e SHA-256; qualquer falha mantém o shell anterior. A tela mostra o hash do manifesto e do `sw.js` para comparação humana.

## 7. Mapa do código

| Assunto | Host | PWA | Testes |
|---|---|---|---|
| Protocolo do relay, prova de posse | `src/nucleo/relay/{protocolo,roteador,servidor}.ts` | `pwa/protocolo-cliente.js` | `src/nucleo/relay/*.test.ts` |
| Canal, envelope, padding | `src/nucleo/remoto-estendido/{canal,quadro,padding}.ts` | `pwa/{cripto,padding}.js` | `*.test.ts` ao lado; `tests/pwa/cripto.test.ts` |
| Pareamento, sessão, canal | `src/nucleo/remoto/protocolo.ts` | `pwa/cripto.js` | `src/nucleo/remoto/*.test.ts`; `tests/pwa/protocolo-cliente.test.ts` |
| Pareamento por relay, segredo, revogação | `src/nucleo/remoto-estendido/{pareamento-relay,revogacao,servico}.ts` | `pwa/protocolo-cliente.js` | `servico.test.ts`; `tests/pwa/pareamento-relay.integracao.test.ts` |
| Manifesto e Service Worker | — | `pwa/{verificar,sw-fonte}.js` | `tests/pwa/manifesto.test.ts` |
| Vetores e fuzz | — | — | `tests/scripts/vetores.test.ts`; `tests/fuzz/*` |
| Mutação das defesas | — | — | `tests/scripts/mutacao-relay.mjs` (lista em `mutacoes-relay.mjs`) |

## 8. O que NÃO é garantia

- **Não é um PAKE.** O código de 60 bits entra no HKDF junto do ECDH, mas a proteção contra quem **observa** o pareamento e depois tenta adivinhar `K` offline depende de a janela ser curta (120 s) e de o código ser de uso único; um PAKE (SPAKE2/OPAQUE)
  seria mais forte. Pede-se opinião explícita.
- **Metadados.** O relay vê IP, horário, tamanho aproximado do quadro (em blocos de padding) e o `canal_id` do dia (R-B). Não há anonimato de rede.
- **Primeira instalação do PWA** e **Service Worker trocado depois** não se resolvem por software (R-A, R-F); só um app nativo elimina. Mitigam: impressão digital comparável, SW com chave pinada, instalação pelo desktop.
- **Negação de serviço** por um relay malicioso é possível (R-C); leitura e forja não.
- **Celular roubado e desbloqueado** age dentro da permissão dele (`leitura`) até a revogação (R-E).
- Não há *forward secrecy* para o canal EXTERNO (invólucro): a chave vem de `S`; a confidencialidade de longo prazo vem da sessão interna (ECDH efêmero por sessão). Pede-se avaliar se vale rotacionar `S`.

## 9. Perguntas ao revisor

1. A composição `ikm = ecdh ‖ H("psk" ‖ K)` com `transcrição` como sal é adequada, ou convém um PAKE? 2. Separação de domínio: prefixos, rótulos de HKDF e AADs são suficientes? 3. Reuso da mesma chave P-256 do host para a prova
de posse do relay e para as assinaturas de sessão (domínios `relay-prova-v1` × `sess-v1`). 4. AES-GCM com `iv` aleatório de 96 bits no invólucro (limite de ~2^32 quadros por chave) e contador no canal de sessão. 5. Janela de ±1 época. 6. Entrega do
segredo por mensagem dentro da sessão. 7. Verificação do manifesto no SW (ordem das checagens, base64 não canônico). 8. Qualquer composição que permita a um relay ativo ler, forjar, repetir fora de ordem ou fazer um dispositivo revogado autenticar.

## 10. Critérios de aprovação e o que muda quando aprovar

**Aprovação** = relatório do revisor sem achado Alto/Crítico aberto na composição (§2–§6), com os achados Médios/Baixos corrigidos ou aceitos por escrito pelo dono, e os vetores atualizados e reproduzidos nos dois lados.
**O que muda:** só então se discute (decisão do dono, nunca automática) remover o rótulo «experimental», lembrar o reconhecimento entre ligações ou sugerir o relay no assistente de configuração. **Habilitar por padrão continua proibido**
mesmo com a aprovação: o relay é o do próprio usuário, sem endereço embutido, e nasce desligado a cada reinício. `ax34_nao_habilita_por_padrao` falha se qualquer um desses invariantes mudar; ao aprovar, a mudança passa por D-NN
e por este documento.
