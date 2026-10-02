// Extrai o objeto JSON da resposta da IA, tolerando texto em volta e blocos de código (D-584). Puro; sem `eval`.
export type Extracao = { ok: true; valor: unknown } | { ok: false; erro: string };

export const RESPOSTA_MAX_CHARS = 200_000;
const MAX_TENTATIVAS = 40;

/** Fim do objeto que começa em `inicio` (`{`), respeitando strings e escapes; `-1` se não fecha. */
function fimDoObjeto(t: string, inicio: number): number {
  let prof = 0;
  let string = false;
  let escape = false;
  for (let i = inicio; i < t.length; i += 1) {
    const c = t[i]!;
    if (string) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "\"") string = false;
      continue;
    }
    if (c === "\"") string = true;
    else if (c === "{") prof += 1;
    else if (c === "}") { prof -= 1; if (prof === 0) return i; }
  }
  return -1;
}

/** Procura, em ordem, objetos JSON na resposta; devolve o primeiro que tem `configuracoes` (lista). Texto em volta e cercas ``` são ignorados. */
export function extrairJson(resposta: string): Extracao {
  if (resposta.trim() === "") return { ok: false, erro: "resposta vazia" };
  const t = resposta.length > RESPOSTA_MAX_CHARS ? resposta.slice(0, RESPOSTA_MAX_CHARS) : resposta;
  let primeiroValido: unknown;
  let achouObjeto = false;
  // cada `{` varre até o fim: um limite de tentativas evita custo quadrático com lixo cheio de chaves
  let tentativas = 0;
  for (let i = t.indexOf("{"); i >= 0 && tentativas < MAX_TENTATIVAS; i = t.indexOf("{", i + 1)) {
    tentativas += 1;
    const fim = fimDoObjeto(t, i);
    if (fim < 0) continue;
    let v: unknown;
    try { v = JSON.parse(t.slice(i, fim + 1)); } catch { continue; }
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    achouObjeto = true;
    if (Array.isArray((v as Record<string, unknown>)["configuracoes"])) return { ok: true, valor: v };
    primeiroValido ??= v;
    i = fim; // não reentra num objeto já lido
  }
  if (!achouObjeto) return { ok: false, erro: "a resposta não contém um objeto JSON válido" };
  return { ok: true, valor: primeiroValido };
}
