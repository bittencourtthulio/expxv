import { argumentoInvalido, violacaoDeRegra } from "../erros";
import { TIPOS_CATALOG_LIST, type TipoCatalogList } from "../portas";
import { comoObjeto, identificador, inteiroOpcional, texto, textoOpcional, type ImplTool } from "./comum";

export const providerList: ImplTool = async (args, { claims, deps }) => {
  comoObjeto(args);
  const todos = await deps.provedores.listar(claims.workspace_id);
  return todos
    .filter((p) => p.habilitado)
    .map((p) => ({ provider: p.provedor, cli: p.cli, accounts: [...p.contas], enabled: true, ...(p.clis === undefined ? {} : { clis: [...p.clis] }) }));
};

export const modelList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const provedor = identificador(a, "provider");
  const todos = await deps.provedores.listar(claims.workspace_id);
  if (!todos.some((p) => p.provedor === provedor && p.habilitado)) {
    throw violacaoDeRegra("provider_disabled", `O provedor "${provedor}" não está habilitado.`);
  }
  const modelos = await deps.provedores.modelos(provedor);
  return modelos.map((m) => ({ model: m.modelo, effort_levels: [...m.niveis_esforco], ...(m.padrao === true ? { default: true } : {}), ...(m.faixa === undefined ? {} : { faixa: m.faixa }) }));
};

const LIMITE_PADRAO_CATALOGO = 25;
const ORCAMENTO_PADRAO = 4096;
const ORCAMENTO_GRANDE = 16384;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Texto de terceiro vira DADO curto: sem controle/bidi, uma linha, truncado em code points. */
function sanear(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.replace(CONTROLE, " ").replace(/\s+/g, " ").trim();
  return t === "" ? null : [...t].slice(0, max).join("");
}

/**
 * `catalog_list` (Fase 7, T-07.20): leitura paginada do catálogo. Em Missão `squad`/`agentico`, `skill` devolve SÓ o snapshot do PRÓPRIO Pane (identidade
 * do token; sem snapshot = nada, falha fechada) e `allowed` é sempre `true`. Nunca devolve caminho, `env`, URL nem argumentos: só os campos fixos abaixo.
 * A descrição é dado de terceiro, saneada (≤ 200) e cortada para o orçamento (4 KB no padrão).
 */
export const catalogList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const kind = texto(a, "kind", { max: 50 });
  if (!(TIPOS_CATALOG_LIST as readonly string[]).includes(kind)) throw argumentoInvalido(`O campo "kind" deve ser um de: ${TIPOS_CATALOG_LIST.join(", ")}.`);
  const query = textoOpcional(a, "query", 100);
  const limite = inteiroOpcional(a, "limit", 1, 100) ?? LIMITE_PADRAO_CATALOGO;
  const cursor = textoOpcional(a, "cursor", 40);
  const vazio = { items: [], next_cursor: null, truncated: false };
  const porta = deps.catalogo;
  if (porta === undefined) return vazio;
  let permitidas: string[] | null = null;
  if (kind === "skill") {
    const snap = await porta.permitidasDoPane(claims.pane_id);
    permitidas = snap ?? (claims.mode === "livre" ? null : []);
  }
  const r = await porta.listar({ workspace_id: claims.workspace_id, pane_id: claims.pane_id, kind: kind as TipoCatalogList, query, limit: limite, cursor, permitidas });
  const orcamento = limite > LIMITE_PADRAO_CATALOGO ? ORCAMENTO_GRANDE : ORCAMENTO_PADRAO;
  let itens = r.items.slice(0, limite).map((i) => ({
    name: sanear(i.name, 80) ?? "",
    kind: i.kind,
    origin: i.origin,
    description: sanear(i.description, 200),
    clis: i.clis.slice(0, 5),
    allowed: true as const,
  })).filter((i) => i.name !== "");
  let truncado = r.truncated;
  let proximo = r.next_cursor;
  const tamanho = (): number => JSON.stringify({ items: itens, next_cursor: proximo, truncated: truncado }).length;
  // 1) encurta as descrições; 2) se ainda não couber, corta itens (o cursor devolvido continua o da porta: o chamador pede a página de novo com `limit` menor)
  for (const max of [120, 60, 0]) {
    if (tamanho() <= orcamento) break;
    itens = itens.map((i) => ({ ...i, description: max === 0 ? null : i.description === null ? null : [...i.description].slice(0, max).join("") }));
  }
  while (itens.length > 1 && tamanho() > orcamento) {
    itens = itens.slice(0, -1);
    truncado = true;
    proximo = null;
  }
  return { items: itens, next_cursor: proximo, truncated: truncado };
};
