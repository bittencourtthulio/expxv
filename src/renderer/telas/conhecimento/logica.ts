// Lógica pura da tela Conhecimento (Fase 15): filtros do grafo, textos de estado, validação do backend e máquina da migração.
import type { ArestaGrafo, EstadoConsulta, EstadoMigracao, FonteResultado, NoGrafo } from "../../../compartilhado/conhecimento";
import type { CampoProvedor } from "../../../compartilhado/rag";
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";

export type AbaConhecimento = "grafo" | "lista" | "fontes" | "aprendizados" | "backend" | "config";
export const ABAS_CONHECIMENTO: ReadonlyArray<ItemSubNav<AbaConhecimento>> = [
  { id: "grafo", rotulo: "Grafo", icone: "grafo" }, { id: "lista", rotulo: "Lista", icone: "catalogo" }, { id: "fontes", rotulo: "Fontes", icone: "pasta" },
  { id: "aprendizados", rotulo: "Aprendizados", icone: "memoria" }, { id: "backend", rotulo: "Backend", icone: "provedores" }, { id: "config", rotulo: "Config", icone: "config" },
];

// ---- tipos de nó -----------------------------------------------------------------------------------------------------

// Cores só por tokens (tokens.css): 13 tipos sobre os tokens de gráfico e de estado, nos dois temas.
const CORES_NO: Record<string, string> = {
  arquivo: "var(--grafico-1)", simbolo: "var(--grafico-6)", task: "var(--grafico-3)", missao: "var(--grafico-5)", decisao: "var(--grafico-2)", commit: "var(--destaque)", pr: "var(--grafico-4)",
  sessao: "var(--texto-discreto)", agente: "var(--destaque-2)", aprendizado: "var(--aviso)", relatorio: "var(--sucesso)", ocorrencia: "var(--alerta)", doc: "var(--destaque-texto)",
};
export const COR_ARESTA: Record<string, string> = {
  toca: "var(--texto-discreto)", implementa: "var(--sucesso)", corrigiu: "var(--destaque-2)", causou: "var(--alerta)", depende: "var(--grafico-5)",
  citou: "var(--aviso)", pertence: "var(--grafico-1)", executou: "var(--texto-suave)", produziu: "var(--grafico-2)", substitui: "var(--grafico-4)",
};
export const corDoTipo = (tipo: string): string => CORES_NO[tipo] ?? "var(--texto-suave)";
export const corDaAresta = (tipo: string): string => COR_ARESTA[tipo] ?? "var(--texto-discreto)";

export const ROTULO_TIPO_NO: Record<string, string> = {
  arquivo: "Arquivo", simbolo: "Símbolo", task: "Task", missao: "Missão", decisao: "Decisão", commit: "Commit", pr: "PR",
  sessao: "Sessão", agente: "Agente", aprendizado: "Aprendizado", relatorio: "Relatório", ocorrencia: "Ocorrência", doc: "Documento",
};
export const rotuloDoTipo = (tipo: string): string => ROTULO_TIPO_NO[tipo] ?? tipo;

const semAcento = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface FiltroGrafo { tipos?: ReadonlySet<string> | null; busca?: string; desde?: string | null; missionId?: string | null }

export function filtrarGrafo(nos: readonly NoGrafo[], arestas: readonly ArestaGrafo[], f: FiltroGrafo): { nos: NoGrafo[]; arestas: ArestaGrafo[] } {
  const busca = semAcento((f.busca ?? "").trim());
  const desde = f.desde !== undefined && f.desde !== null ? Date.parse(f.desde) : Number.NaN;
  const ok = nos.filter((n) => {
    if (f.tipos !== undefined && f.tipos !== null && f.tipos.size > 0 && !f.tipos.has(n.tipo)) return false;
    if (busca !== "" && !semAcento(n.rotulo).includes(busca)) return false;
    if (!Number.isNaN(desde) && Date.parse(n.ultimo_em) < desde) return false;
    if (f.missionId !== undefined && f.missionId !== null && n.mission_id !== f.missionId) return false;
    return true;
  });
  const ids = new Set(ok.map((n) => n.id));
  return { nos: ok, arestas: arestas.filter((a) => ids.has(a.origem) && ids.has(a.destino)) };
}

