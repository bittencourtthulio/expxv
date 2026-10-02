# Auditoria de segurança do Bench (Fase 12, T-12.25) — onda 1

Escopo: núcleo (`src/nucleo/bench/**`), ligação (`src/main/bench*.ts`, `src/main/ipc/bench.ts`), preload e UI (`src/renderer/telas/bench/**`).
Método: leitura do código contra os quatro eixos pedidos, ataque por teste (cada achado tem teste que FALHA sem a correção) e execução com a CLI falsa
(`tests/fixtures/cli-bench.mjs`) sob o `sandbox-exec` REAL do macOS. Nenhuma chamada paga, nenhuma rede. Testes: `src/nucleo/bench/auditoria.test.ts`,
`servico.test.ts`, `sandbox/macos.test.ts`, `execucao/*.test.ts`, `src/main/ipc/bench.test.ts`.

## Resultado

| # | Eixo | Severidade | Achado | Estado | Prova |
|---|---|---|---|---|---|
| D-04 | escrita fora da pasta | **alta** | `limparExecucoes(runId)` fazia `rmSync(join(exec, runId), {recursive})` SEM validar o id: `limparExecucoes("../..")` apagava a pasta de dados do app (a validação de `limparRun` não protegia a segunda remoção) | **corrigido**: id só no formato `brun_…` (senão erro) e uma única remoção, dentro de `exec/` | `auditoria.test.ts › A-05` (`..`, `brun_/../..`, `/`, vazio lançam; pasta de dados e vizinhas intactas) |
| D-12 | execução isolada | média | o juiz roda em modo somente leitura e o perfil do sandbox NÃO reabria a leitura do próprio `cwd` (dentro da pasta de dados, negada): a CLI real abortaria com `uv_cwd: EPERM`; a CLI falsa engolia o erro e o teste do serviço (juiz injetado) nunca exercitou o caminho | **corrigido**: o workdir é sempre reaberto para leitura quando está sob caminho negado | `macos.test.ts` (perfil) e `auditoria.test.ts › D-11` (juiz padrão ponta a ponta, sem erro de registro) |
| D-11 | execução isolada | média | o juiz padrão criava a pasta `_juiz`, mas o validador de segmento recusava `_` inicial: o julgamento real sempre falharia | **corrigido**: `_logs`/`_juiz` são pastas internas (slug de usuário nunca começa com `_`) | `auditoria.test.ts › D-11` |
| A-04 | execução isolada | média | o `PATH` do filho era copiado do pai: uma entrada vazia ou relativa (`.`) resolveria executável a partir do `cwd` (o workdir), onde o código gerado poderia plantar um `claude`/`node`/`git` falso | **corrigido**: `sanearPath` mantém só entradas absolutas | `auditoria.test.ts › A-04` (unidade + integração: o `plantado` NÃO roda) |
| B-04 | segredo nos resultados | **alta** | a conta dedicada guarda a credencial da CLI em seu config dir (legível pelo filho, por necessidade): código gerado poderia copiá-la para um artefato, que a UI lia como estava, o relatório citava e o PACOTE DO JUIZ enviava a outro provedor | **corrigido**: texto de artefato sai com segredo e caminho absoluto redigidos na leitura da UI; o pacote do juiz passa por `redigirSegredos` antes de sair | `auditoria.test.ts › B-04` |
| B-11 | segredo nos resultados | média | julgar envia os arquivos entregues ao provedor do JUIZ (que pode ser outro além dos executores) sem aviso | **corrigido**: a estimativa de julgamento avisa o provedor/modelo que receberá os arquivos (e que nome de modelo, CLI e caminho foram removidos) | `auditoria.test.ts › D-11` |
| C-02 | custo sem confirmação | média | com custo conhecido e sem teto, uma Run podia ter até 50 × 50 pares | **corrigido**: teto DURO de 100 execuções por Run; acima disso a estimativa não oferece a frase de consentimento | `auditoria.test.ts › C-02` |
| A-03 | execução isolada | informativo | symlink de DIRETÓRIO dentro do workdir (`ponte -> /fora`) para ler fora | **já protegido** (`lstat` + `realpath` contra a raiz); teste de regressão adicionado | `auditoria.test.ts › A-03` |
| B-01 | segredo nos resultados | informativo | ambiente do filho por allowlist, sem `*_TOKEN/*_KEY/*_SECRET`, sem `SSH_AUTH_SOCK`, sem token do app; valor do cofre reconhecido pelo scrubber é descartado | **já protegido** | `auditoria.test.ts › B-01`, `macos.test.ts` |
| B-06 | segredo nos resultados | informativo | log lido pela UI, nota, aviso e relatório passam por redação de segredo e de caminho absoluto | **já protegido** | `servico.test.ts › leitura segura`, `auditoria.test.ts › B-06` |
| C-01 | custo sem confirmação | informativo | nenhum caminho inicia Run, re-run ou julgamento sem token de uso único (TTL 120 s) atrelado à estimativa, à finalidade e às VERSÕES das tarefas/alvos | **já protegido**; teste espiona `spawn` e a chamada ao juiz: token forjado, finalidade errada, estimativa inexistente e expirado ⇒ 0 spawns e 0 chamadas | `auditoria.test.ts › C-01`, `servico.test.ts › consentimento`, `consentimento` (puro) |
| C-03 | custo sem confirmação | informativo | sem retentativa automática | **já protegido** | `auditoria.test.ts › C-03` |
| C-04 | custo sem confirmação | informativo | o MCP não tem nenhuma referência ao Bench: agente não inicia, re-roda nem julga (D-68) | **já protegido** | `auditoria.test.ts › C-04` |
| D-01 | escrita fora da pasta | informativo | sandbox do macOS: escrita só no workdir/tmp/HOME e config da conta; leitura negada a credenciais, perfis de navegador e à pasta de dados do app | **já protegido** (teste real, macOS) | `macos.test.ts`, `servico.test.ts › ESCAPE`, `auditoria.test.ts › D-01` |
| D-02 | escrita fora da pasta | informativo | o serviço só sugere um NOME de arquivo para o relatório; o destino vem do diálogo do sistema (main) | **já protegido** | `auditoria.test.ts › D-02` |
| D-03 | escrita fora da pasta | informativo | tudo que o serviço cria fica em `<pasta do Bench>/exec`, `<pasta de dados>/contas/<id>` (home da conta) e `perfis` | **já protegido** | `auditoria.test.ts › D-03` |

