import { moduloDe, type ArquivoMapa } from "./tipos";

// Dialetos e padrões (T-17.29): agrega o que os extratores viram por EIXO (erro, config, DI, acesso a dados, data/hora, dinheiro,
// idioma dos nomes, estilo de teste), com contagem por pasta e data de criação (recência, para desempate de CONFLITO), e classifica
// a FORÇA com os rótulos do inventário do stackx (`references/01-deteccao.md`). Só NOMES; nunca valores de variável de ambiente.

export type Forca = "UNÂNIME" | "CONFLITO" | "ÚNICO CASO" | "AUSENTE" | `MAJORITÁRIO ${number}/${number}`;
export type DestinoForca = "convencao" | "convencao_com_excecao" | "conflito" | "convencao_fraca" | "lacuna";

export interface VarianteForca {
  nome: string;
  /** Ocorrências (arquivos) da variante. */
  n: number;
  /** Data média de criação (ms epoch) dos arquivos da variante, quando conhecida. */
  criado_medio?: number | null;
}

export interface ResultadoForca {
  forca: Forca;
  destino: DestinoForca;
  dominante: string | null;
  /** Total de ocorrências (m). */
  total: number;
  /** Minoria (soma das variantes não dominantes). */
  minoria: number;
  nota: string | null;
}

/** Fração abaixo da qual a minoria é "trivial" (stackx: < 10% e sem sinal de recência). */
export const MINORIA_TRIVIAL = 0.1;

/**
 * Reproduz os rótulos do stackx: AUSENTE (0), ÚNICO CASO (1), UNÂNIME (uma variante só), `MAJORITÁRIO n/m` (maioria > 50% com minoria
 * trivial e sem sinal de recência) e CONFLITO (sem maioria, ou maioria com minoria relevante ou mais recente que a dominante).
 */
export function classificarForca(variantes: readonly VarianteForca[]): ResultadoForca {
  const vs = variantes.filter((v) => v.n > 0).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome));
  const total = vs.reduce((s, v) => s + v.n, 0);
  if (total === 0) return { forca: "AUSENTE", destino: "lacuna", dominante: null, total: 0, minoria: 0, nota: null };
  if (total === 1) return { forca: "ÚNICO CASO", destino: "convencao_fraca", dominante: (vs[0] as VarianteForca).nome, total, minoria: 0, nota: "um único exemplo" };
  const dom = vs[0] as VarianteForca;
  if (vs.length === 1) return { forca: "UNÂNIME", destino: "convencao", dominante: dom.nome, total, minoria: 0, nota: null };
  const minoria = total - dom.n;
  if (dom.n * 2 <= total) return { forca: "CONFLITO", destino: "conflito", dominante: dom.nome, total, minoria, nota: "nenhuma variante tem maioria" };
  const recente = vs.slice(1).some((v) => v.criado_medio != null && dom.criado_medio != null && v.criado_medio > dom.criado_medio);
  if (minoria / total < MINORIA_TRIVIAL && !recente) return { forca: `MAJORITÁRIO ${dom.n}/${total}`, destino: "convencao_com_excecao", dominante: dom.nome, total, minoria, nota: `exceção: ${minoria} de ${total}` };
  return { forca: "CONFLITO", destino: "conflito", dominante: dom.nome, total, minoria, nota: recente ? "a minoria é mais recente que a variante dominante" : "minoria relevante" };
}

export interface VariantePadrao {
  nome: string;
  arquivos: number;
  por_pasta: Record<string, number>;
  /** ISO da média de criação dos arquivos (se `criado` foi informado). */
  criado_medio: string | null;
  /** Até 3 evidências `arquivo:linha`. */
  evidencias: string[];
}

export interface EixoPadrao {
  eixo: Eixo;
  variantes: VariantePadrao[];
  forca: ResultadoForca;
}

export const EIXOS = ["erro", "config", "di", "acesso_dados", "data_hora", "dinheiro", "idioma", "estilo_teste"] as const;
export type Eixo = (typeof EIXOS)[number];

