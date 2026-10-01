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
| Terminais | Grade | 1–3 | abas, divisão em árvore, piloto à esquerda + workers à direita, sinaleira, busca, paleta |
| Método | Andamento | 4 | trabalhos (sprintx/runx/prodx/buildx), estágio, fases/tasks, grafo do plano, rastro, violações, hooks e modos |
| Workspaces | Projetos | 2 | abrir pasta, recentes, git/worktrees, acesso externo, modo de permissão |
| Provedores | CLIs e contas | 2 | CLIs detectadas, versão, contas, executável manual, diagnóstico |
| Configurações | — | 5 | tema claro/escuro, destaque, atalhos, limites, scrollback, atualização |
| (pós-MVP) | Catálogo, Memória, Limites, Bench, Voz | 6+ | ver `06-FASES.md` |

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
alerta `#ff7b9c`, aviso `#f6c177`. Claro: derivado por inversão de luminosidade mantendo o
destaque. Fontes: Chakra Petch (UI) e JetBrains Mono (código), locais. Raio 14 px. Base 15 px/1.6.
Degradê de marca: `linear-gradient(135deg, destaque, destaque-2)` só em progresso/ação principal.
Tema xterm em constante TS, dois `ITheme` (escuro e claro). **Nenhuma cor literal fora de
`tokens.css` e dos dois temas do xterm** (teste de varredura).

## Acessibilidade

`role`/`aria-*` reais (`role="search"`, `aria-current="page"`, `role="tab"`, `role="dialog"`),
confirmações por diálogo da própria UI (nunca `window.confirm`; o e2e afirma zero diálogos nativos),
foco visível (`outline: 2px solid destaque`), `prefers-reduced-motion`, contraste AA nos dois temas.
