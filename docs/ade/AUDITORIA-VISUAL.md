# Auditoria visual do ExpxV

Auditoria de todas as telas do renderer, feita com a lente da skill `frontend-design` (hierarquia, tipografia, ritmo de espaçamento, consistência de raio/borda/sombra, alinhamento, contraste, estados vazios e de erro, clichês de template). Plano e correções no mesmo documento.

## Método

- Renderer gerado em pasta temporária (`vite build` com `window.ade` falso injetado: `src/renderer/a11y/ade-falso*.ts` mais as fábricas de teste de cada tela; `terminais`, `voz`, `captura`, `squads`, `vcs`, `mapa`, `bench`, `catalogo`, `alertas`, `jarvis`, `remoto`, `relay`, `relatorios` completados à parte). Servido por HTTP estático em loopback e percorrido com Playwright (chromium headless).
- Matriz: 22 telas (Gestão ágil fora do escopo) × todas as seções das sub-navegações × 1280×800, 1920×1080, 2560×1440 (primeira seção) e 800×600 (todas as seções) × tema claro e escuro: 246 capturas por rodada, todas passadas pelas checagens de DOM (fonte < 11.5 px, controle < 32 px, alvo < 24×20, texto cortado ou com overflow, elipse sem `title`, contraste < 4.5:1 / 3:1, caixa alta, campo sem rótulo, botão sem nome, linha < 36 px, alvos sobrepostos ou a < 4 px, ícone sem tamanho, coluna central com `max-width`).
- Inspeção visual (ferramenta Read) das capturas por tela, nos dois temas e nos quatro tamanhos de amostra.
- Rodadas: `antes` (estado inicial) e `depois` (após as correções). Capturas citadas em `docs/ade/perf/visual/` (PNG; nomes `antes_<largura>x<altura>_<tema>_<tela>[_<seção>].png`).
- Limite do método: o contraste só mede nós de texto (placeholder e texto dentro de canvas ficam de fora); `window.ade` falso não reproduz dados reais (ex.: "reseta em 26390 d" no Consumo é dado de fixture, não defeito).

## Inventário capturado

Início; Missões (Quadro, Lista, Board); Terminais (somente auditada); Pipelines (somente auditada: em redesenho); Squads; Método (Trabalhos, Violações, Instalação, Saúde); Versionamento (Mudanças, Branches, Histórico, PRs, Conflitos); Mapa (Grafo, Camadas, Fluxo, Hotspots, Entradas, Dados, Dívida); Memória (Pane, Missão, Squad, Projeto, Preferências, Saúde); Conhecimento (Grafo, Lista, Fontes, Aprendizados, Backend, Config); Chat; Relatórios (Pacotes, Revisão, Divulgação, Config); Alertas (Alertas, Regras, Canais, Modelos, Auditoria); Provedores; Harness (Política, Equivalência, Contas e limites, Decisões, Cofre); Consumo (Visão geral, Previsão e eficiência, Trocas, Detalhe por uso, Fontes e preços); Bench; Loja de MCPs; Catálogo (Skills, Agentes, Comandos, MCPs, Plugins, Hooks, Regras); Jarvis (Conversa, Controle remoto, Relay, Auditoria); Workspaces; Configurações (11 seções). Casca (menu, topo, rodapé) vista em todas as capturas. Não auditadas por ordem do dono: Gestão ágil.

## Achados

Gravidade: alta = ilegível, quebrado ou inacessível; média = feio ou inconsistente; baixa = refino. Status: corrigido, aceito ou adiado (com motivo).

