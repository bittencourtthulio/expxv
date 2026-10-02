// Canais `captura:*` (Fase 11): validadores estritos e manipuladores. O renderer NUNCA envia caminho: captura é id (`<data>` ou `q_<data>`), o destino de anexar é o Pane (sessão) e o main
// resolve tudo. O serviço só nasce no primeiro uso (nada no boot). Erro de regra chega como `Error` com `[codigo] texto`; qualquer outro vira texto genérico (nunca stack, SQL nem caminho).
import { LIMITES_CAPTURA } from "../../compartilhado/captura";
import type { NomeInvoke } from "../../compartilhado/ipc";
import { vIdSessao } from "../../nucleo/terminais/ipc-validadores";
import type { ServicoCaptura } from "../captura";
import { vIdWorkspace, vOuNulo } from "./comum-dominio";
import type { RegistroIpc } from "./registro";
import { vBooleano, vEnum, vObjeto, vTexto, vVazio, type Resultado, type Validador } from "./validar";
import { vNumero, type ValidadoresDaFamilia } from "./validar-harness";

const falha = (erro: string): Resultado<never> => ({ ok: false, erro });

export const vIdCaptura = vTexto({ min: 1, max: 40, padrao: /^(?:q_)?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d{1,3})?$/ });
const vWorkspaceOuNulo = vOuNulo(vIdWorkspace);
const vToken = vTexto({ min: 32, max: 32, padrao: /^[0-9a-f]{32}$/ });
const vFonte = vEnum(["tela", "janela_app"] as const);
const vFps: Validador<1 | 2> = (v) => (v === 1 || v === 2 ? { ok: true, valor: v } : falha("fps deve ser 1 ou 2"));
const vCoord = vNumero({ min: -100_000, max: 100_000 });
const vSelecao = vObjeto({ x: vCoord, y: vCoord, largura: vNumero({ min: 0, max: 100_000 }), altura: vNumero({ min: 0, max: 100_000 }) });

/** bytes de imagem: `Uint8Array` real (o validador copia a vista; nunca repassa o objeto recebido). */
export function vBytes(max: number): Validador<Uint8Array> {
  return (v) => {
    if (!(v instanceof Uint8Array)) return falha("esperado bytes");
    if (v.byteLength === 0) return falha("bytes vazios");
    if (v.byteLength > max) return falha("bytes grandes demais");
    return { ok: true, valor: new Uint8Array(v.buffer, v.byteOffset, v.byteLength) };
  };
}

const CHAVES_CONFIG = ["fps_padrao", "atalhos_globais", "aviso_visto"];
const vConfigCaptura: Validador<{ fps_padrao?: 1 | 2; atalhos_globais?: boolean; aviso_visto?: boolean }> = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return falha("esperado objeto");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!CHAVES_CONFIG.includes(k)) return falha(`campo desconhecido: ${k}`);
  const out: { fps_padrao?: 1 | 2; atalhos_globais?: boolean; aviso_visto?: boolean } = {};
  if ("fps_padrao" in o) { const r = vFps(o["fps_padrao"]); if (!r.ok) return falha("fps_padrao inválido"); out.fps_padrao = r.valor; }
  if ("atalhos_globais" in o) { const r = vBooleano(o["atalhos_globais"]); if (!r.ok) return falha("atalhos_globais: booleano"); out.atalhos_globais = r.valor; }
  if ("aviso_visto" in o) { const r = vBooleano(o["aviso_visto"]); if (!r.ok) return falha("aviso_visto: booleano"); out.aviso_visto = r.valor; }
  return { ok: true, valor: out };
};

