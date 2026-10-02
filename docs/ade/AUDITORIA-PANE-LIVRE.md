# Auditoria: painel livre que orquestra ("Orquestrar neste painel")

Escopo: D-420 a D-428. Pedido de origem: "abre 6 agentes… e monta a matriz ICE em tempo real"; o Codex usou subagentes internos (invisíveis ao ADE) e nenhum terminal novo apareceu.
Método: leitura do caminho de criação do Pane, das portas do MCP e do renderer; cada achado abaixo tem teste que falha sem a correção.

## Causa raiz
1. O terminal aberto pela tela Terminais (`terminais:abrir`) nem tem linha de Pane: não passa pelo preparador, então não recebe token, Loja, hooks nem MCP. Só `abrirPane` prepara.
2. Mesmo um Pane livre só recebe `tools_allow: []` (ou `maestro_*`): `pane_spawn` existe só para o piloto de Missão orquestrada.
3. O renderer só enxergava sessões que ele mesmo abria: um worker aberto pelo main nunca entrava na grade.

## Achados de segurança (corrigidos e testados)
| # | Risco | Correção | Teste |
|---|---|---|---|
| A-1 | Escalonamento por MCP: ligar a opção poderia entregar a matriz do piloto agêntico (maestro, `account_switch`, `harness_set`, Loja, `mission_complete`) a um agente de terminal livre | `avulso` troca a matriz inteira por 10 tools; outra combinação papel/modo = nenhuma; opções extras (maestro, rag, mapa, memória, ágil, alertas) não somam | `nucleo/mcp/tools-avulso.test.ts` |
| A-2 | Painel livre SEM opt-in ganhando `pane_spawn` por efeito colateral | sem `avulso` nada muda; preferência do workspace nasce desligada e é reconferida em CADA spawn | `tools-avulso.test.ts`, `main/orquestracao-avulsa.test.ts` |
| A-3 | Agente abrindo agentes sem fim (recursão, custo) | worker só tem `handoff_submit` (profundidade 1); 8 por painel RECONFERIDO dentro da abertura serializada (a tool via estado de antes: rajada de 10 abria mais de 8); 16 por workspace; 12/minuto; teto de custo com bloqueio opt-in (P-80) | `orquestracao-avulsa-mcp.test.ts` (rajada de 10 = 8), `avulso.test.ts` |
| A-4 | Rajada de `pane_spawn` simultâneos (o caso do dono) corrompia a numeração `t-N`: 5 de 6 falhavam | aberturas do mesmo escopo são serializadas | `orquestracao-avulsa-mcp.test.ts` |
| A-5 | Prompt injection pelo retorno do worker (notícia/página no resumo) digitado no painel como se fosse o usuário | envelope `<dados_de_worker tipo="dados">`, controles e fecho forjado removidos, regra em texto; `pane_read` e instruções mandam tratar como dado; briefing marca o contrato como dado | `avulso.test.ts`, `orquestracao-avulsa.test.ts` |
| A-6 | Worker com permissão maior que a do painel / bypass total de sandbox | `min(painel, workspace)`; flags só pelo catálogo e só em `automatico`; nunca o bypass do Codex | `avulso.test.ts`, `orquestracao-avulsa.test.ts` |
| A-7 | Aprovação em massa: 6 pedidos de permissão seguidos levariam o dono a aprovar no automático | `permissions.allow` só para abrir/ler do próprio MCP; `pane_send` e `pane_close` seguem com aprovação | `hooks/claude-avulso.test.ts` |
| A-8 | Interruptor tocando Pane de Missão real, terminal comum ou CLI sem MCP | recusa nominal (`painel_de_missao`, `cli_sem_mcp`); preflight ANTES de encerrar a sessão | `main/painel-livre.test.ts` |
| A-9 | Renderer mandando caminho/executável/`cwd`/token ao abrir | validadores estritos: só ids do app e booleanos; erro de infraestrutura saneado | `main/ipc/painel-livre.test.ts` |
| A-10 | Painel fechado deixando workers e token vivos | fechar/desligar/abortar fecha os workers, revoga o token e aborta a Missão; Missão encerrada não aceita piloto novo | `orquestracao-avulsa.test.ts`, `painel-livre.test.ts` |
| A-11 | A Missão avulsa bloqueando uma Missão de trabalho ("uma Missão por árvore") | `criarServicoMissoes` ignora Missões marcadas como avulsas | `main/painel-livre.test.ts` |
| A-12 | Segredo/caminho vazando | token só no `mcp.json` 0600 e no ambiente (nunca em argv); caminhos gravados relativos; absoluto só no prompt inicial de worker em worktree | `orquestracao-avulsa.test.ts` |

