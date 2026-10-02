// Análise LOCAL (instantânea, sem IPC) do texto do prompt de um membro: o main continua sendo quem valida de verdade
// (`agentes:prompt_previa`/`prompt_gravar`); aqui só se evita mandar texto que o validador de IPC recusaria de cara.
import type { Achado } from "../../../compartilhado/squads";
import { LIMITES_SQUAD, VARIAVEIS_PROMPT } from "../../../compartilhado/squads";

export const bytesDe = (t: string): number => new TextEncoder().encode(t).length;

/** Mesmas regras de forma do IPC: vazio, > 16 KiB e variável fora do conjunto fechado impedem a pré-visualização e o salvar. */
export function analisarPromptLocal(texto: string): Achado[] {
  const achados: Achado[] = [];
  if (texto.trim() === "") achados.push({ severidade: "erro", codigo: "membro_sem_prompt", caminho: "prompt", mensagem: "O prompt está vazio." });
  const n = bytesDe(texto);
  if (n > LIMITES_SQUAD.prompt_max_bytes) achados.push({ severidade: "erro", codigo: "prompt_grande", caminho: "prompt", mensagem: `O prompt tem ${n} bytes; o máximo é ${LIMITES_SQUAD.prompt_max_bytes}.` });
  const vistas = new Set<string>();
  for (const m of texto.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const nome = (m[1] ?? "").trim();
    if (!(VARIAVEIS_PROMPT as readonly string[]).includes(nome) && !vistas.has(nome)) {
      vistas.add(nome);
      achados.push({ severidade: "erro", codigo: "variavel_desconhecida", caminho: "prompt", mensagem: `Variável desconhecida: {{${nome.slice(0, 40)}}}.` });
    }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto)) achados.push({ severidade: "erro", codigo: "membro_sem_prompt", caminho: "prompt", mensagem: "O texto tem caracteres de controle inválidos." });
  return achados;
}

export interface TrechoPrevia {
  dado: boolean;
  texto: string;
}
/** Separa o texto renderizado em trechos comuns e blocos `<dado …>…</dado>` (a UI marca os blocos de dado não confiável). */
export function trechosDaPrevia(renderizado: string): TrechoPrevia[] {
  const saida: TrechoPrevia[] = [];
  const re = /<dado\b[^>]*>[\s\S]*?<\/dado>/g;
  let fim = 0;
  for (const m of renderizado.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > fim) saida.push({ dado: false, texto: renderizado.slice(fim, i) });
    saida.push({ dado: true, texto: m[0] });
    fim = i + m[0].length;
  }
  if (fim < renderizado.length) saida.push({ texto: renderizado.slice(fim), dado: false });
  return saida;
}

/** Insere `ins` no lugar da seleção [ini, fim) e devolve o novo texto e a posição do cursor. */
export function inserirNoCursor(texto: string, ini: number, fim: number, ins: string): { texto: string; cursor: number } {
  const a = Math.max(0, Math.min(ini, texto.length));
  const b = Math.max(a, Math.min(fim, texto.length));
  return { texto: texto.slice(0, a) + ins + texto.slice(b), cursor: a + ins.length };
}
