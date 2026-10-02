// Validadores puros de payload dos canais `terminais:*` (05-CONTRATOS.md §2). O main nunca confia
// no renderer: cada validador reconstrói o objeto campo a campo e recusa o que não cabe.
// Ids opacos: `sessao_<id>` e `exe_<id>`; o renderer nunca envia `cwd`.

import {
  LIMITES_TERMINAIS,
  type FerramentaId,
  type LayoutTerminais,
  type ItemAnexo,
  type NoLayout,
  type PedidoAbrirSessao,
} from "../../compartilhado/terminais";
import type { CanaisEnvio, CanaisInvoke } from "../../compartilhado/ipc";
import {
  vBooleano, vInteiro, vLista, vObjeto, vTexto, vVazio,
  type Resultado, type Validador,
} from "../../main/ipc/validar";

export const FERRAMENTAS_IDS: readonly FerramentaId[] = [
  "terminal", "claude", "codex", "gemini", "opencode", "aider", "qwen", "kilo", "grok", "personalizado",
];

export const LIMITES_ANEXO_IPC = {
  itens: 10,
  bytes_por_item: 25 * 1_024 * 1_024,
  nome: 255,
  caminho: 4_096,
} as const;

export const LIMITES_LAYOUT = {
  profundidade: 16,
  nos: 64,
  bytes: 64 * 1_024,
  abas: 64,
  fixadas: 64,
} as const;

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

const ID_SESSAO = /^sessao_[A-Za-z0-9-]{1,64}$/;
const ID_EXECUTAVEL = /^exe_[A-Za-z0-9-]{1,64}$/;
const ID_WORKSPACE = /^[A-Za-z0-9_.-]{1,80}$/;
const ID_LAYOUT = /^[\w.-]{1,80}$/;
const ID_CONVERSA = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/; // sem `-` inicial (AUD-24)

export const vIdSessao = vTexto({ min: 8, max: 71, padrao: ID_SESSAO });
export const vIdExecutavel = vTexto({ min: 5, max: 68, padrao: ID_EXECUTAVEL });
export const vFerramentaId: Validador<FerramentaId> = (v) =>
  typeof v === "string" && (FERRAMENTAS_IDS as readonly string[]).includes(v) ? ok(v as FerramentaId) : falha("ferramenta desconhecida");
const vIdWorkspace = vTexto({ min: 1, max: 80, padrao: ID_WORKSPACE });

const vWorkspaceOuNulo: Validador<string | null> = (v) => (v === null ? ok(null) : vIdWorkspace(v));

const temNulo = (s: string): boolean => s.includes("\0");

