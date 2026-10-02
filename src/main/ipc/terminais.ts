// Canais `terminais:*` (05-CONTRATOS §2) com os manipuladores reais. Tudo entra pelo registro único
// (`criarRegistroIpc`): remetente autorizado e payload validado por `VALIDADORES_TERMINAIS` ANTES de
// chegar aqui. O renderer nunca envia `cwd` nem caminho de executável: o main resolve o cwd pelo
// workspace e só aceita `executavel_id` que saiu da detecção ou da escolha manual.

import type { FalhaTerminal, FerramentaDetectada, FerramentaId, LayoutTerminais } from "../../compartilhado/terminais";
import { argumentosAutomaticos, argumentosDePromptInicial, argumentosDeRetomada, CATALOGO_TERMINAIS, recursosDaFerramenta, teclaDeInterrupcao, type PermissaoWorkspace } from "../../nucleo/terminais/catalogo";
import type { CatalogoSessoes } from "../../nucleo/terminais/sessoes";
import type { GerenciadorSessoes } from "../../nucleo/terminais/sessoes";
import type { RegistroExecutaveis } from "../../nucleo/terminais/deteccao";
import { prepararAnexos } from "../../nucleo/terminais/anexos";
import type { ArmazemConversas } from "../../nucleo/terminais/conversas";
import { diagnosticoEmTexto } from "../../nucleo/terminais/diagnostico";
import { GuardiaoTransicoes, type SessoesGuardadas } from "../../nucleo/terminais/guardiao";
import { VALIDADORES_TERMINAIS } from "../../nucleo/terminais/ipc-validadores";
import type { ArmazemLayout } from "../../nucleo/terminais/layout";
import { urlDeLinkPermitida } from "../../nucleo/terminais/links";
import { PROTOCOLO_DAEMON } from "../../daemon/protocolo";
import type { RegistroIpc } from "./registro";

/** O que os canais usam do gerenciador de sessões (o real cumpre; teste injeta um falso). */
export type SessoesTerminais = Pick<
  GerenciadorSessoes,
  "abrir" | "listarMetadados" | "recuperar" | "encerrar" | "descartar" | "escrever" | "redimensionar"
  | "interromper" | "confirmarConsumo" | "obter" | "diagnostico" | "persistente"
>;

export interface DetectorUsado {
  detectar(): Promise<FerramentaDetectada[]>;
  invalidar(): void;
  registro: Pick<RegistroExecutaveis, "selecionar" | "obter">;
}

export interface DependenciasTerminais {
  registro: RegistroIpc;
  /** Espera a onda 2 do boot (daemon e atividade iniciados) e devolve o gerenciador da janela atual. */
  sessoes: () => Promise<SessoesTerminais>;
  detector: DetectorUsado;
  /** Quem escolhe o arquivo (diálogo nativo no app; gancho de teste no e2e). `null` = cancelou. */
  escolherExecutavel: (ferramenta_id: FerramentaId) => Promise<string | null>;
  /** `shell.openExternal` injetado. */
  abrirExterno: (url: string) => void | Promise<void>;
  armazemLayout: (workspace_id: string | null) => ArmazemLayout;
  conversas: Pick<ArmazemConversas, "listar">;
  infoApp: () => { versao_app: string; versao_electron: string };
  /** Falha de canal de envio (sem resposta) volta ao renderer por `terminais:falha`. */
  enviarFalha: (falha: FalhaTerminal) => void;
  /**
   * Chamado ANTES do descarte lógico da sessão: o domínio marca o Pane como encerrado ('descartado'), avisa a UI e
   * a Orquestração revoga o token MCP. Falha aqui nunca impede o descarte.
   */
  aoDescartar?: (sessao_id: string) => void;
  /** O usuário digitou na sessão (só o aviso; nunca o conteúdo): alimenta o pulso de atividade do bichinho. */
  aoEscrever?: (sessao_id: string) => void;
  /** Só para teste. */
  prepararAnexos?: typeof prepararAnexos;
}

const PERSONALIZADO = { nome: "Personalizado", descricao: "Executável escolhido por você" } as const;

