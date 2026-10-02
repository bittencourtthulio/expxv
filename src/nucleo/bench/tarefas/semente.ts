// Semente de 9 tarefas (T-12.03) com fixtures embutidas (texto no módulo: nada para copiar no empacotamento). Só o sistema solar tem prompt literal na spec 14 (§8.2); o resto é base [DEC]
// (`origem: autoral`/`observada_parafrase`), a ser trocado pelo original quando o dono o fornecer. Nenhum texto cita nome de modelo. As 7 ativas são reprodutíveis e sem rede; `fps-dust2`
// (pesada) e `apple-site-clone` (depende de site que muda) ficam em `rascunho`, fora da bateria padrão. Nas tarefas de código, a checagem `node --test` FALHA antes de qualquer solução
// (o teste da tarefa prova isso).
import type { ChecagemTarefa, EstadoTarefa, OrigemTarefa, TipoTarefa } from "../tipos";

export interface TarefaSemente {
  slug: string;
  titulo: string;
  atividade: string;
  tipo: TipoTarefa;
  prompt: string;
  escopo: string;
  checagens: ChecagemTarefa[];
  estado: EstadoTarefa;
  origem: OrigemTarefa;
  /** arquivos copiados para o workdir antes da execução (caminho relativo → conteúdo). */
  fixtures: Record<string, string>;
}

/** Primeiro parágrafo do cabeçalho headless (spec 14 §8.3), SEM a palavra de esforço: o esforço vai na flag do adaptador. */
export const CABECALHO_HEADLESS =
  "Você está em modo headless, single shot, sem confirmação. Ninguém vai responder pergunta, aprovar passo, nem continuar a sessão. Se travar esperando, a entrega morre. Trabalhe somente nesse diretório.";

const existe = (alvo: string, critica = true): ChecagemTarefa => ({ tipo: "file_exists", alvo, critica });
const contem = (alvo: string, texto: string, critica = false): ChecagemTarefa => ({ tipo: "contains_text", alvo, texto, critica });
const testes: ChecagemTarefa = { tipo: "command_exit_zero", alvo: "node --test", critica: true };

const SOMA_BUGADA = `// Soma os valores de uma lista de números (ignora itens não numéricos).
function somar(lista) {
  let total = 0;
  for (let i = 1; i < lista.length; i++) {
    if (typeof lista[i] === "number") total += lista[i];
  }
  return total;
}
module.exports = { somar };
`;
const SOMA_TESTE = `const test = require("node:test");
const assert = require("node:assert");
const { somar } = require("./soma.js");
test("soma todos os números", () => assert.strictEqual(somar([1, 2, 3]), 6));
test("ignora itens não numéricos", () => assert.strictEqual(somar([5, "x", 5]), 10));
test("lista vazia vale zero", () => assert.strictEqual(somar([]), 0));
`;

const PRECOS_ANTIGO = `// Formatação de preços espalhada e duplicada. Mantenha o comportamento.
function totalCarrinho(itens) {
  let t = 0;
  for (const i of itens) t = t + i.preco * i.qtd;
  return "R$ " + t.toFixed(2).replace(".", ",");
}
function totalPedido(itens, frete) {
  let t = 0;
  for (const i of itens) t = t + i.preco * i.qtd;
  t = t + frete;
  return "R$ " + t.toFixed(2).replace(".", ",");
}
module.exports = { totalCarrinho, totalPedido };
`;
const PRECOS_TESTE = `const test = require("node:test");
const assert = require("node:assert");
const m = require("./precos.js");
const itens = [{ preco: 10, qtd: 2 }, { preco: 5.5, qtd: 1 }];
test("totalCarrinho mantém o comportamento", () => assert.strictEqual(m.totalCarrinho(itens), "R$ 25,50"));
test("totalPedido mantém o comportamento", () => assert.strictEqual(m.totalPedido(itens, 4.5), "R$ 30,00"));
test("a refatoração extrai formatarMoeda e somarItens", () => {
  assert.strictEqual(typeof m.formatarMoeda, "function");
  assert.strictEqual(typeof m.somarItens, "function");
  assert.strictEqual(m.formatarMoeda(7), "R$ 7,00");
  assert.strictEqual(m.somarItens(itens), 25.5);
});
`;

