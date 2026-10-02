#!/usr/bin/env node
// Gerador/verificador das squads de FÁBRICA (Fase 14, T-14.08). Sem flag: VERIFICA e falha (código 1) se qualquer squad de
// `resources/squads/` estiver inválida, fora da fonte (`scripts/lib/squads-de-fabrica.mjs` + arquétipos) ou com hash
// divergente no manifesto. Com `--gerar`: regenera `resources/squads/` (squad.json, membros/*.md, rigor.json,
// manifesto.json) e verifica em seguida. Determinístico: rodar duas vezes dá os mesmos hashes. Sem rede, sem Electron.
//
// Os módulos TypeScript do núcleo (formato, validador, hashes) são carregados pelo próprio Vite em modo SSR (devDependency
// do projeto), então o script usa o MESMO código do app: não há segunda implementação do validador.
//
// Uso: node scripts/verificar-squads.mjs [--gerar]

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RIGOR, SKILLS_CONHECIDAS, SQUADS, VERSAO_PACOTE, promptDe, squadDe } from "./lib/squads-de-fabrica.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELOS_PERMITIDOS = new Set(["opus", "sonnet", "haiku", "default", null]);
const SQUADS_DO_PLANO = [
  "feature-fullstack", "correcao-de-bug", "revisao-de-pr", "refatoracao-legado", "testes-qa", "auditoria-seguranca", "documentacao",
  "devops-ci", "migracao-dependencias", "performance", "spike-pesquisa", "onboarding-projeto", "dupla-rapida",
];
const CAMINHO_ABSOLUTO = /(?:^|[\s"'`(=])(?:\/(?:Users|home|root|var|private|tmp|opt|etc|mnt|Volumes)\/|[A-Za-z]:[\\/])/;

function listarArquivos(dir, acc = []) {
  for (const nome of readdirSync(dir).sort()) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) listarArquivos(caminho, acc);
    else acc.push(caminho);
  }
  return acc;
}

function permissoesLegiveis(dir) {
  chmodSync(dir, 0o755);
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) permissoesLegiveis(caminho);
    else chmodSync(caminho, 0o644);
  }
}