/** Catálogo das sessões: argumentos automáticos SÓ com workspace em `automatico` (D-14); padrão `seguro`. */
export function criarCatalogoDeSessoes(permissaoDe: (workspace_id: string | null) => PermissaoWorkspace): CatalogoSessoes {
  const permissao = (workspace_id: string | null): PermissaoWorkspace => {
    try { return permissaoDe(workspace_id) === "automatico" ? "automatico" : "seguro"; } catch { return "seguro"; }
  };
  return {
    argumentosAutomaticos: (id, workspace_id) => argumentosAutomaticos(id as FerramentaId, permissao(workspace_id)),
    argumentosDeRetomada,
    argumentosDePromptInicial,
    teclaDeInterrupcao,
  };
}

function descreverEscolhida(ferramenta_id: FerramentaId, executavel_id: string, modo: FerramentaDetectada["modo_lancamento"]): FerramentaDetectada {
  const item = CATALOGO_TERMINAIS.find((f) => f.id === ferramenta_id);
  return {
    // `personalizado` não está em `FerramentaDetectada["id"]` no contrato; a UI o trata pelo id que pediu.
    id: ferramenta_id as FerramentaDetectada["id"],
    nome: item?.nome ?? PERSONALIZADO.nome,
    descricao: item?.descricao ?? PERSONALIZADO.descricao,
    instalado: true,
    executavel_id,
    modo_lancamento: modo,
    erro_codigo: null,
    versao: null,
    recursos: recursosDaFerramenta(ferramenta_id),
  };
}

export function registrarIpcTerminais(d: DependenciasTerminais): void {
  const { registro } = d;
  const V = VALIDADORES_TERMINAIS;
  const anexos = d.prepararAnexos ?? prepararAnexos;

  /** Canais de envio não têm resposta: a falha volta como evento, sem vazar detalhe interno. */
  const enviando = (sessao_id: string, acao: (s: SessoesTerminais) => void): void => {
    d.sessoes().then(acao).catch((erro: unknown) => {
      d.enviarFalha({ sessao_id, codigo: "falha_no_envio", mensagem: erro instanceof Error ? erro.message : "Falha ao falar com o terminal." });
    });
  };

  // ---- detecção (cache no detector; invalidada no foco e ao escolher executável)
  registro.invoke("terminais:listar_ferramentas", V["terminais:listar_ferramentas"], ({ forcar }) => {
    if (forcar) d.detector.invalidar();
    return d.detector.detectar();
  });

  registro.invoke("terminais:selecionar_executavel", V["terminais:selecionar_executavel"], async (entrada) => {
    const ferramenta_id = entrada.ferramenta_id as FerramentaId; // o validador já garantiu o conjunto
    const caminho = await d.escolherExecutavel(ferramenta_id);
    if (caminho === null) return null;
    const r = d.detector.registro.selecionar(caminho, ferramenta_id);
    if (!r.ok) throw new Error(r.mensagem);
    d.detector.invalidar();
    return descreverEscolhida(ferramenta_id, r.executavel_id, d.detector.registro.obter(r.executavel_id)?.modo_lancamento ?? "direto");
  });

  // ---- sessões
  registro.invoke("terminais:abrir", V["terminais:abrir"], async (pedido) => (await d.sessoes()).abrir(pedido));
  registro.invoke("terminais:listar_sessoes", V["terminais:listar_sessoes"], async () => (await d.sessoes()).listarMetadados());
  registro.invoke("terminais:recuperar", V["terminais:recuperar"], async () => ({ sessoes: await (await d.sessoes()).recuperar() }));
  registro.invoke("terminais:encerrar", V["terminais:encerrar"], async ({ sessao_id }) => (await d.sessoes()).encerrar(sessao_id));
  registro.invoke("terminais:descartar", V["terminais:descartar"], async ({ sessao_id }) => {
    try { d.aoDescartar?.(sessao_id); } catch { /* o descarte da sessão vale mesmo assim */ }
    return (await d.sessoes()).descartar(sessao_id);
  });
  registro.invoke("terminais:confirmar_consumo", V["terminais:confirmar_consumo"], async ({ sessao_id, bytes }) => (await d.sessoes()).confirmarConsumo(sessao_id, bytes));

  registro.envio("terminais:escrever", V["terminais:escrever"], ({ sessao_id, dados }) => {
    try { d.aoEscrever?.(sessao_id); } catch { /* acessório */ }
    enviando(sessao_id, (s) => void s.escrever(sessao_id, dados));
  });
  registro.envio("terminais:redimensionar", V["terminais:redimensionar"], ({ sessao_id, colunas, linhas }) => enviando(sessao_id, (s) => void s.redimensionar(sessao_id, colunas, linhas)));
  registro.envio("terminais:interromper", V["terminais:interromper"], ({ sessao_id }) => enviando(sessao_id, (s) => void s.interromper(sessao_id)));

  // ---- anexos: o main copia para a pasta do workspace da sessão e devolve caminho relativo, sem Enter
  registro.invoke("terminais:anexar", V["terminais:anexar"], async ({ sessao_id, itens }) => {
    const sessao = (await d.sessoes()).obter(sessao_id);
    if (sessao === undefined) throw new Error("Sessão desconhecida nesta janela.");
    return anexos(sessao.cwd, sessao_id, itens);
  });

  // ---- links: o main REVALIDA (http/https, sem credenciais, sem controle); nunca confia no renderer
  registro.invoke("terminais:abrir_link", V["terminais:abrir_link"], async ({ url }) => {
    const permitida = urlDeLinkPermitida(url);
    if (permitida === null) return false;
    await d.abrirExterno(permitida);
    return true;
  });

  // ---- layout por workspace (escrita atômica no armazém)
  registro.invoke("terminais:layout_ler", V["terminais:layout_ler"], ({ workspace_id }) => d.armazemLayout(workspace_id).ler());
  registro.invoke("terminais:layout_gravar", V["terminais:layout_gravar"], ({ workspace_id, layout }: { workspace_id: string | null; layout: LayoutTerminais }) => {
    try { d.armazemLayout(workspace_id).gravar(layout); return true; } catch { return false; }
  });

  // ---- diagnóstico (só metadados) e conversas (retomar)
  registro.invoke("terminais:diagnostico", V["terminais:diagnostico"], async () => {
    const [sessoes, ferramentas] = await Promise.all([d.sessoes(), d.detector.detectar().catch(() => [] as FerramentaDetectada[])]);
    const app = d.infoApp();
    return diagnosticoEmTexto({
      ...app,
      versao_protocolo_daemon: PROTOCOLO_DAEMON,
      so: process.platform,
      arquitetura: process.arch,
      persistente: sessoes.persistente,
      ferramentas: ferramentas.map((f) => ({ id: f.id, instalado: f.instalado, erro_codigo: f.erro_codigo })),
      sessoes: sessoes.diagnostico(),
    });
  });
  registro.invoke("terminais:conversas", V["terminais:conversas"], () => d.conversas.listar());
}

