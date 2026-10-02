// Loja de squads (Fase 14, T-14.02/T-14.04 do plano; D-201/D-206/D-207/D-208). `<userData>/squads/` é a FONTE DA VERDADE;
// `resources/squads/` é a fábrica (somente leitura). Sem Electron: todos os diretórios entram por injeção.
// Índice em memória carregado em ocioso (`carregar`); `listar` nunca toca o disco e nunca lê prompts.
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Achado, EventoSquad, FabricaAtualizacao, FabricaDiff, Membro, PedidoListarSquads, PromptLido, ProvenienciaFabrica, PreviaImportacao, Squad, SquadResumo } from "./tipos";
import { LIMITES_SQUAD, PADRAO_SLUG, SCHEMA_VERSION, caminhoPromptDe } from "./tipos";
import { FormatoInvalidoError, VersaoMaiorError, gravarSquadNoDiretorio, hashDoConjunto, interpretarSquad, lerSquadDoDiretorio, serializarSquad, sha256 } from "./formato";
import { CHAVE_SQUAD, compararComFabrica, hashDeMembro, hashesDaSquad, proveniencia } from "./fabrica/atualizar";
import { validarPrompt, validarSquad, temErro, type ContextoValidacao } from "./validar";
import type { SquadNoDisco } from "./tipos";

export type CodigoLoja = "nao_encontrada" | "fabrica_somente_leitura" | "conflito_de_hash" | "invalida" | "em_uso" | "slug_existente" | "importacao_invalida" | "destino_invalido";
export class LojaError extends Error {
  constructor(
    public readonly codigo: CodigoLoja,
    mensagem: string,
    public readonly achados: Achado[] = [],
  ) {
    super(mensagem);
    this.name = "LojaError";
  }
}

export interface OpcoesLoja {
  /** `<userData>/squads`. */
  pastaUsuario: string;
  /** `resources/squads` (somente leitura); `null` = sem fábrica. */
  pastaFabrica?: string | null;
  /** contexto da validação (CLIs instaladas, catálogo de skills/MCPs…); lido a cada validação. */
  contexto?: () => ContextoValidacao;
  /** squad usada por Missão ativa (impede apagar). */
  emUso?: (slug: string) => boolean;
  agora?: () => Date;
}

interface Entrada {
  squad: Squad;
  hash: string;
  dir: string;
  avisos: string[];
  clis: string[];
  valida: boolean;
  atualizacao: boolean;
  prov: ProvenienciaFabrica | null;
}

const PASTA_LIXEIRA = ".lixeira";
const ARQ_ORIGEM = "origem.json";
const LIMITE_PACOTE = 2 * 1024 * 1024;
const GITIGNORE_INTERNO = ["*", "!.gitignore", "!squads/", "!squads/**", "!pipelines/", "!pipelines/**"];

export interface PacoteSquad {
  schema_version: number;
  tipo: "squad";
  squad: unknown;
  prompts: Record<string, string>;
}
export interface PreviaDeImportacao extends Omit<PreviaImportacao, "previa_id"> {
  prompts: Record<string, string>;
}
export interface ResultadoGravar {
  squad: Squad;
  hash: string;
  achados: Achado[];
}

const ordenarPorNome = (a: SquadResumo, b: SquadResumo): number => a.nome.localeCompare(b.nome, "pt-BR") || a.slug.localeCompare(b.slug);

