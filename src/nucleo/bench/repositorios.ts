// Repositórios do Bench sobre o banco principal (migração 0016). As invariantes vivem em CONSTRAINT (um resultado não `substituido` por par; `qualidade` só com juiz feito/manual; custo
// `desconhecido` ⇒ custo NULL); aqui só o mapeamento. O `mapa_cego` só sai por `vereditosDaRun`, que o serviço NÃO repassa a canal algum.
import type { Banco } from "../banco/banco";
import { agora } from "../banco/tempo";
import { novoId } from "../banco/repos/comum";
import { jsonDe, lerJson } from "../banco/repos/json";
import { RUBRICA_PADRAO } from "./tarefas/validacao";
import type { SementeNormalizada } from "./tarefas/catalogo";
import { PESOS_PADRAO, type AlvoBench, type AlvoEditavel, type ChecagemTarefa, type CriterioRubrica, type EstadoResultado, type EstadoRun, type EstadoTarefa, type LinhaResultado, type LinhaRun, type LinhaVeredito, type PrecoBench, type PrecoCongelado, type TarefaBench, type TarefaEditavel, type Pagina } from "./tipos";

interface LTarefa { id: string; slug: string; versao: number; titulo: string; atividade: string; tipo: string; prompt: string; escopo: string; checagens_json: string; rubrica_json: string; estado: string; origem: string; tem_fixture: number; embutida: number; atualizado_em: string }
const tarefa = (l: LTarefa): TarefaBench => ({ id: l.id, slug: l.slug, versao: l.versao, titulo: l.titulo, atividade: l.atividade, tipo: l.tipo as TarefaBench["tipo"], prompt: l.prompt, escopo: l.escopo, checagens: lerJson<ChecagemTarefa[]>(l.checagens_json, []), rubrica: lerJson<CriterioRubrica[]>(l.rubrica_json, RUBRICA_PADRAO), estado: l.estado as EstadoTarefa, origem: l.origem as TarefaBench["origem"], tem_fixture: l.tem_fixture === 1, embutida: l.embutida === 1, atualizado_em: l.atualizado_em });

