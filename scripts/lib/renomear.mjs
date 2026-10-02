// Renomeação do produto por lista FECHADA de arquivos (Fase 21, T-21.05, D-01, D-341, AU-18, AU-19).
// Tudo é edição de LINHA INTEIRA (mesmo número de linhas), o que torna a reversão exata: o relatório guarda, por arquivo,
// o sha256 antes/depois e cada linha antes/depois (só campos da lista fechada; nunca segredo nem caminho absoluto).
// Sem rede, sem Electron. `planejar` não grava; `aplicar` grava (atômico por arquivo, com desfazer em falha); `reverter` confere o hash.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const LISTA_FECHADA = ["src/nucleo/produto.ts", "package.json", "electron-builder.yml", ".github/workflows/*.yml", "build/distribuicao.json"];

/** O que o script NÃO altera: fica para a pessoa (e para o checklist, T-21.06). */
export const ITENS_MANUAIS = [
  { id: "icones", descricao: "Ícones e símbolo em build/ (icon.icns, icon.ico, icone-*.png, simbolo.svg): regenerar com a marca nova (scripts/gerar-icones.mjs)." },
  { id: "assinatura", descricao: "Identidade de assinatura: Developer ID/Team ID da Apple e certificado do Windows (publisher). Mudar o nome pode exigir novo certificado." },
  { id: "protocolo_url", descricao: "Protocolo de URL registrado no sistema (derivado do id): instaladores antigos continuam registrando o anterior." },
  { id: "repositorio_real", descricao: "Repositório de releases real (dono/repo): criar ou transferir no GitHub; o script só troca o texto." },
  { id: "cofre_keychain", descricao: "Cofre e Keychain/DPAPI: o item do chaveiro pertence ao nome do app; com --migrar-dados o primeiro boot copia os dados e pode pedir para reconfigurar o cofre." },
  { id: "documentacao", descricao: "README, docs/ e textos de interface escritos à mão que citam o nome antigo." },
];

const ID_VALIDO = /^[a-z][a-z0-9]{2,23}$/;
const DONO_VALIDO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_VALIDO = /^[A-Za-z0-9._-]{1,100}$/;
const HOST_VALIDO = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const APPID_VALIDO = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const token = (valor) => new RegExp(`(?<![A-Za-z0-9])${escapar(valor)}(?![A-Za-z0-9])`, "g");

/** @returns {{nome:string,id:string,idDadosExpr:string,idDados:string,idsAnteriores:string[],dono:string,repoExpr:string,repo:string,appId:string}} */
export function lerProduto(raiz) {
  const texto = readFileSync(join(raiz, "src/nucleo/produto.ts"), "utf8");
  const nome = /^const NOME = ("(?:[^"\\]|\\.)*");/m.exec(texto);
  const id = /^const ID = "([^"]*)";/m.exec(texto);
  if (!nome || !id) throw new Error("produto.ts: NOME/ID não encontrados no formato esperado");
  const dados = /^const ID_DADOS: string = (ID|"[^"]*");/m.exec(texto);
  const ant = /^const IDS_ANTERIORES: readonly string\[\] = (\[[^\]]*\]);/m.exec(texto);
  const rel = /repositorioReleases: \{ dono: "([^"]*)", repo: (ID|"[^"]*") \}/.exec(texto);
  if (!dados || !ant || !rel) throw new Error("produto.ts: ID_DADOS/IDS_ANTERIORES/repositorioReleases não encontrados (T-21.04)");
  const nomeValor = JSON.parse(nome[1]);
  const idDadosExpr = dados[1];
  const idDados = idDadosExpr === "ID" ? id[1] : JSON.parse(idDadosExpr);
  const repoExpr = rel[2];
  const builder = existsSync(join(raiz, "electron-builder.yml")) ? readFileSync(join(raiz, "electron-builder.yml"), "utf8") : "";
  const appId = /^appId: (\S+)/m.exec(builder)?.[1] ?? `com.expx.${id[1]}`;
  return {
    nome: nomeValor,
    id: id[1],
    idDadosExpr,
    idDados,
    idsAnteriores: JSON.parse(ant[1]),
    dono: rel[1],
    repoExpr,
    repo: repoExpr === "ID" ? id[1] : JSON.parse(repoExpr),
    repositorioReleases: { dono: rel[1], repo: repoExpr === "ID" ? id[1] : JSON.parse(repoExpr) },
    appId,
  };
}