## Orquestrador de verdade (D-510 a D-517): novos riscos
| # | Risco | Correção | Teste |
|---|---|---|---|
| A-13 | Prompt de orquestrador CONTORNADO: a CLI ignora a instrução e faz o trabalho ou usa subagentes internos | defesa em camadas por sessão: instrução em canal de SISTEMA + proibição técnica dos subagentes (deny `Agent`/`Task`, `--disable multi_agent`, `permission.task`, `--no-subagents`) + negação de edição quando a CLI permite; selo honesto na UI quando só a instrução vale | `canal-orquestrador.test.ts`, `orquestracao-orquestrador.test.ts` |
| A-14 | Deny de `Task` insuficiente (tool renomeado para `Agent`) ou inofensivo para o MCP | os dois nomes entram no deny; `permissions.allow` do MCP do app não é afetado; `--disallowedTools` NÃO é usado (variádico engoliria o prompt posicional) | `canal-orquestrador.test.ts`, `claude-avulso.test.ts` |
| A-15 | Orquestrador editando o repositório pelo shell (o app não prova que um comando não grava) | residual ACEITO e dito na UI: `bash` nunca é negado (quebraria leitura e `git status`) e segue com as aprovações normais; Codex ganha sandbox somente-leitura (exceto no modo automático, onde conflita com `--approve-for-me`) | `canal-orquestrador.test.ts` (selo `parcial`), UI |
| A-16 | Ponte do Grok escrevendo no repositório do dono sem autorização, sobrescrevendo arquivo dele, vazando segredo ou escrevendo através de link | só com o diálogo que mostra o arquivo exato; `wx` (nunca sobrescreve; `bloqueada` se já existe); `.grok` link simbólico/fora do projeto recusado; conteúdo SEM segredo (`${VAR}`; URL e token por painel no AMBIENTE, nunca no argv nem no disco); marca na primeira linha e remoção só do que tem a marca; removida ao desligar/fechar o último Grok orquestrador; nada em `~/.grok` | `ponte-grok.test.ts`, `painel-livre.test.ts`, `orquestracao-orquestrador.test.ts`, `ipc/painel-livre.test.ts` |
| A-17 | Renderer escolhendo caminho/conteúdo da ponte ou ligando o opt-out por texto livre | `painel_livre:ponte_grok` só aceita a ação (enum); `orquestrador_edita` é booleano estrito; campo extra recusado | `ipc/painel-livre.test.ts` |
| A-18 | Sem "Orquestrar" o app mudar o comportamento das CLIs (flag nova, instrução, arquivo) | o canal só existe em `prepararAvulso`; painel livre comum, Pane de Missão e worker não passam por ele | `orquestracao-orquestrador.test.ts` ("sem Orquestrar nada muda", 4 CLIs) |
| A-19 | Fechar o orquestrador por engano matando N agentes em andamento | confirmação "Encerrar também os N agentes?" (Cancelar mantém tudo); fechar worker/aba é direto | `orquestrar.test.tsx` |

## Causa do 143 e ciclo de vida do worker (D-520 a D-527)

Relato do dono: "abra 3 agentes em paralelo, cada um responde uma linha com o seu número e a hora": os 3 workers começaram, depois apareceram "Sessão encerrada, código 143" e o orquestrador não achou texto.

**Causa CONFIRMADA (evidência no banco real, cópia somente leitura, só metadados).** Piloto `grok`, 3 workers `claude`: handoffs `ok` às 18:07:34,873 / 38,140 / 39,105 (UTC) e os três Panes `encerrado` com motivo `handoff_done` às 18:07:36,385 / 39,644 / 40,616: exatamente 1,5 s depois de cada entrega (atraso padrão de `fecharDepois`). Tasks `entregue`, Missão `executando`, piloto vivo, nenhum outro evento de fechamento. Ou seja: o 143 era o app encerrando, por SIGTERM, quem já tinha entregue; a sessão ficava na grade e depois sumia do daemon (por isso `pane_read` vinha vazio). Hipóteses (i) a (v) do pedido descartadas na evidência (ver D-520).