export const VALIDADORES_CAPTURA = {
  "captura:estado": vVazio,
  "captura:config_gravar": vObjeto({ patch: vConfigCaptura }),
  "captura:pedir_tela": vVazio,
  "captura:regiao_iniciar": vObjeto({ fonte: vFonte }),
  "captura:regiao_confirmar": vObjeto({ token: vToken, selecao: vSelecao, workspace_id: vWorkspaceOuNulo }),
  "captura:regiao_cancelar": vObjeto({ token: vToken }),
  "captura:janela_inteira": vObjeto({ workspace_id: vWorkspaceOuNulo }),
  "captura:quadros_iniciar": vObjeto({ fonte: vFonte, fps: vFps, workspace_id: vWorkspaceOuNulo }),
  "captura:quadros_parar": vVazio,
  "captura:listar": vObjeto({ workspace_id: vWorkspaceOuNulo, depois: vOuNulo(vIdCaptura) }),
  "captura:ler": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo }),
  "captura:salvar_edicao": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo, png: vBytes(LIMITES_CAPTURA.edicao_max_bytes) }),
  "captura:anexar_ao_pane": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo, sessao_id: vIdSessao }),
  "captura:anexar_quadros": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo, sessao_id: vIdSessao }),
  "captura:copiar_caminho": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo }),
  "captura:remover": vObjeto({ captura_id: vIdCaptura, workspace_id: vWorkspaceOuNulo }),
} satisfies ValidadoresDaFamilia<"captura:">;

export type CanalCaptura = keyof typeof VALIDADORES_CAPTURA;

export interface DependenciasIpcCaptura {
  registro: RegistroIpc;
  /** leitura preguiçosa: o serviço só nasce na primeira chamada (nada no boot). */
  servico: () => ServicoCaptura | Promise<ServicoCaptura>;
  aviso?: (mensagem: string) => void;
}

export function registrarIpcCaptura(d: DependenciasIpcCaptura): void {
  const { registro } = d;
  const V = VALIDADORES_CAPTURA;
  type P = Record<string, unknown>;
  const R = (canal: CanalCaptura, fn: (p: P, s: ServicoCaptura) => unknown): void => {
    registro.invoke(canal as NomeInvoke, V[canal] as never, (async (p: never) => {
      try {
        return await fn((p ?? {}) as P, await d.servico());
      } catch (e) {
        // erro de regra: `[codigo] texto` (feito pelo serviço); qualquer outro: texto genérico
        if (e instanceof Error && /^\[[a-z_]+\] /.test(e.message)) throw e;
        d.aviso?.(`captura: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}`);
        throw new Error("[indisponivel] Falha interna na captura.");
      }
    }) as never);
  };
  R("captura:estado", (_p, s) => s.estado());
  R("captura:config_gravar", (p, s) => s.configGravar(p["patch"] as never));
  R("captura:pedir_tela", (_p, s) => s.pedirTela());
  R("captura:regiao_iniciar", (p, s) => s.regiaoIniciar(p["fonte"] as never));
  R("captura:regiao_confirmar", (p, s) => s.regiaoConfirmar(p["token"] as string, p["selecao"] as never, p["workspace_id"] as string | null));
  R("captura:regiao_cancelar", (p, s) => s.regiaoCancelar(p["token"] as string));
  R("captura:janela_inteira", (p, s) => s.janelaInteira(p["workspace_id"] as string | null));
  R("captura:quadros_iniciar", (p, s) => s.quadrosIniciar(p["fonte"] as never, p["fps"] as 1 | 2, p["workspace_id"] as string | null));
  R("captura:quadros_parar", (_p, s) => s.quadrosParar());
  R("captura:listar", (p, s) => s.listar(p["workspace_id"] as string | null, p["depois"] as string | null));
  R("captura:ler", (p, s) => s.ler(p["captura_id"] as string, p["workspace_id"] as string | null));
  R("captura:salvar_edicao", (p, s) => s.salvarEdicao(p["captura_id"] as string, p["workspace_id"] as string | null, p["png"] as Uint8Array));
  R("captura:anexar_ao_pane", (p, s) => s.anexarAoPane(p["captura_id"] as string, p["workspace_id"] as string | null, p["sessao_id"] as string));
  R("captura:anexar_quadros", (p, s) => s.anexarQuadrosAoPane(p["captura_id"] as string, p["workspace_id"] as string | null, p["sessao_id"] as string));
  R("captura:copiar_caminho", (p, s) => s.copiarCaminho(p["captura_id"] as string, p["workspace_id"] as string | null));
  R("captura:remover", (p, s) => s.remover(p["captura_id"] as string, p["workspace_id"] as string | null));
}