/** Lança `Error` com mensagem em PT-BR citando o campo. `contexto.appIdAtual` serve para derivar o appId. */
export function validarOpcoes(op, contexto = {}) {
  if (op.id !== undefined && !ID_VALIDO.test(op.id)) throw new Error("id inválido: use ^[a-z][a-z0-9]{2,23}$ (minúsculas e dígitos, 3 a 24 caracteres)");
  if (op.nome !== undefined) {
    if (op.nome.trim() === "" || op.nome.length > 64) throw new Error("nome inválido: de 1 a 64 caracteres");
    if (CONTROLE.test(op.nome) || op.nome.includes("/")) throw new Error("nome inválido: sem caracteres de controle nem '/'");
  }
  if (op.dono !== undefined && !DONO_VALIDO.test(op.dono)) throw new Error("dono inválido (usuário/organização do GitHub)");
  if (op.repo !== undefined && !REPO_VALIDO.test(op.repo)) throw new Error("repo inválido (letras, dígitos, '.', '_' e '-')");
  if (op.hostFeed !== undefined && !HOST_VALIDO.test(op.hostFeed)) throw new Error("host do feed inválido: informe só o nome do host, sem esquema nem caminho");
  if (op.id !== undefined && contexto.appIdAtual !== undefined) {
    const appId = derivarAppId(contexto.appIdAtual, op.id);
    if (!APPID_VALIDO.test(appId)) throw new Error(`appId derivado inválido (DNS reverso): ${appId}`);
  }
}

function derivarAppId(atual, id) {
  const i = atual.lastIndexOf(".");
  return i < 0 ? `${atual}.${id}` : `${atual.slice(0, i)}.${id}`;
}

function escalarYaml(valor) {
  if (/^[A-Za-z][A-Za-z0-9 ._()\-]*$/.test(valor) && valor === valor.trim() && !/^(true|false|null|yes|no|on|off)$/i.test(valor)) return valor;
  return JSON.stringify(valor);
}
const paraArquivo = (nome) => nome.trim().replace(/\s+/g, "-");

/** Aplica `fn` a cada linha (sem o `\r` final). `fn` devolve a linha nova ou `undefined`. */
function editarLinhas(texto, fn) {
  const linhas = texto.split("\n");
  const edicoes = [];
  const novas = linhas.map((bruta, i) => {
    const cr = bruta.endsWith("\r") ? "\r" : "";
    const linha = cr ? bruta.slice(0, -1) : bruta;
    const nova = fn(linha, i);
    if (nova === undefined || nova === linha) return bruta;
    edicoes.push({ linha: i + 1, antes: linha, depois: nova });
    return nova + cr;
  });
  return { texto: novas.join("\n"), edicoes };
}

