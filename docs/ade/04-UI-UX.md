# UI e UX

Mesma família visual do ExpxMedia, para os dois parecerem do mesmo ambiente. Tudo respeita os
orçamentos de `03-ORCAMENTOS-DESEMPENHO.md`.

## Casca

```
┌────┬───────────────────────────────────────────────────────────────┐
│ ▣  │ topo (64 px): workspace atual ▾ · busca/paleta ⌘K · alertas   │
│ ⌂  ├───────────────────────────────────────────────────────────────┤
│ ◎  │                                                               │
│ ▦  │                    área da tela ativa                         │
│ ◈  │                                                               │
│ ▤  │                                                               │
│ ⚙  ├───────────────────────────────────────────────────────────────┤
│ v  │ rodapé (40 px): sinaleira global · painéis · missões · versão │
└────┴───────────────────────────────────────────────────────────────┘
```

- Menu lateral **recolhido por padrão (76 px)**; abre a 232 px **por cima** com hover/foco de
  teclado; "fixar" empurra o conteúdo. Transição de largura só sem `prefers-reduced-motion`.
- Topo e rodapé com fundo **sólido** (sem `backdrop-filter`).
- Navegação por estado, sem roteador. Telas pesadas em `React.lazy`; as 4 últimas visitadas ficam
  montadas e ocultas; **Terminais fica sempre montada** (senão perde o estado visual).
- Breakpoints 560/640/1000/1250 px; largura mínima 720 px (app desktop).

## Menus e telas

| Menu | Tela | Fase | O que tem |
|---|---|---|---|
| Início | Hoje | 5 | missões ativas, o que aguarda você, bloqueios, últimos eventos do método |
| Missões | Quadro | 2–4 | lista e quadro por estágio; criar Missão (free/squad/agêntica; feature/ocorrência/pedido); detalhe com Panes, cards e handoffs |
| Terminais | Grade | 1–3 | abas, divisão em árvore, piloto à esquerda + workers à direita, orquestrador + workers (D-515), sinaleira, busca, paleta |
| Método | Método | 4 | conversa de pedido, violações, instalação da suíte, saúde, hooks e modos |
| Trabalhos | Trabalhos | 4 | portfólio dos trabalhos (sprintx/runx/prodx/buildx): resumo, filtros, colunas por estágio ou linha do tempo; detalhe com plano, quadro, grafo e rastro |
| Workspaces | Projetos | 2 | abrir pasta, recentes, git/worktrees, acesso externo, modo de permissão |
| Provedores | CLIs e contas | 2 | CLIs detectadas, versão, contas, executável manual, diagnóstico |
| Configurações | — | 5 | tema claro/escuro, destaque, atalhos, limites, scrollback, atualização |
| (pós-MVP) | Catálogo, Memória, Limites, Bench, Voz | 6+ | ver `06-FASES.md` |

## Navegação agrupada

Com 23 telas, o menu plano ficou longo demais. A barra lateral agora tem **7 grupos de topo, por tarefa
do usuário**, expansíveis. Cada tela pertence a **exatamente um** grupo (campo `grupo` em
`src/renderer/casca/telas.ts`; ids de tela inalterados; um teste confere a cobertura).

| Grupo | Telas | Critério |
|---|---|---|
| Trabalho (aberto por padrão) | Início, Missões, Terminais, Pipelines, Squads | o que se usa todo dia para pedir e acompanhar trabalho |
| Código | Método, Trabalhos, Versionamento, Mapa do código | o repositório e o que o método grava nele |
| Contexto | Memória, Conhecimento, Chat | o que os agentes sabem e como se conversa com isso |
| Gestão | Gestão ágil (inclui Board), Relatórios, Alertas | acompanhar andamento e pendências |
| IA e consumo | Provedores, Harness, Consumo (inclui Custo), Bench | CLIs, contas, limites, custo e comparação |
| Extensões | Loja de MCPs, Catálogo, Jarvis (acesso remoto) | o que se acrescenta ao app e como se chega a ele de fora |
| Sistema | Workspaces, Configurações | projetos e ajustes |

O grupo "Conhecimento" do plano original virou **Contexto** para não repetir o nome da tela Conhecimento
(dois botões com o mesmo nome confundem leitor de tela). Captura e voz não são telas: ficam em
Configurações e na paleta.

**Comportamento**
- Cabeçalho do grupo: ícone, rótulo, contagem de telas e chevron; sub-itens indentados. Padrão
  disclosure (WAI-ARIA): `aria-expanded`, `aria-controls`.
- Estado aberto/fechado, telas fixadas e modo só-ícones persistem em `localStorage`
  (`casca.menu.v1`, validado ao ler; sem canal de IPC novo, como os filtros do Board).
- O grupo da tela ativa abre sozinho a cada pedido de tela (clique, paleta ⌘K, atalho), inclusive se
  a pessoa o recolheu e a tela já era a ativa. Grupo fechado com a tela ativa mostra a barra de destaque.
- Teclado: ↑/↓/Home/End percorrem cabeçalhos e itens visíveis; → expande (e, expandido, entra no
  primeiro item); ← recolhe (ou volta do item ao cabeçalho); Enter/Espaço ativam; **P** fixa/desafixa
  a tela focada.
- Fixados: até 3 telas no topo (a quarta tira a mais antiga); botão de alfinete aparece em hover/foco
  na linha, sem ocupar espaço.
- Selos (hoje: alertas não lidos) agregam no cabeçalho do grupo fechado (soma; vermelho se houver
  crítico) e voltam ao item quando o grupo abre. Texto equivalente para leitor de tela.
- Modo **Só ícones** (botão no rodapé do menu): o menu não abre ao passar o mouse; o ícone do grupo
  abre um flyout com os sub-itens (Esc fecha e devolve o foco). "Fixar menu" continua empurrando o
  conteúdo e mostra os grupos expandidos.
- Busca ⌘K lista **todas** as telas ("Ir para X", com o grupo como detalhe).
- Estilo: D-32 (linhas de 28–30 px, 12 px), destaque D-31, só tokens CSS, tema claro/escuro; a
  animação (entrada dos sub-itens, giro do chevron) dura `--duracao` e some com `prefers-reduced-motion`.

## Sub-navegação lateral

Regra do dono: tela com várias abas/menus **não** tem abas em cima. Cada uma tem a sua própria sidebar à esquerda, dentro do conteúdo, sempre. O menu principal da casca não muda.

- Componente único: `src/renderer/componentes/SubNavegacao.tsx` (+ `subnavegacao.css`, lógica pura em `subnavegacao-logica.ts`). API: `<SubNavegacao base rotulo itens={[{ id, rotulo, icone?, selo?, grupo? }]} ativo onMudar recolhivel? barra? classePainel?>{painel}</SubNavegacao>`. `barra` leva os controles/filtros da tela (acima do painel, fora do `tabpanel`).
- Padrão ARIA único: `tablist` com `aria-orientation` (vertical; horizontal só no fallback < 720 px) + `tab`/`tabpanel` (`idAba`/`idPainel`), ativação automática, tabindex roving, ↑/↓ (e ←/→), Home/End, foco visível. `selo` = contagem; `grupo` = título de seção (itens consecutivos).
- Layout: coluna de 216 px (compacta, item >= 34 px, rolagem própria, sticky), painel ocupa 100% do resto, sem max-width. `recolhivel` adiciona o botão de recolher para só ícones (lembrado por tela em `localStorage`, com try/catch). Janela < 900 px: só ícones; < 720 px: lista no topo. Item sem ícone mostra a inicial (via CSS, sem alterar o texto do `tab`). Variante `subnav-aninhada` (156 px) para sub-seções dentro de um painel.
- Só tokens de cor; `prefers-reduced-motion` respeitado; contrato `src/renderer/telas/sub-navegacao-contrato.test.ts` proíbe `role="tablist"`/`role="tab"` próprios nas telas (exceção: `terminais/`, abas de Panes aprovadas, D-32).

Inventário (telas convertidas; id de aba e deep links preservados):

| Tela | Seções na sidebar |
|---|---|
| Gestão ágil | Painel, Backlog, Sprint, Daily, Retro, Qualidade, Config |
| Consumo | Visão geral, Previsão e eficiência, Trocas, Detalhe por uso, Fontes e preços |
| Harness | Política, Equivalência, Contas e limites, Decisões, Cofre |
| Alertas | Alertas, Regras, Canais, Modelos, Auditoria |
| Jarvis | Conversa, Controle remoto, Relay, Auditoria |
| Pipelines | Pipeline, Intenção, Etapas, Rigidez, Provedores |
| Mapa | Grafo, Camadas, Fluxo, Hotspots, Entradas, Dados, Dívida |
| Conhecimento | Grafo, Lista, Fontes, Aprendizados, Backend, Config |
| Memória | Escopos (Pane, Missão, Squad, Projeto) e Geral (Preferências, Saúde) |
| Relatórios | Pacotes, Revisão, Divulgação, Config |
| Catálogo | Skills, Agentes, Comandos, MCPs, Plugins, Hooks, Regras |
| Método | Pedido (padrão), Violações (selo), Instalação, Saúde |
| Trabalhos | sem sub-navegação própria; o detalhe abre num painel à direita e tem a sub-navegação aninhada Plano, Quadro, Grafo, Rastro |
| Versionamento | Mudanças, Branches, Histórico, PRs, Conflitos; dentro de Branches (aninhada): Branches, Tags, Stash, Worktrees; SVN: Branches, Tags |
| Missões | Quadro, Lista, Board |
| Configurações | grupos Aparência, Terminais, Avisos e atalhos, Recursos, Sistema (11 seções, uma por painel) |

Fora do escopo (não são navegação por seções): abas de Panes e Grade/Abas da tela Terminais; filtros em chips (`aria-pressed`) de Squads e Bench; Loja de MCPs (lista única com filtros, sem abas); grupos de rádio de Chat, Workspaces e Pipelines.

## Listas de entidades (D-694: padrão único)

