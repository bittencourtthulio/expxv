// Canais `loja_mcp:*` (Fase 7B, T-07B.01/.26): validadores estritos + registro. O renderer nunca envia caminho, comando, URL nem
// userData: só ids do catálogo, ids de workspace e os hashes que a pessoa consentiu. O valor de variável secreta entra em
// `loja_mcp:variavel_gravar` (canal SENSÍVEL: o log do registro nunca o imprime) e nunca volta. Erros nominais passam; o resto
// vira texto genérico (nunca caminho de máquina nem trecho de saída de instalador).
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { ServicoLojaMcp } from "../loja-mcp";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vLista, vObjeto, vTexto, type Resultado, type Validador } from "./validar";
import { vNulavel, type ValidadoresDaFamilia } from "./validar-harness";

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

export const vIdServidor = vTexto({ min: 1, max: 48, padrao: /^[a-z0-9][a-z0-9-]{0,47}$/ });
const vNomeVariavel = vTexto({ min: 2, max: 64, padrao: /^[A-Z][A-Z0-9_]{1,63}$/ });
const vHash = vTexto({ min: 64, max: 64, padrao: /^[0-9a-f]{64}$/ });
const vWorkspaceOuNulo = vNulavel(vIdWorkspace);
const vCliLoja = vEnum(["claude", "codex", "opencode", "gemini"] as const);
const vAlvoTipo = vEnum(["workspace", "missao", "agente"] as const);
/** O valor da variável: texto sem NUL; o serviço aplica as regras finas (vazio, 4 KB, quebra de linha). */
const vValor = vTexto({ min: 1, max: 8192 });
export const vIdInstalacao = vTexto({ min: 6, max: 64, padrao: /^inst_[0-9A-Za-z]{6,40}$/ });
/** `aceito` precisa ser literalmente `true`. */
const vAceito: Validador<true> = (v) => (v === true ? ok(true) : falha("consentimento exige aceito: true"));
const vConsentimento = vObjeto({ aceito: vAceito, comando_hash: vHash });

/** `{ <id>: <sha256> }` com até 20 ids. */
const vHashesPorId: Validador<Record<string, string>> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const entradas = Object.entries(v as Record<string, unknown>);
  if (entradas.length > 20) return falha("hashes demais");
  const saida: Record<string, string> = {};
  for (const [id, h] of entradas) {
    const a = vIdServidor(id);
    if (!a.ok) return falha("id inválido");
    const b = vHash(h);
    if (!b.ok) return falha("hash inválido");
    saida[id] = b.valor;
  }
  return ok(saida);
};