function arquivosDeWorkflow(raiz) {
  const dir = join(raiz, ".github/workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".yml")).sort().map((n) => `.github/workflows/${n}`);
}

/**
 * Monta o plano SEM gravar. `op`: `{nome?, id?, dono?, repo?, hostFeed?, migrarDados?}`.
 * @returns {{de:object, para:object, arquivos:Array<{caminho:string,sha256_antes:string,sha256_depois:string,edicoes:Array<{linha:number,antes:string,depois:string}>,_novo:string}>, manual:Array<{id:string,descricao:string}>, avisos:string[]}}
 */
export function planejar(raiz, op) {
  const atual = lerProduto(raiz);
  validarOpcoes(op, { appIdAtual: atual.appId });
  const nome = op.nome ?? atual.nome;
  const id = op.id ?? atual.id;
  const dono = op.dono ?? atual.dono;
  const avisos = [];
  let idDadosExpr = atual.idDadosExpr;
  let idsAnteriores = atual.idsAnteriores;
  if (op.migrarDados) {
    if (id === atual.idDados) throw new Error("--migrar-dados exige um id novo, diferente do id de dados atual (use --id)");
    idDadosExpr = "ID";
    idsAnteriores = [atual.idDados, ...atual.idsAnteriores.filter((x) => x !== atual.idDados && x !== id)];
  } else if (id !== atual.id && atual.idDadosExpr === "ID") {
    idDadosExpr = JSON.stringify(atual.idDados); // AU-18: os dados ficam onde estão
  }
  const repoExpr = op.repo !== undefined ? JSON.stringify(op.repo) : atual.repoExpr;
  const repo = op.repo ?? (repoExpr === "ID" ? id : atual.repo);
  const appId = derivarAppId(atual.appId, id);
  const arquivos = [];

  const registrar = (caminho, transforma) => {
    const abs = join(raiz, caminho);
    if (!existsSync(abs)) return null;
    const bruto = readFileSync(abs);
    const { texto, edicoes } = transforma(bruto.toString("utf8"));
    if (edicoes.length === 0) return { texto, edicoes };
    const novoBuf = Buffer.from(texto, "utf8");
    arquivos.push({ caminho, sha256_antes: sha(bruto), sha256_depois: sha(novoBuf), edicoes, _novo: texto });
    return { texto, edicoes };
  };

  registrar("src/nucleo/produto.ts", (t) =>
    editarLinhas(t, (l) => {
      if (/^const NOME = /.test(l)) return `const NOME = ${JSON.stringify(nome)};`;
      if (/^const ID = /.test(l)) return `const ID = ${JSON.stringify(id)};`;
      if (/^const ID_DADOS: string = /.test(l)) return `const ID_DADOS: string = ${idDadosExpr};`;
      if (/^const IDS_ANTERIORES: readonly string\[\] = /.test(l)) return `const IDS_ANTERIORES: readonly string[] = [${idsAnteriores.map((x) => JSON.stringify(x)).join(", ")}];`;
      if (/repositorioReleases: \{ dono: /.test(l)) return l.replace(/repositorioReleases: \{ dono: "[^"]*", repo: (?:ID|"[^"]*") \}/, `repositorioReleases: { dono: ${JSON.stringify(dono)}, repo: ${repoExpr} }`);
      return undefined;
    }),
  );

  registrar("package.json", (t) => {
    let campoName = false;
    return editarLinhas(t, (l) => {
      if (!campoName && /^ {2}"name": "/.test(l)) {
        campoName = true;
        return `  "name": ${JSON.stringify(id)},`;
      }
      if (/^ {2}"description": "/.test(l)) return l.replace(token(atual.nome), () => nome.replace(/["\\]/g, "\\$&"));
      return undefined;
    });
  });

  registrar("electron-builder.yml", (t) => {
    let secao = "";
    return editarLinhas(t, (l) => {
      const topo = /^([A-Za-z][\w-]*):/.exec(l);
      if (topo) secao = topo[1];
      if (/^appId: /.test(l)) return `appId: ${appId}`;
      if (/^productName: /.test(l)) return `productName: ${escalarYaml(nome)}`;
      const art = /^(\s*)artifactName: (.*)$/.exec(l);
      if (art) {
        const prefixoAtual = paraArquivo(atual.nome);
        return art[2].startsWith(prefixoAtual) ? `${art[1]}artifactName: ${paraArquivo(nome)}${art[2].slice(prefixoAtual.length)}` : undefined;
      }
      if (secao === "publish") {
        if (/^ {2}owner: /.test(l)) return `  owner: ${dono}`;
        if (/^ {2}repo: /.test(l)) return `  repo: ${repo}`;
      }
      return undefined;
    });
  });

  for (const caminho of arquivosDeWorkflow(raiz)) {
    registrar(caminho, (t) =>
      editarLinhas(t, (l) => {
        if (!/(^\s*(?:-\s*)?(?:name|path):|artifact|dist-app\/)/i.test(l)) return undefined;
        let n = l;
        if (atual.nome !== nome) n = n.replace(token(atual.nome), () => nome);
        if (atual.id !== id) n = n.replace(token(atual.id), () => id);
        return n;
      }),
    );
  }

  if (op.hostFeed !== undefined) {
    const r = registrar("build/distribuicao.json", (t) => {
      const total = t.split("\n").filter((l) => /^\s*"host": "/.test(l)).length;
      if (total !== 1) return { texto: t, edicoes: [] };
      return editarLinhas(t, (l) => (/^\s*"host": "/.test(l) ? l.replace(/"host": "[^"]*"/, `"host": ${JSON.stringify(op.hostFeed)}`) : undefined));
    });
    if (r === null) avisos.push("build/distribuicao.json ausente: host do feed não alterado");
    else if (r.edicoes.length === 0) avisos.push('build/distribuicao.json: esperava exatamente uma chave "host"; nada alterado');
  }

  return {
    de: { nome: atual.nome, id: atual.id, idDados: atual.idDados, appId: atual.appId, dono: atual.dono, repo: atual.repo },
    para: { nome, id, idDados: idDadosExpr === "ID" ? id : atual.idDados, appId, dono, repo, idsAnteriores },
    opcoes: { nome: op.nome ?? null, id: op.id ?? null, dono: op.dono ?? null, repo: op.repo ?? null, hostFeed: op.hostFeed ?? null, migrarDados: op.migrarDados === true },
    arquivos,
    manual: ITENS_MANUAIS.map((m) => ({ ...m })),
    avisos,
  };
}

function gravarAtomico(abs, texto) {
  const tmp = `${abs}.renomear-${process.pid}.tmp`;
  writeFileSync(tmp, texto);
  renameSync(tmp, abs);
}