| Id | Gravidade | Tela / tamanho | Achado | Evidência | Causa provável | Status |
|---|---|---|---|---|---|---|
| VIS-01 | alta | Alertas, 1280 e 800 | Coluna "Ações" e "Quando" cortadas à direita ("Abr…"); a 800 px a coluna Quando some | `antes_1280x800_escuro_alertas_alertas.png`, `antes_800x600_claro_alertas_alertas.png` (depois: mesmos nomes `depois_`) | grade da linha com última coluna de 17 em menor que o conteúdo (Lido + Silenciar + Abrir) | corrigido: coluna de ações fixa (232 px), cabeçalho e linha alinhados |
| VIS-02 | alta | Método › Trabalhos, 1280 | Card do trabalho com a última linha ("Atenção · Auditoria pendente") cortada | `antes_1280x800_escuro_metodo_trabalhos.png` | `VirtualLista` com `alturaItem` 68 e conteúdo de ~96 px na escala de conforto | corrigido: altura de item 100 |
| VIS-03 | alta | Casca (topo), 1280 e 800 | O chip de consumo "pior cl·2 87% …" invade a caixa de busca centralizada; a 800 px cobre a busca por inteiro | `antes_1280x800_escuro_casca-chip-consumo.png` (também visível em todas as capturas) | busca centralizada e chip posicionados sem reserva de largura | adiado: cabeçalho é área aprovada e intocável; o dono decide (sugestão: chip some abaixo de 1100 px ou vira só ícone com tooltip) |
| VIS-04 | média | Configurações › Voz e captura | Títulos e formulários centralizados dentro do cartão, único trecho do app fora do alinhamento à esquerda; faixas de fundo em cada grupo | `antes_…_configuracoes_voz-e-captura.png` → `depois_…` | colisão de nomes no CSS global: `.vc-grupo`/`.vc-secao` do Versionamento (`align-items:center`, `height:100%`) valiam também na Config | corrigido: classes da Config renomeadas para `cfgv-*` + teste de colisão de classes |
| VIS-05 | média | Mapa › Grafo, 1280 e 1920 | Canvas do grafo com ~240 px de altura e o resto da tela vazio | `antes_1280x800_escuro_mapa_grafo.png` → `depois_…` (canvas 647 px) | `.subnav-painel` é `block`: o `.mp-miolo` (`flex:1`) não preenchia | corrigido: `.mp-painel-raiz` flex em coluna |
| VIS-06 | média | Mapa e Conhecimento (todas as seções) | Botões e campos de 26 px, 22 px nos ícones, 33 controles < 32 px, textos de 10.5 px | `antes_…_conhecimento_lista.png` | raízes sem `data-modo`: herdavam os tokens densos do `:root` | corrigido: `data-modo="cheia"` nas duas raízes |
| VIS-07 | média | Versionamento (todas as seções) | Botões "Merge…/Rebase…/Novo branch", campos e minis de 20 a 24 px | `antes_…_versionamento_mudancas3.png` → `depois_…` | alturas fixas em px no `versionamento.css` | corrigido: tokens `--botao-altura`, `--campo-altura`, `--alvo-minimo` |
| VIS-08 | média | Conhecimento › Aprendizados | Linhas de 28 px com botões de 36 px vazando para as linhas vizinhas; chip "candidato" cortado; colunas fora do cabeçalho | `antes_…_conhecimento_aprendizados.png` → `depois_…` | grade com colunas `auto` e `alturaItem` 28 | corrigido: colunas fixas, linha de 40 px |
| VIS-09 | média | Harness › Política, Provedores (OpenRouter), Consumo (fontes e preços) | Cabeçalho da tabela desalinhado das linhas (Provedor, Esforço, Faixa deslocados 20 a 40 px); select "Sem f…" truncado | `antes_…_harness_politica.png` → `depois_…`; `antes_1280x800_claro_provedores.png` → `depois_…` | cada linha é um grid próprio e a última coluna era `auto`/`max-content` (largura por conteúdo) | corrigido: última coluna fixa; teste proíbe `auto`/`max-content` em grades de linha |
| VIS-10 | média | 9 telas (Conhecimento, Catálogo, Memória, Squads, Loja de MCPs, Consumo, Chat, Board, Harness) | Rótulos e cabeçalhos em CAIXA ALTA de 10.5 px com tracking ("CODIGO", "REVISAO" sem acento: id de domínio exposto) | `antes_…_harness_politica.png`, `antes_…_catalogo_skills.png` | padrão repetido de "eyebrow" em caixa alta | corrigido: caixa de frase, 11.5 a 12.5 px, 600; categoria do Harness com rótulo por extenso (Código, Revisão) |
| VIS-11 | média | Todas com botão primário desativado (Jarvis "Enviar", Relay, Relatórios "Gerar", Commit) | Azul a 50% de opacidade com rótulo quase ilegível | `antes_…_versionamento_mudancas3.png` ("Comitar (2)") | `.botao:disabled{opacity:.5}` sobre fundo de destaque | corrigido: primário desativado neutro (`--superficie-2`, texto suave) |
| VIS-12 | média | Consumo › Previsão e eficiência, ≥ 1280 | Rótulos dos eixos do gráfico a ~18 px (SVG com `width:100%` escala o texto) e gráfico enorme | `antes_…_consumo_previsao-e-eficiencia.png` → `depois_…` | `viewBox` de 560 px esticado a 900 px | corrigido: teto de 640 px no SVG |
| VIS-13 | média | Missões › Quadro, 1280 e 2560 | Colunas fixas de 240 px: a sétima fica cortada sem indicação a 1280 e, a 2560, o quadro termina a 80% da largura; corpo da coluna com teto de 520 px | `antes_2560x1440_escuro_missoes.png` → `depois_…` | `flex: 0 0 240px` | corrigido em parte: colunas crescem (`flex:1 0 220px`) e a altura acompanha a janela; a 1280 a rolagem horizontal continua (7 colunas), aceita |
| VIS-14 | média | Conhecimento, barra de filtros | Barra com rolagem horizontal escondida: controles saíam da janela (botão de índice a 1298 px) | medição DOM `fora-da-janela` | `overflow-x:auto; nowrap; scrollbar-width:none` | corrigido: a barra quebra em linhas |
| VIS-15 | média | Qualquer tela com `<small>` (Provedores, Consumo) | Texto de 10.4 px (83% do pai) | medição DOM `fonte<11.5` | `small` herda 83% | corrigido: piso de `--fs-micro` em `conforto.css` |
| VIS-16 | média | Mapa/Conhecimento, canvas do grafo 3D | Rótulos de 11 px, legenda de 10.5 px, controles de 22 px | medição DOM | `grafo3d.css` com px fixos | corrigido |
| VIS-17 | média | Qualquer erro de render numa tela | Sem *error boundary*: uma exceção desmonta o app inteiro (captura toda em branco, inclusive menu) | `antes_…_configuracoes_voz-e-captura.png` na 1ª rodada (API falsa incompleta) | `App.tsx`/casca sem fronteira de erro | adiado: casca é área aprovada; sugestão: `ErrorBoundary` por tela com mensagem e botão "Recarregar tela" (dono decide) |
| VIS-18 | média | Pipelines (todas as seções) | 6 textos de 11 px (`pl-discreto`), 16 cabeçalhos em caixa alta, linhas de 24 px, botões a 3 px de distância, alvo de 16 px | `antes_1280x800_escuro_pipelines_etapas.png` | CSS próprio da tela | adiado: **em redesenho por outro agente**; reavaliar após o redesenho |
| VIS-19 | baixa | Terminais | Um `svg` sem tamanho; barra com alvos de 26 px | `antes_1280x800_escuro_terminais.png` | área aprovada pelo dono | apenas registrado (não alterada) |
| VIS-20 | baixa | Memória › Pane | Filtros por tipo são só glifos (◉ ◆ ▲ · ■ ⇄ ✦ ≡) sem rótulo visível | `antes_…_memoria_pane.png` | economia de espaço | adiado: precisa de decisão de texto (o `aria-label` existe) |
| VIS-21 | baixa | Relatórios › Pacotes | Rótulo "Exportar" centralizado sobre o seletor; prévia em iframe branca no tema escuro | `antes_…_relatorios_pacotes.png` | `text-align` herdado; o documento do cliente é claro por definição | adiado (rótulo) / aceito (iframe) |
| VIS-22 | baixa | Harness, Consumo, Conhecimento | Chips e spans cortados (`custo desconhecido` 115>100, `limite atingido`, `candidato`) sem `title` | medição DOM `corte-horizontal`, `elipse-sem-title` | largura fixa de chip | adiado (refino) |
| VIS-23 | baixa | Estado "indisponível" (Squads, Bench, Catálogo…) fora do Electron | Caixa tracejada ocupa só 220 px de altura | `antes_…_squads.png` | `EstadoVazio` sem preencher | aceito: só aparece fora do app |
| VIS-24 | baixa | Itens da sub-navegação | 2 px entre itens (itens são linhas inteiras de 32+ px, sem risco de clique errado) | medição DOM `gap<4` | por desenho | aceito |
| VIS-25 | baixa | 2560×1440, telas de leitura | Tabelas esticam e deixam colunas muito espaçadas; muito vazio à direita (regra do dono: 100% da largura) | `antes_2560x1440_claro_harness.png` | decisão de layout | aceito |
| VIS-26 | baixa | Missões › Quadro | `summary "custo desconhecido"` com 23 px de altura | medição DOM `altura<32` | raiz sem `data-modo` | adiado (refino) |