export const VALIDADORES_LOJA_MCP = {
  "loja_mcp:listar": vObjeto({}),
  "loja_mcp:detalhe": vObjeto({ id: vIdServidor, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:plano_instalacao": vObjeto({ ids: vLista(vIdServidor, 20), workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:instalar": vObjeto({
    ids: vLista(vIdServidor, 20),
    consentimento: vObjeto({ aceito: vAceito, comando_hashes: vHashesPorId }),
    workspace_id: vWorkspaceOuNulo,
  }),
  "loja_mcp:cancelar": vObjeto({ instalacao_id: vIdInstalacao }),
  "loja_mcp:desinstalar": vObjeto({ id: vIdServidor, apagar_segredos: vBooleano }),
  "loja_mcp:plano_atualizacao": vObjeto({ id: vIdServidor, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:atualizar": vObjeto({ id: vIdServidor, consentimento: vConsentimento, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:variaveis_estado": vObjeto({ id: vIdServidor }),
  "loja_mcp:variavel_gravar": vObjeto({ id: vIdServidor, nome: vNomeVariavel, valor: vValor }),
  "loja_mcp:variavel_apagar": vObjeto({ id: vIdServidor, nome: vNomeVariavel }),
  "loja_mcp:testar": vObjeto({ id: vIdServidor, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:habilitar": vObjeto({
    id: vIdServidor,
    alvo_tipo: vAlvoTipo,
    // workspace_id (`ws_…`), id de Missão (`mis_…`) ou id de agente (`<squad>.<membro>`): nunca caminho
    alvo_valor: vTexto({ min: 1, max: 100, padrao: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/ }),
    habilitado: vBooleano,
  }),
  "loja_mcp:habilitacoes": vObjeto({ workspace_id: vIdWorkspace }),
  "loja_mcp:previa_cli_usuario": vObjeto({ id: vIdServidor, cli: vCliLoja, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:instalar_na_cli": vObjeto({ id: vIdServidor, cli: vCliLoja, confirmacao: vTexto({ min: 1, max: 64 }), workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:remover_da_cli": vObjeto({ id: vIdServidor, cli: vCliLoja }),
  "loja_mcp:logs": vObjeto({ id: vIdServidor, limite: vInteiro({ min: 1, max: 200 }) }),
  "loja_mcp:kit_estado": vObjeto({}),
  "loja_mcp:kit_plano": vObjeto({ workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:kit_instalar": vObjeto({ consentimento: vConsentimento, workspace_id: vWorkspaceOuNulo }),
  "loja_mcp:kit_opt_out": vObjeto({ valor: vBooleano }),
  "loja_mcp:diagnostico": vObjeto({}),
  "loja_mcp:descobrir": vObjeto({ consulta: vTexto({ min: 2, max: 100 }) }),
} satisfies ValidadoresDaFamilia<"loja_mcp:">;

export type CanalLojaMcp = keyof typeof VALIDADORES_LOJA_MCP;

/** Erros que o renderer pode ver: os nominais (`ErroLoja`, códigos de ciclo); o resto vira texto genérico. */
export class ErroLoja extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroLoja";
  }
}
export function sanearErroDaLoja(e: unknown): Error {
  // erros da descoberta têm texto próprio, curto e em português (nunca caminho nem trecho de resposta de terceiro)
  if (e instanceof Error && e.name === "ErroDescoberta") return new ErroLoja((e as Error & { codigo?: string }).codigo ?? "descoberta", e.message);
  return e instanceof ErroLoja ? e : new Error("falha ao executar a operação da Loja de MCPs");
}

export type ProvedorServicoLoja = () => ServicoLojaMcp | Promise<ServicoLojaMcp>;

export interface DependenciasIpcLojaMcp {
  registro: RegistroIpc;
  /** o serviço nasce sob demanda (catálogo, cofre e bloqueio só são lidos no primeiro uso). */
  servico: ProvedorServicoLoja;
}

/** Manipuladores puros (testáveis sem IPC). */
export function criarManipuladoresLojaMcp(provedor: ProvedorServicoLoja) {
  const com = async <T>(f: (s: ServicoLojaMcp) => T | Promise<T>): Promise<T> => {
    try {
      return await f(await provedor());
    } catch (e) {
      throw sanearErroDaLoja(e);
    }
  };
  type E<C extends CanalLojaMcp> = CanaisInvoke[C]["entrada"];
  return {
    "loja_mcp:listar": () => com((s) => s.listar()),
    "loja_mcp:detalhe": (p: E<"loja_mcp:detalhe">) => com((s) => s.detalhe(p.id, p.workspace_id)),
    "loja_mcp:plano_instalacao": (p: E<"loja_mcp:plano_instalacao">) => com((s) => s.planoInstalacao(p.ids, p.workspace_id)),
    "loja_mcp:instalar": (p: E<"loja_mcp:instalar">) => com((s) => s.instalar(p)),
    "loja_mcp:cancelar": (p: E<"loja_mcp:cancelar">) => com((s) => s.cancelar(p.instalacao_id)),
    "loja_mcp:desinstalar": (p: E<"loja_mcp:desinstalar">) => com((s) => s.desinstalar(p.id, p.apagar_segredos)),
    "loja_mcp:plano_atualizacao": (p: E<"loja_mcp:plano_atualizacao">) => com((s) => s.planoAtualizacao(p.id, p.workspace_id)),
    "loja_mcp:atualizar": (p: E<"loja_mcp:atualizar">) => com((s) => s.atualizar(p.id, p.consentimento, p.workspace_id)),
    "loja_mcp:variaveis_estado": (p: E<"loja_mcp:variaveis_estado">) => com((s) => s.variaveisEstado(p.id)),
    "loja_mcp:variavel_gravar": (p: E<"loja_mcp:variavel_gravar">) => com((s) => s.gravarVariavel(p.id, p.nome, p.valor)),
    "loja_mcp:variavel_apagar": (p: E<"loja_mcp:variavel_apagar">) => com((s) => s.apagarVariavel(p.id, p.nome)),
    "loja_mcp:testar": (p: E<"loja_mcp:testar">) => com((s) => s.testar(p.id, p.workspace_id)),
    "loja_mcp:habilitar": (p: E<"loja_mcp:habilitar">) => com((s) => s.habilitar(p.id, p.alvo_tipo, p.alvo_valor, p.habilitado)),
    "loja_mcp:habilitacoes": (p: E<"loja_mcp:habilitacoes">) => com((s) => s.habilitacoes(p.workspace_id)),
    "loja_mcp:previa_cli_usuario": (p: E<"loja_mcp:previa_cli_usuario">) => com((s) => s.previaCliUsuario(p.id, p.cli, p.workspace_id)),
    "loja_mcp:instalar_na_cli": (p: E<"loja_mcp:instalar_na_cli">) => com((s) => s.instalarNaCli(p.id, p.cli, p.confirmacao, p.workspace_id)),
    "loja_mcp:remover_da_cli": (p: E<"loja_mcp:remover_da_cli">) => com((s) => s.removerDaCli(p.id, p.cli)),
    "loja_mcp:logs": (p: E<"loja_mcp:logs">) => com((s) => s.logs(p.id, p.limite)),
    "loja_mcp:kit_estado": () => com((s) => s.kitEstado()),
    "loja_mcp:kit_plano": (p: E<"loja_mcp:kit_plano">) => com((s) => s.kitPlano(p.workspace_id)),
    "loja_mcp:kit_instalar": (p: E<"loja_mcp:kit_instalar">) => com((s) => s.kitInstalar(p.consentimento, p.workspace_id)),
    "loja_mcp:kit_opt_out": (p: E<"loja_mcp:kit_opt_out">) => com((s) => s.kitOptOut(p.valor)),
    "loja_mcp:diagnostico": () => com((s) => s.diagnostico()),
    "loja_mcp:descobrir": (p: E<"loja_mcp:descobrir">) => com((s) => s.descobrir(p.consulta)),
  };
}

/** Registra os 24 canais (um manipulador por canal). Não carrega catálogo, cofre nem bloqueio: isso é do primeiro uso. */
export function registrarIpcLojaMcp(d: DependenciasIpcLojaMcp): void {
  const m = criarManipuladoresLojaMcp(d.servico);
  const V = VALIDADORES_LOJA_MCP;
  const r = d.registro;
  r.invoke("loja_mcp:listar", V["loja_mcp:listar"], () => m["loja_mcp:listar"]());
  r.invoke("loja_mcp:detalhe", V["loja_mcp:detalhe"], (e) => m["loja_mcp:detalhe"](e));
  r.invoke("loja_mcp:plano_instalacao", V["loja_mcp:plano_instalacao"], (e) => m["loja_mcp:plano_instalacao"](e));
  r.invoke("loja_mcp:instalar", V["loja_mcp:instalar"], (e) => m["loja_mcp:instalar"](e));
  r.invoke("loja_mcp:cancelar", V["loja_mcp:cancelar"], (e) => m["loja_mcp:cancelar"](e));
  r.invoke("loja_mcp:desinstalar", V["loja_mcp:desinstalar"], (e) => m["loja_mcp:desinstalar"](e));
  r.invoke("loja_mcp:plano_atualizacao", V["loja_mcp:plano_atualizacao"], (e) => m["loja_mcp:plano_atualizacao"](e));
  r.invoke("loja_mcp:atualizar", V["loja_mcp:atualizar"], (e) => m["loja_mcp:atualizar"](e));
  r.invoke("loja_mcp:variaveis_estado", V["loja_mcp:variaveis_estado"], (e) => m["loja_mcp:variaveis_estado"](e));
  r.invoke("loja_mcp:variavel_gravar", V["loja_mcp:variavel_gravar"], (e) => m["loja_mcp:variavel_gravar"](e));
  r.invoke("loja_mcp:variavel_apagar", V["loja_mcp:variavel_apagar"], (e) => m["loja_mcp:variavel_apagar"](e));
  r.invoke("loja_mcp:testar", V["loja_mcp:testar"], (e) => m["loja_mcp:testar"](e));
  r.invoke("loja_mcp:habilitar", V["loja_mcp:habilitar"], (e) => m["loja_mcp:habilitar"](e));
  r.invoke("loja_mcp:habilitacoes", V["loja_mcp:habilitacoes"], (e) => m["loja_mcp:habilitacoes"](e));
  r.invoke("loja_mcp:previa_cli_usuario", V["loja_mcp:previa_cli_usuario"], (e) => m["loja_mcp:previa_cli_usuario"](e));
  r.invoke("loja_mcp:instalar_na_cli", V["loja_mcp:instalar_na_cli"], (e) => m["loja_mcp:instalar_na_cli"](e));
  r.invoke("loja_mcp:remover_da_cli", V["loja_mcp:remover_da_cli"], (e) => m["loja_mcp:remover_da_cli"](e));
  r.invoke("loja_mcp:logs", V["loja_mcp:logs"], (e) => m["loja_mcp:logs"](e));
  r.invoke("loja_mcp:kit_estado", V["loja_mcp:kit_estado"], () => m["loja_mcp:kit_estado"]());
  r.invoke("loja_mcp:kit_plano", V["loja_mcp:kit_plano"], (e) => m["loja_mcp:kit_plano"](e));
  r.invoke("loja_mcp:kit_instalar", V["loja_mcp:kit_instalar"], (e) => m["loja_mcp:kit_instalar"](e));
  r.invoke("loja_mcp:kit_opt_out", V["loja_mcp:kit_opt_out"], (e) => m["loja_mcp:kit_opt_out"](e));
  r.invoke("loja_mcp:diagnostico", V["loja_mcp:diagnostico"], () => m["loja_mcp:diagnostico"]());
  r.invoke("loja_mcp:descobrir", V["loja_mcp:descobrir"], (e) => m["loja_mcp:descobrir"](e));
}
