// Adaptador Supabase/PostgREST + pgvector (G §1.6): REST puro sobre uma tabela preparada pelo usuário com o SCRIPT SQL abaixo
// (extensão vector, tabela, índice HNSW, RPC de busca por similaridade e RLS de exemplo). Upsert `Prefer: resolution=merge-duplicates`,
// contagem `Prefer: count=exact` (cabeçalho `content-range`), busca por RPC. Credencial: `apikey` + `Authorization: Bearer`.
// Filtros de tabela vão no parâmetro `and=(…)` do PostgREST com TODO valor entre aspas duplas (escape de `"` e `\`) e codificado na URL;
// filtros da RPC vão como JSON (função `<tabela>_filtro_ok`, sem SQL dinâmico).
import { CursorInvalidoErro, FiltroInvalidoErro, type Capacidades, type Filtro, type MetricaDistancia, type PaginaExportada, type RegistroConhecimento, type ResultadoBuscaArmazenamento } from "../../armazenamento/interface";
import { ArmazenamentoHttp, enc, escoreBruto, fatiar, ID_CONFIG, limparTexto, metaParaPlano, parseVetor, planoParaMeta, segredoObrigatorio, type ConfigRemota, type OpcoesAdaptador } from "./comum";

export const CAPACIDADES_SUPABASE: Omit<Capacidades, "loteMaximo"> & { loteMaximo: number } = {
  hibrido: true,
  filtroNativo: true,
  exportarComCursor: true,
  apagarPorFiltro: true,
  dimensaoMaxima: 2000,
  loteMaximo: 100,
  consistenciaEventual: false,
  multiTenancy: "campo",
};

export const TABELA_PADRAO_SUPABASE = "rag_conhecimento";
export const DIMENSAO_PADRAO_SCRIPT = 256;