async function carregarNucleo(raiz) {
  const { createServer } = await import("vite");
  const servidor = await createServer({
    root: raiz,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const carregar = (caminho) => servidor.ssrLoadModule(caminho);
  const [formato, validar, atualizar, produto, tipos, esforco] = await Promise.all([
    carregar("/src/nucleo/squads/formato.ts"),
    carregar("/src/nucleo/squads/validar.ts"),
    carregar("/src/nucleo/squads/fabrica/atualizar.ts"),
    carregar("/src/nucleo/produto.ts"),
    carregar("/src/nucleo/squads/tipos.ts"),
    carregar("/src/nucleo/squads/esforco.ts"),
  ]);
  return { formato, validar, atualizar, produto, tipos, esforco, fechar: () => servidor.close() };
}

function lerArquetipos(pasta) {
  const mapa = {};
  if (!existsSync(pasta)) return mapa;
  for (const nome of readdirSync(pasta)) if (nome.endsWith(".md")) mapa[nome.slice(0, -3)] = readFileSync(join(pasta, nome), "utf8");
  return mapa;
}

function mcpsConfirmados(raiz) {
  const arquivo = join(raiz, "resources", "mcp", "catalogo-mcps.json");
  if (!existsSync(arquivo)) return null;
  const seed = JSON.parse(readFileSync(arquivo, "utf8"));
  return new Set((seed.entradas ?? []).filter((e) => e.confirmado === true && e.classificacao !== "descartado").map((e) => e.id));
}

/**
 * Gera (opcional) e verifica as squads de fábrica. `raiz` é a raiz do repositório (testes passam uma cópia).
 * Devolve `{ ok, erros, resumo }`; nunca lança por conteúdo inválido.
 */
export async function verificarSquads({ raiz = RAIZ, gerar = false } = {}) {
  const erros = [];
  const pastaRes = join(raiz, "resources", "squads");
  const nucleo = await carregarNucleo(raiz);
  try {
    const { gravarSquadNoDiretorio, lerSquadDoDiretorio } = nucleo.formato;
    const { validarSquad, validarPrompt, pareceSegredo } = nucleo.validar;
    const { hashesDaSquad } = nucleo.atualizar;
    const arquetipos = lerArquetipos(join(pastaRes, "arquetipos"));

    // fonte → squads esperadas (objeto + texto de cada prompt)
    const esperadas = new Map();
    for (const def of SQUADS) {
      const squad = squadDe(def);
      const prompts = Object.fromEntries(def.membros.map((m) => [m.slug, promptDe(def, m, arquetipos)]));
      esperadas.set(def.slug, { squad, prompts });
    }

    if (gerar) {
      // só apaga o que ESTE gerador cria (pastas de squad: têm squad.json); arquivos de outros módulos em resources/squads/ ficam.
      for (const nome of existsSync(pastaRes) ? readdirSync(pastaRes) : []) {
        const dir = join(pastaRes, nome);
        if (statSync(dir).isDirectory() && existsSync(join(dir, "squad.json"))) rmSync(dir, { recursive: true, force: true });
      }
      mkdirSync(pastaRes, { recursive: true });
      // `esforco-por-cli.json` é DADO EDITÁVEL do usuário (T-14.05): o gerador nunca o apaga nem o sobrescreve; só o recria se faltar.
      const arqEsforco = join(pastaRes, "esforco-por-cli.json");
      if (!existsSync(arqEsforco)) writeFileSync(arqEsforco, `${JSON.stringify(nucleo.esforco.TABELA_ESFORCO_PADRAO, null, 2)}\n`);
      for (const [id, { squad, prompts }] of esperadas) await gravarSquadNoDiretorio(join(pastaRes, id), squad, prompts);
      writeFileSync(join(pastaRes, "rigor.json"), `${JSON.stringify({ schema_version: 1, niveis: RIGOR }, null, 2)}\n`);
      const manifesto = {
        schema_version: 1,
        versao_pacote: VERSAO_PACOTE,
        squads: [...esperadas.keys()].sort().map((id) => {
          const { squad, prompts } = esperadas.get(id);
          return { id, versao: squad.fabrica.versao, arquivos: hashesDaSquad(squad, prompts) };
        }),
      };
      writeFileSync(join(pastaRes, "manifesto.json"), `${JSON.stringify(manifesto, null, 2)}\n`);
      permissoesLegiveis(pastaRes);
    }

    // ---- verificação ----
    if (!existsSync(pastaRes)) return { ok: false, erros: ["resources/squads/ não existe (rode --gerar)"], resumo: { squads: 0, membros: 0 } };
    const dirs = readdirSync(pastaRes).filter((n) => statSync(join(pastaRes, n)).isDirectory() && n !== "arquetipos").sort();
    const catalogoMcps = mcpsConfirmados(raiz);
    const ctx = { skillsConhecidas: new Set(SKILLS_CONHECIDAS), mcpsConhecidos: catalogoMcps };
    let membros = 0;

    for (const slug of SQUADS_DO_PLANO) if (!dirs.includes(slug)) erros.push(`squad do plano ausente: ${slug}`);
    for (const slug of esperadas.keys()) if (!dirs.includes(slug)) erros.push(`squad da fonte ausente no disco: ${slug}`);
    for (const slug of dirs) if (!esperadas.has(slug)) erros.push(`squad no disco fora da fonte: ${slug}`);

    let manifesto = null;
    try {
      manifesto = JSON.parse(readFileSync(join(pastaRes, "manifesto.json"), "utf8"));
    } catch {
      erros.push("manifesto.json ausente ou ilegível");
    }
    if (manifesto !== null) {
      if (manifesto.schema_version !== 1) erros.push("manifesto.json: schema_version inesperado");
      const ids = (manifesto.squads ?? []).map((s) => s.id).sort();
      if (JSON.stringify(ids) !== JSON.stringify(dirs)) erros.push("manifesto.json não lista exatamente as squads do disco");
    }
    try {
      const rigor = JSON.parse(readFileSync(join(pastaRes, "rigor.json"), "utf8"));
      const niveis = (rigor.niveis ?? []).map((n) => n.nivel);
      if (JSON.stringify(niveis) !== "[1,2,3,4,5]" || rigor.niveis.some((n) => typeof n.texto !== "string" || n.texto.length < 40)) erros.push("rigor.json precisa ter os 5 níveis com texto");
      if (JSON.stringify(rigor.niveis) !== JSON.stringify(RIGOR)) erros.push("rigor.json diverge da fonte");
    } catch {
      erros.push("rigor.json ausente ou ilegível");
    }
    try {
      const bruto = JSON.parse(readFileSync(join(pastaRes, "esforco-por-cli.json"), "utf8"));
      const v = nucleo.esforco.validarTabelaEsforco(bruto);
      if (!v.ok) erros.push(`esforco-por-cli.json inválido: ${v.erros.map((e) => `${e.campo}: ${e.motivo}`).join("; ")}`);
    } catch {
      erros.push("esforco-por-cli.json ausente ou ilegível (rode --gerar para recriar)");
    }
    for (const nome of ["orquestrador", "explorador", "implementador", "revisor"]) if (arquetipos[nome] === undefined) erros.push(`arquétipo ausente: ${nome}`);

    for (const slug of dirs) {
      const dir = join(pastaRes, slug);
      let lida;
      try {
        lida = await lerSquadDoDiretorio(dir, "fabrica");
      } catch (e) {
        erros.push(`${slug}: ilegível: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const { squad, prompts } = lida;
      membros += squad.membros.length;
      for (const a of lida.avisos) erros.push(`${slug}: aviso de leitura: ${a}`);
      if (squad.slug !== slug) erros.push(`${slug}: slug do squad.json difere da pasta`);
      if (squad.fabrica === null || squad.fabrica.id !== slug) erros.push(`${slug}: campo fabrica ausente ou com id diferente`);
      const achados = validarSquad(squad, ctx);
      for (const a of achados) erros.push(`${slug}: ${a.severidade}/${a.gravidade} ${a.codigo} em ${a.caminho}: ${a.mensagem}`);
      if (squad.membros.filter((m) => m.papel === "orchestrator").length !== 1) erros.push(`${slug}: precisa de exatamente 1 orquestrador`);
      if (!squad.membros.some((m) => m.papel === "reviewer")) erros.push(`${slug}: sem revisor`);
      squad.membros.forEach((m, i) => {
        const texto = prompts[m.slug] ?? "";
        for (const a of validarPrompt(texto, `membros[${i}].prompt`)) erros.push(`${slug}/${m.slug}: ${a.codigo}: ${a.mensagem}`);
        if (!texto.includes("{{rigor}}")) erros.push(`${slug}/${m.slug}: prompt sem {{rigor}}`);
        if (!texto.includes("## Foco desta squad") || texto.includes("<!-- FOCO -->")) erros.push(`${slug}/${m.slug}: foco não materializado`);
        if (!texto.includes("## Regras herdadas") || !texto.includes("## Contrato de saída")) erros.push(`${slug}/${m.slug}: faltam as seções de regras herdadas ou contrato de saída`);
        if (!MODELOS_PERMITIDOS.has(m.perfil.modelo)) erros.push(`${slug}/${m.slug}: modelo fora de opus|sonnet|haiku|default: ${m.perfil.modelo}`);
        if (m.perfil.cli !== "claude") erros.push(`${slug}/${m.slug}: a fábrica prefere a CLI claude (pré-voo adapta)`);
        if (m.descricao.length > 140) erros.push(`${slug}/${m.slug}: descrição passa de 140 caracteres`);
      });
      const esperada = esperadas.get(slug);
      if (esperada !== undefined) {
        if (JSON.stringify(squad) !== JSON.stringify(esperada.squad)) erros.push(`${slug}: squad.json diverge da fonte (rode --gerar)`);
        for (const m of squad.membros) if ((prompts[m.slug] ?? "") !== (esperada.prompts[m.slug] ?? "\0")) erros.push(`${slug}/${m.slug}: prompt diverge da fonte (rode --gerar)`);
      }
      const entrada = manifesto?.squads?.find((s) => s.id === slug);
      if (entrada === undefined) erros.push(`${slug}: ausente do manifesto`);
      else {
        const hashes = hashesDaSquad(squad, prompts);
        if (JSON.stringify(entrada.arquivos) !== JSON.stringify(hashes)) erros.push(`${slug}: hashes do manifesto não conferem`);
        if (entrada.versao !== squad.fabrica?.versao) erros.push(`${slug}: versão do manifesto difere da squad`);
      }
      if (squad.membros.some((m) => m.skills_permitidas.length === 0)) erros.push(`${slug}: membro sem nenhuma skill (deny-by-default exige as do papel)`);
      void pareceSegredo;
    }

    // marca, caminho absoluto e segredo em QUALQUER arquivo da fábrica
    const { PRODUTO } = nucleo.produto;
    const termos = [PRODUTO.nome, PRODUTO.id, PRODUTO.appId, PRODUTO.scheme].map((t) => t.toLowerCase());
    for (const arquivo of listarArquivos(pastaRes)) {
      const rel = relative(raiz, arquivo);
      const texto = readFileSync(arquivo, "utf8");
      const minus = texto.toLowerCase();
      for (const t of termos) if (minus.includes(t)) erros.push(`${rel}: contém o nome do produto ("${t}")`);
      if (CAMINHO_ABSOLUTO.test(texto)) erros.push(`${rel}: contém caminho absoluto`);
      if (pareceSegredo(texto)) erros.push(`${rel}: parece conter segredo`);
    }
    return { ok: erros.length === 0, erros, resumo: { squads: dirs.length, membros, versao_pacote: manifesto?.versao_pacote ?? null } };
  } finally {
    await nucleo.fechar();
  }
}

const executadoDiretamente = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDiretamente) {
  const gerar = process.argv.includes("--gerar");
  verificarSquads({ gerar })
    .then((r) => {
      if (r.ok) {
        console.log(`squads de fábrica OK: ${r.resumo.squads} squads, ${r.resumo.membros} membros/prompts (pacote v${r.resumo.versao_pacote})${gerar ? " [regeneradas]" : ""}`);
        process.exit(0);
      }
      console.error(`squads de fábrica INVÁLIDAS (${r.erros.length}):`);
      for (const e of r.erros.slice(0, 60)) console.error(` - ${e}`);
      process.exit(1);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.stack ?? e.message : String(e));
      process.exit(1);
    });
}
