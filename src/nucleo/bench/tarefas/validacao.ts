// Validação de tarefa: o ESFORÇO nunca entra no texto do prompt (ele é parâmetro do alvo, passado ao adaptador como flag/env) e a lista de checagens é fechada.
import { CRITERIOS_RUBRICA, ESTADOS_TAREFA, TIPOS_CHECAGEM, TIPOS_TAREFA, type ChecagemTarefa, type ErroTarefa, type TarefaEditavel } from "../tipos";
import { comandoPermitido } from "../medicao/comandos";

/** Indicações de esforço/raciocínio que contaminariam a comparação se vivessem no prompt. */
const PADROES_ESFORCO: readonly RegExp[] = [
  /\bextra[\s-]?high\b/i, /\bxhigh\b/i, /\bhigh[\s-]?effort\b/i, /\blow[\s-]?effort\b/i, /\bmedium[\s-]?effort\b/i, /\bmax(?:imum)?[\s-]?effort\b/i, /\breasoning[\s-]?effort\b/i, /\beffort\b/i,
  /\besfor[cç]o\s+(?:alto|baixo|m[eé]dio|m[aá]ximo|extra)/i, /\besfor[cç]o\b/i, /\bthink\s+(?:hard|harder|deeply|step)/i, /\bpense\s+(?:muito|profundamente|bastante)/i, /\bultrathink\b/i, /\bpensamento\s+(?:profundo|estendido)/i,
];

export function indicaEsforco(texto: string): boolean {
  return PADROES_ESFORCO.some((p) => p.test(texto));
}

const CAMINHO_RELATIVO = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0\\]{1,200}$/;
export const SLUG_VALIDO = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validarChecagem(c: ChecagemTarefa): boolean {
  if (typeof c !== "object" || c === null || !(TIPOS_CHECAGEM as readonly string[]).includes(c.tipo) || typeof c.alvo !== "string" || typeof c.critica !== "boolean") return false;
  if (c.tipo === "command_exit_zero") return comandoPermitido(c.alvo) !== null;
  if (!CAMINHO_RELATIVO.test(c.alvo)) return false;
  if (c.tipo === "contains_text") return typeof c.texto === "string" && c.texto.length > 0 && c.texto.length <= 500;
  return true;
}

export function validarTarefa(t: TarefaEditavel): ErroTarefa | null {
  if (typeof t.slug !== "string" || !SLUG_VALIDO.test(t.slug)) return "slug_invalido";
  if (typeof t.titulo !== "string" || t.titulo.trim() === "" || t.titulo.length > 120 || typeof t.atividade !== "string" || !SLUG_VALIDO.test(t.atividade)) return "campo_invalido";
  if (!(TIPOS_TAREFA as readonly string[]).includes(t.tipo) || !(ESTADOS_TAREFA as readonly string[]).includes(t.estado)) return "campo_invalido";
  if (typeof t.prompt !== "string" || t.prompt.trim() === "") return "prompt_vazio";
  if (t.prompt.length > 20_000 || typeof t.escopo !== "string" || t.escopo.length > 2000) return "campo_invalido";
  if (indicaEsforco(t.prompt)) return "esforco_no_prompt";
  if (!Array.isArray(t.checagens) || t.checagens.length > 20 || !t.checagens.every(validarChecagem)) return "checagem_invalida";
  return null;
}

export const RUBRICA_PADRAO = [...CRITERIOS_RUBRICA];