/** Gera o SQL de preparação (copiável) para a tabela e a dimensão informadas. Idempotente. */
export function gerarScriptSupabase(o: { tabela?: string; dimensao?: number } = {}): string {
  const t = o.tabela ?? TABELA_PADRAO_SUPABASE;
  const d = o.dimensao ?? DIMENSAO_PADRAO_SCRIPT;
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(t)) throw new Error("nome de tabela inválido (use minúsculas, números e _)");
  if (!Number.isInteger(d) || d < 1 || d > 2000) throw new Error("dimensão inválida (1 a 2000 para índice HNSW)");
  return `-- Preparação do RAG online no Supabase (rode UMA vez no SQL Editor do seu projeto).
-- Tabela "${t}", vetores de ${d} dimensões (troque ${d} pela dimensão do seu modelo ANTES de rodar; o app recusa dimensão diferente).
-- Seguro para repetir: tudo usa IF NOT EXISTS / CREATE OR REPLACE.

create extension if not exists vector;

create table if not exists public.${t} (
  id               text primary key,
  projeto_id       text not null,
  equipe_id        text,
  tipo             text not null default '',
  origem           text not null default '',
  hash_conteudo    text not null default '',
  modelo_embedding text not null default '',
  dimensao         integer not null default ${d},
  indice           integer,
  titulo           text,
  criado_em        text not null default '',
  criado_em_ms     bigint not null default 0,
  texto            text not null default '',
  embedding        vector(${d}),
  texto_busca      tsvector generated always as (to_tsvector('simple', coalesce(texto, ''))) stored
);

create index if not exists ${t}_projeto_idx on public.${t} (projeto_id, tipo);
create index if not exists ${t}_criado_idx  on public.${t} (criado_em_ms);
create index if not exists ${t}_texto_idx   on public.${t} using gin (texto_busca);
-- Índice vetorial (cosseno). Para outra métrica troque o operador (vector_ip_ops / vector_l2_ops).
create index if not exists ${t}_hnsw_idx on public.${t} using hnsw (embedding vector_cosine_ops);

-- Filtro estruturado (mesma AST do app, como JSON): sem SQL dinâmico, só campos da lista fechada.
create or replace function public.${t}_filtro_ok(linha jsonb, f jsonb) returns boolean
language plpgsql immutable as $$
declare item jsonb; v text; campo text;
begin
  if f is null or f = 'null'::jsonb then return true; end if;
  if f ? 'e' then
    for item in select * from jsonb_array_elements(f->'e') loop
      if not public.${t}_filtro_ok(linha, item) then return false; end if;
    end loop;
    return true;
  elsif f ? 'ou' then
    for item in select * from jsonb_array_elements(f->'ou') loop
      if public.${t}_filtro_ok(linha, item) then return true; end if;
    end loop;
    return false;
  end if;
  campo := f->>'campo';
  if campo is null or campo not in ('projeto_id','equipe_id','tipo','origem','hash_conteudo','modelo_embedding','dimensao','criado_em_ms') then return false; end if;
  v := linha->>campo;
  if f ? 'igual' then return v = (f->>'igual');
  elsif f ? 'em' then return v in (select jsonb_array_elements_text(f->'em'));
  elsif f ? 'entre' then return v is not null and v::numeric between (f->'entre'->>0)::numeric and (f->'entre'->>1)::numeric;
  end if;
  return false;
end $$;

-- Busca por similaridade. metrica: 'cosseno' | 'produto_interno' | 'euclidiana'. Devolve a DISTÂNCIA (menor = mais parecido).
create or replace function public.${t}_buscar(consulta vector(${d}), k integer default 10, metrica text default 'cosseno', filtro jsonb default null)
returns table (id text, texto text, projeto_id text, equipe_id text, tipo text, origem text, hash_conteudo text, modelo_embedding text,
               dimensao integer, indice integer, titulo text, criado_em text, criado_em_ms bigint, distancia double precision)
language sql stable as $$
  select t.id, t.texto, t.projeto_id, t.equipe_id, t.tipo, t.origem, t.hash_conteudo, t.modelo_embedding, t.dimensao, t.indice, t.titulo, t.criado_em, t.criado_em_ms,
         (case metrica when 'produto_interno' then (t.embedding <#> consulta) when 'euclidiana' then (t.embedding <-> consulta) else (t.embedding <=> consulta) end)::double precision as distancia
  from public.${t} t
  where t.id <> '__config__' and t.embedding is not null and public.${t}_filtro_ok(to_jsonb(t) - 'embedding' - 'texto_busca', filtro)
  order by distancia asc
  limit least(greatest(k, 1), 200)
$$;

-- Busca textual (parte lexical do híbrido). consulta_texto vem pronta (termos alfanuméricos unidos por " | ").
create or replace function public.${t}_buscar_texto(consulta_texto text, k integer default 40, filtro jsonb default null)
returns table (id text, texto text, projeto_id text, equipe_id text, tipo text, origem text, hash_conteudo text, modelo_embedding text,
               dimensao integer, indice integer, titulo text, criado_em text, criado_em_ms bigint)
language sql stable as $$
  select t.id, t.texto, t.projeto_id, t.equipe_id, t.tipo, t.origem, t.hash_conteudo, t.modelo_embedding, t.dimensao, t.indice, t.titulo, t.criado_em, t.criado_em_ms
  from public.${t} t
  where t.id <> '__config__' and t.texto_busca @@ to_tsquery('simple', consulta_texto) and public.${t}_filtro_ok(to_jsonb(t) - 'embedding' - 'texto_busca', filtro)
  order by ts_rank(t.texto_busca, to_tsquery('simple', consulta_texto)) desc
  limit least(greatest(k, 1), 200)
$$;

-- Segurança: o app usa a chave service_role (guardada só no cofre do seu sistema). Ligue o RLS para que a chave anon/pública
-- NUNCA leia a tabela; a service_role ignora o RLS. Exemplo de política para equipe autenticada (ajuste ao seu modelo):
alter table public.${t} enable row level security;
-- create policy "${t}_equipe_le" on public.${t} for select to authenticated
--   using (projeto_id in (select projeto_id from public.minha_equipe_projetos where user_id = auth.uid()));
revoke all on public.${t} from anon;
`;
}

export const SCRIPT_PREPARACAO_SUPABASE = gerarScriptSupabase();