Toda lista de entidades (MCPs, provedores, skills, contas, workspaces…) usa `componentes/ItemLista.tsx`
(`lista-padrao.css`, classes `lst-*`): uma entidade por linha com hierarquia **nome ≫ descrição ≫ selos**,
coluna de meta em mono discreto e UMA ação de largura estável (84 px). Linha de 56 px (38–40 px `densa`);
seleção por barra de destaque à esquerda + `aria-pressed`; corpo inteiro abre o detalhe; teclado de lista
(↑/↓/Home/End roving) continua com a tela. Abaixo de 900 px: a meta some (segue no detalhe) e os selos
quebram linha em vez de cortar; nunca scroll horizontal. Origem visual: a linha da Loja de MCPs.

## Terminais

### Área de trabalho máxima (pedido do dono — requisito de primeira classe)

O que importa na tela Terminais é a área dos terminais. O cromado ao redor é mínimo e compacto:

- **Uma única linha de controles** no topo da tela (altura ≈ 28 px): abas pequenas, `+` (novo), dividir,
  buscar, contador "N aguardando" e ações — tudo na MESMA linha, nunca em duas ou mais linhas.
- **Abas pequenas**: ícone da CLI 12–14 px + rótulo curto em 11 px, altura 24–26 px, sem paddings
  grandes; overflow com rolagem horizontal sem barra (não quebra linha).
- **Botões de ícone** 20–24 px (só ícone + `title`/`aria-label`; texto só quando indispensável).
- **Cabeçalho de painel** ≤ 18 px em fonte 10–11 px (`#n · CLI · papel`), ou só no hover/foco; o
  painel em foco se destaca por um fio fino de 1–2 px (não por moldura grossa).
- **Sem padding** ao redor do xterm além de 2–4 px; divisores entre painéis de 2 px.
- **Casca mais fina**: topo 40 px e rodapé 26 px (antes 64/40); na tela Terminais o topo e o rodapé
  ficam nessa altura mínima, sem linhas extras. Fontes de interface 11–12 px (base 13 px), ícones 14–16 px.
- Modo "foco" (⌘⇧Enter): o painel expandido ocupa toda a área; a linha de controles some e volta ao mover o mouse
  para a borda superior.
- Nada de botões grandes, cartões ou títulos de página dentro da tela Terminais.

- Abas por workspace/missão; cada aba é uma árvore binária de painéis (profundidade ≤ 16, ≤ 64 nós).
- Rótulo do painel: `#<display_id> · <CLI> · <papel> · <missão>`; display_id nunca reutilizado.
- **Sinaleira**: verde pronto, amarelo trabalhando, vermelho aguarda você. Cor nunca é o único
  sinal (anel / "!" / "✓" + `aria-label`); pulso some com `prefers-reduced-motion`. Atividade vem
  dos hooks das CLIs; sem hook, cai em heurística de ociosidade, marcada como "estimado".
- Busca no terminal: Cmd+F (mac) / Ctrl+Shift+F. Links: Cmd/Ctrl+clique. Colar grande (>20 000
  caracteres ou >32 KB) pede confirmação (arquivo ou em partes).
- Modo Missão: piloto fixo à esquerda, grade de workers à direita, contador de tokens/custo quando
  conhecido, "custo desconhecido" nunca vira zero.
- Estados vazios e de erro sempre explicam o próximo passo (sem CLI instalada: como instalar).

### Orquestrar neste painel (D-420, D-428) — aditivo; não muda nenhuma medida da área aprovada

- **Interruptor** `role="switch"` ("Orquestrar") no cabeçalho do painel livre (CLI de IA; nunca no terminal comum nem em Pane de Missão). Desligado: o clique abre o aviso "Orquestrar neste painel permite que o agente abra até 8 agentes (terminais)…" com **Permitir neste projeto e ligar** / **Cancelar**; com a preferência do projeto já ligada, liga direto. Ligado: o clique desliga (fecha os agentes). Durante a troca mostra "reiniciando…"; erro aparece no painel (`role="alert"`) sem perder o terminal. Sem projeto aberto fica desabilitado, com `title` explicando.
- **Criação:** chave "Orquestrar" na barra (padrão desmarcada, só em memória) faz o próximo "novo terminal" já abrir orquestrando (mesmo aviso).
- **Grade (D-515, substitui a grade equilibrada de D-428 quando há orquestrador):** ver "Layout orquestrador + workers" abaixo. Sem orquestrador na aba vale o comportamento de sempre (grade equilibrada de 1 a 9, mínimo 360×180). Em qualquer caso, o que não cabe com tamanho legível vai para outra aba sem roubar o foco, o foco fica no orquestrador, WebGL só nos primeiros 6 (o resto em DOM/canvas). Cabeçalho compacto: pedinte `#n · CLI · orquestrando`, worker `#n · CLI · <nome da tarefa>`, com a sinaleira de sempre e o chip de papel (`↳ orq.` / `↳ orq. A`).
- **Subagentes internos:** chip somente leitura `⧉ N` no cabeçalho e, em painel SEM orquestração, faixa discreta "Este agente abriu subagentes internos (N). Quer que eles apareçam como terminais? Ative Orquestrar neste painel" com **Ativar** e dispensar (por sessão). Subagente interno nunca vira terminal falso.

### Ciclo de vida do painel do worker (D-520 a D-527) — aditivo; não muda nenhuma medida da área aprovada

- **Fechamento pedido pelo app some na hora.** `pane_close` do orquestrador, handoff entregue (3 s depois), fechar o orquestrador ou o X do dono: o painel SAI da grade imediatamente e a grade reflui (D-516); nunca fica "Sessão encerrada (código 143)" pendurada. O 143 de um encerramento solicitado nunca é mostrado.
- **Concluído.** Worker que terminou sozinho e cujo painel ainda não fechou (opção desligada): cartão "Concluído" com "Fechar" (sem código). Na chave do cabeçalho do orquestrador, `fechar ao terminar` (`role="switch"`, "Fechar workers ao terminar", padrão ligada, por projeto) escolhe entre fechar sozinho ~3 s depois da entrega ou manter abertos para inspeção.
- **Falhou.** Worker que MORREU com erro que ninguém pediu fica visível: borda e título em `--alerta`, "Falhou (código N)" (ou "Falhou" sem código), a dica "O orquestrador foi avisado. Este painel fecha sozinho em 1 min se você não interagir." e "Fechar". O cabeçalho do orquestrador ganha o chip `⚠ N agente(s) falhou(aram)` e o botão "limpar encerrados (N)" (fecha de uma vez todo painel de worker que já terminou: concluído ou falhou). Ponteiro sobre o painel, clique, tecla ou foco cancelam o fechamento automático de 60 s.
- Nenhum token novo, nenhuma cor literal: `--alerta`, `--texto-suave`, `--superficie`; o cartão quebra linha (`flex-wrap`) em painéis estreitos. Verificado por captura (1 orquestrador + 3 workers; fechamentos um a um com a grade refluindo; Falhou, Concluído e "limpar encerrados"; temas escuro e claro).

### Layout orquestrador + workers (D-515, D-516) — aditivo; não muda `--altura-barra`, `--altura-aba`, `--fonte-aba` nem as medidas da área aprovada (D-32)

Função pura `layoutOrquestrador` (nós `{id, papel, pai?, ordem}`, área e mínimo → árvore de divisões com `proporcao`). Mínimo legível desta regra: 320×160 px; o que não cabe vira outra aba. Até 8 workers por orquestrador.

**Um orquestrador:** coluna esquerda em altura total (50% da largura até 2 workers, 45% a partir de 3); workers à direita, criados como ⌘D / ⌘⇧D (cada novo corta a MAIOR célula que cabe, pelo lado maior; empate: a mais recente).

```
1 worker         2 workers        3 workers        4 workers
+-----+-----+    +-----+-----+    +-----+-----+    +-----+--+--+
|     |     |    |     | w1  |    |     | w1  |    |     |w1|w4|
|     |     |    |     +-----+    |     +--+--+    |     +--+--+
| ORQ | w1  |    | ORQ | w2  |    | ORQ |w2|w3|    | ORQ |w2|w3|
|     |     |    |     |     |    |     |  |  |    |     |  |  |
+-----+-----+    +-----+-----+    +-----+--+--+    +-----+--+--+

6 workers (50% -> 45% de largura para o ORQ a partir do 3º)
+-----+----+----+
|     | w1 | w4 |      w5 corta o w4 pela altura;
|     |    +----+      w6 corta o w3 pela altura
|     |    | w5 |      (cada corte vai na MAIOR célula que cabe;
| ORQ +----+----+       empate: a mais recente)
|     | w2 | w3 |
|     |    +----+
|     |    | w6 |
+-----+----+----+
```

**Dois ou mais orquestradores:** linha de CIMA = orquestradores em partes iguais; linha de BAIXO = workers em grade que se ajusta (58% da altura quando há workers; 100% para cima quando não há), agrupados pelo orquestrador que os abriu (ordem do pai, depois a de chegada).

```
2 orq + 5 workers, 1280 px (3 + 2)      2 orq + 5 workers, 1920 px (uma linha)
+-------------+-------------+           +-------------+-------------+
|   ORQ A     |   ORQ B     |           |   ORQ A     |   ORQ B     |
|             |             |   42%     |             |             |
+------+------+------+------+           +----+----+----+----+-------+
| ↳A   | ↳A   | ↳A   |                 | ↳A | ↳A | ↳A | ↳B | ↳B    |
+------+------+------+       58%        +----+----+----+----+-------+
| ↳B          | ↳B          |
+-------------+-------------+
```

- **Rótulos e cores:** workers `↳ orq.` (um orquestrador) ou `↳ orq. A`/`↳ orq. B` na cor do pai; com dois ou mais, o orquestrador leva `orq. A`/`orq. B`. Só tokens de cor.
- **Foco e fechamento:** o foco volta ao orquestrador; fechar um worker reflui a grade; fechar o orquestrador com agentes vivos pergunta "Encerrar também os N agentes?".
- **Persistência:** a árvore (com `proporcao`) é gravada com o layout da aba, como qualquer outra; reabrir restaura sem recalcular.