function nomeDoRelatorio(raiz, hoje) {
  const dia = hoje.toISOString().slice(0, 10);
  let caminho = join(raiz, `renomeacao-${dia}.json`);
  for (let i = 2; existsSync(caminho); i++) caminho = join(raiz, `renomeacao-${dia}-${i}.json`);
  return caminho;
}

/** Grava os arquivos do plano e o relatório. Falha no meio: desfaz o que gravou. */
export function aplicar(raiz, plano, { hoje = new Date() } = {}) {
  const originais = new Map();
  try {
    for (const a of plano.arquivos) {
      const abs = join(raiz, a.caminho);
      const atualBuf = readFileSync(abs);
      if (sha(atualBuf) !== a.sha256_antes) throw new Error(`${a.caminho} mudou desde o planejamento; planeje de novo`);
      originais.set(abs, atualBuf);
    }
    for (const a of plano.arquivos) gravarAtomico(join(raiz, a.caminho), a._novo);
  } catch (e) {
    for (const [abs, buf] of originais) writeFileSync(abs, buf);
    throw e;
  }
  const relatorio = {
    versao: 1,
    gerado_em: hoje.toISOString(),
    de: plano.de,
    para: plano.para,
    opcoes: plano.opcoes,
    arquivos: plano.arquivos.map(({ _novo, ...resto }) => resto),
    manual: plano.manual,
    avisos: plano.avisos,
  };
  const caminhoRelatorio = nomeDoRelatorio(raiz, hoje);
  writeFileSync(caminhoRelatorio, `${JSON.stringify(relatorio, null, 2)}\n`);
  return { relatorio, caminhoRelatorio };
}

/** Restaura os arquivos pelo relatório. Recusa (sem tocar em nada) se algum arquivo mudou depois da renomeação. */
export function reverter(raiz, caminhoRelatorio) {
  const relatorio = JSON.parse(readFileSync(resolve(caminhoRelatorio), "utf8"));
  if (relatorio.versao !== 1 || !Array.isArray(relatorio.arquivos)) throw new Error("relatório de renomeação inválido");
  const novos = [];
  for (const a of relatorio.arquivos) {
    if (typeof a.caminho !== "string" || a.caminho.startsWith("/") || a.caminho.split("/").includes("..")) throw new Error("relatório com caminho inválido");
    const abs = join(raiz, a.caminho);
    const buf = readFileSync(abs);
    if (sha(buf) !== a.sha256_depois) throw new Error(`${a.caminho} mudou depois da renomeação; reversão recusada`);
    const linhas = buf.toString("utf8").split("\n");
    for (const e of a.edicoes) {
      const bruta = linhas[e.linha - 1];
      const cr = bruta.endsWith("\r") ? "\r" : "";
      if ((cr ? bruta.slice(0, -1) : bruta) !== e.depois) throw new Error(`${a.caminho}:${e.linha} não confere com o relatório`);
      linhas[e.linha - 1] = e.antes + cr;
    }
    const texto = linhas.join("\n");
    if (sha(Buffer.from(texto, "utf8")) !== a.sha256_antes) throw new Error(`${a.caminho}: o resultado não bate com o original`);
    novos.push({ abs, texto, original: buf, caminho: a.caminho });
  }
  const feitos = [];
  try {
    for (const n of novos) {
      gravarAtomico(n.abs, n.texto);
      feitos.push(n);
    }
  } catch (e) {
    for (const n of feitos) writeFileSync(n.abs, n.original);
    throw e;
  }
  return { restaurados: novos.map((n) => n.caminho) };
}

export function resumo(plano) {
  const linhas = [`${plano.de.nome} (${plano.de.id}) -> ${plano.para.nome} (${plano.para.id}); appId ${plano.de.appId} -> ${plano.para.appId}`];
  linhas.push(`id de dados: ${plano.de.idDados} -> ${plano.para.idDados}${plano.opcoes.migrarDados ? " (migração por cópia no primeiro boot)" : " (inalterado)"}`);
  for (const a of plano.arquivos) {
    linhas.push(`  ${a.caminho}`);
    for (const e of a.edicoes) linhas.push(`    L${e.linha}: ${e.antes.trim()}  =>  ${e.depois.trim()}`);
  }
  if (plano.arquivos.length === 0) linhas.push("  (nenhuma alteração)");
  for (const av of plano.avisos) linhas.push(`aviso: ${av}`);
  linhas.push("Manual (o script não altera):");
  for (const m of plano.manual) linhas.push(`  [${m.id}] ${m.descricao}`);
  return linhas.join("\n");
}
