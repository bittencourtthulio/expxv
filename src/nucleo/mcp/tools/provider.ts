import { violacaoDeRegra } from "../erros";
import { comoObjeto, identificador, texto, type ImplTool } from "./comum";

export const providerList: ImplTool = async (args, { claims, deps }) => {
  comoObjeto(args);
  const todos = await deps.provedores.listar(claims.workspace_id);
  return todos.filter((p) => p.habilitado).map((p) => ({ provider: p.provedor, cli: p.cli, accounts: [...p.contas], enabled: true }));
};

export const modelList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const provedor = identificador(a, "provider");
  const todos = await deps.provedores.listar(claims.workspace_id);
  if (!todos.some((p) => p.provedor === provedor && p.habilitado)) {
    throw violacaoDeRegra("provider_disabled", `O provedor "${provedor}" não está habilitado.`);
  }
  const modelos = await deps.provedores.modelos(provedor);
  return modelos.map((m) => ({ model: m.modelo, effort_levels: [...m.niveis_esforco], ...(m.padrao === true ? { default: true } : {}) }));
};

/** Catálogo real é pós-MVP: a tool existe (agêntico) e devolve lista vazia. */
export const catalogList: ImplTool = async (args) => {
  const a = comoObjeto(args);
  texto(a, "kind", { max: 50 });
  return [];
};
