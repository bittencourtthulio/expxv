# K · Passeio dos bichinhos (referência: ExpxMedia)

Base de conhecimento do passeio, das travessuras e do atalho escondido (D-650 a D-654). Lida SOMENTE do ExpxMedia (`central/ui/src/personagem/`); nada foi editado lá.

## O que o ExpxMedia faz (lido)

| Arquivo | O que faz |
|---|---|
| `PasseioAlma.tsx` + `passeio.ts` | Um clone fixo do personagem sai do botão do menu, anda (transição CSS de `transform`, 70 px/s) por cima de "poleiros" (botões do menu, cabeçalho da página, barra do topo, barra de uso), para em cada um e faz um exercício (esteira, halteres, flexão) por 6 a 9 s, e corre de volta (360 px/s) quando o passeio acaba. Passos = `setTimeout` encadeados; sem pointer-events; não passeia com `prefers-reduced-motion`. |
| `useOcioso.ts` | UM timer que confere a hora ao disparar; qualquer ação (movimento de 4 px ou mais, clique, tecla, rolagem, toque, foco) volta ao não-ocioso. 5 minutos por padrão. |
| `useSegredo.ts` + `AlmaViva.tsx` | O atalho escondido: **código Konami** (↑ ↑ ↓ ↓ ← → ← → B A) em qualquer lugar da janela, menos em campo de texto e terminal, OU **Shift + clique** no personagem. Chama o passeio na hora, por 40 s; clique em qualquer lugar ou Esc encerram. Não aparece em menu nem ajuda. |
| `useOlhar.ts`, `useEsquiva.ts`, `falas.ts` | Olhar que segue o mouse, esquiva e falas: continuam FORA do ExpxV (custo de CPU, D-460). |

## O que o ExpxV reaproveitou e o que é novo

- Reaproveitado: a ideia de passeio em transição CSS por trecho, a ociosidade por timer único que confere a hora, o rearme, a volta rápida, a regra de reduzir movimento, o Konami + Shift + clique e os 40 s com clique/Esc.
- Adaptado: vários bichinhos (slot + um por cartão do painel), máquina de estados pura por tabela, chão virtual (borda de cima do rodapé) em vez de poleiros por seletor, lugares de sono, encontros, ações de bichinho (no ExpxMedia são exercícios de academia), e a regra "workspace trabalhando não passeia".
- Novo (pedido do dono): travessuras com os elementos da tela (D-654).
- O nome do produto nunca aparece em `src/`; nada do ExpxMedia foi importado: código e arte foram reescritos e parametrizados.

## O ATALHO ESCONDIDO (só documentado aqui, de propósito)

> Digite, com a janela em foco e fora de campo de texto e terminal: **↑ ↑ ↓ ↓ ← → ← → B A** (ou **Shift + clique** no bichinho do rodapé do menu).

O que acontece: todos os bichinhos visíveis (mesmo os de workspaces trabalhando, mesmo sem ociosidade) saem andando para a **parada**: correm em fila até o centro da janela e dançam por ~4 s; depois passeiam livremente (com travessuras, se ligadas) até 40 s. Só **clique** ou **Esc** encerram (mexer o mouse ou digitar não); no fim, todos voltam correndo (≤ 1,5 s) e as travessuras se desfazem. Com movimento reduzido ou "Silenciar animações": aviso "Animações silenciadas: os bichinhos só fazem uma pose rápida." e uma pose estática de 1 s no centro. Não está no ⌘K, na ajuda de atalhos nem em tooltip (um teste varre `src/renderer` para garantir).

## Mapa do código

`src/renderer/bichinho/passeio/`: `maquina.ts` (fases, eventos, tabela, quem pode passear, ações), `geometria.ts` (chão, cantos, lugares de sono, sorteio semeado), `ocioso.ts` (detector), `segredo.ts` (Konami), `travessuras.ts` (lista branca/proibida, registro WAAPI, restauração), `controle.ts` (controlador), `Camada.tsx` + `passeio.css` (overlay), `casa.tsx` (ganchos e casinha), `ligar.ts` (store ↔ controlador). Encaixes: `Slot.tsx` e `Mini.tsx` (casas), `casca/SlotBichinho.tsx` (`PasseioBichinhos` lazy), `App.tsx` (montagem), `telas/config/SecaoBichinhos.tsx` (preferências).

## Travessuras: regras (resumo; texto completo em D-654)

Só visual (WAAPI em `translate`/`rotate`, nada de DOM/estilo/classe/atributo/React/layout); lista branca por região, tamanho e tipo; lista proibida (terminal, campos, foco, diálogos, menus, popovers, `aria-live`, `data-sem-travessura`); ≤ 3 simultâneas e ≤ 1 por bichinho; restauração ≤ 140 ms na primeira atividade e seca em visibilitychange, blur, troca de tela, diálogo/menu/popover, unmount, beforeunload e failsafe de 90 s; o primeiro clique nos 250 ms após a volta é descartado se cair sobre onde havia elemento deslocado.

## Verificação visual

Build do renderer numa pasta temporária (`vite build --outDir` fora do repositório), servidor estático em loopback e Chromium com `window.ade` falso: painel de workspaces com 3 cartões, ociosidade simulada, saída, passeio, ações, sono em lugares diferentes, volta, travessuras (elemento deslocado durante e `getBoundingClientRect` idêntico ao original depois) e o atalho escondido; 1280×800 e 1920×1080, claro e escuro. Tudo apagado ao fim.