## Riscos residuais (declarados no diálogo de consentimento ou na UI)

1. **Rede aberta no sandbox.** A CLI precisa falar com o provedor, então o código gerado também poderia sair para a rede. Mitigação: nada sensível acessível
   (credenciais negadas, ambiente limpo, conta dedicada, pasta de dados do app negada). O diálogo diz isto. Filtro de rede fica como melhoria futura.
2. **`tmp` do sistema é gravável** dentro do sandbox (Node, Claude Code e `node --test` precisam). Execuções simultâneas poderiam ver o `tmp` uma da outra.
3. **Mesma conta dedicada em dois alvos** compartilha HOME/config (a CLI roda com `--no-session-persistence`, mas o login é um só). Recomendar uma conta por alvo.
4. **Windows sem sandbox** (P-38): permitido só com a frase reforçada `RODAR SEM SANDBOX`; `isolamento: parcial` no resultado e selo "harness parcial" na comparação.
   Linux: sandbox indisponível, a Run é recusada.
5. **Overshoot do teto de custo**: `teto_usd` impede lançar pares NOVOS depois que o custo conhecido estoura; as execuções já em andamento (até `max_paralelo`, teto 5) terminam.
6. **Codex** usa o sandbox da própria CLI (`workspace-write`, sem o bypass total, D-14); as flags reais são [LAC] e só uma validação real mínima (P-37) as confirma. As checagens
   automáticas (código gerado) rodam SEMPRE sob o `sandbox-exec`, mesmo para resultados do Codex.

## O que NÃO foi validado por falta de CLI real

Adaptadores `claude` e `codex` verificados só contra saídas gravadas e um `--help` simulado (P-37 continua pendente: uma Run real barata com consentimento do dono).
A captura do artefato web em `BrowserWindow` offscreen (T-12.14), `opens_without_console_error`, as tools MCP somente leitura (T-12.21) e P-51/P-53/P-56/P-58 dependem do
Electron real ou do bundle e não entraram nesta onda; o e2e (`tests/bench.e2e.test.ts`) está escrito e type-checado, não executado (exige `npm run build`).