export interface ResultadoPadroes {
  eixos: EixoPadrao[];
  /** Nomes (NUNCA valores) de variáveis de ambiente lidas, com a contagem de arquivos. */
  variaveis_de_ambiente: Array<{ nome: string; arquivos: number }>;
  /** Proporção de termos PT × EN por pasta. */
  idioma_por_pasta: Array<{ pasta: string; pt: number; en: number; proporcao_pt: number }>;
}

// ---------------------------------------------------------------------------------------------

const RE_DINHEIRO = /(preco|valor|total|saldo|amount|price|balance|juros|desconto|salario|custo|cost|tarifa|taxa|fee)/i;
const RE_FLUTUANTE = /\b(float|double|number|Float|Double|real)\b/;
const RE_DECIMAL = /\b(Decimal|BigDecimal|decimal|bigint|BigInt|Money|centavos|cents|Dinheiro)\b/;
const RE_RESULT = /\b(Result|Either|Option|Optional|Try)\s*[<[]|,\s*error\)|\)\s*error\b/;

const LIBS_DATA: ReadonlyArray<[RegExp, string]> = [
  [/^moment(-timezone)?$/, "moment"],
  [/^dayjs/, "dayjs"],
  [/^date-fns/, "date-fns"],
  [/^luxon$/, "luxon"],
  [/^(@js-temporal|temporal-polyfill)/, "temporal"],
  [/^datetime$/, "python datetime"],
  [/^(arrow|pendulum)$/, "python arrow/pendulum"],
  [/^java\.time/, "java.time"],
  [/^org\.joda\.time/, "joda-time"],
  [/^NodaTime/, "NodaTime"],
  [/^(Carbon|Illuminate\\Support\\Carbon)/, "carbon"],
  [/^time$/, "time (go)"],
];

const LIBS_CONFIG: ReadonlyArray<[RegExp, string]> = [[/^(config|nconf|convict|dotenv|configparser|viper|@nestjs\/config|Microsoft\.Extensions\.Configuration|decouple|environ)/, "biblioteca de configuração"]];
const DECORADORES_DI = /^@(Inject|Injectable|Autowired|Service|Component|Repository|Bean)\b/;
const LIBS_DI = /^(inversify|tsyringe|@nestjs\/common|org\.springframework|Microsoft\.Extensions\.DependencyInjection|injector|dependency_injector)/;
const RUNNERS_TESTE: ReadonlyArray<[RegExp, string]> = [
  [/^vitest/, "vitest"],
  [/^(@jest\/|jest)/, "jest"],
  [/^mocha/, "mocha"],
  [/^node:test$/, "node:test"],
  [/^pytest/, "pytest"],
  [/^unittest/, "unittest"],
  [/^org\.junit/, "junit"],
  [/^[Xx]unit/, "xunit"],
  [/^NUnit/, "nunit"],
  [/^(rspec|minitest)/, "rspec/minitest"],
  [/^PHPUnit/i, "phpunit"],
];

const PT = new Set("de da do dos das para por com sem em cliente clientes pedido pedidos produto produtos usuario usuarios valor total saldo nota notas fiscal fatura conta contas pagamento pagamentos cobranca emitir emite gerar gera calcular calcula buscar busca salvar salva listar lista obter obtem criar cria atualizar atualiza excluir exclui remover remove enviar envia receber recebe cadastro cadastrar consulta consultar imposto folha ponto ferias salario nome data hora dia mes ano endereco telefone senha entrada saida lancamento extrato boleto".split(" "));
const EN = new Set("get set create update delete remove find list fetch save load build make parse format handle process validate check compute calculate send receive user users order orders product products customer customers account accounts payment payments invoice invoices total balance name date time day month year address phone password config manager service controller repository factory builder helper util utils data item items value values result results error errors request response".split(" "));