Totais: 3 altas (2 corrigidas, 1 de casca adiada), 15 médias (13 corrigidas, 1 adiada por área aprovada, 1 por redesenho), 8 baixas (1 refino extra corrigido junto, 2 aceitas por desenho, 5 adiadas ou aceitas). Tela mais afetada no início: Conhecimento (cerca de 60 sinalizações de DOM), seguida de Mapa e Alertas.

## Plano de correção (por causa-raiz)

1. Tokens e componentes compartilhados: piso de `<small>`, primário desativado, grafo 3D (VIS-11, 15, 16). Feito.
2. Escala de conforto aplicada onde faltava: `data-modo` em Mapa e Conhecimento; alturas fixas trocadas por tokens em Versionamento, Catálogo, Chat, Jarvis, Loja, Squads, Mapa, Conhecimento, OpenRouter (VIS-06, 07).
3. Grades de tabela: coluna final fixa e `alturaItem` coerente (VIS-01, 02, 08, 09).
4. Colisão de classes no CSS global (VIS-04) e preenchimento de altura (VIS-05, 13).
5. Estilo tipográfico: fim da caixa alta em rótulos (VIS-10), teto de SVG (VIS-12), barra que quebra linha (VIS-14).
6. Fora do escopo: cabeçalho (VIS-03), error boundary (VIS-17), Pipelines (VIS-18), Terminais (VIS-19).

