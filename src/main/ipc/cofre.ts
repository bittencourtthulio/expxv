// Canais `cofre:*` (Fase 9, T-09.01). SÓ validadores nesta onda; manipuladores na T-09.21.
// O valor de uma entrada atravessa UMA vez (`cofre:gravar`) e nunca volta; nenhum canal devolve valor.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { ESCOPOS_COFRE } from "../../compartilhado/harness";
import { vIdWorkspace } from "./comum-dominio";
import { vBooleano, vEnum, vObjeto, vTexto, type Validador } from "./validar";
import { vNulavel, type ValidadoresDaFamilia } from "./validar-harness";

/** Nome da entrada: UPPER_SNAKE (vira o nome da variável/placeholder; erro cita o NOME, nunca o valor). */
export const vNomeCofre = vTexto({ min: 1, max: 64, padrao: /^[A-Z][A-Z0-9_]{0,63}$/ });
export const vIdCofre = vTexto({ min: 5, max: 64, padrao: /^cof_[0-9A-Za-z]{10,40}$/ });
/** Valor secreto: qualquer texto sem NUL (chave de API, senha). Tamanho limitado; nunca logado. */
const vValorSecreto = vTexto({ min: 1, max: 16 * 1024 });
const vSenha = vTexto({ min: 8, max: 256 });

const vGravar: Validador<CanaisInvoke["cofre:gravar"]["entrada"]> = (v) => {
  const r = vObjeto({
    id: vNulavel(vIdCofre),
    nome: vNomeCofre,
    escopo: vEnum(ESCOPOS_COFRE),
    workspace_id: vNulavel(vIdWorkspace),
    sensivel: vBooleano,
    valor: vValorSecreto,
  })(v);
  if (!r.ok) return r;
  const { escopo, workspace_id: ws, valor } = r.valor;
  if (escopo === "workspace" && ws === null) return { ok: false, erro: "workspace_id: obrigatório no escopo workspace" };
  if (escopo === "global" && ws !== null) return { ok: false, erro: "workspace_id: deve ser null no escopo global" };
  if (valor.includes("\0")) return { ok: false, erro: "valor inválido" };
  return r;
};

export const VALIDADORES_COFRE = {
  "cofre:disponivel": vObjeto({}),
  "cofre:listar": vObjeto({}),
  "cofre:gravar": vGravar,
  "cofre:apagar": vObjeto({ id: vIdCofre }),
  "cofre:senha_mestra_definir": vObjeto({ senha: vSenha }),
  "cofre:desbloquear": vObjeto({ senha: vSenha }),
  "cofre:bloquear": vObjeto({}),
} satisfies ValidadoresDaFamilia<"cofre:">;

export type CanalCofre = keyof typeof VALIDADORES_COFRE;