function sem(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function termos(nome: string): string[] {
  return sem(nome.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " "))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

interface Acum {
  arquivos: Set<string>;
  por_pasta: Map<string, number>;
  criados: number[];
  evidencias: string[];
}

class Eixos {
  private readonly dados = new Map<Eixo, Map<string, Acum>>();
  constructor(private readonly criado: ReadonlyMap<string, number> | undefined) {}
  marcar(eixo: Eixo, variante: string, a: ArquivoMapa, linha: number | null): void {
    let m = this.dados.get(eixo);
    if (m === undefined) this.dados.set(eixo, (m = new Map()));
    let v = m.get(variante);
    if (v === undefined) m.set(variante, (v = { arquivos: new Set(), por_pasta: new Map(), criados: [], evidencias: [] }));
    if (v.arquivos.has(a.caminho)) return;
    v.arquivos.add(a.caminho);
    const pasta = moduloDe(a);
    v.por_pasta.set(pasta, (v.por_pasta.get(pasta) ?? 0) + 1);
    const c = this.criado?.get(a.caminho);
    if (c !== undefined) v.criados.push(c);
    if (v.evidencias.length < 3) v.evidencias.push(linha === null ? a.caminho : `${a.caminho}:${linha}`);
  }
  resultado(): EixoPadrao[] {
    const saida: EixoPadrao[] = [];
    for (const eixo of EIXOS) {
      const m = this.dados.get(eixo) ?? new Map<string, Acum>();
      const variantes: VariantePadrao[] = [...m].map(([nome, v]) => ({
        nome,
        arquivos: v.arquivos.size,
        por_pasta: Object.fromEntries([...v.por_pasta].sort(([x], [y]) => x.localeCompare(y))),
        criado_medio: v.criados.length === 0 ? null : new Date(v.criados.reduce((s, x) => s + x, 0) / v.criados.length).toISOString(),
        evidencias: v.evidencias,
      }));
      variantes.sort((a, b) => b.arquivos - a.arquivos || a.nome.localeCompare(b.nome));
      const forca = classificarForca(variantes.map((v) => ({ nome: v.nome, n: v.arquivos, criado_medio: v.criado_medio === null ? null : Date.parse(v.criado_medio) })));
      saida.push({ eixo, variantes, forca });
    }
    return saida;
  }
}

/** Agrega os padrões de todos os arquivos. `criado` = data de criação (ms) por caminho, para a recência. */
export function analisarPadroes(arquivos: readonly ArquivoMapa[], criado?: ReadonlyMap<string, number>): ResultadoPadroes {
  const eixos = new Eixos(criado);
  const envs = new Map<string, Set<string>>();
  const idioma = new Map<string, { pt: number; en: number }>();
  for (const a of arquivos) {
    const x = a.extracao;
    if (x.e_gerado) continue;
    const ehTeste = x.e_teste;
    // erro
    const th = x.padroes.find((p) => p.tipo === "throw");
    if (th !== undefined && !ehTeste) eixos.marcar("erro", "excecao (throw)", a, th.linha);
    const rs = x.simbolos.find((s) => RE_RESULT.test(s.assinatura));
    if (rs !== undefined && !ehTeste) eixos.marcar("erro", "retorno tipado de erro (Result/error)", a, rs.linha);
    const cv = x.padroes.find((p) => p.tipo === "catch_vazio");
    if (cv !== undefined && !ehTeste) eixos.marcar("erro", "erro engolido (catch vazio)", a, cv.linha);
    // config
    const env = x.padroes.find((p) => p.tipo === "env");
    for (const p of x.padroes) {
      if (p.tipo === "env" && p.nome !== null) {
        let s = envs.get(p.nome);
        if (s === undefined) envs.set(p.nome, (s = new Set()));
        s.add(a.caminho);
      }
    }
    if (env !== undefined && !ehTeste) eixos.marcar("config", "variável de ambiente direta", a, env.linha);
    const lc = x.imports.find((i) => LIBS_CONFIG.some(([re]) => re.test(i.especificador)));
    if (lc !== undefined && !ehTeste) eixos.marcar("config", LIBS_CONFIG[0]?.[1] ?? "biblioteca de configuração", a, lc.linha);
    // DI
    const dec = x.simbolos.find((s) => s.decoradores.some((d) => DECORADORES_DI.test(d)));
    const ldi = x.imports.find((i) => LIBS_DI.test(i.especificador));
    if ((dec !== undefined || ldi !== undefined) && !ehTeste) eixos.marcar("di", "contêiner de injeção de dependência", a, dec?.linha ?? ldi?.linha ?? null);
    const novo = x.chamadas.find((c) => c.tipo === "instancia" && c.de !== null);
    if (novo !== undefined && !ehTeste) eixos.marcar("di", "instanciação direta (new)", a, novo.linha);
    // acesso a dados
    for (const d of x.dados) {
      if (d.operacao === "define" || ehTeste) continue;
      const fonte = d.fonte.toLowerCase();
      if (fonte === "sql" || fonte === "ddl") eixos.marcar("acesso_dados", "SQL cru", a, d.linha);
      else if (/proc|call|exec/.test(fonte)) eixos.marcar("acesso_dados", "procedure", a, d.linha);
      else eixos.marcar("acesso_dados", `ORM (${d.fonte})`, a, d.linha);
    }
    // data/hora
    for (const i of x.imports) {
      const l = LIBS_DATA.find(([re]) => re.test(i.especificador));
      if (l !== undefined && !ehTeste) eixos.marcar("data_hora", l[1], a, i.linha);
    }
    // dinheiro: identificadores monetários e o tipo declarado na assinatura
    if (!ehTeste) {
      for (const s of x.simbolos) {
        if (!RE_DINHEIRO.test(s.nome) && !RE_DINHEIRO.test(s.assinatura)) continue;
        const dec2 = RE_DECIMAL.test(s.assinatura) || RE_DECIMAL.test(s.nome);
        const flut = RE_FLUTUANTE.test(s.assinatura);
        if (dec2) eixos.marcar("dinheiro", "decimal / centavos", a, s.linha);
        else if (flut) eixos.marcar("dinheiro", "ponto flutuante (float/double/number)", a, s.linha);
      }
    }
    // idioma dos nomes (por pasta)
    const pasta = moduloDe(a);
    let id = idioma.get(pasta);
    if (id === undefined) idioma.set(pasta, (id = { pt: 0, en: 0 }));
    for (const s of x.simbolos) {
      for (const t of termos(s.nome)) {
        if (PT.has(t)) id.pt++;
        else if (EN.has(t)) id.en++;
      }
    }
    // estilo de teste
    if (ehTeste) {
      for (const i of x.imports) {
        const r = RUNNERS_TESTE.find(([re]) => re.test(i.especificador));
        if (r !== undefined) eixos.marcar("estilo_teste", r[1], a, i.linha);
      }
    }
  }
  // idioma como eixo: cada pasta com termos conta como uma ocorrência da língua predominante
  const idiomaPasta = [...idioma]
    .filter(([, v]) => v.pt + v.en > 0)
    .map(([pasta, v]) => ({ pasta, pt: v.pt, en: v.en, proporcao_pt: Math.round((v.pt / (v.pt + v.en)) * 100) / 100 }))
    .sort((a, b) => a.pasta.localeCompare(b.pasta));
  const res = eixos.resultado();
  const ei = res.find((e) => e.eixo === "idioma") as EixoPadrao;
  const pt = idiomaPasta.filter((p) => p.proporcao_pt >= 0.5).length;
  const en = idiomaPasta.length - pt;
  ei.variantes = [
    ...(pt > 0 ? [{ nome: "nomes em português", arquivos: pt, por_pasta: Object.fromEntries(idiomaPasta.filter((p) => p.proporcao_pt >= 0.5).map((p) => [p.pasta, 1])), criado_medio: null, evidencias: idiomaPasta.filter((p) => p.proporcao_pt >= 0.5).slice(0, 3).map((p) => p.pasta) }] : []),
    ...(en > 0 ? [{ nome: "nomes em inglês", arquivos: en, por_pasta: Object.fromEntries(idiomaPasta.filter((p) => p.proporcao_pt < 0.5).map((p) => [p.pasta, 1])), criado_medio: null, evidencias: idiomaPasta.filter((p) => p.proporcao_pt < 0.5).slice(0, 3).map((p) => p.pasta) }] : []),
  ].sort((a, b) => b.arquivos - a.arquivos || a.nome.localeCompare(b.nome));
  ei.forca = classificarForca(ei.variantes.map((v) => ({ nome: v.nome, n: v.arquivos })));
  return {
    eixos: res,
    variaveis_de_ambiente: [...envs].map(([nome, s]) => ({ nome, arquivos: s.size })).sort((a, b) => b.arquivos - a.arquivos || a.nome.localeCompare(b.nome)),
    idioma_por_pasta: idiomaPasta,
  };
}