### Orquestrar neste painel: explicação e selo (D-512, D-513, D-514)

- O aviso de primeira vez diz o que acontece (até 8 terminais, permissão herdada, o orquestrador só lê e delega, não usa subagentes internos), mostra o **selo da CLI** ("Claude Code: orquestração completa.", resumo e limites, por exemplo "o shell segue com as aprovações normais") e traz a caixa **"Orquestrador pode editar arquivos neste projeto"** (padrão desmarcada). Com o painel orquestrando, a chave **"pode editar"** do cabeçalho muda a opção do projeto (vale para o próximo orquestrador). O título do interruptor mostra o selo; selo `parcial` vira "Orquestrar · parcial" no cabeçalho.
- CLI que não orquestra (Gemini, Aider, Qwen, Kilo; Grok sem a ponte): o clique abre "X ainda não orquestra" com o motivo e a alternativa (usar Claude Code, Codex ou OpenCode como orquestrador); nada é reiniciado.
- **Ponte do Grok:** diálogo "Adicionar o servidor do app em .grok do projeto?" com o caminho relativo e o conteúdo EXATO do arquivo (sem segredo), aviso de que aparece no git até ser removido e de que é removido ao desligar; **Criar o arquivo e ligar** / **Cancelar**. Se já existe um `.grok/config.toml` de outra pessoa, o diálogo explica que o app não o edita e só oferece **Entendi**.

## Atalhos (regra: Cmd+tecla no mac; Ctrl+Shift+tecla no Windows/Linux — Ctrl+letra é do processo)

| Ação | mac | Win/Linux |
|---|---|---|
| Paleta de comandos | ⌘K | Ctrl+Shift+P |
| Nova aba/terminal | ⌘N | Ctrl+Shift+N |
| Dividir / dividir na outra orientação | ⌘D / ⌘⇧D | Ctrl+Shift+D / Ctrl+Shift+Alt+D |
| Fechar painel | ⌘W | Ctrl+Shift+W |
| Foco na paleta de painéis | ⌘J | Ctrl+Shift+J |
| Ir para aba 1–9 | ⌘1…9 | Ctrl+1…9 |
| Navegar painéis | ⌘⌥ setas | Ctrl+Alt setas |
| Expandir painel | ⌘⇧Enter | Ctrl+Shift+Enter |
| Buscar no terminal | ⌘F | Ctrl+Shift+F |
| Trocar tema | ⌘⇧L | Ctrl+Shift+L |

## Tokens (valores do ExpxMedia; ver `base/E-…` §4)

Escuro: fundo `#16181a`, painel `#1c1f21`, superfície `#232729`/`#2b3033`, texto `#f2f5f3`, suave
`#a8b0ac`, discreto `#8f9994`, borda `rgba(255,255,255,.10)`, destaque **azul** `#2563eb`, segunda cor `#38bdf8` (claro: `#0284c7`),
alerta `#ff6b5e` (vermelho; sem rosa, D-31), aviso `#f6c177`. Claro: derivado por inversão de luminosidade mantendo o
destaque. Fontes: Chakra Petch (UI) e JetBrains Mono (código), locais. Raio 14 px. Base 15 px/1.6.
Degradê de marca: `linear-gradient(135deg, destaque, destaque-2)` só em progresso/ação principal.
Tema xterm em constante TS, dois `ITheme` (escuro e claro). **Nenhuma cor literal fora de
`tokens.css` e dos dois temas do xterm** (teste de varredura).

## Acessibilidade

`role`/`aria-*` reais (`role="search"`, `aria-current="page"`, `role="tab"`, `role="dialog"`),
confirmações por diálogo da própria UI (nunca `window.confirm`; o e2e afirma zero diálogos nativos),
foco visível (`outline: 2px solid destaque`), `prefers-reduced-motion`, contraste AA nos dois temas.

## Grok (CLI da xAI) na tela (D-440 a D-443)

- **CLIs e contas:** o Grok aparece como `Instalada` com a versão (`grok --version`, ex.: 1.0.46) e a **Conta padrão**
  habilitada. Sinal de login = existência de `~/.grok/auth.json` (só `stat`; `GROK_HOME` absoluto do usuário vale).
  Sem o arquivo: selo `não autenticada` e a instrução "rode `grok login` no terminal"; o app nunca executa o login
  nem lê a credencial. Instalação sugerida quando ausente: `curl -fsSL https://x.ai/cli/install.sh | bash`.
- **Seletor de CLI** (novo terminal, Missão, squads, harness): Grok é opção como as demais; glifo `Gk` na aba.
- **Lançamento:** prompt inicial posicional (`grok "prompt"`), modelo por `--model`, retomada `--resume <id>`;
  modo automático do workspace = `--permission-mode auto` (nunca `bypassPermissions`, `--always-approve` ou `--yolo`);
  `seguro` abre com as aprovações normais. Interromper = Ctrl+C (o Esc do Grok não cancela o turno).
- **Sem MCP/hook por Pane:** o Grok só aceita `mcp_servers` e hooks em `~/.grok/config.toml`, `.grok/config.toml` ou
  `.mcp.json` (arquivos do usuário/projeto, que o app nunca edita); a sobreposição `GROK_CONFIG` descarta essas tabelas.
  Logo o Grok não recebe o MCP do app (sem orquestração por Pane nem "Orquestrar neste painel"), a sinaleira de
  atividade não é exata e o consumo aparece como `sem fonte`. Fora da Loja de MCPs e do Catálogo (isolamento: nenhum).
- **Esforço:** `--reasoning-effort` existe, mas a ajuda não lista os níveis: tratado como **indicativo** (instrução no prompt).
- **Modelos:** `default` (a CLI escolhe) e os ids de `grok models` (grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5; 2026-10-01).

## Executar projeto: ▶/■ no cabeçalho (D-430 a D-437)

- **Lugar:** grupo ESQUERDO do cabeçalho, logo depois do seletor de workspace (a busca segue centralizada; o topo de 40 px não cresce). Botão compacto de 26 px como os vizinhos: ▶ **Executar** (ícone verde) e, rodando, ■ **Parar** (ícone vermelho); chevron ao lado abre o menu; chip discreto com o estado ("rodando há 00:42 · porta 5173", "preparando (passo 1/2)", "saiu com código 1", "concluído"); com URL local detectada, um botão "abrir no navegador". Abaixo de 1180 px de largura o texto cede (fica o ícone; o tooltip e o anúncio de leitor de tela continuam completos).
- **Menu (ARIA `menu`/`menuitem`, setas, Home/End, Esc devolve o foco):** uma linha por configuração (executa essa) com a estrela "Definir como padrão"; Reiniciar e Parar quando roda; "Editar configurações…"; três últimas execuções (resultado e duração). A lista é lida só ao abrir (≤ 50 ms: cache por mtime no main).
- **Confiança:** diálogo próprio com o comando exato, pasta, nomes das variáveis (nunca valores), aviso de shell e o conteúdo do script do repositório; foco inicial em "Cancelar"; "Confiar neste projeto e executar" confirma. Mudou o comando: "O comando mudou: confirmar de novo".
- **Editor** (diálogo lazy, escala "conforto"): lista de configurações à esquerda (padrão, detectada/sua, confiável), formulário à direita (nome, tipo, programa, argumentos, pré-passos, pasta, porta, ambiente, URL, grupo, abrir navegador, reiniciar ao salvar, usar shell com confirmação marcada), pré-visualização do comando, Salvar/Excluir/Revogar confiança/Definir como padrão. Sem configuração: assistente "Configurar execução do projeto" com modelos.
- **Painel "Execução":** aba própria na tela Terminais (rótulo `#N · Execução`), reaproveitada a cada execução e focada ao rodar (preferência: focar ou só sinalizar). Medidas das abas inalteradas.
- **Atalhos** (também na ajuda dos Terminais e no ⌘K, grupo "Executar"): F5 executa/para; Shift+F5 para; Ctrl+Shift+F5 reinicia. macOS (F5 exige fn): ⌘R, ⌘. e ⌘⇧R. ⌘K: "Executar projeto", "Parar execução", "Reiniciar execução", "Executar configuração…", "Editar configurações de execução…".



## Assistente de execução com IA (D-580 a D-589)