## Regressão: testes

`src/renderer/componentes/visual-css.test.ts` (estático): sem classe de topo definida em dois CSS (lista fechada das 7 existentes); sem `text-transform: uppercase` em telas; sem `auto`/`max-content` em grades de linha e cabeçalho; grafo 3D sem texto < 11.5 px; sem altura fixa de 16 a 31 px em botão/campo/seletor nas telas; Mapa e Conhecimento com `data-modo="cheia"` e painel flex; primário desativado legível e piso de `<small>`. Ajuste de teste existente: `harness/Tela.test.tsx` (categoria agora "Código" e "Revisão").

## O que o dono deve conferir na janela real

- Alertas: lista, coluna Ações inteira a 1280 e janela estreita.
- Método › Trabalhos: card completo (3 linhas).
- Mapa › Grafo e Conhecimento › Grafo: altura do canvas e barra de filtros que agora quebra linha; toque nos controles de 32 px.
- Configurações › Voz e captura: alinhamento à esquerda.
- Harness › Política e Provedores › OpenRouter: colunas alinhadas ao cabeçalho.
- Consumo › Previsão: gráfico de 640 px (ver se prefere maior ou em duas colunas).
- Missões › Quadro: rolagem horizontal a 1280 e preenchimento a 1920+.
- Decidir: VIS-03 (chip do topo), VIS-17 (error boundary), VIS-20 (rótulos dos filtros da Memória).

## Estado dos testes ao fechar

- Verde nos arquivos tocados: `src/renderer/componentes` (157), telas Harness, Método, Config, Mapa, Conhecimento, Alertas, Consumo, Provedores mais `tests/varredura-marca.test.ts` (294), e as varreduras `a11y` (telas, conhecimento, memória, custo, pipelines) isoladas.
- Execução completa de `src/renderer` sob carga da máquina: as varreduras `a11y` e `P-242` estouraram tempo e passam isoladas; `DiffView` (P-18, orçamento de tempo) idem.
- Falha alheia: `conforto-css.test.ts` aponta `bichinho/bichinho.css` (fontes de 10.5 a 11 px e `min-height: 26px`), feature de outro agente, fora desta auditoria.
