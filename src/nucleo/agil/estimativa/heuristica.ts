// T-18.14: estimativa/classificação DETERMINÍSTICA e instantânea (≤ 5 ms por item). Mesma entrada => mesma saída. Cada fator traz evidência ≤ 160 caracteres.
import type { ConfigAgil, CriticidadeAgil, FatorEstimativa, FatorRisco, FatorRiscoId, RiscoAgil } from "../../../compartilhado/agil";
import { normalizar, truncar } from "../util";
import { escalaDe, moverDegraus } from "./escala";

export interface EntradaEstimativa {
  ref: string;
  titulo: string;
  descricao: string | null;
  criterios: string[];
  tipo_task: string | null;
  /** caminhos RELATIVOS prováveis; vazio = desconhecido. */
  arquivos: string[];
  depende_de: string[];
  origem: string;
  ocorrencia_tipo: string | null;
  valor: number | null;
  urgencia: number | null;
  /** sinais externos (Mapa/legadox/memox); `undefined`/ausente = desconhecido, tratado como falso. */
  sinais: Partial<Record<FatorRiscoId, boolean>>;
  ftr_area: { ftr: number; n: number } | null;
  similar_sem_retrabalho: boolean | null;
}

export interface ResultadoHeuristica {
  ref: string;
  pontos: number;
  rotulo: string;
  escala_id: string;
  fatores: FatorEstimativa[];
  confianca: number;
  categoria: string;
  tipo_task: string;
  risco: RiscoAgil;
  risco_pontuacao: number;
  risco_fatores: FatorRisco[];
  criticidade: CriticidadeAgil;
  sugerir_quebra: boolean;
}

const TETO_PONTOS = 13;
const ev = (t: string): string => truncar(t, 160);
const temAlgum = (texto: string, termos: readonly string[]): string | null => {
  for (const t of termos) {
    const n = normalizar(t);
    if (new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(texto)) return t;
  }
  return null;
};
const ehTeste = (f: string): boolean => /(\.test\.|\.spec\.|\/tests?\/|__tests__|_test\.go)/.test(`/${f.toLowerCase()}`);