- **Entradas:** "Configurar com IA…" no menu do ▶ (ícone `faiscas`, logo antes de "Editar configurações…"), botão no editor de configurações e convite no menu quando nada foi detectado ("A IA da sua CLI pode ler o projeto e propor a configuração"). Nada é lido nem enviado antes do clique; o chunk do diálogo é lazy (≈ 16 KB, 5 KB gzip).
- **Consentimento (diálogo modal, 680 px, escala "conforto"):** três blocos. "O que será enviado": nº de caminhos (≤ 3 níveis), a lista dos arquivos cujo trecho vai (chips em fonte mono), a pista da detecção, tamanho e custo estimado em tokens. "O que nunca é enviado": arquivos de ambiente, chaves, credenciais, `.git`, lockfiles e binários (nem o nome) + quantos sensíveis foram omitidos + redação de segredos. "Quem vai analisar": seletor da CLI (indisponíveis desabilitadas com o motivo), modelo (padrão da CLI ou o do harness), aviso de que consome tokens da conta, prazo (até 2 min 30 s), cancelável, CLI sem ferramentas. Foco inicial em **Cancelar**; "Concordo, analisar o projeto" é o único caminho que envia algo; sem CLI disponível o botão fica desligado com aviso.
- **Analisando:** anel de progresso (parado com `prefers-reduced-motion`), frase da fase em região viva `role="status"` (preparando, consultando a CLI, validando, retentando) e cronômetro "00:12 de até 02:30" fora da região viva (não polui o leitor de tela); "Cancelar análise" (Esc também cancela e mata a CLI).
- **Proposta da IA (980 px):** resumo ("proposta de CLI em 00:14; a detecção automática achou 9 configurações; 2 itens são novos"), bloco âmbar "Avisos e pré-requisitos", um cartão por configuração com **Salvar** (checkbox), **Padrão** (rádio), selos "novo/já detectada" e "confiança N%", campos EDITÁVEIS (nome, comando = programa + argumentos, pasta, porta, pré-passos), "Por quê" (justificativa da IA) e o **comando exato** em fonte mono (`$ npm install` / `$ npm run dev`). A pasta é um `<select>` limitado às pastas do projeto (nunca texto livre). Comando inválido mostra o motivo no cartão e desliga o Salvar. "Itens descartados pela validação" em `<details>` com o motivo de cada um. Rodapé: "Nada foi salvo nem executado… a primeira execução ainda pede a sua confirmação — a IA nunca concede confiança". Botão **Salvar configurações (N)**.
- **Quando a IA não ajuda:** faixa `role="note"` "Esta proposta NÃO veio da IA" com o motivo, os itens vêm da detecção automática e os selos de IA somem ("detecção automática").
- **Erros acionáveis:** CLI ausente, sem login e limite de uso → mensagem simples + sugestão; botões "Tentar de novo" (volta ao consentimento), "Usar a detecção automática" (abre o editor) e "Fechar". Lista vazia da IA → estado vazio com os avisos e caminho para o editor. Confirmação "N configurações salvas" lembra a confirmação da primeira execução.
- **Avisos de prechecagem (sem executar nada):** `node_modules` ausente, Python sem venv, Docker fora do PATH, por configuração (`avisos[]` da lista); com o pré-passo sugerido (`npm install`) quando existe.
- **Monorepo no menu:** configurações rotuladas pela pasta (`desktop · Rodar (dev)`), a de maior probabilidade como padrão.
- **A11y:** `role="dialog"` modal com foco preso e devolvido a quem abriu (`key` por passo recomeça o foco), rótulos em todos os campos (`aria-label` "Salvar X", "Definir X como padrão"), `role="alert"` nos erros, região viva só para mudança de fase, nenhuma cor literal (só tokens), claro e escuro, alvos ≥ 32 px na escala conforto.


## Painel de workspaces (D-450 a D-455)

- **Abrir:** alfinete (ícone `fixar`, `aria-pressed`) no grupo ESQUERDO do cabeçalho: seletor de workspace | fixar | executar. Atalho ⌘⌥W (Ctrl+Alt+W) e ⌘K "Fixar/desafixar painel de workspaces". Desafixado, a casca fica exatamente como antes (menu, topo 40 px, rodapé 26 px, terminais maximizados e sem mudar medidas, fontes nem abas).
- **Coluna:** entre o menu e o resto, de cima a baixo (as três linhas da casca), 200–360 px (padrão 264), redimensionável pela borda (arrastar ou ←/→ 16 px, Shift ×4, Home/End), largura gravada. Janela ≤ 900 px: vira sobreposição ao lado do menu (botão de fechar e Esc); o conteúdo nunca é esmagado.
- **Cabeçalho do painel:** "Workspaces", contagem, selo âmbar com o total de agentes aguardando você ou com erro em OUTROS workspaces, recolher/expandir tudo, visão geral compacta (uma linha por workspace com chips), "+" abrir projeto (mesmo diálogo do seletor) e filtro (nome, pasta, ramo, Missão, agente).
- **Cartão = um workspace (D-590, D-591):** hierarquia NOME ≫ ramo/chips ≫ pasta ≫ ações. Linha 1 = SOMENTE [mini-bichinho 28 px] [nome] (semibold 14 px, quebra em até 2 linhas, `title` com o nome completo; ativo = nome em azul D-31, `aria-current`, marcador curto de 3 px à esquerda, sem caixa pesada). Linha 2 = SEMPRE presente, o resumo: ponto de atenção, chip "N agentes · M ativos" (bolinha por token: trabalhando = `--destaque`, aguardando = `--aviso`, erro = `--alerta`, resto = `--texto-discreto`; conta todos os agentes, mesmo só aguardando) ou "sem agentes" em texto discreto (sem chip tracejado), "N aguardando você" e "N com erro" (botões que levam aos Terminais), "executando :porta", etapa da pipeline, "N terminais" e, à direita, "há 3 min" (última atividade vista; só dados do resumo). Os chips quebram em outra linha em vez de cortar. Linha 3 = ramo (+ ponto de alterações) e pasta mascarada (meio truncado), fonte discreta. Ações (recolher/expandir, fixar no topo, ⋯ com revelar, copiar caminho, fixar e remover da lista, que NÃO apaga a pasta) são ícones com área de 28 px, sobrepostos ao FIM da linha 3 e revelados no hover/foco do cartão (nunca cobrem o nome nem o resumo; sempre acessíveis por Tab; sempre visíveis no toque; a estrela marcada fica visível em repouso, com espaço reservado). Recuo: padding esquerdo do cartão 8 px, margem do cartão 4 px, recuo por nível da árvore 10 px (no máximo 2 níveis de recuo; mais fundo só linhas-guia). Visão compacta = [bichinho][nome] + selo mínimo de atenção (contagem), ações no hover/foco. O cartão inteiro (nome, bichinho ou área morta; também no modo compacto) troca o workspace E leva à tela Terminais (se já é o atual, só navega); chips levam ao agente certo; as ações não navegam; reordenar arrastando (ou Alt+↑/↓), persistido.
- **Árvore (ao vivo):** Missão (título, modo, estado, "Abrir Missão") → piloto → workers (inclusive os do "Orquestrar neste painel"), subagentes internos da CLI só como contagem "2/3 sub", e a Execução do projeto (rodando · porta · tempo). Linhas-guia discretas, até 6 agentes e "e mais N". Cada linha: glifo do estado (anel girando, "!", "✓", "×"), nome e papel, o que faz agora (última linha de saída limpa e redigida, ou o estado em palavras), tempo no estado. Clicar numa linha troca o workspace E foca o painel dela na tela Terminais.
- **Terminar (■):** botão de 32 px por linha; confirmação inline "Terminar X? Sim, terminar / Não" (Esc cancela); agente trabalhando e piloto com workers mostram o aviso do que será interrompido. Só encerra o agente pedido, naquele workspace.
- **Teclado:** ↑/↓/Home/End entre cartões, → entra nos agentes (e no ■), ← volta ao cartão (ou recolhe), Enter/Espaço ativam, Delete pede para terminar, Alt+↑/↓ reordena, Esc fecha confirmações/menu (e, como sobreposição, o painel). Um só cartão na ordem do Tab.
- **Estados:** vazio ("Nenhum projeto aberto — abra uma pasta" + botão), carregando (esqueleto), erro (alerta com "Tentar de novo"), sem resultado do filtro. Anúncios `aria-live` polite só de quem passou a aguardar você ou a falhar.
- **Leveza:** nada no boot, chunk lazy, sem polling; só com o painel montado o main acompanha os eventos (coalescidos ≥ 300 ms) e o estado ao vivo vem do store de terminais.


## Terminais por workspace (D-570 a D-573)

- **Regra:** a tela Terminais mostra APENAS os terminais do workspace atual (abas, painéis, grade, orquestradores e workers, aba Execução). Trocar de workspace (card, seletor, ⌘K, abrir projeto) troca o conjunto no mesmo quadro, sem piscar, para não misturar as coisas. As sessões dos outros workspaces continuam vivas no daemon; nada é encerrado.
- **Por workspace:** layout e divisões com proporções, aba ativa, painel em foco, painel expandido, modo foco; restaurados ao voltar (memória na sessão + layout em disco por workspace). A rolagem de cada terminal volta como estava.
- **Indicadores:** cartão do painel de workspaces com chip discreto "N terminais"; seletor do cabeçalho com o número ao lado do nome; selo âmbar de "aguardando você" nos outros workspaces segue no painel. O contador "N aguardando você" da barra da tela conta só o workspace visível.
- **Sem projeto:** item "Sem projeto (N)" (seletor e fim do painel de workspaces) só quando existem sessões sem workspace; abre uma faixa rotulada ("Sem projeto · Terminais que não pertencem a nenhum workspace…") com "Voltar a <workspace>"; terminal novo fica desabilitado ali.
- **Foco e entrada:** ao trocar, o foco vai ao painel que estava em foco naquele workspace (ou ao primeiro); atalhos de painel/aba, fechar, dividir e "novo terminal" valem só para o workspace atual. Painel de workspaces e ⌘K que focam o agente de outro workspace trocam de workspace e focam o painel certo.
- **Medidas intocadas:** `--altura-barra`, `--altura-aba`, `--fonte-aba` e demais medidas aprovadas do terminal não mudam; a faixa "Sem projeto" é uma linha única de 11,5 px sob a barra, só quando o grupo está aberto.

## Bichinho do workspace (D-460 a D-469)

O "ser vivo" de cada projeto: um bichinho em SVG próprio que reage ao uso das CLIs e cresce com os tokens consumidos e com a base de conhecimento. Estrutura adaptada do personagem da Alma do ExpxMedia (ver D-460 para o que foi reaproveitado e o que ficou de fora).

- **Onde:** (1) slot fixo no rodapé do menu lateral, acima de "Só ícones"/"Fixar menu", representando o workspace ATUAL: recolhido (56 px, a largura não muda) mostra só a cabeça em 40 px; aberto mostra o corpo em 46 px com apelido, "espécie · estágio" e a barra de maturidade. (2) Mini de 28 px no card de cada workspace do painel de workspaces, reagindo ao estado DAQUELE workspace mesmo se não for o ativo (`<BichinhoMini workspaceId>`). (3) Clique no slot abre o popover.
- **Popover** (não modal, fixo ao lado do slot; Esc fecha e devolve o foco): nome (apelido ou espécie), "espécie · estágio" (marca "escolha sua" quando manual), humor, **Maturidade 0–100** com os dois componentes (**Tokens** e **Conhecimento**, cada um 0–100, com tokens acumulados em pt-BR e itens de memória e trechos indexados), quanto falta para o próximo estágio, a personalidade da espécie e o motivo da escolha, "Trocar bichinho" (abre a grade pesquisável das 100 espécies, D-674), "Renomear" (1 a 24 caracteres), "Silenciar animações" e "Ocultar bichinhos". Preferências globais também em Configurações > Tema.
- **Aparece só em ocioso:** o chunk (com as 100 espécies, ver P-670) é pedido 1,2 s depois da casca montar e em `requestIdleCallback`; falha de carga some em silêncio.