export function agruparPorTipo(nos: readonly NoGrafo[]): Array<{ tipo: string; n: number }> {
  const m = new Map<string, number>();
  for (const n of nos) m.set(n.tipo, (m.get(n.tipo) ?? 0) + 1);
  return [...m.entries()].map(([tipo, n]) => ({ tipo, n })).sort((a, b) => b.n - a.n || (a.tipo < b.tipo ? -1 : 1));
}

/** Vizinhos de 1 salto (ids), sem repetir, na ordem em que aparecem nas arestas. */
export function vizinhosDe(id: string, arestas: readonly ArestaGrafo[]): string[] {
  const r: string[] = [];
  for (const a of arestas) {
    const outro = a.origem === id ? a.destino : a.destino === id ? a.origem : null;
    if (outro !== null && !r.includes(outro)) r.push(outro);
  }
  return r;
}

// ---- consulta ---------------------------------------------------------------------------------------------------------

export function descreverEstadoConsulta(estado: EstadoConsulta, aviso: string | null): { texto: string; tom: "sucesso" | "neutro" | "aviso" | "alerta" } {
  const extra = aviso !== null && aviso.trim() !== "" ? ` ${aviso.trim().replace(/\s+/g, " ")}` : "";
  switch (estado) {
    case "ok": return { texto: "Consulta completa.", tom: "sucesso" };
    case "vazio": return { texto: `Nada encontrado para esta busca.${extra}`, tom: "neutro" };
    case "lento": return { texto: `A consulta demorou mais que o esperado.${extra}`, tom: "aviso" };
    case "degradado": return { texto: `Resposta parcial: usando só parte dos recursos.${extra}`, tom: "aviso" };
    case "indisponivel": return { texto: `O índice não respondeu agora.${extra}`, tom: "alerta" };
    case "desligado": return { texto: "O conhecimento está desligado neste projeto. Ligue em Config.", tom: "neutro" };
  }
}

