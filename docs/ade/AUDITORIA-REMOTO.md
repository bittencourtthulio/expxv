# Auditoria — Fase 13, onda 1 (Jarvis por texto e controle remoto local)

Revisão do código novo contra `AMEACAS-REMOTO.md`: autenticação, replay, CSRF/DNS rebinding no servidor local, escalonamento de privilégio por prompt injection, vazamento por saída e DoS.
Método: leitura dirigida pelos casos AR-01..AR-28, testes adversariais nomeados (`src/nucleo/remoto/adversarial.test.ts`) e **harness de mutação sem dependência nova**
(`node tests/scripts/mutacao-fase13.mjs`; consistência da lista em `tests/scripts/mutacao-fase13.test.ts`). Resultado da execução completa: **35/35 mutantes mortos** (a 1ª execução deixou 1 vivo, AR-17e).

## Achados e correções (todos corrigidos e testados)

| # | Achado | Gravidade | Correção | Prova |
|---|---|---|---|---|
| A-01 | **Mutante vivo AR-17e**: o teste de replay do pedido de sessão reaproveitava o mesmo nonce, então o anti-replay mascarava a checagem da janela de tempo (`ts` ±60 s) | Média (defesa existia, mas sem prova) | testes com nonce novo por caso de `ts` fora da janela | `protocolo.test.ts` (replay do pedido); mutante AR-17e morto |
| A-02 | Limite de **30 req/min por IP** valia também para o `/v1/canal` já autenticado: um uso normal (envio + consultas) seria estrangulado e o limite viraria negação de serviço contra o próprio dono | Média (DoS auto-infligido) | dois tetos: 30/min nas rotas sem autenticação e 240/min no canal; o limite fino é 120/min **por dispositivo** | `servidor.test.ts` (flood sem auth; canal folgado), mutante AR-16 morto |
| A-03 | `resolverConfirmacao` varria as vencidas **antes** de resolver: uma confirmação expirada virava "inválida" e perdia o motivo (e a limpeza do plano preso dependia do caminho) | Baixa | a expiração é decidida pelo próprio armazém atômico; o plano proposto é cancelado nos dois caminhos | `servico.test.ts` ("negar, expirar…"), `confirmacao.test.ts` |
| A-04 | Erro emitido pelo servidor **depois** de `listen` ficaria sem ouvinte (`once("error")`) e derrubaria o processo main | Média (disponibilidade do app) | `on("error")` permanente; porta ocupada continua tipada | `servidor.test.ts` (porta ocupada) |
| A-05 | Na tela, o código de pareamento era apagado no mesmo instante em que aparecia (a leitura de estado ainda dizia "não pareando"), e podia reaparecer depois de usado | Baixa (UX/segurança do código "uma vez") | o código só some ao expirar, ao ser usado ou cancelado, depois de **visto aberto** no estado | `Tela.test.tsx` ("o código aparece uma vez e some ao expirar") |
| A-06 | `jarvis:confirmar` aceitava qualquer origem de resolução no armazém; voz/remoto/conteúdo externo não podem confirmar | Alta se existisse | só `ui` e `desktop` resolvem; tentativa de outra origem **não** queima a confirmação legítima | `confirmacao.test.ts`, `ar05_confirmacao_uso_unico`, mutante AR-05a morto |
| A-07 | Texto do prompt voltava ao Maestro com controle/bidi/ANSI e segredo | Alta se existisse | `textoSeguro`: sanitiza, redige (cofre/chaves) e corta em 2 000 antes de formar a ação | `acoes.test.ts`, `ar19_sem_segredo_em_auditoria` |

## Verificações sem achado