### 100 espécies sem repetir (D-670 a D-674)

- **Catálogo:** 100 espécies em 7 grupos (lista completa e afinidades em `docs/ade/base/K-bichinho-catalogo.md`): mamíferos 48, aves 14, répteis 8, anfíbios 4, peixes e cetáceos 7, invertebrados 8 e insetos e aracnídeos 11 (contagens incluem as 14 originais, que mantêm a arte própria). As outras 86 são montadas por RECEITA: arquétipo de corpo (felino, canino, roedor, urso, ungulado, primata, ave, ave aquática, peixe, réptil, anfíbio, inseto, aracnídeo, invertebrado marinho) x partes (orelhas, cauda, focinho/bico/tromba, chifres/galhada, asas, casco, listras/pintas, crista, juba, espinhos, antenas) x paleta de tokens do tema.
- **Sem repetir:** cada workspace novo recebe a espécie mais afim ainda livre; só depois das 100 em uso uma se repete, com variante visual (paleta e marca diferentes). Quem já tinha repetida é corrigido uma vez (o mais antigo fica; manual nunca muda) com um aviso discreto.
- **Trocar bichinho:** botão no popover abre a grade (busca por nome, filtro por grupo, prévia viva, marca "em uso", "Automático", chave "Sem repetir espécie" ligada por padrão). Escolher uma espécie já usada é permitido, com o aviso "já está em uso em <workspace>".

### Ovo que racha devagar (D-671)

O bichinho começa no ovo e só nasce com atividade de verdade: pelo menos 4 tarefas concluídas (configurável de 2 a 6) E 150 mil tokens acumulados. Progresso = o menor dos dois (0–100%).

| Progresso | Visual do ovo | Movimento |
|---|---|---|
| 0–24% | liso | balança de leve só enquanto há atividade |
| 25–49% | uma rachadura pequena | idem |
| 50–74% | rachaduras maiores e um olho espiando | idem, um pouco mais forte |
| 75–99% | quase abrindo, casca solta | balanço mais forte |
| 100% | nascimento único: a casca abre e cai, o bichinho aparece, toast "Seu bichinho nasceu: <espécie>!" | uma vez só |

Tooltip do slot e do mini do card, e popover: "Ovo: 2/4 tarefas · 80 mil/150 mil tokens (50%)" e o que falta. O esforço escala o balanço mas o ovo nunca comemora. Quem já passou do ovo nunca volta a ser ovo.

### Passeio e ociosidade (D-650 a D-654)

- **Quando:** sem mouse, teclado nem foco por 3 minutos (1–30, configurável) e sem agente trabalhando no workspace do bichinho, ele sai do lugar (o slot do menu e, com o painel de workspaces aberto, UM por cartão) e passeia numa camada decorativa sobre a janela (`aria-hidden`, sem cliques, abaixo de diálogos, menus e popovers). O lugar de origem mostra uma casinha vazia tracejada. Sai andando do próprio cartão, caminha pelo chão (borda de cima do rodapé), para para fazer algo curto (cheirar, olhar em volta, pular, espreguiçar, brincar com uma bolinha, acenar, perseguir uma borboleta, cavar), encontra os outros (se olham, acenam e caminham juntos) e deita para dormir em lugares diferentes (cantos, sobre o rodapé, ao lado do painel, no topo de um cartão, pendurado sob a barra do topo); acorda e passeia de novo.
- **Voltar:** qualquer mexida do mouse, tecla, clique, foco da janela ou trabalho no workspace do bichinho manda todos de volta correndo em ≤ 1,5 s; a camada some quando o último chega. Janela oculta: pausa total.
- **Travessuras:** no passeio eles pegam ícones, selos e textos pequenos da casca e os levam para outro lugar (só visual; volta tudo ao lugar em ≤ 150 ms ao primeiro sinal de atividade). Nunca terminais, campos, diálogos, menus nem botões marcados `data-sem-travessura`.
- **Sem movimento:** `prefers-reduced-motion` do sistema ou "Silenciar animações" = não passeiam (pose estática no posto). Configurações › Tema: "Bichinhos passeiam quando ociosos" (padrão ligado), "Tempo de ociosidade antes do passeio" (1–30 min) e "Bichinhos mexem nos elementos da tela (travessuras)".
- **Custo:** no posto só existe o timer de ociosidade; a camada só existe enquanto alguém passeia (P-650 a P-652).

### Intensidade do esforço (D-500 a D-504)

O bichinho nunca dorme com a CLI trabalhando. Quanto mais a CLI consome, mais forte e rápido ele se move, mesmo sem adaptador de atividade (Grok, terminal livre, CLI nova).

| Nível | Nome | Quando (taxa combinada, a maior vale) | Movimento | Indicadores estáticos |
|---|---|---|---|---|
| 0 | parado / dormindo | sem saída, entrada nem consumo (dorme após 5 min reais) | nenhum timer, nenhuma animação | nenhum |
| 1 | atento | entrada recente, ou saída até 30 B/s, ou até 500 tokens/min; piso por 20 s depois de qualquer atividade | respira devagar (2,4 s) | 1 barra |
| 2 | trabalhando | saída ≥ 30 B/s ou ≥ 500 tokens/min | digita no notebook, ciclo 0,56 s | 2 barras e anel azul |
| 3 | acelerado | saída ≥ 600 B/s ou ≥ 2,5 mil tokens/min | ciclo 0,34 s, amplitude 2,2×, cabeça balança, 3 gotas, 3 faíscas, baforadas, olhos arregalados | 3 barras, anel âmbar, chama |
| 4 | frenético | saída ≥ 4 mil B/s ou ≥ 12 mil tokens/min, ou 3+ sessões fluindo no nível 3 | ciclo 0,19 s, amplitude 3,6× com giro e achatamento, 4 gotas, 5 faíscas, boca ofegante | 4 barras, anel vermelho, chama grande |

Sobe na hora, desce um nível a cada 6 s (não pisca). O tooltip do mini-bichinho do card e o popover dizem "Agora: acelerado · ~4,2 mil tokens/min" (tokens lidos) ou "acelerado · saída intensa" (estimado pela saída do terminal); nunca mostram conteúdo. Com "reduzir movimento" do sistema ou "Silenciar animações", os indicadores estáticos (barras, anel, chama) mantêm a informação; só o movimento some. Fonte de cada número: `docs/ade/05-CONTRATOS.md` §23.

### Espécies (D-461): sinais e racional

Pontos: linguagem = 10 × peso relativo (dominante = 10); tipo = 4 (indício) ou 12 (certeza); empate pelo hash do nome do projeto; troca manual vence.

| Espécie | Representa | Sinais principais | Personalidade |
|---|---|---|---|
| Caranguejo | Rust | Cargo.toml, `*.rs` | blindado e metódico, anda de lado até achar o caminho seguro |
| Piton | Python | pyproject.toml, requirements.txt, `*.py` | calma e legível, enrola o problema até caber numa linha |
| Esquilo | Go | go.mod, `*.go` | rápido e enxuto, junta só o que precisa |
| Raposa | JavaScript | package.json sem tsconfig, `*.js` | esperta e improvisada |
| Camaleão | TypeScript | tsconfig.json, `*.ts`/`*.tsx` | muda de cor para combinar com cada contrato |
| Lontra | Java e Kotlin | pom.xml, build.gradle(.kts), `*.java`/`*.kt` | sociável e persistente, boia na JVM |
| Tucano | C# e .NET | `*.csproj`/`*.sln`, `*.cs` | vistoso e confiável, bico grande |
| Elefante | PHP | composer.json, `*.php` | memória longa, veterano da web |
| Ouriço | Ruby | Gemfile, `*.rb` | elegante por fora, espinhos de convenção |
| Coruja | dados, ML e análise (tipo) | pandas/NumPy/PyTorch/TensorFlow/scikit-learn/Jupyter, 2+ notebooks, dbt (certeza 12) | analítica, enxerga padrão no escuro |
| Polvo | infraestrutura e DevOps (tipo) | Terraform (`*.tf`), Helm, Pulumi, Ansible, Kustomize (12); Docker Compose (4) | oito braços: pipeline, contêiner e cluster |
| Gato | documentação (tipo) | mkdocs/Docusaurus ou Markdown dominante (12); muito Markdown (4) | observador, deita em cima do texto |
| Sapo | mobile (tipo) e Swift/Dart | React Native/Expo/Flutter/Android/Package.swift/Xcode (12), `*.swift`, `*.dart` | salta de tela em tela |
| Urso | C e C++ | CMakeLists.txt, Makefile, `*.c`/`*.cpp`/`*.h` | forte e direto, perto do metal |

Sem nenhum sinal (pasta vazia): sorteio estável sobre as 14 pelo nome do projeto, avisado no motivo. Tipo web/API/CLI/biblioteca aparece no motivo mas não muda a espécie.

### Estágios e curva de crescimento (D-463)

`maturidade = 0,6 × Tokens + 0,4 × Conhecimento`, ambos logarítmicos (Tokens: 100 em 1 bilhão de tokens in+out; Conhecimento: 100 em 100 mil itens). Maturidade nunca regride.

