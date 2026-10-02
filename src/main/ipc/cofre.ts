// Canais `cofre:*` (Fase 9, T-09.01 validadores; manipuladores: T-09.21/23).
// O valor de uma entrada atravessa UMA vez (`cofre:gravar`) e nunca volta; nenhum canal devolve valor.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import { CofreErro, type Cofre } from "../../nucleo/cofre";
import type { RegistroIpc } from "./registro";
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

// ---------------------------------------------------------------- manipuladores (T-09.23)

/** Cofre sob demanda: a função só é chamada quando um canal `cofre:*` é usado (nada de cofre no boot). */
export type ProvedorCofre = () => Cofre | Promise<Cofre>;

export interface DependenciasIpcCofre {
  registro: RegistroIpc;
  cofre: ProvedorCofre;
}

/** Erro que o renderer pode ver: nominal (código + NOME da entrada); qualquer outra coisa vira mensagem genérica, já sem valores do cofre. */
function sanear(cofre: Cofre, e: unknown): Error {
  if (e instanceof CofreErro) return e;
  // a mensagem original pode citar caminhos ou valores: não é repassada (o scrubber vale como cinto e suspensório)
  return new Error(cofre.scrubSincrono("falha no cofre"));
}

/**
 * Manipuladores puros (testáveis sem IPC). O valor entra só em `gravar`/`senha`/`testarSemSalvar` e nunca volta;
 * o log do registro nunca imprime o payload destes canais (`CANAIS_SENSIVEIS`).
 */
export function criarManipuladoresCofre(provedor: ProvedorCofre) {
  const comCofre = async <T>(f: (c: Cofre) => Promise<T>): Promise<T> => {
    const c = await provedor();
    try {
      return await f(c);
    } catch (e) {
      throw sanear(c, e);
    }
  };
  return {
    disponivel: () => comCofre((c) => c.estado()),
    listar: () => comCofre((c) => c.listar()),
    gravar: (entrada: CanaisInvoke["cofre:gravar"]["entrada"]) => comCofre((c) => c.guardar(entrada)),
    apagar: (id: string) => comCofre((c) => c.apagar(id)),
    definirSenhaMestra: (senha: string) => comCofre((c) => c.definirSenhaMestra(senha)),
    /** senha errada NÃO lança: devolve o estado trancado com motivo genérico (sem pista). */
    desbloquear: (senha: string) =>
      comCofre(async (c) => {
        try {
          return await c.desbloquear(senha);
        } catch (e) {
          if (e instanceof CofreErro && e.codigo === "senha_incorreta") return { ...(await c.estado()), ok: false, bloqueado: true, motivo: "senha_incorreta" };
          throw e;
        }
      }),
    bloquear: () => comCofre((c) => c.bloquear()),
    /** "Testar sem salvar": o valor vale só durante `fn`; nada vai a disco; erros saem sem o valor. */
    testarSemSalvar: <T>(valor: string, fn: (valor: string) => Promise<T> | T) => comCofre((c) => c.usarSemSalvar(valor, fn)),
  };
}

export function registrarIpcCofre(d: DependenciasIpcCofre): void {
  const m = criarManipuladoresCofre(d.cofre);
  const V = VALIDADORES_COFRE;
  d.registro.invoke("cofre:disponivel", V["cofre:disponivel"], () => m.disponivel());
  d.registro.invoke("cofre:listar", V["cofre:listar"], () => m.listar());
  d.registro.invoke("cofre:gravar", V["cofre:gravar"], (e) => m.gravar(e));
  d.registro.invoke("cofre:apagar", V["cofre:apagar"], ({ id }) => m.apagar(id));
  d.registro.invoke("cofre:senha_mestra_definir", V["cofre:senha_mestra_definir"], ({ senha }) => m.definirSenhaMestra(senha));
  d.registro.invoke("cofre:desbloquear", V["cofre:desbloquear"], ({ senha }) => m.desbloquear(senha));
  d.registro.invoke("cofre:bloquear", V["cofre:bloquear"], () => m.bloquear());
}