type Obj = Record<string, unknown>;
const ASPAS = (s: string): string => `"${limparTexto(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const valor = (x: string | number | boolean): string => (typeof x === "number" ? (Number.isFinite(x) ? String(x) : "0") : typeof x === "boolean" ? String(x) : ASPAS(x));

/** Filtro do núcleo → árvore lógica do PostgREST (`and(...)`/`or(...)`/`campo.op.valor`). Todo texto vai entre aspas duplas escapadas. */
export function traduzirFiltroPostgrest(f: Filtro): string {
  if ("e" in f) return `and(${f.e.map(traduzirFiltroPostgrest).join(",")})`;
  if ("ou" in f) return `or(${f.ou.map(traduzirFiltroPostgrest).join(",")})`;
  if (!/^[a-z_]+$/.test(f.campo)) throw new FiltroInvalidoErro("campo inválido");
  if ("igual" in f) return `${f.campo}.eq.${valor(f.igual)}`;
  if ("em" in f) return `${f.campo}.in.(${f.em.map(valor).join(",")})`;
  if ("entre" in f) return `and(${f.campo}.gte.${valor(f.entre[0])},${f.campo}.lte.${valor(f.entre[1])})`;
  throw new FiltroInvalidoErro("filtro inválido");
}

const METRICA_RPC: Record<MetricaDistancia, string> = { cosseno: "cosseno", produto_interno: "produto_interno", euclidiana: "euclidiana" };

export class ArmazenamentoSupabase extends ArmazenamentoHttp {
  protected readonly caps = CAPACIDADES_SUPABASE;
  private readonly tabela: string;
  constructor(o: OpcoesAdaptador) {
    super(o, "supabase");
    segredoObrigatorio(o.segredos, "service_key", "supabase");
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(o.colecao)) throw new Error("nome da tabela inválido (minúsculas, números e _)");
    this.tabela = o.colecao;
  }
  private t(q = ""): string {
    return `/rest/v1/${this.tabela}${q}`;
  }
  protected cabecalhosAuth(): Record<string, string> {
    const k = segredoObrigatorio(this.o.segredos, "service_key", "supabase");
    return { apikey: k, authorization: `Bearer ${k}` };
  }
  /** `and=(id.neq."__config__", ...)` codificado. */
  private and(...extras: string[]): string {
    return `and=${enc(`(${[`id.neq.${ASPAS(ID_CONFIG)}`, ...extras].join(",")})`)}`;
  }
  private andComFiltro(filtro: Filtro | undefined, ...extras: string[]): string {
    return this.and(...extras, ...(filtro === undefined ? [] : [traduzirFiltroPostgrest(filtro)]));
  }

  protected async sondar(): Promise<{ versao?: string }> {
    const r = await this.chamar("GET", this.t("?select=id&limit=1"), { aceitar: [404] });
    if (r.status === 404) throw new Error(`supabase: tabela "${this.tabela}" não encontrada; aplique o script de preparação SQL no seu projeto`);
    return { versao: "supabase-postgrest" };
  }

  protected async preparar(): Promise<{ vazia: boolean }> {
    await this.sondar();
    return { vazia: (await this.contarRemoto(undefined)) === 0 };
  }

  async lerConfigRemota(): Promise<ConfigRemota | null> {
    const r = await this.chamar("GET", this.t(`?select=id,modelo_embedding,dimensao,titulo&id=eq.${enc(ID_CONFIG)}`), { aceitar: [404] });
    if (r.status === 404) return null;
    const l = (r.json as Obj[] | null) ?? [];
    const row = l[0];
    if (!row || typeof row.modelo_embedding !== "string" || typeof row.dimensao !== "number" || typeof row.titulo !== "string") return null;
    const m = row.titulo;
    return m === "cosseno" || m === "produto_interno" || m === "euclidiana" ? { modeloEmbedding: row.modelo_embedding, dimensao: row.dimensao, metrica: m } : null;
  }

  protected async gravarConfig(c: ConfigRemota): Promise<void> {
    await this.chamar("POST", this.t("?on_conflict=id"), {
      corpo: [{ id: ID_CONFIG, texto: "", projeto_id: ID_CONFIG, equipe_id: null, tipo: "", origem: ID_CONFIG, hash_conteudo: "", modelo_embedding: c.modeloEmbedding, dimensao: c.dimensao, indice: null, titulo: METRICA_RPC[c.metrica], criado_em: "", criado_em_ms: 0, embedding: null }],
      cabecalhos: { prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }

  protected async gravar(regs: RegistroConhecimento[]): Promise<void> {
    const linhas = regs.map((r) => {
      const p = metaParaPlano(r.meta);
      return { id: r.id, texto: r.texto, projeto_id: p.projeto_id, equipe_id: p.equipe_id ?? null, tipo: p.tipo, origem: p.origem, hash_conteudo: p.hash_conteudo, modelo_embedding: p.modelo_embedding, dimensao: p.dimensao, indice: p.indice ?? null, titulo: p.titulo ?? null, criado_em: p.criado_em, criado_em_ms: p.criado_em_ms, embedding: JSON.stringify(r.vetor) };
    });
    await this.chamar("POST", this.t("?on_conflict=id"), { corpo: linhas, cabecalhos: { prefer: "resolution=merge-duplicates,return=minimal" } });
  }

  private paraMeta(l: Obj): RegistroConhecimento["meta"] {
    return planoParaMeta(l);
  }

  protected async buscarVetor(vetor: number[], filtro: Filtro | undefined, k: number, c: ConfigRemota): Promise<ResultadoBuscaArmazenamento[]> {
    const r = await this.chamar("POST", `/rest/v1/rpc/${this.tabela}_buscar`, { corpo: { consulta: JSON.stringify(vetor), k, metrica: METRICA_RPC[c.metrica], filtro: filtro ?? null } });
    return ((r.json as Obj[] | null) ?? []).map((l) => {
      const d = Number(l.distancia ?? 0);
      // <=> = 1 - cos ; <#> = -produto ; <-> = distância L2
      const bruto = c.metrica === "cosseno" ? { cosseno: 1 - d } : c.metrica === "produto_interno" ? { produto: -d } : { distancia: d };
      return { id: String(l.id), escore: escoreBruto(c.metrica, bruto), texto: typeof l.texto === "string" ? l.texto : "", meta: this.paraMeta(l) };
    });
  }

  protected override async buscarTexto(termos: string[], filtro: Filtro | undefined, k: number): Promise<ResultadoBuscaArmazenamento[]> {
    const seguros = termos.map((t) => t.replace(/[^\p{L}\p{N}_]/gu, "")).filter((t) => t.length >= 2);
    if (seguros.length === 0) return [];
    const r = await this.chamar("POST", `/rest/v1/rpc/${this.tabela}_buscar_texto`, { corpo: { consulta_texto: seguros.join(" | "), k, filtro: filtro ?? null } });
    return ((r.json as Obj[] | null) ?? []).map((l) => ({ id: String(l.id), escore: 0, texto: typeof l.texto === "string" ? l.texto : "", meta: this.paraMeta(l) }));
  }

  protected async contarRemoto(filtro: Filtro | undefined): Promise<number> {
    const r = await this.chamar("GET", this.t(`?select=id&limit=1&${this.andComFiltro(filtro)}`), { cabecalhos: { prefer: "count=exact" } });
    const cr = r.resposta.cabecalho("content-range") ?? "";
    const n = Number(cr.split("/")[1]);
    if (!Number.isFinite(n)) throw new Error("supabase: resposta sem contagem (content-range)");
    return n;
  }

  private paraRegistro(l: Obj): RegistroConhecimento {
    return { id: String(l.id), vetor: parseVetor(l.embedding), texto: typeof l.texto === "string" ? l.texto : "", meta: this.paraMeta(l) };
  }

  protected async paginaRemota(cursor: string | null, tamanho: number, filtro: Filtro | undefined): Promise<PaginaExportada> {
    const extras: string[] = [];
    if (cursor !== null) {
      if (!/^s:[A-Za-z0-9_.:-]{1,100}$/.test(cursor)) throw new CursorInvalidoErro();
      extras.push(`id.gt.${ASPAS(cursor.slice(2))}`);
    }
    const r = await this.chamar("GET", this.t(`?select=*&order=id.asc&limit=${tamanho + 1}&${this.andComFiltro(filtro, ...extras)}`));
    const l = (r.json as Obj[] | null) ?? [];
    const pagina = l.slice(0, tamanho);
    const ultimo = pagina[pagina.length - 1];
    return { itens: pagina.map((x) => this.paraRegistro(x)), proximoCursor: l.length > tamanho && ultimo ? `s:${String(ultimo.id)}` : null };
  }

  protected async porIds(ids: string[]): Promise<RegistroConhecimento[]> {
    const saida: RegistroConhecimento[] = [];
    for (const lote of fatiar(ids, 100)) {
      const r = await this.chamar("GET", this.t(`?select=*&${this.and(`id.in.(${lote.map(ASPAS).join(",")})`)}`));
      for (const l of (r.json as Obj[] | null) ?? []) saida.push(this.paraRegistro(l));
    }
    return saida;
  }

  protected async removerRemoto(filtro: Filtro): Promise<number> {
    const r = await this.chamar("DELETE", this.t(`?select=id&${this.andComFiltro(filtro)}`), { cabecalhos: { prefer: "return=representation" } });
    return ((r.json as unknown[] | null) ?? []).length;
  }
}