| Estágio | Maturidade | Visual |
|---|---|---|
| Ovo | 0–2 | ovo na cor da espécie; racha depois do primeiro uso |
| Filhote | 3–19 | corpo a 64%, cabeça 20% maior |
| Jovem | 20–44 | corpo a 78%, lenço |
| Adulto | 45–69 | corpo a 90%, óculos |
| Veterano | 70–89 | corpo a 97%, cicatriz de batalha e medalha |
| Lendário | 90–100 | tamanho cheio, coroa e aura |

Pontos de referência: 1 M de tokens + 1 mil itens = maturidade 44 (jovem); 30 M + 2 mil = 65 (adulto). Ganho de estágio: comemoração única do sprite e um aviso discreto ("Raposa de meu-app cresceu: agora é adulto.").

### Humores e símbolos (sem texto, sem depender de cor)

| Humor | Quando | Símbolo / pose |
|---|---|---|
| Ocioso | nada acontecendo | pose estática; a cada 2–5 min, um olhar em volta de 1,8 s |
| Dormindo | 10 min sem atividade | olhos fechados, Z |
| Curioso | clique/foco no bichinho | olhos grandes, "?" |
| Pensando | Pane iniciando, Missão ou Execução iniciada | reticências |
| Trabalhando | Pane trabalhando | notebook, patas digitando, suor |
| Aguardando | Pane aguardando você | balão "!" e pata levantada |
| Comemorando | Pane pronto após ≥ 3 s, Missão concluída, Execução ok | olhos felizes e confete |
| Preocupado | falha de Pane, Missão ou Execução, alerta crítico | sobrancelha e gota |
| Doente (sinal extra) | cota de consumo ≥ 85% | termômetro |

Animação: só `transform`/`opacity`, só em reação; dormir, esperar e preocupar rodam um número finito de ciclos e assentam em pose estática (CPU ociosa ≈ 0); trabalhar e pensar repetem enquanto durarem. `prefers-reduced-motion: reduce` e "Silenciar animações" = poses estáticas com os mesmos símbolos. Janela oculta pausa tudo.


## Instalar suíte ExpxDev (D-470 a D-479) e Módulos da suíte (D-480 a D-484)

**Botão no cabeçalho (grupo DIREITO, antes da cota).** Aparece só com workspace atual e suíte `ausente` (azul de destaque `--destaque`, ícone `baixar` + "Instalar suíte ExpxDev"), `incompleta` ("Reparar suíte ExpxDev", ícone `aviso`) ou `desatualizada` (discreto, "Atualizar suíte ExpxDev", opcional); "Instalando… N%" enquanto roda; some quando fica completa. Não rouba foco. O grupo direito já é justo (cota, rigidez, ações) e o botão não pode empurrar nada: em três larguras do cabeçalho — rótulo inteiro (≥ 1600 px), só a ação ("Instalar", 1285–1600 px) e só o ícone com tooltip (≤ 1260 px de conteúdo; 1280×800 cai aqui) —, e **a cota cede espaço com reticências** (`min-width: 48 px`). Altura de 40 px preservada (verificado com capturas em 1280×800 e 800×600, claro e escuro). Também aparece como linha de ação no card do workspace (compacta) e como bloco na tela Método › Instalação; ⌘K ganha "Instalar/Reparar/Atualizar suíte ExpxDev" só quando falta; "Agora não" esconde o botão do cabeçalho naquele projeto (card e Método seguem; reativar em Método › Instalação).

**Modal "Instalar a suíte ExpxDev"** (diálogo ARIA, foco preso, foco inicial em "Cancelar", retorno de foco; só o corpo rola, título e botões ficam à vista). Passo 1: o que é e o que será instalado (as nove skills, sem checkbox; "O que cada skill faz" recolhido), o que vai acontecer, rede, pasta alvo (`~`), versão fixada, arquivos que já existem ("já existem N arquivos em .claude/ — serão mantidos"), efeitos fora do projeto, **requisitos ✓/✗/○/ℹ com correção sugerida** (os ✗ aparecem num alerta no topo), o comando exato em fonte mono; botões "Agora não", "Cancelar" e o único primário "Instalar agora". Passo 2: etapas com estado (aria-live polite), barra determinística (`role=progressbar`), tempo decorrido, log ao vivo recolhido, "Cancelar" (Esc ou botão pede confirmação inline antes de matar o instalador). Passo 3: sucesso (versão, skills, arquivos, o que já existia e mudou/sumiu, cópia de segurança e como restaurar, **"Módulos ativados: 8 de 9 — o legadox está desligado… Ajustar módulos"**, "Abrir o Método", "Fechar") ou falha (causa em linguagem simples, "Seu projeto: …", "Tentar de novo", "Copiar diagnóstico"). `prefers-reduced-motion`: sem giro nem transição da barra. Escala "conforto" e só tokens.

**Módulos da suíte (Método › Instalação; padrão global em Configurações › Módulos da suíte).** Lista dos nove com nome, descrição de uma linha, selos de dependência (`exige`, `recomenda`, `usado por`, `padrão: desligado`) e interruptor `role="switch"` (rótulo, descrição, foco, Enter/Espaço). Desligar o que outro módulo ligado exige abre, **acima da lista** e com foco em "Cancelar", "Desligar X também desliga Y" com "Desligar também os dependentes" (nunca em cascata em silêncio); ligar um que exige outro desligado oferece "Ligar também os requisitos". "Restaurar padrões"; onde o arquivo está guardado; "Como o desligado vale em cada CLI" (Claude Code: negado ao modelo por Pane; Codex, OpenCode e outras: parcial, "esta CLI ainda enxerga a skill").

## Instalação vs. contexto do projeto (D-495, D-496)

A aba Método › Instalação tem dois blocos de largura total (escala conforto, tokens, claro/escuro). **Instalação** (suíte): resumo em linha (versão, skills de 9, módulos ativos de 9 com atalho), ação do assistente, item "Hooks de proteção" (estado, explicação de uma frase, "Ativar proteções"/"Ver a rigidez", "Ver o que são") e "Módulos da suíte". **Contexto do projeto**: resumo "Contexto do projeto: 2 de 4 gerados" (nada gerado: "0 de 4"), lista semântica com nome simples, para que serve, estado (marca + texto, nunca só cor), comando exato em mono com "Copiar", "Gerar agora" / "Ligar módulo", e "Gerar o que falta (N)" com progresso em `role="status"` `aria-live="polite"`, "Pular este" e "Cancelar". Verbos: instalar (suíte), gerar (contexto), ativar (hooks). Textos da v1 ("Para instalar, rode…", "O app só mostra o comando…") removidos. Movimento só sob `prefers-reduced-motion: no-preference`.

## Método: pedido e disparo (D-610 a D-612)

- Tela Método (aba **Pedido**, padrão; D-680): **conversa de pedido**. No centro, o histórico de pedidos da sessão como mensagens (o pedido da pessoa à direita, em bolha azul de destaque; a resposta do ADE à esquerda, em cartão: "Enviado ao agente em Pane …", `entregue`, o comando exato e "Ir para o terminal") e, fixo embaixo, o composer (comando exato e "Copiar", campo grande, atalhos ⌘/Ctrl+Enter e Shift+⌘/Ctrl+Enter, botão primário que diz o que acontece, "Mais formas de disparar"). À **direita**, a coluna "O que você quer fazer?" com Nova feature, Corrigir um bug, Pedido livre, Novo projeto e "Mais" (os `gerar_*`), cada um com uma linha e a skill; escolher o gesto ajusta botão, comando e exemplos; abaixo, "Ir para o terminal ao disparar" e a CLI padrão. Abaixo de 1100 px a coluna vira uma faixa "O que você quer fazer? Nova feature · Trocar" acima do composer, que abre a lista como popover. Atalho discreto "Ver trabalhos (N)" no topo da conversa. Violações, Instalação e Saúde seguem na sub-navegação lateral esquerda. Mantidas as regras de rigidez, módulo desligado, suíte ausente, recusas, sugestão de comando e confirmação de geração de contexto. O histórico vive só na sessão do app (nada gravado).
- Tela **Trabalhos** (D-680), 100% da área: faixa de resumo (total, em andamento, aguardando você, entregues, bloqueados; contagens reais do índice, cada uma filtra), busca, filtros de estado e tipo, **novo pedido** (leva ao composer do Método com o gesto do tipo filtrado) e duas visões memorizadas em localStorage (`<produto>.trabalhos.visao`, sem contrato): **Cartões em colunas** (Ideia, Planejado, Em execução, Validando, Entregue, derivados de `estagio`/`status`/tasks do índice, sem estados novos; cartão com tipo, estado em palavras, barra de progresso, mini-rastro de uma tira por task, última atividade, raio e sinaleira) e **Linha do tempo** (uma linha por trabalho, estágio, progresso, raio, data). Colunas e linhas são listas virtualizadas (300+ trabalhos). Clicar abre o detalhe (componente `Trabalho` do Método) num painel deslizante à direita com "Voltar" (Esc também; o foco volta ao cartão). Vazio: "Nenhum trabalho ainda" com "Fazer um pedido no Método".
- **Disparar leva ao Pane:** entregue o comando, a tela Terminais abre com o painel certo em foco e uma faixa no topo (`Executando: Nova feature — “…”`, **Voltar ao Método**, Dispensar). Falha não navega. Preferência "Ir para o terminal ao disparar" (padrão ligada); menu do botão "Disparar e ficar aqui"; ⌘/Ctrl+Enter vai, Shift+⌘/Ctrl+Enter fica. Anúncio por aria-live: "Comando enviado; abrindo o terminal".
- Primeiro uso (suíte recém-instalada, sem trabalho): checklist de três passos (suíte instalada, gerar o contexto do projeto pela mesma sequência da aba Instalação, escrever o primeiro pedido). Some quando há trabalho.
- Avisos honestos: módulo desligado → "Ligar módulo"; suíte ausente → "Instalar a suíte"; sem CLI → "Abrir Provedores"; Pane aguardando → "Ver o terminal".

## Medidor de CPU e memória (D-530 a D-535)

Discreto, no grupo direito do cabeçalho e **antes** do chip de consumo das CLIs (a grade de 3 colunas continua mandando: a busca nunca é coberta).