function dataCurta(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
/** `tipo · data · origem · missão X · task`. */
export function linhaDeFonte(f: FonteResultado): string {
  const partes: string[] = [f.tipo];
  const d = dataCurta(f.ocorrido_em);
  if (d !== null) partes.push(d);
  partes.push(f.origem);
  if (f.mission_id !== null) partes.push(`missão ${f.mission_id}`);
  if (f.task_ref !== null) partes.push(f.task_ref);
  return partes.join(" · ");
}

export function formatarBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 B";
  const un = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < un.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1).replace(".", ",")} ${un[i]}`;
}

export const formatarPct = (p: number | null): string => (p === null ? "—" : `${Math.round(p)}%`);

// ---- backend online: URL e formulário -----------------------------------------------------------------------------------

export interface AvaliacaoUrl { ok: boolean; aviso: string | null; erro: string | null }

const ehPrivadoOuLoopback = (host: string): boolean => {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (m === null) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
};

/** Mesma regra do main (https obrigatório; http só loopback/rede privada, com aviso) — reimplementada aqui, sem importar o núcleo. */
export function avaliarUrl(bruta: string): AvaliacaoUrl {
  const texto = bruta.trim();
  if (texto === "") return { ok: false, aviso: null, erro: "Informe a URL do serviço." };
  let u: URL;
  try { u = new URL(texto); } catch { return { ok: false, aviso: null, erro: "URL inválida." }; }
  if (u.username !== "" || u.password !== "") return { ok: false, aviso: null, erro: "A URL não pode conter usuário ou senha." };
  if (u.protocol === "https:") return { ok: true, aviso: null, erro: null };
  if (u.protocol === "http:") {
    return ehPrivadoOuLoopback(u.hostname)
      ? { ok: true, aviso: "Conexão http sem criptografia: aceitável só nesta máquina ou numa rede privada.", erro: null }
      : { ok: false, aviso: null, erro: "Use https. O http só é aceito para esta máquina ou rede privada." };
  }
  return { ok: false, aviso: null, erro: "Use uma URL https." };
}

export interface EntradaFormulario {
  url: string;
  colecao: string;
  valores: Readonly<Record<string, string>>;
  mascaras: Readonly<Record<string, string>>;
  campos: readonly CampoProvedor[];
}
export function validarFormulario(f: EntradaFormulario): { ok: boolean; erros: Record<string, string> } {
  const erros: Record<string, string> = {};
  const u = avaliarUrl(f.url);
  if (!u.ok) erros["url"] = u.erro ?? "URL inválida.";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(f.colecao.trim())) erros["colecao"] = "Use de 1 a 64 caracteres: letras, números, ponto, hífen ou sublinhado.";
  for (const c of f.campos) {
    if (!c.obrigatorio) continue;
    const digitado = (f.valores[c.chave] ?? "").trim() !== "";
    const salvo = c.secreto && f.mascaras[c.chave] !== undefined;
    if (!digitado && !salvo) erros[c.chave] = `${c.rotulo} é obrigatório.`;
  }
  return { ok: Object.keys(erros).length === 0, erros };
}

// ---- máquina da migração (prévia → consentimento → migrando → verificando) ----------------------------------------------

export type EtapaMigracao = "inicio" | "previa" | "consentimento" | "consentida" | "migrando" | "pausada" | "verificando" | "concluida" | "falhou" | "cancelada";
export interface EstadoMaquina { etapa: EtapaMigracao; previaId: string | null; enviados: number; total: number }
export type EntradaMaquina =
  | { tipo: "previa_pronta"; previa_id: string }
  | { tipo: "pedir_consentimento" }
  | { tipo: "consentir" }
  | { tipo: "recusar" }
  | { tipo: "iniciar" }
  | { tipo: "progresso"; estado: EstadoMigracao; enviados: number; total: number }
  | { tipo: "reiniciar" };

const EM_VOO: ReadonlySet<EtapaMigracao> = new Set(["migrando", "pausada", "verificando"]);

export const maquinaMigracao = {
  inicial: (): EstadoMaquina => ({ etapa: "inicio", previaId: null, enviados: 0, total: 0 }),
  passo(s: EstadoMaquina, e: EntradaMaquina): EstadoMaquina {
    switch (e.tipo) {
      case "reiniciar": return maquinaMigracao.inicial();
      case "previa_pronta": return EM_VOO.has(s.etapa) ? s : { etapa: "previa", previaId: e.previa_id, enviados: 0, total: 0 };
      case "pedir_consentimento": return s.etapa === "previa" ? { ...s, etapa: "consentimento" } : s;
      case "recusar": return s.etapa === "consentimento" ? { ...s, etapa: "previa" } : s;
      case "consentir": return s.etapa === "consentimento" ? { ...s, etapa: "consentida" } : s;
      case "iniciar": return s.etapa === "consentida" ? { ...s, etapa: "migrando" } : s;
      case "progresso": {
        if (!EM_VOO.has(s.etapa) && s.etapa !== "consentida") return s;
        const base = { ...s, enviados: e.enviados, total: e.total };
        switch (e.estado) {
          case "enviando": return { ...base, etapa: "migrando" };
          case "pausada": return { ...base, etapa: "pausada" };
          case "verificando": return { ...base, etapa: "verificando" };
          case "concluida": return { ...base, etapa: "concluida" };
          case "falhou": return { ...base, etapa: "falhou" };
          case "cancelada": return { ...base, etapa: "cancelada" };
          default: return s;
        }
      }
    }
  },
};
export const assinarMaquina = (s: EstadoMaquina): string => `${s.etapa}:${s.enviados}/${s.total}`;