| # | Risco | Correção | Teste |
|---|---|---|---|
| A-20 | Fechamento do app deixava o painel pendurado como falha ("código 143") | `fecharPelaApp`: evento `fechada` (sai da grade na hora, grade reflui) + SIGINT→SIGTERM→SIGKILL + descarte; `encerramento.solicitado` zera o código na UI | `sessoes.test.ts`, `estado/terminais.test.ts`, `ciclo-worker.test.tsx`, `orquestracao-ciclo-worker.test.ts` |
| A-21 | Saída do worker sumia com a sessão (orquestrador "sem texto na tela") | cauda de 16 KB (ANSI-limpa, redigida) em memória por 10 min; `pane_read`/`pane_list`/`handoff_read` | `orquestracao-ciclo-worker.test.ts` |
| A-22 | Segredo na cauda guardada | scrubber do cofre (se aberto) + `redigirSegredos` ANTES de cortar; só memória, apagada ao encerrar a orquestração; teste varre disco e banco | `ciclo-worker.test.ts`, `orquestracao-ciclo-worker.test.ts` |
| A-23 | Worker/outro orquestrador fechando painel alheio | `pane_close` só do orquestrador dono (worker recusado; escopo da Missão do token) | `regras.test.ts`, `orquestracao-ciclo-worker.test.ts` |
| A-24 | CLI que ignora SIGTERM ficando órfã no daemon | escalada até SIGKILL com prazos curtos; descarte só depois | `sessoes.test.ts` |
| A-25 | Falha real escondida (painel que fecha sozinho ou erro engolido) | código ≠ 0 não pedido mantém o painel ("Falhou (código N)"), chip no orquestrador, aviso por wake, `last_output`; handoff `falhou` nunca fecha; 60 s sem interação fecha | `orquestracao-ciclo-worker.test.ts`, `ciclo-worker.test.tsx` |
| A-26 | Fechar antes de o relatório existir | o fechamento automático só roda depois do handoff persistido (ordem relatório → banco → wake intocada); prompt manda ler antes de fechar | `handoff.test.ts`, `canal-orquestrador.test.ts` |

Limites desta parte: a cauda guardada pode estar incompleta se o worker produziu mais de 5 000 linhas (o leitor mantém esse scrollback); o aviso de falha entra quando o orquestrador está ocioso (ponto seguro do wake); e2e escrito e não executado nesta etapa (exige `npm run build`).

## Limites conhecidos (não corrigidos de propósito)
- Codex/OpenCode não têm `permissions.allow` por Pane: o dono aprova cada chamada do MCP nas aprovações da CLI (D-14). Seguro por padrão, mais cliques.
- Sem `resume` (CLI sem retomada ou pasta diferente) o painel reabre com sessão nova e o aviso aparece no painel.
- Se a abertura da sessão nova falhar DEPOIS de a antiga ser encerrada, o painel mostra "Sessão encerrada"; o preflight cobre as falhas previsíveis.
- O e2e `tests/painel-livre.e2e.test.ts` está escrito mas só roda com build pronto e sem o `npm run dev` do dono ativo.
- Grok: a ponte (D-514) segue a documentação instalada e foi validada só offline (`grok mcp list`/`inspect` leem o arquivo de projeto); depende de o Grok confiar na pasta do projeto e ainda precisa de um teste com o Grok real autenticado (pendência do dono: rodar uma vez com a ponte ligada). `--deny Edit` no TUI idem. Enquanto isso o selo é `parcial`.
- Gemini, Aider, Qwen e Kilo não orquestram (sem MCP por sessão sem editar configuração do usuário). Candidatos documentados em D-513; nada implementado sem evidência.
- O sandbox somente-leitura do Codex e a negação de edição do Claude/OpenCode não cobrem o shell; o selo diz.
- Em janela muito pequena o layout manda workers para outra aba (mínimo 320×160); o aviso é a aba nova com o rótulo `↳ orq.`.

## Correção: disparo do método abria o Pane sem o comando (D-620)

**Relato:** workspace novo, "Nova feature" mostrou "enviado ao Pane"; na tela Terminais havia um Pane vazio.

**Evidência (somente metadados, cópia do banco apagada):** o workspace tinha exatamente 1 Pane (`tipo=cli`, `cli=claude`, `papel=nenhum`, `mission_id=null`, `estado=pronto`, `sessao_pty_id` preenchido, nunca encerrado), criado 1 s depois de o workspace existir; a sessão do daemon estava `executando` e o histórico tinha 5,5 KB (a CLI rodou e imprimiu: não é CLI ausente nem falha de exibição). O argv da sessão tinha `--mcp-config` e `--settings` do Pane (ou seja, o preparador de orquestração devolveu um preparo).

**Causa:** `criarServicoPanes.abrirPane` só repassava `prompt_inicial` à sessão quando `preparo === null`. Todo Pane com MCP/settings (todo Pane livre com a Loja/Maestro/gate) tem preparo, que não embute o prompt (só piloto/worker embutem): o `/expx:sprintx …` era descartado em silêncio, a CLI abria limpa e ociosa, e `metodo:disparar` respondia `ok: true` só porque o Pane foi criado. Hipóteses descartadas: corrida de prontidão (o comando nunca foi escrito; o caminho é argv), adoção no renderer (a sessão existia e estava viva), CLI ausente.

**Correção:** `prompt_embutido` no preparo (só o do piloto/worker o declara) e `estado`/`entrega` no resultado, com espera curta para detectar CLI que sai na largada. Testes: `src/nucleo/missoes/panes.test.ts` e `src/nucleo/metodo/missao.test.ts` ("entrega confirmada do comando").