export function criarLoja(opcoes: OpcoesLoja) {
  const { pastaUsuario } = opcoes;
  const pastaFabrica = opcoes.pastaFabrica ?? null;
  const ctx = (): ContextoValidacao => opcoes.contexto?.() ?? {};
  const agora = opcoes.agora ?? ((): Date => new Date());
  const indice = new Map<string, Entrada>();
  const fabricaPorSlug = new Map<string, Entrada>();
  const avisosCarga: string[] = [];
  let fila: Promise<unknown> = Promise.resolve();
  /** serializa as escritas (gravar/apagar/duplicar/aplicar): nunca duas ao mesmo tempo. */
  const exclusivo = <T>(f: () => Promise<T>): Promise<T> => {
    const p = fila.then(f, f);
    fila = p.catch(() => undefined);
    return p;
  };

  // ---------- leitura ----------
  async function lerProveniencia(dir: string): Promise<ProvenienciaFabrica | null> {
    try {
      const o = JSON.parse(await readFile(join(dir, ARQ_ORIGEM), "utf8")) as Partial<ProvenienciaFabrica>;
      if (typeof o.fabrica_id !== "string" || typeof o.versao !== "number" || typeof o.arquivos !== "object" || o.arquivos === null) return null;
      return { fabrica_id: o.fabrica_id, versao: o.versao, arquivos: o.arquivos as Record<string, string> };
    } catch {
      return null;
    }
  }

  function montarEntrada(d: SquadNoDisco, dir: string, prov: ProvenienciaFabrica | null): Entrada {
    let valida = !temErro(validarSquad(d.squad, ctx()));
    if (valida) {
      for (const m of d.squad.membros) {
        if (temErro(validarPrompt(d.prompts[m.slug] ?? ""))) {
          valida = false;
          break;
        }
      }
    }
    return { squad: d.squad, hash: d.hash, dir, avisos: d.avisos, clis: [...new Set(d.squad.membros.map((m) => m.perfil.cli))], valida, atualizacao: false, prov };
  }

  async function lerPastas(raiz: string, origem: "fabrica" | "usuario"): Promise<Map<string, Entrada>> {
    const saida = new Map<string, Entrada>();
    let itens: import("node:fs").Dirent[];
    try {
      itens = await readdir(raiz, { withFileTypes: true });
    } catch {
      return saida;
    }
    await Promise.all(
      itens.map(async (item) => {
        if (item.name.startsWith(".")) return;
        if (item.isSymbolicLink()) {
          avisosCarga.push(`${item.name}: symlink ignorado`);
          return;
        }
        if (!item.isDirectory()) return;
        const dir = join(raiz, item.name);
        try {
          await stat(join(dir, "squad.json"));
        } catch {
          return; // pasta sem squad.json (ex.: arquetipos/) não é squad
        }
        try {
          const d = await lerSquadDoDiretorio(dir, origem);
          if (d.squad.slug !== item.name) {
            avisosCarga.push(`${item.name}: o slug do squad.json (${d.squad.slug}) difere do nome da pasta; ignorada`);
            return;
          }
          saida.set(item.name, montarEntrada(d, dir, origem === "usuario" ? await lerProveniencia(dir) : null));
        } catch (e) {
          avisosCarga.push(`${item.name}: ${e instanceof Error ? e.message : "squad ilegível"}`);
        }
      }),
    );
    return saida;
  }

  function marcarAtualizacoes(): void {
    for (const e of indice.values()) {
      const f = e.prov === null ? undefined : fabricaPorSlug.get(e.prov.fabrica_id);
      e.atualizacao = f !== undefined && (f.squad.fabrica?.versao ?? 1) > e.prov!.versao;
    }
  }

  /** Carrega fábrica + usuário. Chame em ocioso (fora do caminho de abrir a tela). */
  async function carregar(): Promise<void> {
    avisosCarga.length = 0;
    const [fab, usu] = await Promise.all([pastaFabrica === null ? Promise.resolve(new Map<string, Entrada>()) : lerPastas(pastaFabrica, "fabrica"), lerPastas(pastaUsuario, "usuario")]);
    fabricaPorSlug.clear();
    for (const [k, v] of fab) fabricaPorSlug.set(k, v);
    indice.clear();
    for (const [k, v] of fab) indice.set(k, v);
    for (const [k, v] of usu) {
      if (indice.has(k)) avisosCarga.push(`${k}: slug reservado pela fábrica; a pasta do usuário foi ignorada`);
      else indice.set(k, v);
    }
    marcarAtualizacoes();
  }

  /** Relê o disco e devolve o que mudou FORA do app (edição externa). Gravações do próprio app já atualizaram o índice. */
  async function recarregar(): Promise<EventoSquad[]> {
    const antes = new Map([...indice].map(([k, v]) => [k, v.hash]));
    await carregar();
    const eventos: EventoSquad[] = [];
    for (const [k, v] of indice) if (antes.get(k) !== v.hash) eventos.push({ slug: k, tipo: "externa" });
    for (const k of antes.keys()) if (!indice.has(k)) eventos.push({ slug: k, tipo: "externa" });
    return eventos;
  }

  const entrada = (slug: string): Entrada => {
    const e = indice.get(slug);
    if (e === undefined) throw new LojaError("nao_encontrada", `squad não encontrada: ${slug.slice(0, 40)}`);
    return e;
  };

  function listar(filtro: PedidoListarSquads = {}): SquadResumo[] {
    const busca = (filtro.busca ?? "").trim().toLocaleLowerCase("pt-BR").slice(0, LIMITES_SQUAD.busca_max);
    const r: SquadResumo[] = [];
    for (const [slug, e] of indice) {
      if (filtro.origem !== undefined && e.squad.origem !== filtro.origem) continue;
      if (busca !== "" && !`${e.squad.nome} ${slug} ${e.squad.descricao}`.toLocaleLowerCase("pt-BR").includes(busca)) continue;
      r.push({ slug, nome: e.squad.nome, escopo: e.squad.escopo, origem: e.squad.origem, membros: e.squad.membros.length, clis: e.clis, valida: e.valida, atualizacao_de_fabrica: e.atualizacao, em_uso: opcoes.emUso?.(slug) ?? false, hash: e.hash });
    }
    return r.sort(ordenarPorNome);
  }
  const obter = (slug: string): Squad => structuredClone(entrada(slug).squad);
  const hashDe = (slug: string): string => entrada(slug).hash;
  const avisos = (): string[] => [...avisosCarga];

  /** Texto do prompt de um membro, lido do arquivo NO INSTANTE da chamada (D-211: edição vale na próxima invocação). */
  async function lerPrompt(slug: string, membro: string): Promise<PromptLido> {
    const e = entrada(slug);
    if (!e.squad.membros.some((m) => m.slug === membro)) throw new LojaError("nao_encontrada", `membro não encontrado: ${membro.slice(0, 40)}`);
    const d = await lerSquadDoDiretorio(e.dir, e.squad.origem === "fabrica" ? "fabrica" : "usuario");
    const texto = d.prompts[membro] ?? "";
    const original = e.prov?.arquivos[caminhoPromptDe(membro)];
    const m = d.squad.membros.find((x) => x.slug === membro);
    return { texto, hash: sha256(texto), editado: original !== undefined && m !== undefined ? hashDeMembro(m, texto) !== original : false };
  }

  // ---------- escrita ----------
  const proibidoDaFabrica = (slug: string): boolean => fabricaPorSlug.has(slug);

  async function gravarInterno(squad: Squad, prompts: Record<string, string> | undefined, hashEsperado: string | null): Promise<ResultadoGravar> {
    const slugRuim = validarSquad({ ...squad, membros: [] }, {}).find((a) => a.codigo === "slug_invalido" && a.caminho === "slug");
    if (slugRuim !== undefined) throw new LojaError("invalida", slugRuim.mensagem, [slugRuim]);
    if (squad.origem === "fabrica" || proibidoDaFabrica(squad.slug)) throw new LojaError("fabrica_somente_leitura", 'Squad de fábrica é somente leitura: use "Duplicar para editar".');
    const dir = join(pastaUsuario, squad.slug);
    const existente = indice.get(squad.slug);
    let atual: SquadNoDisco | null = null;
    try {
      atual = await lerSquadDoDiretorio(dir, "usuario");
    } catch {
      atual = null;
    }
    if (atual !== null) {
      if (hashEsperado === null || hashEsperado !== atual.hash) throw new LojaError("conflito_de_hash", "A squad mudou fora do app ou já existe; recarregue antes de gravar.");
    } else if (hashEsperado !== null && existente !== undefined) {
      throw new LojaError("conflito_de_hash", "A squad foi removida ou alterada; recarregue.");
    }
    const final: Squad = { ...squad, origem: squad.origem === "importada" ? "importada" : "usuario", membros: squad.membros.map((m) => ({ ...m, prompt: caminhoPromptDe(m.slug) })) };
    const textos: Record<string, string> = {};
    for (const m of final.membros) textos[m.slug] = prompts?.[m.slug] ?? atual?.prompts[m.slug] ?? "";
    const achados: Achado[] = validarSquad(final, { ...ctx(), paraGravar: true });
    final.membros.forEach((m, i) => achados.push(...validarPrompt(textos[m.slug] ?? "", `membros[${i}].prompt`)));
    if (temErro(achados)) throw new LojaError("invalida", "A squad tem erros de validação.", achados);
    const g = await gravarSquadNoDiretorio(dir, final, textos);
    // sem reler o disco: o que acabou de ser gravado é conhecido (mesmo hash que uma leitura daria; coberto por teste)
    const lida: SquadNoDisco = { squad: structuredClone(final), prompts: textos, avisos: [], hash: g.hash, arquivos: g.arquivos };
    const prov = existente?.prov ?? (await lerProveniencia(dir));
    const nova = montarEntrada(lida, dir, prov);
    indice.set(final.slug, nova);
    marcarAtualizacoes();
    return { squad: structuredClone(nova.squad), hash: g.hash, achados };
  }

  /** `prompts` ausente = mantém o texto atual dos membros que já existem. `hashEsperado = null` só para squad nova. */
  const gravar = (squad: Squad, prompts: Record<string, string> | undefined, hashEsperado: string | null): Promise<ResultadoGravar> => exclusivo(() => gravarInterno(squad, prompts, hashEsperado));

  function gravarPrompt(slug: string, membro: string, texto: string, hashEsperado: string): Promise<{ hash: string; achados: Achado[] }> {
    return exclusivo(async () => {
      const e = entrada(slug);
      if (e.squad.origem === "fabrica") throw new LojaError("fabrica_somente_leitura", 'Squad de fábrica é somente leitura: use "Duplicar para editar".');
      const atual = await lerPrompt(slug, membro);
      if (atual.hash !== hashEsperado) throw new LojaError("conflito_de_hash", "O prompt mudou fora do app; recarregue.");
      const i = e.squad.membros.findIndex((m) => m.slug === membro);
      const achados = validarPrompt(texto, `membros[${i}].prompt`);
      if (temErro(achados)) throw new LojaError("invalida", "O prompt tem erros de validação.", achados);
      const d = await lerSquadDoDiretorio(e.dir, "usuario");
      await gravarSquadNoDiretorio(e.dir, d.squad, { ...d.prompts, [membro]: texto });
      indice.set(slug, montarEntrada(await lerSquadDoDiretorio(e.dir, "usuario"), e.dir, e.prov));
      return { hash: sha256(texto), achados };
    });
  }

  /** Cópia de fábrica: volta o prompt do membro ao texto ORIGINAL da fábrica (descarta a edição; demais campos do membro ficam). */
  function restaurarPrompt(slug: string, membro: string): Promise<{ hash: string }> {
    return exclusivo(async () => {
      const e = entrada(slug);
      if (e.squad.origem === "fabrica") throw new LojaError("fabrica_somente_leitura", "Squad de fábrica é somente leitura; não há o que restaurar.");
      const f = e.prov === null ? undefined : fabricaPorSlug.get(e.prov.fabrica_id);
      if (e.prov === null || f === undefined) throw new LojaError("nao_encontrada", "A squad não veio de uma fábrica disponível: não há original para restaurar.");
      if (!e.squad.membros.some((m) => m.slug === membro)) throw new LojaError("nao_encontrada", `membro não encontrado: ${membro.slice(0, 40)}`);
      const original = (await lerSquadDoDiretorio(f.dir, "fabrica")).prompts[membro];
      if (original === undefined) throw new LojaError("nao_encontrada", "O original de fábrica não tem esse membro.");
      const d = await lerSquadDoDiretorio(e.dir, "usuario");
      await gravarSquadNoDiretorio(e.dir, d.squad, { ...d.prompts, [membro]: original });
      indice.set(slug, montarEntrada(await lerSquadDoDiretorio(e.dir, "usuario"), e.dir, e.prov));
      return { hash: sha256(original) };
    });
  }

  function apagar(slug: string, confirmar: string): Promise<{ lixeira: string }> {
    return exclusivo(async () => {
      const e = entrada(slug);
      if (confirmar !== slug) throw new LojaError("invalida", "Digite o slug da squad para confirmar.");
      if (e.squad.origem === "fabrica") throw new LojaError("fabrica_somente_leitura", "Squad de fábrica não pode ser apagada.");
      if (opcoes.emUso?.(slug) === true) throw new LojaError("em_uso", "A squad está em uso por uma Missão ativa.");
      const nome = `${slug}-${agora().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(2).toString("hex")}`;
      await mkdir(join(pastaUsuario, PASTA_LIXEIRA), { recursive: true, mode: 0o700 });
      await rename(e.dir, join(pastaUsuario, PASTA_LIXEIRA, nome)); // nunca apaga de verdade
      indice.delete(slug);
      return { lixeira: nome };
    });
  }

  async function listarLixeira(): Promise<string[]> {
    try {
      return (await readdir(join(pastaUsuario, PASTA_LIXEIRA), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
  }
  function restaurar(nome: string): Promise<Squad> {
    return exclusivo(async () => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(nome)) throw new LojaError("nao_encontrada", "item da lixeira inválido");
      const origem = join(pastaUsuario, PASTA_LIXEIRA, nome);
      const d = await lerSquadDoDiretorio(origem, "usuario").catch(() => null);
      if (d === null) throw new LojaError("nao_encontrada", "item da lixeira não encontrado");
      if (indice.has(d.squad.slug)) throw new LojaError("slug_existente", `já existe uma squad ${d.squad.slug}`);
      await rename(origem, join(pastaUsuario, d.squad.slug));
      const dir = join(pastaUsuario, d.squad.slug);
      indice.set(d.squad.slug, montarEntrada(await lerSquadDoDiretorio(dir, "usuario"), dir, await lerProveniencia(dir)));
      marcarAtualizacoes();
      return structuredClone(indice.get(d.squad.slug)!.squad);
    });
  }

  function slugLivre(base: string): string {
    const raiz = base.slice(0, 33).replace(/-+$/, "");
    for (let n = 1; n < 1000; n++) {
      const c = n === 1 ? `${raiz}-copia` : `${raiz}-copia-${n}`;
      if (!indice.has(c)) return c;
    }
    throw new LojaError("slug_existente", "não foi possível achar um identificador livre");
  }

  /** Fábrica → cópia do usuário com `origem.json`; usuário → cópia independente. Nunca sobrescreve. */
  function duplicar(slug: string, novoSlug?: string, novoNome?: string): Promise<Squad> {
    return exclusivo(async () => {
      const origem = entrada(slug);
      const novo = novoSlug ?? slugLivre(slug);
      if (!PADRAO_SLUG.test(novo)) throw new LojaError("invalida", "Identificador inválido para a cópia.", validarSquad({ ...origem.squad, slug: novo, membros: [] }, {}).filter((a) => a.codigo === "slug_invalido"));
      if (indice.has(novo)) throw new LojaError("slug_existente", `já existe uma squad ${novo}`);
      const d = await lerSquadDoDiretorio(origem.dir, origem.squad.origem === "fabrica" ? "fabrica" : "usuario");
      const daFabrica = origem.squad.origem === "fabrica";
      const copia: Squad = { ...structuredClone(d.squad), slug: novo, nome: novoNome ?? `${d.squad.nome} (cópia)`.slice(0, 80), origem: "usuario", fabrica: daFabrica ? d.squad.fabrica : null };
      const dir = join(pastaUsuario, novo);
      await gravarSquadNoDiretorio(dir, copia, d.prompts);
      if (daFabrica) await escreverJson(join(dir, ARQ_ORIGEM), proveniencia(d.squad, d.prompts));
      indice.set(novo, montarEntrada(await lerSquadDoDiretorio(dir, "usuario"), dir, daFabrica ? await lerProveniencia(dir) : null));
      marcarAtualizacoes();
      return structuredClone(indice.get(novo)!.squad);
    });
  }

  async function escreverJson(caminho: string, valor: unknown): Promise<void> {
    const tmp = `${caminho}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
    await writeFile(tmp, `${JSON.stringify(valor, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(tmp, caminho);
  }

  // ---------- atualização de fábrica (3 vias) ----------
  async function contextoDeFabrica(slug: string): Promise<{ e: Entrada; prov: ProvenienciaFabrica; usuario: SquadNoDisco; nova: SquadNoDisco } | null> {
    const e = entrada(slug);
    if (e.prov === null) return null;
    const f = fabricaPorSlug.get(e.prov.fabrica_id);
    if (f === undefined) return null;
    const [usuario, nova] = await Promise.all([lerSquadDoDiretorio(e.dir, "usuario"), lerSquadDoDiretorio(f.dir, "fabrica")]);
    return { e, prov: e.prov, usuario, nova };
  }

  async function fabricaAtualizacao(slug: string): Promise<FabricaAtualizacao> {
    const c = await contextoDeFabrica(slug);
    if (c === null) return { versao_nova: null, membros: [] };
    return compararComFabrica(c.prov, hashesDaSquad(c.usuario.squad, c.usuario.prompts), { versao: c.nova.squad.fabrica?.versao ?? 1, arquivos: hashesDaSquad(c.nova.squad, c.nova.prompts) });
  }

  /**
   * Diff lado a lado de UM membro (ou `@squad`): texto da cópia do usuário × texto da fábrica nova. O texto é o prompt mais uma
   * linha de configuração em JSON (perfil, limites, permissões). Só leitura; lado inexistente = texto vazio.
   */
  async function fabricaDiff(slug: string, membro: string): Promise<FabricaDiff> {
    const c = await contextoDeFabrica(slug);
    if (c === null) throw new LojaError("nao_encontrada", "a squad não vem de uma fábrica disponível");
    const estados = compararComFabrica(c.prov, hashesDaSquad(c.usuario.squad, c.usuario.prompts), { versao: c.nova.squad.fabrica?.versao ?? 1, arquivos: hashesDaSquad(c.nova.squad, c.nova.prompts) });
    const estado = estados.membros.find((x) => x.membro === membro)?.estado ?? "igual";
    const texto = (d: SquadNoDisco): string => {
      if (membro === "@squad") {
        const q = d.squad;
        return JSON.stringify({ descricao: q.descricao, escopo: q.escopo, rigidez_padrao: q.rigidez_padrao, max_instancias_paralelas: q.max_instancias_paralelas, orcamento: q.orcamento, portoes: q.portoes }, null, 2);
      }
      const m = d.squad.membros.find((x) => x.slug === membro);
      if (m === undefined) return "";
      const { prompt: _caminho, ...config } = m;
      void _caminho;
      return `${JSON.stringify(config, null, 2)}\n\n---\n${d.prompts[membro] ?? ""}`;
    };
    return { membro, estado, atual: texto(c.usuario), fabrica: texto(c.nova) };
  }

  /**
   * Aplica o que está `atualizavel`/`novo` e foi pedido. `editado` só entra se o chamador o listar em `sobrescrever` (o usuário viu o
   * diff e aceitou); `removido` nunca é tocado.
   */
  function fabricaAplicar(slug: string, membros: string[], sobrescrever: string[] = []): Promise<Squad> {
    return exclusivo(async () => {
      const c = await contextoDeFabrica(slug);
      if (c === null) throw new LojaError("nao_encontrada", "a squad não vem de uma fábrica disponível");
      const estados = compararComFabrica(c.prov, hashesDaSquad(c.usuario.squad, c.usuario.prompts), { versao: c.nova.squad.fabrica?.versao ?? 1, arquivos: hashesDaSquad(c.nova.squad, c.nova.prompts) });
      const aplicaveis = new Set(estados.membros.filter((x) => x.estado === "atualizavel" || x.estado === "novo" || (x.estado === "editado" && sobrescrever.includes(x.membro))).map((x) => x.membro));
      const escolhidos = membros.filter((m) => aplicaveis.has(m));
      const squad = structuredClone(c.usuario.squad);
      const prompts = { ...c.usuario.prompts };
      const hashesNovos = hashesDaSquad(c.nova.squad, c.nova.prompts);
      const arquivos = { ...c.prov.arquivos };
      for (const nome of escolhidos) {
        if (nome === "@squad") {
          const n = c.nova.squad;
          Object.assign(squad, { descricao: n.descricao, escopo: n.escopo, rigidez_padrao: n.rigidez_padrao, max_instancias_paralelas: n.max_instancias_paralelas, orcamento: n.orcamento, portoes: n.portoes });
          arquivos[CHAVE_SQUAD] = hashesNovos[CHAVE_SQUAD]!;
          continue;
        }
        const novoM = c.nova.squad.membros.find((m) => m.slug === nome) as Membro;
        const i = squad.membros.findIndex((m) => m.slug === nome);
        if (i >= 0) squad.membros[i] = structuredClone(novoM);
        else squad.membros.push(structuredClone(novoM));
        prompts[nome] = c.nova.prompts[nome] ?? "";
        arquivos[caminhoPromptDe(nome)] = hashesNovos[caminhoPromptDe(nome)]!;
      }
      const restantes = estados.membros.filter((x) => (x.estado === "atualizavel" || x.estado === "novo") && !escolhidos.includes(x.membro));
      const versao = restantes.length === 0 ? (c.nova.squad.fabrica?.versao ?? c.prov.versao) : c.prov.versao;
      squad.fabrica = { id: c.prov.fabrica_id, versao };
      const achados = [...validarSquad(squad, { ...ctx(), paraGravar: true })];
      if (temErro(achados)) throw new LojaError("invalida", "A atualização deixaria a squad inválida.", achados);
      await gravarSquadNoDiretorio(c.e.dir, squad, prompts);
      await escreverJson(join(c.e.dir, ARQ_ORIGEM), { fabrica_id: c.prov.fabrica_id, versao, arquivos } satisfies ProvenienciaFabrica);
      indice.set(slug, montarEntrada(await lerSquadDoDiretorio(c.e.dir, "usuario"), c.e.dir, await lerProveniencia(c.e.dir)));
      marcarAtualizacoes();
      return structuredClone(indice.get(slug)!.squad);
    });
  }

  // ---------- importar / exportar JSON versionado ----------
  async function exportarJson(slug: string): Promise<string> {
    const e = entrada(slug);
    const d = await lerSquadDoDiretorio(e.dir, e.squad.origem === "fabrica" ? "fabrica" : "usuario");
    const pacote: PacoteSquad = { schema_version: SCHEMA_VERSION, tipo: "squad", squad: JSON.parse(serializarSquad({ ...d.squad, origem: "usuario" })), prompts: d.prompts };
    return `${JSON.stringify(pacote, null, 2)}\n`;
  }

  /** Importação é NÃO CONFIÁVEL (D-208): remove MCPs e hooks, filtra skills ao catálogo (quando conhecido), marca `importada`, não executa nada. */
  function importarPrevia(texto: string, opc: { skillsConhecidas?: ReadonlySet<string> | null } = {}): PreviaDeImportacao {
    const falha = (m: string): never => {
      throw new LojaError("importacao_invalida", m);
    };
    if (texto.length > LIMITE_PACOTE) falha("o arquivo é grande demais para importar");
    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      return falha("o arquivo não é um JSON válido");
    }
    if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return falha("formato de pacote inválido");
    const p = bruto as Partial<PacoteSquad>;
    if (p.tipo !== "squad") falha("o arquivo não é um pacote de squad");
    if (typeof p.schema_version !== "number") falha("pacote sem schema_version");
    else if (p.schema_version > SCHEMA_VERSION) throw new VersaoMaiorError(p.schema_version, "pacote de squad");
    if (typeof p.prompts !== "object" || p.prompts === null || Array.isArray(p.prompts)) falha("pacote sem prompts");
    let squad: Squad;
    try {
      squad = interpretarSquad(JSON.stringify(p.squad), "usuario").squad;
    } catch (e) {
      if (e instanceof VersaoMaiorError) throw e;
      return falha(e instanceof FormatoInvalidoError ? e.message : "squad do pacote inválida");
    }
    const prompts: Record<string, string> = {};
    for (const m of squad.membros) {
      const t = (p.prompts as Record<string, unknown>)[m.slug];
      prompts[m.slug] = typeof t === "string" ? t : "";
    }
    const mcps_removidos: string[] = [];
    const skills_removidas: string[] = [];
    const conhecidas = opc.skillsConhecidas ?? null;
    squad.membros = squad.membros.map((m) => {
      for (const x of m.mcps_permitidos) mcps_removidos.push(`${m.slug}: ${x}`);
      for (const h of m.hooks) skills_removidas.push(`${m.slug}: hook ${h}`);
      const manter = m.skills_permitidas.filter((s) => conhecidas === null || conhecidas.has(s));
      for (const s of m.skills_permitidas) if (!manter.includes(s)) skills_removidas.push(`${m.slug}: ${s}`);
      return { ...m, mcps_permitidos: [], hooks: [], skills_permitidas: manter };
    });
    squad = { ...squad, origem: "importada", fabrica: null };
    const achados: Achado[] = validarSquad(squad, ctx());
    squad.membros.forEach((m, i) => achados.push(...validarPrompt(prompts[m.slug] ?? "", `membros[${i}].prompt`)));
    return { squad, achados, mcps_removidos, skills_removidas, prompts };
  }

  /** Grava a prévia aprovada. Recusa se houver erro; nunca sobrescreve uma squad existente. */
  function importarConfirmar(previa: PreviaDeImportacao, slug?: string): Promise<ResultadoGravar> {
    return exclusivo(async () => {
      if (temErro(previa.achados)) throw new LojaError("invalida", "A squad importada tem erros; corrija antes de importar.", previa.achados);
      const alvo = slug ?? previa.squad.slug;
      if (indice.has(alvo)) throw new LojaError("slug_existente", `já existe uma squad ${alvo}`);
      return gravarInterno({ ...previa.squad, slug: alvo, origem: "importada" }, previa.prompts, null);
    });
  }

  // ---------- exportar para o repositório (D-207; P-232) ----------
  /** `.gitignore` interno: tudo ignorado, exceto `squads/` e `pipelines/` (configuração se versiona; artefato de Missão nunca). */
  async function garantirGitignoreInterno(pastaProduto: string): Promise<void> {
    const caminho = join(pastaProduto, ".gitignore");
    let atual = "";
    try {
      atual = await readFile(caminho, "utf8");
    } catch {
      atual = "";
    }
    const linhas = atual.split(/\r?\n/).filter((l) => l !== "");
    const faltam = GITIGNORE_INTERNO.filter((l) => !linhas.includes(l));
    if (faltam.length === 0) return;
    await mkdir(pastaProduto, { recursive: true, mode: 0o755 });
    const tmp = `${caminho}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
    await writeFile(tmp, `${[...linhas, ...faltam].join("\n")}\n`, { mode: 0o644, flag: "wx" });
    await rename(tmp, caminho);
  }

  const PASTA_PRODUTO = /^\.[a-z0-9][a-z0-9-]{0,39}$/;
  /**
   * Um repositório não confiável pode ter `<pasta do produto>` ou `squads/` como link simbólico para FORA da raiz: exportar escreveria lá
   * e importar leria de lá. Cada trecho EXISTENTE do caminho precisa ser pasta comum (não link).
   */
  async function exigirSemLinkSimbolico(raiz: string, partes: string[]): Promise<void> {
    let atual = raiz;
    for (const parte of partes) {
      atual = join(atual, parte);
      const st = await lstat(atual).catch(() => null);
      if (st === null) return; // o que não existe será criado por nós, dentro da raiz
      if (st.isSymbolicLink()) throw new LojaError("destino_invalido", "O caminho do repositório passa por um atalho (link simbólico); recusado por segurança.");
    }
  }
  /**
   * Exporta a squad para `<raiz>/<pastaProduto>/squads/<slug>/` por ação EXPLÍCITA (idempotente = "sincronizar").
   * Sem `origem.json`, sem caminho absoluto; recusa prompt com segredo. Devolve o caminho RELATIVO à raiz.
   */
  async function exportarParaRepositorio(slug: string, destino: { raiz: string; pastaProduto: string }): Promise<{ caminho_relativo: string; avisos: string[] }> {
    if (!PASTA_PRODUTO.test(destino.pastaProduto)) throw new LojaError("destino_invalido", "pasta do produto inválida");
    const e = entrada(slug);
    const st = await stat(destino.raiz).catch(() => null);
    if (st === null || !st.isDirectory()) throw new LojaError("destino_invalido", "a raiz do repositório não existe");
    await exigirSemLinkSimbolico(destino.raiz, [destino.pastaProduto, "squads", slug]);
    const d = await lerSquadDoDiretorio(e.dir, e.squad.origem === "fabrica" ? "fabrica" : "usuario");
    const achados: Achado[] = [];
    d.squad.membros.forEach((m, i) => achados.push(...validarPrompt(d.prompts[m.slug] ?? "", `membros[${i}].prompt`).filter((a) => a.codigo === "prompt_com_segredo")));
    if (achados.length > 0) throw new LojaError("invalida", "Há segredo em um prompt; remova antes de exportar.", achados);
    const pasta = join(destino.raiz, destino.pastaProduto);
    await garantirGitignoreInterno(pasta);
    const alvo = join(pasta, "squads", slug);
    await mkdir(join(pasta, "squads"), { recursive: true });
    await gravarSquadNoDiretorio(alvo, { ...d.squad, origem: "usuario" }, d.prompts);
    const avisos = d.squad.membros.filter((m) => /(?:^|[\s"'`(])(?:\/(?:Users|home|root)\/|[A-Za-z]:[\\/])/.test(d.prompts[m.slug] ?? "")).map((m) => `${m.slug}: o prompt cita caminho absoluto`);
    return { caminho_relativo: `${destino.pastaProduto}/squads/${slug}`, avisos };
  }

  /** Lê uma squad exportada no repositório e devolve a PRÉVIA (nunca grava): o fluxo de importação é o mesmo de qualquer pacote. */
  async function importarDoRepositorio(nome: string, origem: { raiz: string; pastaProduto: string }, opc: { skillsConhecidas?: ReadonlySet<string> | null } = {}): Promise<PreviaDeImportacao> {
    if (!PADRAO_SLUG.test(nome) || !PASTA_PRODUTO.test(origem.pastaProduto)) throw new LojaError("destino_invalido", "nome ou pasta inválidos");
    await exigirSemLinkSimbolico(origem.raiz, [origem.pastaProduto, "squads", nome]);
    const d = await lerSquadDoDiretorio(join(origem.raiz, origem.pastaProduto, "squads", nome), "usuario").catch((e: unknown) => {
      throw new LojaError("importacao_invalida", e instanceof Error ? e.message : "squad ilegível");
    });
    return importarPrevia(JSON.stringify({ schema_version: SCHEMA_VERSION, tipo: "squad", squad: JSON.parse(serializarSquad(d.squad)), prompts: d.prompts }), opc);
  }

  return {
    carregar, recarregar, listar, obter, hashDe, avisos, lerPrompt, gravar, gravarPrompt, restaurarPrompt, apagar, listarLixeira, restaurar, duplicar,
    fabricaAtualizacao, fabricaAplicar, fabricaDiff, exportarJson, importarPrevia, importarConfirmar, exportarParaRepositorio, importarDoRepositorio,
    /** soma dos hashes (útil para auditoria). */
    hashGeral: (): string => hashDoConjunto(Object.fromEntries([...indice].map(([k, v]) => [k, v.hash]))),
  };
}
export type LojaDeSquads = ReturnType<typeof criarLoja>;