export function inferirTipoTask(e: EntradaEstimativa, texto: string): string {
  if (e.tipo_task) return e.tipo_task;
  const f = e.arquivos.map((a) => a.toLowerCase());
  if (f.length > 0 && f.every(ehTeste)) return "teste";
  if (f.some((a) => /migra|\.sql$|schema/.test(a)) || /\bmigra(cao|tion)\b/.test(texto)) return "persistencia";
  if (temAlgum(texto, ["webhook", "api externa", "gateway", "stripe", "integra com", "integracao com"])) return "integracao_externa";
  if (/refator|refactor/.test(texto)) return "refatoracao";
  if (f.some((a) => /\.(tsx|jsx|vue|svelte|css)$|\/ui\/|telas?\/|components?\//.test(a)) || temAlgum(texto, ["tela", "componente", "botao", "interface"])) return "ui";
  if (f.some((a) => /\/api\/|routes?|controller|ipc|mcp/.test(a)) || temAlgum(texto, ["endpoint", "rota", "api"])) return "api";
  if (f.some((a) => /dockerfile|\.ya?ml$|ci\/|\.github\//.test(a)) || temAlgum(texto, ["deploy", "pipeline", "docker"])) return "infra";
  if (temAlgum(texto, ["config", "configuracao", "variavel de ambiente"])) return "config";
  return "dominio";
}

export function inferirCategoria(e: EntradaEstimativa, tipo: string, texto: string, categorias: readonly string[]): string {
  const ok = (c: string): string => (categorias.includes(c) ? c : (categorias[0] as string));
  if (e.ocorrencia_tipo === "bug" || e.origem === "ocorrencia") return ok("bug");
  const titulo = normalizar(e.titulo);
  const chaves: [string, readonly string[]][] = [
    ["bug", ["bug", "erro", "falha", "corrig", "fix", "defeito", "regress", "quebrad"]],
    ["spike", ["spike", "investig", "pesquis", "poc", "prova de conceito"]],
    ["divida", ["divida tecnica", "debito tecnico", "legado"]],
    ["refator", ["refator", "refactor", "limpeza", "renomear"]],
    ["doc", ["doc", "readme", "documenta"]],
    ["teste", ["teste", "test", "cobertura"]],
    ["infra", ["infra", "deploy", "pipeline", "docker", "build"]],
  ];
  for (const alvo of [titulo, texto]) for (const [cat, termos] of chaves) if (temAlgum(alvo, termos)) return ok(cat);
  if (tipo === "teste") return ok("teste");
  if (tipo === "infra" || tipo === "config") return ok("infra");
  if (tipo === "refatoracao") return ok("refator");
  return ok("feature");
}

export function estimarHeuristica(e: EntradaEstimativa, config: ConfigAgil): ResultadoHeuristica {
  const escala = escalaDe(config);
  const textoCompleto = normalizar([e.titulo, e.descricao ?? "", ...e.criterios].join(" \n "));
  const tipo = inferirTipoTask(e, textoCompleto);
  const categoria = inferirCategoria(e, tipo, textoCompleto, config.categorias);
  const arquivos = e.arquivos;

  // ---- sinais de risco (com evidência) ----
  const risco_fatores: FatorRisco[] = [];
  const peso = (id: string): number => config.risco_pesos[id] ?? 0;
  const marcar = (id: FatorRiscoId, evidencia: string): void => {
    risco_fatores.push({ fator: id, peso: peso(id), direcao: "sobe", evidencia: ev(evidencia) });
  };
  const s = e.sinais;
  if (s.raio_alto) marcar("raio_alto", "raio de impacto ALTO nos arquivos prováveis (mapa do código)");
  if (s.zona_risco_historica) marcar("zona_risco_historica", "arquivos com regressão ou reprovação de QA nos últimos 90 dias");
  if (s.sem_cobertura) marcar("sem_cobertura", "arquivo provável sem teste");
  if (s.integracao_externa || tipo === "integracao_externa") marcar("integracao_externa", `tipo_task = ${tipo}: depende de sistema externo`);
  const migra = s.migracao_schema ?? (tipo === "persistencia" && (arquivos.some((a) => /migra|\.sql$/i.test(a)) || /\bmigra(cao|tion)\b/.test(textoCompleto)));
  if (migra) marcar("migracao_schema", "task de persistência com migration de esquema");
  const termo = temAlgum(textoCompleto, config.termos_sensiveis) ?? (arquivos.map(normalizar).map((a) => temAlgum(a, config.termos_sensiveis)).find(Boolean) ?? null);
  if (s.sensivel_dominio || termo) marcar("sensivel_dominio", `termo de domínio sensível: "${termo ?? "sinal externo"}"`);
  const contrato = s.contrato_publico ?? (arquivos.some((a) => /(^|\/)(ipc|catalogo|contratos?|openapi)\b|\/api\//i.test(a)) || /\b(contrato publico|endpoint publico|canal ipc)\b/.test(textoCompleto));
  if (contrato) marcar("contrato_publico", "muda IPC, MCP ou API pública");
  if (e.depende_de.length >= 3) marcar("dependencias_muitas", `${e.depende_de.length} dependências declaradas`);
  if (e.ftr_area && e.ftr_area.n >= 5 && e.ftr_area.ftr < 0.7) marcar("historico_retrabalho_area", `FTR da área ${(e.ftr_area.ftr * 100).toFixed(0)}% em ${e.ftr_area.n} tasks`);
  if (s.lacuna_aberta) marcar("lacuna_aberta", "lacuna ou bloqueio aberto na área");
  if (e.criterios.every((c) => c.trim() === "")) marcar("sem_criterio_aceite", "critério de aceite vazio");

  // ---- pontos: base por tipo e degraus por sinal ----
  const fatores: FatorEstimativa[] = [];
  const base = config.pontos_base_tipo[tipo] ?? 3;
  fatores.push({ fator: "tipo_task", direcao: "sobe", evidencia: ev(`base ${base} para tipo ${tipo}`) });
  let degraus = 0;
  const sobe = (fator: string, evidencia: string): void => { degraus++; fatores.push({ fator, direcao: "sobe", evidencia: ev(evidencia) }); };
  const desce = (fator: string, evidencia: string): void => { degraus--; fatores.push({ fator, direcao: "desce", evidencia: ev(evidencia) }); };
  if (arquivos.length >= 5) sobe("muitos_arquivos", `${arquivos.length} arquivos prováveis`);
  if (s.raio_alto) sobe("raio_alto", "raio de impacto ALTO");
  if (s.sem_cobertura) sobe("sem_cobertura", "sem cobertura de teste");
  if (tipo !== "integracao_externa" && s.integracao_externa) sobe("integracao_externa", "integração externa");
  if (e.depende_de.length >= 3) sobe("dependencias", `${e.depende_de.length} dependências`);
  if (e.criterios.length > 4) sobe("muitos_criterios", `${e.criterios.length} critérios de aceite`);
  if ((e.descricao?.length ?? 0) + e.titulo.length > 600) sobe("texto_longo", "texto da task com mais de 600 caracteres");
  if (arquivos.length === 1) desce("um_arquivo", "um único arquivo provável");
  if (tipo === "teste" || categoria === "doc") desce("escopo_pequeno", `tipo/categoria de escopo contido (${tipo}/${categoria})`);
  if (e.similar_sem_retrabalho) desce("similar_sem_retrabalho", "tarefa similar entregue sem retrabalho");

  let alvo = moverDegraus(base, degraus, escala);
  let sugerirQuebra = false;
  if (alvo.valor > TETO_PONTOS) {
    sugerirQuebra = true;
    if (escala.id !== "horas") {
      const cap = [...escala.valores].reverse().find((v) => v.valor <= TETO_PONTOS);
      if (cap) alvo = cap;
    }
  }
  if (alvo.valor >= 8 && !risco_fatores.some((f) => f.fator === "tamanho_grande")) marcar("tamanho_grande", `estimativa de ${alvo.rotulo} pontos`);

  const pontuacao = risco_fatores.reduce((a, f) => a + f.peso, 0);
  const fx = config.risco_faixas;
  const risco: RiscoAgil = pontuacao >= fx.critico ? "critico" : pontuacao >= fx.alto ? "alto" : pontuacao >= fx.medio ? "medio" : "baixo";

  let crit = 0;
  if (config.categorias_criticas.includes(categoria)) crit += 1;
  const vv = e.valor ?? 0;
  crit += vv >= 8 ? 2 : vv >= 5 ? 1 : 0;
  const uu = e.urgencia ?? 0;
  crit += uu >= 8 ? 2 : uu >= 5 ? 1 : 0;
  if (risco_fatores.some((f) => f.fator === "sensivel_dominio")) crit += 2;
  const criticidade: CriticidadeAgil = crit >= 5 ? "critica" : crit >= 3 ? "alta" : crit >= 2 ? "media" : "baixa";

  const q = 0.2 + (e.criterios.some((c) => c.trim()) ? 0.15 : 0) + ((e.descricao?.length ?? 0) >= 80 ? 0.1 : 0) + (arquivos.length > 0 ? 0.1 : 0) + (e.tipo_task ? 0.1 : 0);
  return {
    ref: e.ref, pontos: alvo.valor, rotulo: alvo.rotulo, escala_id: escala.id, fatores, confianca: Math.round(Math.min(0.6, q) * 100) / 100,
    categoria, tipo_task: tipo, risco, risco_pontuacao: pontuacao, risco_fatores, criticidade, sugerir_quebra: sugerirQuebra,
  };
}

export const rotuloConfianca = (c: number | null): "baixa" | "media" | "alta" | null => (c === null ? null : c < 0.4 ? "baixa" : c < 0.7 ? "media" : "alta");