function objetoSimples(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Recusa chave desconhecida (ex.: `cwd`, `papel`): o que o renderer não pode mandar não passa. */
function soChaves(v: Record<string, unknown>, permitidas: readonly string[]): string | null {
  for (const chave of Object.keys(v)) if (!permitidas.includes(chave)) return chave;
  return null;
}

// ---------------------------------------------------------------- abrir

const CHAVES_PEDIDO = ["versao", "ferramenta_id", "executavel_id", "argumentos", "colunas", "linhas", "workspace_id", "retomar", "prompt_inicial"] as const;

export const validarPedidoAbrirSessao: Validador<PedidoAbrirSessao> = (valor) => {
  const v = objetoSimples(valor);
  if (v === null) return falha("esperado objeto");
  const extra = soChaves(v, CHAVES_PEDIDO);
  if (extra !== null) return falha(`campo desconhecido: ${extra}`);
  if (v["versao"] !== 1) return falha("versão do contrato de terminais desconhecida");
  const ferramenta = vFerramentaId(v["ferramenta_id"]);
  if (!ferramenta.ok) return falha(`ferramenta_id: ${ferramenta.erro}`);
  const exe = vIdExecutavel(v["executavel_id"]);
  if (!exe.ok) return falha("executavel_id: identificador inválido");
  const args = v["argumentos"];
  if (!Array.isArray(args) || args.length > LIMITES_TERMINAIS.argumentos) return falha("argumentos inválidos");
  const argumentos: string[] = [];
  for (const a of args) {
    if (typeof a !== "string" || Buffer.byteLength(a) > LIMITES_TERMINAIS.argumento_bytes || temNulo(a)) return falha("argumentos inválidos");
    argumentos.push(a);
  }
  const colunas = vInteiro({ min: LIMITES_TERMINAIS.colunas_min, max: LIMITES_TERMINAIS.colunas_max })(v["colunas"]);
  const linhas = vInteiro({ min: LIMITES_TERMINAIS.linhas_min, max: LIMITES_TERMINAIS.linhas_max })(v["linhas"]);
  if (!colunas.ok || !linhas.ok) return falha("dimensões de terminal inválidas");
  const workspace = v["workspace_id"] === undefined ? ok(null) : vWorkspaceOuNulo(v["workspace_id"]);
  if (!workspace.ok) return falha("workspace_id: identificador inválido");
  const pedido: PedidoAbrirSessao = {
    versao: 1,
    ferramenta_id: ferramenta.valor,
    executavel_id: exe.valor,
    argumentos,
    colunas: colunas.valor,
    linhas: linhas.valor,
    workspace_id: workspace.valor,
  };
  if (v["retomar"] !== undefined) {
    if (typeof v["retomar"] !== "string" || !ID_CONVERSA.test(v["retomar"])) return falha("conversa a retomar inválida");
    pedido.retomar = v["retomar"];
  }
  if (v["prompt_inicial"] !== undefined) {
    const p = v["prompt_inicial"];
    if (typeof p !== "string" || p === "" || Buffer.byteLength(p) > LIMITES_TERMINAIS.argumento_bytes || temNulo(p)) return falha("prompt inicial inválido");
    pedido.prompt_inicial = p;
  }
  return ok(pedido);
};

// ---------------------------------------------------------------- layout

function validarNo(v: unknown, profundidade: number, contador: { n: number }): Resultado<NoLayout> {
  if (profundidade > LIMITES_LAYOUT.profundidade) return falha("layout profundo demais");
  if (++contador.n > LIMITES_LAYOUT.nos) return falha("layout com nós demais");
  const o = objetoSimples(v);
  if (o === null) return falha("nó de layout inválido");
  if (o["tipo"] === "terminal") {
    const extra = soChaves(o, ["tipo", "sessao_id"]);
    if (extra !== null) return falha(`campo desconhecido: ${extra}`);
    const id = vTexto({ min: 1, max: 80, padrao: ID_LAYOUT })(o["sessao_id"]);
    return id.ok ? ok({ tipo: "terminal", sessao_id: id.valor }) : falha("sessao_id do layout inválido");
  }
  if (o["tipo"] === "divisao") {
    const extra = soChaves(o, ["tipo", "orientacao", "proporcao", "primeiro", "segundo"]);
    if (extra !== null) return falha(`campo desconhecido: ${extra}`);
    if (o["orientacao"] !== "horizontal" && o["orientacao"] !== "vertical") return falha("orientação inválida");
    const proporcao = o["proporcao"];
    if (proporcao !== undefined && (typeof proporcao !== "number" || !Number.isFinite(proporcao) || proporcao < 0.05 || proporcao > 0.95)) return falha("proporção inválida");
    const primeiro = validarNo(o["primeiro"], profundidade + 1, contador);
    if (!primeiro.ok) return primeiro;
    const segundo = validarNo(o["segundo"], profundidade + 1, contador);
    if (!segundo.ok) return segundo;
    return ok({ tipo: "divisao", orientacao: o["orientacao"], ...(proporcao === undefined ? {} : { proporcao }), primeiro: primeiro.valor, segundo: segundo.valor });
  }
  return falha("tipo de nó inválido");
}

export const validarLayoutTerminais: Validador<LayoutTerminais> = (valor) => {
  const v = objetoSimples(valor);
  if (v === null) return falha("esperado objeto");
  const extra = soChaves(v, ["versao", "ativa", "abas", "fixadas", "expandido", "foco_unico"]);
  if (extra !== null) return falha(`campo desconhecido: ${extra}`);
  if (v["versao"] !== 2) return falha("versão de layout desconhecida");
  const vId = vTexto({ min: 1, max: 80, padrao: ID_LAYOUT });
  let ativa: string | null = null;
  if (v["ativa"] !== null) {
    const r = vId(v["ativa"]);
    if (!r.ok) return falha("ativa: identificador inválido");
    ativa = r.valor;
  }
  if (!Array.isArray(v["abas"]) || v["abas"].length > LIMITES_LAYOUT.abas) return falha("abas inválidas");
  const contador = { n: 0 };
  const abas: LayoutTerminais["abas"] = [];
  for (const aba of v["abas"]) {
    const o = objetoSimples(aba);
    if (o === null || soChaves(o, ["arvore"]) !== null) return falha("aba inválida");
    const arvore = validarNo(o["arvore"], 1, contador);
    if (!arvore.ok) return falha(arvore.erro);
    abas.push({ arvore: arvore.valor });
  }
  const fixadas = vLista(vId, LIMITES_LAYOUT.fixadas)(v["fixadas"]);
  if (!fixadas.ok) return falha(`fixadas: ${fixadas.erro}`);
  const layout: LayoutTerminais = { versao: 2, ativa, abas, fixadas: fixadas.valor };
  if (v["expandido"] !== undefined && v["expandido"] !== null) {
    const r = vId(v["expandido"]);
    if (!r.ok) return falha("expandido: identificador inválido");
    layout.expandido = r.valor;
  }
  if (v["foco_unico"] !== undefined) {
    if (typeof v["foco_unico"] !== "boolean") return falha("foco_unico: esperado booleano");
    if (v["foco_unico"]) layout.foco_unico = true;
  }
  if (Buffer.byteLength(JSON.stringify(layout)) > LIMITES_LAYOUT.bytes) return falha("layout grande demais");
  return ok(layout);
};

// ---------------------------------------------------------------- anexos

export const validarItemAnexo: Validador<ItemAnexo> = (valor) => {
  const v = objetoSimples(valor);
  if (v === null) return falha("item de anexo inválido");
  if ("caminho" in v) {
    if (soChaves(v, ["caminho"]) !== null) return falha("item de anexo inválido");
    const c = v["caminho"];
    if (typeof c !== "string" || c === "" || c.length > LIMITES_ANEXO_IPC.caminho || temNulo(c)) return falha("caminho de anexo inválido");
    return ok({ caminho: c });
  }
  if (soChaves(v, ["nome", "bytes"]) !== null) return falha("item de anexo inválido");
  const nome = v["nome"];
  // eslint-disable-next-line no-control-regex
  if (typeof nome !== "string" || nome === "" || nome.length > LIMITES_ANEXO_IPC.nome || /[\\/\u0000-\u001f]/.test(nome)) return falha("nome de anexo inválido");
  const bytes = v["bytes"];
  if (!(bytes instanceof Uint8Array)) return falha("bytes de anexo inválidos");
  if (bytes.byteLength > LIMITES_ANEXO_IPC.bytes_por_item) return falha("anexo grande demais");
  return ok({ nome, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
};

// ---------------------------------------------------------------- entrada de teclado

export const vDadosDeEntrada: Validador<string> = (v) => {
  if (typeof v !== "string") return falha("esperado texto");
  if (v.length > LIMITES_TERMINAIS.entrada_bytes || Buffer.byteLength(v) > LIMITES_TERMINAIS.entrada_bytes) return falha("entrada de terminal grande demais");
  if (temNulo(v)) return falha("entrada de terminal inválida");
  return ok(v);
};

// ---------------------------------------------------------------- tabela

export type CanalTerminais = Extract<keyof CanaisInvoke | keyof CanaisEnvio, `terminais:${string}`>;
type EntradaDe<K extends CanalTerminais> =
  K extends keyof CanaisInvoke ? CanaisInvoke[K]["entrada"]
    : K extends keyof CanaisEnvio ? CanaisEnvio[K]["entrada"] : never;

export type ValidadoresTerminais = { [K in CanalTerminais]: Validador<EntradaDe<K>> };

const vSessao = vObjeto({ sessao_id: vIdSessao });

export const VALIDADORES_TERMINAIS: ValidadoresTerminais = {
  "terminais:listar_ferramentas": vObjeto({ forcar: vBooleano }),
  "terminais:selecionar_executavel": vObjeto({ ferramenta_id: vFerramentaId }),
  "terminais:abrir": validarPedidoAbrirSessao,
  "terminais:listar_sessoes": vVazio,
  "terminais:recuperar": vVazio,
  "terminais:encerrar": vSessao,
  "terminais:descartar": vSessao,
  "terminais:confirmar_consumo": vObjeto({ sessao_id: vIdSessao, bytes: vInteiro({ min: 0, max: LIMITES_TERMINAIS.buffer_saida_bytes * 8 }) }),
  "terminais:anexar": vObjeto({ sessao_id: vIdSessao, itens: vLista(validarItemAnexo, LIMITES_ANEXO_IPC.itens) }),
  "terminais:abrir_link": vObjeto({ url: vTexto({ min: 1, max: 2_048 }) }),
  "terminais:layout_ler": vObjeto({ workspace_id: vWorkspaceOuNulo }),
  "terminais:layout_gravar": vObjeto({ workspace_id: vWorkspaceOuNulo, layout: validarLayoutTerminais }),
  "terminais:diagnostico": vVazio,
  "terminais:conversas": vVazio,
  "terminais:escrever": vObjeto({ sessao_id: vIdSessao, dados: vDadosDeEntrada }),
  "terminais:redimensionar": vObjeto({
    sessao_id: vIdSessao,
    colunas: vInteiro({ min: LIMITES_TERMINAIS.colunas_min, max: LIMITES_TERMINAIS.colunas_max }),
    linhas: vInteiro({ min: LIMITES_TERMINAIS.linhas_min, max: LIMITES_TERMINAIS.linhas_max }),
  }),
  "terminais:interromper": vSessao,
};