- **Chip** (alvo ≥ 28 px dentro dos 40 px do cabeçalho; fonte 11,5 px mono): `CPU 23%` e `RAM 61%`, cada um com uma minibarra de **3 px** (destaque azul; âmbar `--aviso` ≥ 80%; vermelho `--alerta` ≥ 92%). O número está sempre no texto; no aviso/alerta o ícone ganha ▲ / !. `aria-label`: "CPU 23 por cento, memória 61 por cento". Antes da primeira medição mostra "—" (nunca 0 falso).
- **Largura do cabeçalho (container query):** ≥ 1360 px rótulos + números + barras; < 1360 px só `23% · 61%` com as barras; < 960 px um ícone único (tooltip com os números; ▲/! no aviso/alerta).
- **Popover** (`role="dialog"` não modal; Esc ou clique fora fecham e o foco volta ao chip; abrir o popover de limites fecha este): CPU total + mini-histórico de 2 min; CPU por núcleo (4 colunas, no máximo 16 e "e mais N"); memória em uso / total / disponível e swap + mini-histórico; **Este app** (processos do app e o daemon de PTY); **Agentes** (CLIs de IA, soma por sessão); **Top 5** por CPU e por memória (só nome do executável e a sessão, nunca argumentos nem caminhos); botão **Ocultar este medidor**.
- **Mostrar/ocultar:** botão do popover, atalho ⌘⌥U / Ctrl+Alt+U e comando ⌘K "Mostrar/ocultar medidor de CPU e memória"; preferência `medidor_sistema_mostrar` (padrão ligado). Oculto = nada renderiza e o main não amostra.
- **Acessibilidade e movimento:** região viva própria que só anuncia ao cruzar limiar (nunca por amostra); a barra muda de largura sem animação (compatível com `prefers-reduced-motion`); só tokens CSS (nenhuma cor literal).

## Consumo: provedores, contas e modelos (D-560 a D-564)

Inspirado na faixa de consumo do ExpxMedia (`BarraUso.tsx`: ícone do provedor, janelas "5 horas"/"Semanal" com barra e % usado, "Renova em…"), adaptado aqui para várias contas por provedor e para a separação por modelo. O que foi reaproveitado: logos por provedor (traçados SVG, agora `currentColor`), nomes de janela e a ideia de resumo geral. O que é novo: hierarquia provedor → conta → modelo, procedência do dado e estados com sinal além da cor.

- **Rodapé (26 px, 11,5 px):** agrupado por provedor, uma entrada por conta: logo 15 px, ordinal (só se o provedor tem mais de uma conta), % do gargalo e minibarra. Âmbar com ▲ a partir de 85 %, vermelho com ! em 100 %, "—" e barra tracejada sem dado, saldo para crédito. Tooltip e rótulo falado trazem todas as janelas e o reinício. Até 4 contas inline, o resto vira `+N`.
- **Popover (chip do cabeçalho):** resumo (pior caso + folga média), depois seções por provedor (logo + nome + nº de contas). Cada conta: nome, "medido/estimado/manual · fonte · idade", janelas com barra, % e "reinicia em 1 h 20 min · 17:43", bloco "Por modelo" (barras em ordem de uso; esgotado marcado; ou custo de 7 dias quando a fonte não dá balde; ou "sem dado por modelo"), custo hoje/7 d, Atualizar e Informar manualmente. Rola por dentro, Esc fecha, não cobre a busca.
- **Tela Consumo:** a visão por provedor e por modelo usa os mesmos componentes.
- **Fora de escopo:** baldes por modelo do Codex/Grok/OpenRouter dependem de a fonte fornecê-los (hoje só o Claude); sem isso aparece o custo por modelo ou "sem dado por modelo".

## Voz local (D-545)

Configurações › Voz e captura › **Motor de voz**: a primeira opção é **"Local neste computador (recomendado)"**; "Nenhum (desligado)", "Avançado: comando local externo" e "Avançado: servidor HTTP compatível (remoto)" seguem abaixo. O seletor nasce no que está
configurado (desligado numa instalação nova: nada é baixado sem a pessoa pedir) e, enquanto estiver em "Nenhum", um botão primário **"Configurar voz local (recomendado)"** leva ao assistente. Escolher "Local" troca a área do motor pelo painel de voz local e esconde "Salvar motor" (a ativação do modelo faz tudo).

- **Assistente (sem modelo instalado, ou "Baixar outro modelo"):** grade de cartões (radio, foco visível) com nome, selo **Recomendado** (azul) e **PT-BR** (contorno azul, destacado) ou "Sem português", descrição, Download (MB/GB), "Memória ao usar: cerca de…", Idiomas, Licença (link) e, em linhas inteiras, Velocidade e Qualidade em
  linguagem simples ("Rápido: responde quase na hora", "Excelente: a mais precisa…"). O recomendado vem marcado; modelo sem checksum confirmado aparece bloqueado com o motivo e nunca é pré-selecionado. Linha de **espaço livre em disco**; sem espaço ⇒ alerta e botão desligado. Um único botão primário **"Baixar e ativar"**.
- **Consentimento (diálogo próprio, foco em "Cancelar"):** "De onde" (host de origem e CDN da mesma organização), "O que" (só o modelo, tamanho, checksum SHA-256), "Privacidade" (nenhum áudio, texto ou dado sai do computador; entra o modelo), "Onde fica", "Como apagar" e "Licença/atribuição". Botões **Cancelar** / **Concordo e baixar**. O aceite vale por download.
- **Progresso:** cartão com `role="progressbar"` (`aria-valuemin/max/now`, `aria-valuetext` "40%"), "268 MB de 670 MB (40%) · 4,2 MB/s · faltam 1 min 36 s", **Pausar / Retomar / Cancelar**. "Verificando…" e "Testando o reconhecimento…" usam barra indeterminada (sem `aria-valuenow`, com `aria-valuetext`);
  com `prefers-reduced-motion` a barra fica estática. Região viva discreta (`role="status"`, `aria-live="polite"`, fora da tela) que anuncia só mudança de fase e 25/50/75 % (nunca por tick). Depois do autoteste: **"Pronto: voz local ativada."** (caixa verde com o atalho de ditado).
- **Erros em linguagem simples e com ação:** sem internet / disco cheio / servidor recusou ⇒ **Retomar**; checksum / tamanho / redirecionamento ⇒ **Baixar de novo** (reabre o consentimento); autoteste falhou ou modelo corrompido ⇒ **Apagar modelo** + **Baixar de novo**; runtime indisponível ⇒ aviso com o caminho alternativo (opções avançadas) e botão desligado.
- **Gerenciar:** lista de instalados com tamanho em disco, selo **Em uso**, **Usar este modelo**, **Testar** (resultado "Funcionando: 3 de 3 palavras da amostra (0,02× o tempo real)"), **Apagar modelo** (confirmação) e **Baixar outro modelo**; seletor "Descarregar da memória após" (30 s a 1 h) e a linha "Modelo na memória agora (1,2 GB)" / "Modelo fora da memória: 0 MB e nenhum processo ativo".
- Só tokens CSS (nenhuma cor literal), escala "conforto", sem rosa. O painel de voz do terminal não muda: erros novos (`modelo_ausente`, `modelo_corrompido`, `runtime_indisponivel`) levam à configuração.

## Aprovações dos workers (D-640 a D-646)

- **Seletor de 3 níveis** (`SeletorNiveisAprovacao`, escala conforto, só tokens): rádios "Perguntar sempre", "Automático seguro (recomendado)" e "Total (bypass)", cada um com "Pode sozinho:" e "Continua bloqueado:" em linguagem simples, mais a tabela de selos por CLI (garantido / parcial / a CLI pergunta sempre; a cor nunca é o único sinal). O Total mostra um bloco vermelho (`role="alert"`, `--alerta`) e o campo "digite liberar tudo"; o botão de salvar/ligar fica desabilitado até a palavra bater.
- **Onde aparece**: (1) aviso de primeiro uso de "Orquestrar neste painel" (a escolha vale para o projeto; só grava se mudou); (2) Configurações › Terminais › "Aprovações dos workers" (padrão global, botão "Salvar padrão"); (3) cartão do workspace: chip "aprovações dos workers: …" (com "(padrão)" quando herda) e botão "Alterar" que abre o diálogo do projeto (nível próprio ou "Voltar ao padrão global", caixa "Projeto confiável" e caixa "Permitir também na raiz do projeto" com confirmação).
- **Cabeçalho do painel do worker**: chip "aprovações: automático seguro" (verde), "total (bypass)" (vermelho, negrito) ou "perguntar sempre"; borda tracejada quando o app rebaixou o nível por segurança, e o título explica o motivo (raiz do projeto, projeto não confiável, sem worktree).
- **Worker aguardando**: depois de 8 s contínuos em "aguardando", chip âmbar "Worker aguardando sua aprovação" com "Ir para o painel" (some se o painel já está em foco).

## Adicionar workspace (D-600 a D-609, D-613 a D-615)

Modal lazy (`Dialogo`, largura 940 px, altura ≤ 720 px / 88 vh) com **sub-navegação lateral à esquerda** (`SubNavegacao`: Abrir pasta · Clonar repositório · Novo projeto), escala "conforto" e só tokens (destaque azul, sem rosa, nenhuma cor literal). Uma ação primária por seção; rodapé fixo com a ação principal e uma dica do que falta.