const CSV_SUJO = `id,nome,email,cidade
1, Ana Souza ,ANA@EXEMPLO.COM,são paulo
2,Bruno Lima,bruno@exemplo.com,RIO DE JANEIRO
3,ana souza,ana@exemplo.com,São Paulo
4,Carla Dias,,Curitiba
5,Bruno Lima,bruno@exemplo.com,rio de janeiro
`;
const LIMPAR_TESTE = `const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const linhas = () => fs.readFileSync("limpo.csv", "utf8").trim().split(/\\r?\\n/);
test("limpo.csv existe com cabeçalho", () => assert.strictEqual(linhas()[0], "id,nome,email,cidade"));
test("duplicados removidos (3 pessoas)", () => assert.strictEqual(linhas().length, 4));
test("e-mail em minúsculas e sem espaços", () => assert.ok(linhas().slice(1).every((l) => { const e = l.split(",")[2]; return e === e.toLowerCase().trim(); })));
test("relatório do que foi corrigido existe", () => assert.ok(fs.existsSync("RELATORIO.md")));
`;

const PAGINA_QUEBRADA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Loja</title><link rel="stylesheet" href="styles.css"></head>
<body><header><h1>Loja</h1><nav><a href="#">Início</a><a href="#">Produtos</a><a href="#">Contato</a></nav></header>
<main><section class="grade"><article>Produto A</article><article>Produto B</article><article>Produto C</article><article>Produto D</article></section></main></body></html>
`;
const CSS_QUEBRADO = `body { margin: 0; font-family: sans-serif; }
header { display: flex; justify-content: space-between; width: 1200px; }
nav a { margin-right: 24px; }
.grade { display: grid; grid-template-columns: repeat(4, 280px); gap: 16px; width: 1200px; }
article { background: #eee; padding: 48px; }
`;

const REVISAO_CODIGO = `// diff para revisão: carrinho.js
function aplicarDesconto(preco, percentual) {
  return preco - preco * percentual / 10; // desconto em percentual
}
function buscarUsuario(db, nome) {
  return db.query("SELECT * FROM usuarios WHERE nome = '" + nome + "'");
}
function ultimoItem(lista) {
  return lista[lista.length];
}
`;

const PROMPT_REVISAO = "Revise o arquivo carrinho.js e liste os problemas por severidade (alta, média, baixa), cada um com a linha, o motivo e a correção sugerida. Grave o resultado em REVISAO.md. Não altere o código.";

export const SEMENTE_TAREFAS: readonly TarefaSemente[] = [
  {
    slug: "solar-system-3d", titulo: "Sistema solar 3D interativo", atividade: "web-interativa", tipo: "web", estado: "ativa", origem: "observada_literal", fixtures: {},
    prompt: "Crie um único arquivo HTML, sistema solar 3D interativo, o Sol no centro e os oito planetas orbitando em velocidades realistas. Grave como index.html, autocontido (sem depender de rede).",
    escopo: "Escopo: não entregue só um círculo girando. Deve ter o Sol, os oito planetas em órbitas proporcionais, controle de câmera e velocidade ajustável.",
    checagens: [existe("index.html"), contem("index.html", "<canvas"), contem("index.html", "requestAnimationFrame")],
  },
  {
    slug: "canvas-physics-lab", titulo: "Laboratório de física em Canvas", atividade: "web-interativa", tipo: "web", estado: "ativa", origem: "observada_parafrase", fixtures: {},
    prompt: "Crie um único arquivo HTML com um laboratório de física em Canvas: bolinhas com gravidade, colisão entre si e com as paredes, e controles para adicionar bolinhas e alterar a gravidade. Grave como index.html, autocontido.",
    escopo: "Escopo: as colisões precisam conservar energia de forma plausível e os controles precisam funcionar de verdade.",
    checagens: [existe("index.html"), contem("index.html", "<canvas"), contem("index.html", "requestAnimationFrame")],
  },
  {
    slug: "debug-find-and-fix", titulo: "Encontrar e corrigir um bug", atividade: "bug", tipo: "codigo", estado: "ativa", origem: "autoral",
    fixtures: { "soma.js": SOMA_BUGADA, "soma.test.js": SOMA_TESTE },
    prompt: "A função somar de soma.js retorna valores errados. Encontre e corrija o bug, faça os testes de soma.test.js passarem (node --test) e explique a causa em CAUSA.md.",
    escopo: "Escopo: corrija a causa, não os testes. Não altere soma.test.js.",
    checagens: [testes, existe("CAUSA.md", false)],
  },
  {
    slug: "css-responsive", titulo: "Tornar uma página responsiva", atividade: "css", tipo: "web", estado: "ativa", origem: "autoral",
    fixtures: { "index.html": PAGINA_QUEBRADA, "styles.css": CSS_QUEBRADO },
    prompt: "A página index.html quebra em telas pequenas (largura fixa, rolagem horizontal). Torne-a responsiva editando apenas styles.css, sem alterar o conteúdo do HTML.",
    escopo: "Escopo: deve funcionar de 320 px a 1440 px, com a grade reorganizando as colunas e a navegação legível.",
    checagens: [existe("styles.css"), contem("styles.css", "@media", true), contem("index.html", "viewport")],
  },
  {
    slug: "code-review", titulo: "Revisão de código", atividade: "review", tipo: "analise", estado: "ativa", origem: "autoral",
    fixtures: { "carrinho.js": REVISAO_CODIGO },
    prompt: PROMPT_REVISAO,
    escopo: "Escopo: aponte também o que NÃO é problema se houver dúvida, sem inventar defeitos.",
    checagens: [existe("REVISAO.md"), contem("REVISAO.md", "carrinho.js")],
  },
  {
    slug: "refactor-existing-code", titulo: "Refatorar código existente", atividade: "refactor", tipo: "codigo", estado: "ativa", origem: "autoral",
    fixtures: { "precos.js": PRECOS_ANTIGO, "precos.test.js": PRECOS_TESTE },
    prompt: "Refatore precos.js eliminando a duplicação: extraia formatarMoeda(valor) e somarItens(itens), mantenha o comportamento de totalCarrinho e totalPedido e faça precos.test.js passar (node --test).",
    escopo: "Escopo: não altere precos.test.js; não mude a assinatura pública existente.",
    checagens: [testes],
  },
  {
    slug: "dirty-data", titulo: "Normalizar dados sujos", atividade: "dados", tipo: "codigo", estado: "ativa", origem: "autoral",
    fixtures: { "dados.csv": CSV_SUJO, "limpar.test.js": LIMPAR_TESTE },
    prompt: "O arquivo dados.csv está sujo (espaços, caixa, duplicados, e-mail vazio). Normalize, deduplique e grave limpo.csv (mesmo cabeçalho); reporte o que foi corrigido em RELATORIO.md e faça limpar.test.js passar (node --test).",
    escopo: "Escopo: não perca nenhuma pessoa distinta; mantenha o menor id de cada duplicado.",
    checagens: [testes, existe("limpo.csv"), existe("RELATORIO.md", false)],
  },
  {
    slug: "fps-dust2", titulo: "FPS estilo mapa clássico (pesada)", atividade: "web-interativa", tipo: "web", estado: "rascunho", origem: "autoral", fixtures: {},
    prompt: "Crie um FPS jogável no browser ambientado em um mapa de corredores e praças, com armas com dano real, inimigos que morrem, munição, HUD e efeitos sonoros. Grave como index.html, autocontido.",
    escopo: "Escopo: jogável de ponta a ponta; não entregue um cubo e um chão.",
    checagens: [existe("index.html")],
  },
  {
    slug: "apple-site-clone", titulo: "Clone de uma home de produto (precisa de rede)", atividade: "web-interativa", tipo: "web", estado: "rascunho", origem: "observada_parafrase", fixtures: {},
    prompt: "Clone a home de um site de produtos de consumo de referência em HTML/CSS/JS: menu, logo, hero e cards de produtos. Fidelidade visual máxima. Grave como index.html.",
    escopo: "Escopo: depende de um site que muda; por isso a tarefa fica fora da bateria padrão.",
    checagens: [existe("index.html")],
  },
];

/** Monta o prompt efetivo: cabeçalho headless genérico + escopo da tarefa + pedido. O esforço NUNCA entra aqui. */
export function promptEfetivo(t: { escopo: string; prompt: string }): string {
  return [CABECALHO_HEADLESS, t.escopo.trim(), t.prompt.trim()].filter((p) => p !== "").join("\n\n");
}