interface LAlvo { id: string; slug: string; provedor: string; modelo: string; esforco: string | null; cli: string; conta_id: string | null; rotulo: string }
const alvo = (l: LAlvo): AlvoBench => ({ id: l.id, slug: l.slug, provedor: l.provedor, modelo: l.modelo, esforco: l.esforco, cli: l.cli as AlvoBench["cli"], conta_id: l.conta_id, rotulo: l.rotulo });
export const slugDoAlvo = (a: { provedor: string; modelo: string; esforco: string | null }): string => `${a.provedor}-${a.modelo}-${a.esforco ?? "padrao"}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

interface LRun { id: string; nome: string; tarefas_json: string; alvos_json: string; estado: string; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null; pesos_json: string; sandbox: string; criado_em: string; iniciada_em: string | null; terminada_em: string | null }
const run = (l: LRun): LinhaRun => ({ id: l.id, nome: l.nome, tarefas: lerJson(l.tarefas_json, []), alvos: lerJson(l.alvos_json, []), estado: l.estado as EstadoRun, max_paralelo: l.max_paralelo, teto_usd: l.teto_usd, juiz_alvo: l.juiz_alvo, pesos: lerJson(l.pesos_json, PESOS_PADRAO), sandbox: l.sandbox as LinhaRun["sandbox"], criado_em: l.criado_em, iniciada_em: l.iniciada_em, terminada_em: l.terminada_em });

interface LRes { id: string; run_id: string; tarefa_slug: string; tarefa_versao: number; alvo_slug: string; tentativa: number; estado: string; workdir: string | null; log_ref: string | null; prompt_efetivo: string; duracao_s: number | null; custo_usd: number | null; custo_fonte: string; custo_tipo: string | null; preco_json: string | null; tokens_in: number | null; tokens_out: number | null; tokens_total: number | null; turnos: number | null; revisoes: number | null; artefatos_json: string; checagens_json: string; isolamento: string; juiz_estado: string; qualidade: number | null; qualidade_detalhe_json: string | null; notas: string | null; aviso: string | null; cli_versao: string | null; criado_em: string; atualizado_em: string }
const res = (l: LRes): LinhaResultado => ({ id: l.id, run_id: l.run_id, tarefa_slug: l.tarefa_slug, tarefa_versao: l.tarefa_versao, alvo_slug: l.alvo_slug, tentativa: l.tentativa, estado: l.estado as EstadoResultado, workdir: l.workdir, log_ref: l.log_ref, prompt_efetivo: l.prompt_efetivo, duracao_s: l.duracao_s, custo_usd: l.custo_usd, custo_fonte: l.custo_fonte as LinhaResultado["custo_fonte"], custo_tipo: l.custo_tipo as LinhaResultado["custo_tipo"], preco: l.preco_json === null ? null : lerJson<PrecoCongelado | null>(l.preco_json, null), tokens_in: l.tokens_in, tokens_out: l.tokens_out, tokens_total: l.tokens_total, turnos: l.turnos, revisoes: l.revisoes, artefatos: lerJson(l.artefatos_json, []), checagens: lerJson(l.checagens_json, []), isolamento: l.isolamento as LinhaResultado["isolamento"], juiz_estado: l.juiz_estado as LinhaResultado["juiz_estado"], qualidade: l.qualidade, qualidade_detalhe: l.qualidade_detalhe_json === null ? null : lerJson(l.qualidade_detalhe_json, null), notas: l.notas, aviso: l.aviso, cli_versao: l.cli_versao, criado_em: l.criado_em, atualizado_em: l.atualizado_em });

function lerRanking(json: string): { ranking: string[]; custo_juiz_usd: number | null } {
  const o = lerJson<unknown>(json, []);
  if (Array.isArray(o)) return { ranking: o as string[], custo_juiz_usd: null };
  const r = o as { ordem?: string[]; custo_juiz_usd?: number | null };
  return { ranking: r.ordem ?? [], custo_juiz_usd: typeof r.custo_juiz_usd === "number" ? r.custo_juiz_usd : null };
}

interface LVer { id: string; run_id: string; tarefa_slug: string; tarefa_versao: number; juiz_modelo: string; mapa_cego_json: string; notas_json: string; ranking_json: string; criado_em: string }

export type PatchResultado = Partial<Pick<LinhaResultado, "estado" | "workdir" | "log_ref" | "prompt_efetivo" | "duracao_s" | "custo_usd" | "custo_fonte" | "custo_tipo" | "preco" | "tokens_in" | "tokens_out" | "tokens_total" | "turnos" | "revisoes" | "artefatos" | "checagens" | "isolamento" | "juiz_estado" | "qualidade" | "qualidade_detalhe" | "notas" | "aviso" | "cli_versao">>;

export interface NovoResultado { run_id: string; tarefa_slug: string; tarefa_versao: number; alvo_slug: string; tentativa?: number; prompt_efetivo?: string }
export interface NovaRun { nome: string; tarefas: Array<{ slug: string; versao: number }>; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null; pesos: LinhaRun["pesos"]; sandbox: LinhaRun["sandbox"] }

export function criarReposBench(banco: Banco) {
  const ts = (): string => agora();
  const tarefas = {
    listar(f: { atividade?: string | null; estado?: EstadoTarefa | null } = {}): TarefaBench[] {
      const onde: string[] = [];
      const p: string[] = [];
      if (f.atividade != null) { onde.push("atividade = ?"); p.push(f.atividade); }
      if (f.estado != null) { onde.push("estado = ?"); p.push(f.estado); }
      return banco.consultar<LTarefa>(`SELECT * FROM bench_tarefa ${onde.length ? `WHERE ${onde.join(" AND ")}` : ""} ORDER BY embutida DESC, slug`, p).map(tarefa);
    },
    obter(slug: string): TarefaBench | undefined {
      const l = banco.consultarUm<LTarefa>("SELECT * FROM bench_tarefa WHERE slug = ?", [slug]);
      return l ? tarefa(l) : undefined;
    },
    /** semeia as tarefas que faltam; NUNCA sobrescreve tarefa existente (a pessoa pode ter editado). */
    semear(sementes: readonly SementeNormalizada[]): number {
      let n = 0;
      banco.transacao((b) => {
        for (const s of sementes) {
          if (b.consultarUm("SELECT 1 AS x FROM bench_tarefa WHERE slug = ?", [s.slug]) !== undefined) continue;
          const t = ts();
          b.executar("INSERT INTO bench_tarefa (id,slug,versao,titulo,atividade,tipo,prompt,escopo,checagens_json,rubrica_json,estado,origem,tem_fixture,embutida,criado_em,atualizado_em) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,1,?,?)",
            [novoId("task", "btar"), s.slug, s.titulo, s.atividade, s.tipo, s.prompt, s.escopo, jsonDe("checagens", s.checagens), jsonDe("rubrica", RUBRICA_PADRAO), s.estado, s.origem, Object.keys(s.fixtures).length > 0 ? 1 : 0, t, t]);
          n++;
        }
      });
      return n;
    },
    /** cria ou atualiza; `versao++` SÓ quando `prompt` ou `checagens` mudam (título/estado/escopo não contam). */
    salvar(e: TarefaEditavel, extra: { origem?: TarefaBench["origem"]; tem_fixture?: boolean } = {}): TarefaBench {
      return banco.transacao((b) => {
        const atual = b.consultarUm<LTarefa>("SELECT * FROM bench_tarefa WHERE slug = ?", [e.slug]);
        const t = ts();
        if (atual === undefined) {
          b.executar("INSERT INTO bench_tarefa (id,slug,versao,titulo,atividade,tipo,prompt,escopo,checagens_json,rubrica_json,estado,origem,tem_fixture,embutida,criado_em,atualizado_em) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,0,?,?)",
            [novoId("task", "btar"), e.slug, e.titulo, e.atividade, e.tipo, e.prompt, e.escopo, jsonDe("checagens", e.checagens), jsonDe("rubrica", RUBRICA_PADRAO), e.estado, extra.origem ?? "autoral", extra.tem_fixture === true ? 1 : 0, t, t]);
        } else {
          const mudou = atual.prompt !== e.prompt || atual.checagens_json !== jsonDe("checagens", e.checagens);
          b.executar("UPDATE bench_tarefa SET titulo=?, atividade=?, tipo=?, prompt=?, escopo=?, checagens_json=?, estado=?, versao=versao+?, atualizado_em=? WHERE slug=?",
            [e.titulo, e.atividade, e.tipo, e.prompt, e.escopo, jsonDe("checagens", e.checagens), e.estado, mudou ? 1 : 0, t, e.slug]);
        }
        return tarefa(b.consultarUm<LTarefa>("SELECT * FROM bench_tarefa WHERE slug = ?", [e.slug]) as LTarefa);
      });
    },
  };

  const alvos = {
    listar: (): AlvoBench[] => banco.consultar<LAlvo>("SELECT * FROM bench_alvo ORDER BY slug").map(alvo),
    obter(slug: string): AlvoBench | undefined {
      const l = banco.consultarUm<LAlvo>("SELECT * FROM bench_alvo WHERE slug = ?", [slug]);
      return l ? alvo(l) : undefined;
    },
    /** substitui a lista (upsert por slug; some o que a pessoa tirou). */
    substituir(lista: readonly AlvoEditavel[]): AlvoBench[] {
      banco.transacao((b) => {
        const slugs = lista.map((a) => slugDoAlvo(a));
        const existentes = b.consultar<{ slug: string }>("SELECT slug FROM bench_alvo").map((x) => x.slug);
        for (const s of existentes) if (!slugs.includes(s)) b.executar("DELETE FROM bench_alvo WHERE slug = ?", [s]);
        lista.forEach((a, i) => {
          const slug = slugs[i] as string;
          const rotulo = a.rotulo ?? `${a.modelo}${a.esforco === null ? "" : ` · ${a.esforco}`}`;
          if (existentes.includes(slug)) b.executar("UPDATE bench_alvo SET provedor=?, modelo=?, esforco=?, cli=?, conta_id=?, rotulo=? WHERE slug=?", [a.provedor, a.modelo, a.esforco, a.cli, a.conta_id, rotulo, slug]);
          else b.executar("INSERT INTO bench_alvo (id,slug,provedor,modelo,esforco,cli,conta_id,rotulo,criado_em) VALUES (?,?,?,?,?,?,?,?,?)", [novoId("task", "balv"), slug, a.provedor, a.modelo, a.esforco, a.cli, a.conta_id, rotulo, ts()]);
        });
      });
      return alvos.listar();
    },
  };

  const precos = {
    listar: (): PrecoBench[] => banco.consultar<PrecoBench>("SELECT provedor, modelo, preco_in_mtok, preco_out_mtok, preco_cache_mtok, vale_desde FROM bench_preco ORDER BY provedor, modelo"),
    substituir(lista: readonly PrecoBench[]): PrecoBench[] {
      banco.transacao((b) => {
        b.executar("DELETE FROM bench_preco");
        for (const p of lista) b.executar("INSERT OR REPLACE INTO bench_preco (provedor,modelo,preco_in_mtok,preco_out_mtok,preco_cache_mtok,vale_desde) VALUES (?,?,?,?,?,?)", [p.provedor, p.modelo, p.preco_in_mtok, p.preco_out_mtok, p.preco_cache_mtok, p.vale_desde]);
      });
      return precos.listar();
    },
  };

  const runs = {
    criar(n: NovaRun): LinhaRun {
      const id = novoId("task", "brun");
      banco.executar("INSERT INTO bench_run (id,nome,tarefas_json,alvos_json,estado,max_paralelo,teto_usd,juiz_alvo,pesos_json,sandbox,criado_em) VALUES (?,?,?,?, 'enfileirada',?,?,?,?,?,?)",
        [id, n.nome, jsonDe("tarefas", n.tarefas), jsonDe("alvos", n.alvos), n.max_paralelo, n.teto_usd, n.juiz_alvo, jsonDe("pesos", n.pesos), n.sandbox, ts()]);
      return runs.obter(id) as LinhaRun;
    },
    obter(id: string): LinhaRun | undefined {
      const l = banco.consultarUm<LRun>("SELECT * FROM bench_run WHERE id = ?", [id]);
      return l ? run(l) : undefined;
    },
    atualizar(id: string, p: { estado?: EstadoRun; iniciada_em?: string | null; terminada_em?: string | null }): void {
      const sets: string[] = [];
      const v: Array<string | null> = [];
      if (p.estado !== undefined) { sets.push("estado = ?"); v.push(p.estado); }
      if (p.iniciada_em !== undefined) { sets.push("iniciada_em = ?"); v.push(p.iniciada_em); }
      if (p.terminada_em !== undefined) { sets.push("terminada_em = ?"); v.push(p.terminada_em); }
      if (sets.length > 0) banco.executar(`UPDATE bench_run SET ${sets.join(", ")} WHERE id = ?`, [...v, id]);
    },
    listar(depois: string | null, limite = 30): Pagina<LinhaRun> {
      const l = Math.max(1, Math.min(100, limite));
      const linhas = banco.consultar<LRun>(`SELECT * FROM bench_run ${depois === null ? "" : "WHERE id < ?"} ORDER BY id DESC LIMIT ?`, depois === null ? [l + 1] : [depois, l + 1]).map(run);
      const mais = linhas.length > l;
      const itens = mais ? linhas.slice(0, l) : linhas;
      return { itens, proximo: mais ? (itens[itens.length - 1] as LinhaRun).id : null };
    },
    /** boot: Runs `executando|julgando` viram `interrompida`; resultados `executando` viram `interrompido`; NADA retoma sozinho. */
    interromperPendentes(): { runs: number; resultados: number } {
      return banco.transacao((b) => {
        const r = b.executar("UPDATE bench_run SET estado='interrompida', terminada_em=? WHERE estado IN ('executando','julgando','enfileirada')", [ts()]);
        const x = b.executar("UPDATE bench_resultado SET estado='interrompido', atualizado_em=? WHERE estado = 'executando'", [ts()]);
        return { runs: r.alteracoes, resultados: x.alteracoes };
      });
    },
  };

  const resultados = {
    criar(n: NovoResultado): LinhaResultado {
      const id = novoId("task", "bres");
      const t = ts();
      banco.executar("INSERT INTO bench_resultado (id,run_id,tarefa_slug,tarefa_versao,alvo_slug,tentativa,estado,prompt_efetivo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?, 'enfileirado',?,?,?)", [id, n.run_id, n.tarefa_slug, n.tarefa_versao, n.alvo_slug, n.tentativa ?? 1, n.prompt_efetivo ?? "", t, t]);
      return resultados.obter(id) as LinhaResultado;
    },
    obter(id: string): LinhaResultado | undefined {
      const l = banco.consultarUm<LRes>("SELECT * FROM bench_resultado WHERE id = ?", [id]);
      return l ? res(l) : undefined;
    },
    /** resultados da Run; `incluirSubstituidos=false` traz só os vigentes. */
    daRun(runId: string, incluirSubstituidos = false): LinhaResultado[] {
      return banco.consultar<LRes>(`SELECT * FROM bench_resultado WHERE run_id = ? ${incluirSubstituidos ? "" : "AND estado <> 'substituido'"} ORDER BY tarefa_slug, alvo_slug, tentativa`, [runId]).map(res);
    },
    atualizar(id: string, p: PatchResultado): void {
      const m: Record<string, string | number | null> = {};
      const set = (c: string, v: string | number | null | undefined): void => { if (v !== undefined) m[c] = v; };
      set("estado", p.estado); set("workdir", p.workdir); set("log_ref", p.log_ref); set("prompt_efetivo", p.prompt_efetivo); set("duracao_s", p.duracao_s);
      set("custo_usd", p.custo_usd); set("custo_fonte", p.custo_fonte); set("custo_tipo", p.custo_tipo);
      if (p.preco !== undefined) m["preco_json"] = p.preco === null ? null : jsonDe("preco", p.preco);
      set("tokens_in", p.tokens_in); set("tokens_out", p.tokens_out); set("tokens_total", p.tokens_total); set("turnos", p.turnos); set("revisoes", p.revisoes);
      if (p.artefatos !== undefined) m["artefatos_json"] = jsonDe("artefatos", p.artefatos);
      if (p.checagens !== undefined) m["checagens_json"] = jsonDe("checagens", p.checagens);
      set("isolamento", p.isolamento); set("juiz_estado", p.juiz_estado); set("qualidade", p.qualidade);
      if (p.qualidade_detalhe !== undefined) m["qualidade_detalhe_json"] = p.qualidade_detalhe === null ? null : jsonDe("detalhe", p.qualidade_detalhe);
      set("notas", p.notas); set("aviso", p.aviso); set("cli_versao", p.cli_versao);
      const cols = Object.keys(m);
      if (cols.length === 0) return;
      banco.executar(`UPDATE bench_resultado SET ${cols.map((c) => `${c} = ?`).join(", ")}, atualizado_em = ? WHERE id = ?`, [...cols.map((c) => m[c] as string | number | null), ts(), id]);
    },
    /** re-run: o vigente vira `substituido` e nasce `tentativa+1` em `enfileirado` (na mesma transação, por causa do índice único parcial). */
    substituir(anteriorId: string, prompt_efetivo: string): LinhaResultado {
      return banco.transacao((b) => {
        const a = b.consultarUm<LRes>("SELECT * FROM bench_resultado WHERE id = ?", [anteriorId]);
        if (a === undefined) throw new Error("resultado inexistente");
        b.executar("UPDATE bench_resultado SET estado='substituido', atualizado_em=? WHERE id=?", [ts(), anteriorId]);
        return resultados.criar({ run_id: a.run_id, tarefa_slug: a.tarefa_slug, tarefa_versao: a.tarefa_versao, alvo_slug: a.alvo_slug, tentativa: a.tentativa + 1, prompt_efetivo });
      });
    },
    /** resultados vigentes com nota, de uma atividade/alvo (para comparar, recomendar e estimar). */
    historico(f: { alvo?: string; tarefa?: string; estados?: readonly EstadoResultado[]; limite?: number } = {}): LinhaResultado[] {
      const onde: string[] = ["estado <> 'substituido'"];
      const p: Array<string | number> = [];
      if (f.alvo !== undefined) { onde.push("alvo_slug = ?"); p.push(f.alvo); }
      if (f.tarefa !== undefined) { onde.push("tarefa_slug = ?"); p.push(f.tarefa); }
      if (f.estados !== undefined && f.estados.length > 0) { onde.push(`estado IN (${f.estados.map(() => "?").join(",")})`); p.push(...f.estados); }
      return banco.consultar<LRes>(`SELECT * FROM bench_resultado WHERE ${onde.join(" AND ")} ORDER BY criado_em DESC LIMIT ?`, [...p, f.limite ?? 10_000]).map(res);
    },
  };

  const vereditos = {
    criar(v: Omit<LinhaVeredito, "id" | "criado_em">): LinhaVeredito {
      const id = novoId("task", "bjul");
      banco.executar("INSERT INTO bench_veredito (id,run_id,tarefa_slug,tarefa_versao,juiz_modelo,mapa_cego_json,notas_json,ranking_json,criado_em) VALUES (?,?,?,?,?,?,?,?,?)", [id, v.run_id, v.tarefa_slug, v.tarefa_versao, v.juiz_modelo, jsonDe("mapa", v.mapa_cego), jsonDe("notas", v.notas), jsonDe("ranking", { ordem: v.ranking, custo_juiz_usd: v.custo_juiz_usd }), ts()]);
      return vereditos.daRun(v.run_id).find((x) => x.id === id) as LinhaVeredito;
    },
    /** USO INTERNO: devolve o `mapa_cego`. Nunca repassar a canal IPC/MCP. */
    daRun(runId: string): LinhaVeredito[] {
      return banco.consultar<LVer>("SELECT * FROM bench_veredito WHERE run_id = ? ORDER BY criado_em", [runId]).map((l) => ({ id: l.id, run_id: l.run_id, tarefa_slug: l.tarefa_slug, tarefa_versao: l.tarefa_versao, juiz_modelo: l.juiz_modelo, mapa_cego: lerJson(l.mapa_cego_json, {}), notas: lerJson(l.notas_json, {}), ...lerRanking(l.ranking_json), criado_em: l.criado_em }));
    },
    contarDaRun: (runId: string): number => Number(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM bench_veredito WHERE run_id = ?", [runId])?.n ?? 0),
  };

  return { tarefas, alvos, precos, runs, resultados, vereditos };
}
export type ReposBench = ReturnType<typeof criarReposBench>;