- **Entradas.** "+" do painel de workspaces, "Adicionar workspace…" do seletor do topo, botão "Abrir projeto" do primeiro uso na Início, botão da tela Projetos, ⌘K (Adicionar workspace…, Clonar repositório…, Novo projeto…: abrem já na seção) e ⌘⇧O / Ctrl+Shift+O. O item de menu "Abrir pasta…" e ⌘O (Windows/Linux Ctrl+Alt+O) continuam indo DIRETO ao diálogo nativo.
- **Abrir pasta.** Primário "Escolher pasta…" (diálogo nativo). "Recentes" (até 6, com o atual marcado). "Encontrar projetos nesta máquina": só por clique ("Procurar projetos"); durante a busca mostra pastas verificadas e "Cancelar busca"; cada achado tem nome, pasta `~/…`, branch (ou manifesto), selo "Já é workspace" e "Adicionar"/"Abrir". Vazio: "Nenhum projeto encontrado nos locais comuns".
- **Clonar repositório.** Campo "URL ou identificador" (https, ssh, scp ou `dono/repo`), com selo do servidor (GitHub, GitLab, Bitbucket, Azure DevOps, outro) e o motivo da recusa em linguagem simples (inclusive "não coloque usuário, senha ou token na URL: `gh auth login`"). "Origem em pasta local" (permitir + confirmar). **Meus repositórios**: com `gh` autenticado, "Carregar meus repositórios" (rede, por clique), filtro local, selo "Privado", ordenado por último push; sem login, botão "Abrir terminal para `gh auth login`"; sem `gh`, instrução. **O que salvar**: pasta de destino (`~/…`, "Escolher pasta…", "Usar como minha pasta de projetos"), nome da pasta (padrão = nome do repo), branch opcional, histórico completo (padrão) ou raso `--depth 1`, "Incluir submódulos" (desligado). Colisão: aviso com "Usar “nome-2”" e "Abrir a existente"; nunca sobrescreve. **Revisar e clonar…** abre o painel de consentimento (servidor, repositório, destino exato, opções, "Isto baixa o repositório para o seu computador") e só o botão **Clonar** inicia.
- **Progresso.** Título "Clonando host/dono/repo…", destino, fase (Contando, Comprimindo, Recebendo objetos, Resolvendo deltas, Extraindo arquivos, Baixando submódulos), `role="progressbar"` (indeterminada sem valor), bytes e velocidade, região `aria-live` que muda por fase e a cada 25 %, "Cancelar clone" (apaga só a pasta parcial). `prefers-reduced-motion`: sem animação.
- **Fim.** "Pronto": o workspace já é o atual, nota de "não confiável para execução até você confiar", botões "Abrir" (fecha) e, se a suíte não está completa, "Instalar suíte ExpxDev" (abre o assistente existente). Erro: mensagem acionável (+ terminal de login sem executar nada) e o formulário preservado; cancelado: "Voltar".
- **Novo projeto.** Nome (validado), pasta de destino, ponto de partida (Pasta vazia, Node, Python, Documentação), "Iniciar repositório git" (ramo `main`), `.gitignore`, commit inicial (só com identidade git; senão avisa), README, "Instalar a suíte ExpxDev ao criar" (opt-in). "Pronto" com os avisos.
- **A11y.** `role="dialog"` modal, foco preso e devolvido, `tablist` vertical, `aria-live` no progresso, Esc só fecha sem clone (com clone pergunta), alvos ≥ 32 px (conforto).

## Commit e push / Enviar PR (D-630 a D-639)
- **Onde e quando.** Grupo esquerdo do cabeçalho: `[fixar][workspace][Executar][Commit e push][Enviar PR]`, SOMENTE na tela Terminais, em repositório git com `origin` no GitHub (github.com por https/ssh; Enterprise e outros hosts não mostram na v1). Medida do cabeçalho compacto (botões de 26 px, ícone de 16 px na escala do topo, 40 px de altura preservados); a busca continua centralizada e nunca é coberta (em cabeçalho estreito, < 1500 px de largura do topo, os botões viram só ícone com tooltip e o badge vira um ponto; o seletor de workspace cede o espaço, nunca o Executar).
- **Estados.** "Commit e push" desabilitado com "Nada para commitar"; com commits locais vira "Enviar commits"; badge `N · ↑M` (arquivos alterados, commits à frente). "Enviar PR" desabilitado com "Instale/autentique o gh (gh auth login)", "Crie um branch primeiro" (branch padrão) ou "faça o commit primeiro". `aria-disabled` em vez de `disabled`: continua focável e o tooltip aparece; nome acessível inclui o motivo.
- **Diálogo (um clique, uma ação primária).** Resumo local: `branch → origin/destino · dono/repo`, N arquivos +A/−R, os 8 primeiros NOMES e "e mais N" (nunca conteúdo); caixa vermelha "Não vou incluir estes arquivos" para ambiente/chaves/credenciais. Opções: Criar branch novo (marcado no branch padrão, com nome editável `feat/<resumo>-MMDD`; desmarcar no padrão leva à confirmação digitada `push na main` em diálogo à parte), Incluir arquivos novos (ligado), mensagem do commit pelo agente (recomendado) ou manual; no PR: título e descrição pelo agente ou manuais, rascunho, base e revisores; "O agente que vai executar" (CLI do painel em foco, senão a padrão do workspace, com troca). Primário: "Enviar instrução ao agente". Foco inicial no resumo (topo), Esc fecha sem enviar. Agente ocupado: "O agente está trabalhando. Abrir um painel novo para isto?" no próprio diálogo. Falha: motivo no diálogo, sem navegar.
- **Depois.** Foca o painel do agente, faixa discreta "Commit e push enviado ao agente…" com "Acompanhar" e ×, e toasts ("Commit abc1234 criado em…", "Commit abc1234 enviado para origin/feat/…", "PR #42 criado") com "Abrir no navegador" (só https://github.com).
- **Atalhos e paleta.** ⌘⇧U / Ctrl+Shift+U (Commit e push) e ⌘⇧Y / Ctrl+Shift+Y (Enviar PR), só com o botão habilitado; a paleta ⌘K lista "Commit e push…" e "Enviar PR…" (grupo Versionamento) quando os botões estão visíveis.
- **A11y e movimento.** Grupo `role="group"` "Publicar no GitHub", região `aria-live="polite"` com o andamento, modal com foco preso e devolvido, `prefers-reduced-motion` respeitado, sem cor literal (tokens; destaque azul).
- **Contagem, suíte e Atualizar (D-691..D-693).** O badge de "Commit e push" conta arquivos rastreados alterados + pastas/arquivos novos no nível do `git status` (uma pasta nova vale 1); `.expx/`, `.opencode/`, `.claude/` e `.expxv/` não rastreados são "da suíte" e ficam de fora: só elas = "Nada para commitar", sem badge, tooltip "3 pastas da suíte não rastreadas" e o clique abre o diálogo mesmo assim. O diálogo mostra "N arquivos alterados · M pastas/arquivos novos" e, havendo suíte, uma seção com a lista, a explicação do `.git/info/exclude` (local, nunca vai ao remoto) e duas ações: "Ignorar neste computador" e "Incluir no commit" (desmarcado). Terceiro botão "Atualizar" (ícone `baixar`, badge `↓N`) com tooltip "Trazer N commits de origin/main para main"; desabilitado com "Já está atualizado", sem upstream, merge/rebase em curso ou "Atualizando…". Diálogo "Atualizar": resumo (assuntos e arquivos tocados, só nomes), uma ação ("Trazer N commits"), aviso de alterações locais no caminho com dica de commitar, e, se divergiu, "Pedir ao agente para fazer o merge". Toast "Trouxe N commits". Paleta ⌘K: "Atualizar (pull)" e "Pastas da suíte: ignorar ou incluir…". Só tokens, sem rosa.

## Painel de progresso da pipeline (D-660 a D-665)

Coluna **fixa à direita da grade de terminais**, dentro da tela Terminais, só enquanto algo executa. É opcional (Configurações > Terminais), estreita e some sozinha ao terminar; a área de trabalho dos terminais continua maximizada (D-32).

- **Medidas.** 248 px por padrão, 200 a 320 pelo divisor da borda esquerda (teclado: setas, 16 px; persistida), 24 px recolhido. Abaixo de 1000 px de janela, ou no foco único, só a barra de 24 px; clicar a expande **por cima** dos terminais (Esc recolhe).
- **Cabeçalho de uma linha.** Título do progresso ("Pipeline: nova feature", "Sprint: Frete grátis", "/expx:runx"), contador "3/9", `⋯` (Fixar aberto, Ver detalhes na tela Pipelines), recolher, fechar. Barra fina de 3 px logo abaixo (azul; âmbar aguardando; vermelha falha; verde concluído). Linha discreta com "Etapas previstas" (lista conhecida, não medida) e o pedido já redigido.
- **Lista TO-DO (`ol`).** Por item: marca (círculo vazio pendente; anel girando em andamento; ✓ verde concluído, com check animado curto; "!" vermelho falhou; pausa âmbar aguardando você; traço pulado), rótulo de até 2 linhas, nota discreta e tempo. A etapa em andamento fica em destaque azul e a lista rola para mantê-la visível; concluídas esmaecem; puladas riscadas e fora da contagem. Item com terminal é um botão (foca o painel da sessão); "aguardando você" mostra "Abrir" no rodapé.
- **Sprintx.** Tasks agrupadas por fase com cabeçalho curto e contador; fase concluída colapsa sozinha, a que tem a task atual abre, o dono inverte qualquer uma.
- **Vários progressos.** Abas minúsculas (no máximo 3) e "e mais N"; o que pede atenção (falha ou aguardando) aparece primeiro.
- **Ciclo de vida.** Abre sozinho; resumo de 2 s ("Concluído: 9/9 em 4 min" ou "Parou na etapa X: falhou"); fecha com animação de 200 ms e deixa o toast "Ver resumo" (leitura por 10 s). Falha e aguardando não fecham sozinhos; "Fixar aberto" mantém o resumo; fechar dispensa só aquele progresso.
- **Por workspace.** Só o progresso do workspace atual aparece; os outros seguem em segundo plano e aparecem no card do painel de workspaces como "etapa 4/9" (âmbar se aguarda você, vermelho se parou).
- **A11y.** `aside` com nome, `ol`, `aria-current="step"`, estado de cada item em texto, `aria-live="polite"` só para mudança de etapa, foco visível, `prefers-reduced-motion`.