// ---------------------------------------------------------------- foco da janela → invalidar detecção

/** Invalida o cache de detecção cada vez que a janela ganha foco (instalou uma CLI fora do app?). Devolve o cancelamento. */
export function ligarInvalidacaoNoFoco(
  janela: { on(evento: "focus", cb: () => void): unknown; removeListener?(evento: "focus", cb: () => void): unknown },
  detector: Pick<DetectorUsado, "invalidar">,
): () => void {
  const ao = (): void => detector.invalidar();
  janela.on("focus", ao);
  return () => { janela.removeListener?.("focus", ao); };
}

// ---------------------------------------------------------------- transições (guardião)

export interface OpcoesTransicoes {
  guardiao: GuardiaoTransicoes;
  /** sessões da janela atual, se existem. */
  sessoes: () => SessoesGuardadas | null;
  /** Com daemon as sessões sobrevivem: nada é encerrado, então nada a confirmar. */
  persistente: () => boolean;
  /** Pergunta antes de encerrar sessões ativas (só chamado sem daemon). */
  confirmar: (acao: string) => Promise<boolean>;
}

export interface TransicoesTerminais {
  /** Trocar de workspace: serializa, e sem daemon confirma e encerra as sessões antes. */
  trocarWorkspace(executar: () => Promise<void>, publicar?: () => void): Promise<boolean>;
  /** Fechar a janela: idem. */
  fecharJanela(executar: () => Promise<void>, publicar?: () => void): Promise<boolean>;
}

export function criarTransicoesTerminais(op: OpcoesTransicoes): TransicoesTerminais {
  const transicionar = (acao: string, executar: () => Promise<void>, publicar?: () => void): Promise<boolean> =>
    op.guardiao.transicionar({
      sessoes: () => (op.persistente() ? null : op.sessoes()),
      confirmar: () => op.confirmar(acao),
      executar,
      ...(publicar === undefined ? {} : { publicar }),
    });
  return {
    trocarWorkspace: (executar, publicar) => transicionar("trocar de workspace", executar, publicar),
    fecharJanela: (executar, publicar) => transicionar("fechar a janela", executar, publicar),
  };
}