- **Autenticação**: dispositivo revogado/expirado nunca autentica (conferido **a cada requisição**, não só ao abrir a sessão); assinatura do dispositivo e do servidor; nonce anti-replay; `ts` ±60 s. Mutantes AR-17a..e mortos.
- **Replay**: quadro repetido/menor/adulterado/com `sid` trocado/refletido fecha a sessão; um quadro falso não "queima" o contador. AR-11 morto.
- **CSRF/DNS rebinding**: `Host` exato, `Origin` mesma-origem, `Content-Type: application/json`, sem CORS, `OPTIONS` = 404; 404 idêntico (sem versão, sem nome do produto). AR-09/10 mortos.
- **Escalonamento por prompt injection**: conteúdo externo nunca é interpretado; a LLM só devolve uma ação validada e nunca o texto; gesto proibido barrado antes de tudo; portão humano barrado na proposta **e** na execução; plano reavaliado (TOCTOU). AR-01/03/04/05/06 mortos.
- **Vazamento por saída**: auditoria e histórico redigidos; resumo de painel sem cauda bruta (só rótulo/estado do banco), 300 caracteres, `nao_confiavel`; tela usa JSX (HTML de terminal vira texto, testado em jsdom); identidade só no cofre; nenhuma coluna de segredo de dispositivo. AR-19/20 mortos.
- **DoS**: corpo ≤ 16 KiB (413), 4 conexões, `requestTimeout` 10 s, 8 sessões, taxa por IP e por dispositivo, bloqueio do IP após 5 pareamentos falhos, erro do servidor não derruba o app. AR-16 morto.
- **Sockets**: desligado = 0 sockets (`tests/perf/jarvis.perf.ts`, `servidor.test.ts`); `encerrar()` fecha tudo; reiniciar o app deixa desligado (`servico.test.ts`); só `servidor.ts` escuta (`servidor-remoto-fronteira.test.ts`).

## Não corrigido por decisão (vai ao dono; texto em `AMEACAS-REMOTO.md` §7)

R1 (cliente web e atacante ativo na rede; **não há cliente web nesta onda**), R2 (composição criptográfica sem auditoria externa), R3 (pareamento não é PAKE: palpite offline do código contra `conf_s` por quem fale com o servidor durante a janela de 120 s), R4 (dispositivo `mensagem_direta` desbloqueado age até a revogação), R5 (túnel do usuário e outros processos locais em loopback).
Achados menores aceitos: enumeração de ids de dispositivo por tempo de resposta (96 bits de id: inviável) e negação do pareamento por quem esteja na LAN com a janela aberta (120 s, sob olhar do dono; o IP é limitado e bloqueado).

## Conformidade com `DECISOES-DAS-PENDENCIAS.md` (opção mais completa) e o que ficou de fora desta onda

Segurança como **padrão inicial, não teto**: o usuário pode ligar loopback/túnel, nomes extras de Host, CGNAT e a LLM classificadora (todos opt-in com consentimento) e subir permissões por dispositivo.
Pendências de implementação (nada disso é segurança; o padrão seguro já vale):

- **Cliente web móvel** (`src/main/remoto-cliente-web/**`, T-13.17): não feito; o cliente de referência está em `tests/fixtures/jarvis/cliente-remoto.ts`. Decisão do dono sobre app nativo (R1) antecede.
- **Voz como entrada do Jarvis** (Fase 11 → `DestinoFala`) e TTS: a Fase 11 está em andamento; o Jarvis já aceita `origem: "voz"` como fala do usuário no núcleo (nunca confirma). Ligar exige editar arquivos da Fase 11.
- **Foco exato do painel** em `abrir_pane`: hoje o renderer só leva à tela Terminais (a tela não expõe foco programático por `display_id`).
- **Sinaleira/contexto por diferenças (P-61/P-62)** e **realtime remoto (P-60)**: não se aplicam (Jarvis por texto; sem adaptador realtime, D-71).
- **P-66 (memória no app) e P-69 (peso no JS)** e o **e2e** (`tests/jarvis.e2e.test.ts`, escrito e type-checado, não executado: exige `npm run build`).
- **Item "Desligar controle remoto" na bandeja e indicador no rodapé**: a bandeja foi ligada (`remotoDesligar`); o indicador `● remoto · N` no rodapé usa o estado de `remoto:estado` e fica como melhoria da onda de integração.
