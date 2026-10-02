// Canais `gateway:*` (Fase 7C): validadores estritos + registro. O renderer nunca envia caminho, comando, URL nem token: só ids (workspace, servidor, Pane), o papel
// e os números da configuração dentro de faixas fechadas. Erros nominais passam; o resto vira texto genérico (nunca caminho nem saída de servidor de terceiro).
import { MODOS_SUPERFICIE_GATEWAY, PAPEIS_GATEWAY } from "../../compartilhado/catalogo";
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { GatewayMain } from "../gateway";
import { vIdWorkspace } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vInteiro, vObjeto, vTexto } from "./validar";
import { vNulavel, type ValidadoresDaFamilia } from "./validar-harness";

const vIdServidor = vTexto({ min: 1, max: 48, padrao: /^[a-z0-9][a-z0-9-]{0,47}$/ });
/** nome de ferramenta de terceiro: alfabeto do protocolo (o gateway descarta o resto) */
const vFerramenta = vTexto({ min: 1, max: 128, padrao: /^[A-Za-z0-9_.-]{1,128}$/ });
const vIdPane = vTexto({ min: 1, max: 128, padrao: /^[A-Za-z0-9_-]{1,128}$/ });
const vPapel = vEnum(PAPEIS_GATEWAY);

export const VALIDADORES_GATEWAY = {
  "gateway:estado": vObjeto({}),
  "gateway:config_ler": vObjeto({ workspace_id: vIdWorkspace }),
  "gateway:config_gravar": vObjeto({
    workspace_id: vIdWorkspace,
    ativo: vBooleano,
    modo_superficie: vEnum(MODOS_SUPERFICIE_GATEWAY),
    max_ferramentas: vInteiro({ min: 1, max: 200 }),
    limite_por_min: vInteiro({ min: 1, max: 600 }),
    ocioso_s: vInteiro({ min: 30, max: 3600 }),
  }),
  "gateway:ferramentas": vObjeto({ workspace_id: vIdWorkspace, servidor_id: vIdServidor, papel: vPapel }),
  "gateway:filtro_definir": vObjeto({ workspace_id: vIdWorkspace, servidor_id: vIdServidor, ferramenta: vFerramenta, papel: vPapel, habilitada: vBooleano }),
  "gateway:auditoria": vObjeto({ workspace_id: vNulavel(vIdWorkspace), limite: vInteiro({ min: 1, max: 200 }) }),
  "gateway:revogar_pane": vObjeto({ pane_id: vIdPane }),
} satisfies ValidadoresDaFamilia<"gateway:">;

export type CanalGateway = keyof typeof VALIDADORES_GATEWAY;

export type ProvedorGateway = () => GatewayMain | Promise<GatewayMain>;

export interface DependenciasIpcGateway {
  registro: RegistroIpc;
  /** nasce sob demanda (nada no boot onda 1) */
  gateway: ProvedorGateway;
}

export function criarManipuladoresGateway(provedor: ProvedorGateway) {
  const com = async <T>(f: (g: GatewayMain) => T | Promise<T>): Promise<T> => {
    try {
      return await f(await provedor());
    } catch {
      throw new Error("falha ao executar a operação do gateway de MCPs");
    }
  };
  type E<C extends CanalGateway> = CanaisInvoke[C]["entrada"];
  return {
    "gateway:estado": () => com((g) => g.estado()),
    "gateway:config_ler": (p: E<"gateway:config_ler">) => com((g) => g.configLer(p.workspace_id)),
    "gateway:config_gravar": (p: E<"gateway:config_gravar">) => com((g) => g.configGravar(p)),
    "gateway:ferramentas": (p: E<"gateway:ferramentas">) => com((g) => g.ferramentas(p)),
    "gateway:filtro_definir": (p: E<"gateway:filtro_definir">) => com((g) => g.filtroDefinir(p)),
    "gateway:auditoria": (p: E<"gateway:auditoria">) => com((g) => g.auditoria(p)),
    "gateway:revogar_pane": (p: E<"gateway:revogar_pane">) => com((g) => g.revogarPane(p.pane_id)),
  };
}

/** Registra os 7 canais. Não cria o gateway: isso é do primeiro uso (a tela Loja ou o primeiro Pane com gateway). */
export function registrarIpcGateway(d: DependenciasIpcGateway): void {
  const m = criarManipuladoresGateway(d.gateway);
  const V = VALIDADORES_GATEWAY;
  const r = d.registro;
  r.invoke("gateway:estado", V["gateway:estado"], () => m["gateway:estado"]());
  r.invoke("gateway:config_ler", V["gateway:config_ler"], (e) => m["gateway:config_ler"](e));
  r.invoke("gateway:config_gravar", V["gateway:config_gravar"], (e) => m["gateway:config_gravar"](e));
  r.invoke("gateway:ferramentas", V["gateway:ferramentas"], (e) => m["gateway:ferramentas"](e));
  r.invoke("gateway:filtro_definir", V["gateway:filtro_definir"], (e) => m["gateway:filtro_definir"](e));
  r.invoke("gateway:auditoria", V["gateway:auditoria"], (e) => m["gateway:auditoria"](e));
  r.invoke("gateway:revogar_pane", V["gateway:revogar_pane"], (e) => m["gateway:revogar_pane"](e));
}
