// Serviço de atualização (Fase 21, T-21.16): fachada com portas injetadas (relógio, transporte, backend, preferências, Panes, histórico).
// Sem Electron e sem socket próprio. Garante: duas chaves + consentimento antes de qualquer pedido; ≤ 1 verificação automática por 24 h;
// download só manual (ou se a pessoa optou); instalar só com a guarda aprovada, depois de RECONFERIR o arquivo (TOCTOU, AU-26); falha isolada, nunca lança ao chamador.
import {
  CONSENTIMENTO_ATUALIZACAO_VERSAO,
  type ArtefatoAtualizacao,
  type AtualizacaoEvento,
  type ConfigAtualizacao,
  type EstadoAtualizacao,
  type ManifestoAtualizacao,
  type MotivoAtualizacao,
  type ArquiteturaAtualizacao,
  type PlataformaAtualizacao,
} from "../../compartilhado/atualizacao";
import type { BackendAtualizacao } from "./io/backend";
import { AtualizacaoErro, motivoDeErro } from "./io/erros";
import type { ClienteFeed } from "./io/feed";
import { reverificarArquivo } from "./io/verificador";
import { avaliarInstalacao } from "./guarda-instalacao";
import { decidirCarregamento } from "./gate";
import { criarEvento, type EntradaEvento } from "./historico";
import { transicao, type EventoMaquina } from "./maquina";
import { avaliarManifesto } from "./politica";
import { compararTextos } from "./versao";

export const INTERVALO_VERIFICACAO_MS = 24 * 3_600_000;

/** Estado persistido (preferencias.json, D-29): nada disto vai para a rede. */
export interface EstadoPersistido {
  idInstalacao: string;
  ultimaVerificacaoEm: string | null;
  ultimoPublicadoEm: string | null;
  etag: string | null;
  revogadas: string[];
  /** versões que já rodaram nesta máquina (só para elas há reversão, AU-02). */
  versoesInstaladas: string[];
}

export interface InstaladorGuardado {
  caminho: string;
  artefato: ArtefatoAtualizacao;
}

export interface DepsServico {
  build: { habilitada: boolean; chavesAceitas: readonly string[] };
  versaoAtual: string;
  plataforma: PlataformaAtualizacao;
  arquitetura: ArquiteturaAtualizacao;
  feed: ClienteFeed;
  backend: BackendAtualizacao;
  config: { ler(): ConfigAtualizacao };
  persistido: { ler(): EstadoPersistido; gravar(p: Partial<EstadoPersistido>): void };
  relogio: () => Date;
  destinoDir: string;
  panesTrabalhando: () => number;
  protocoloDaemonAtual: number;
  /** salva o que precisa sobreviver ao reinício (Missões, layout) antes de instalar. */
  salvarEstadoDoApp?: () => Promise<void>;
  historico?: (e: AtualizacaoEvento) => void;
  /** notificação coalescida de estado (a UI limita a 4/s). */
  aoMudar?: (e: EstadoAtualizacao) => void;
  novoId: () => string;
  /** reversão: instalador guardado de uma versão já instalada antes. */
  instaladorGuardado?: (versao: string) => InstaladorGuardado | null;
}

export type ResultadoOperacao = { ok: true } | { ok: false; motivo: MotivoAtualizacao };

export interface ServicoAtualizacao {
  estado(): EstadoAtualizacao;
  verificar(op?: { manual?: boolean }): Promise<ResultadoOperacao>;
  baixar(): Promise<ResultadoOperacao>;
  cancelar(): void;
  instalar(op: { confirmar_panes: boolean }): Promise<ResultadoOperacao>;
  reverter(op: { versao: string }): Promise<ResultadoOperacao>;
  /** abre a página de download (backend manual). */
  abrirDownload(): Promise<ResultadoOperacao>;
}

export function criarServicoAtualizacao(d: DepsServico): ServicoAtualizacao {
  let fase: EstadoAtualizacao["fase"] = "desligado";
  let motivo: MotivoAtualizacao | undefined;
  let progresso: number | undefined;
  let aprovado: { manifesto: ManifestoAtualizacao; artefato: ArtefatoAtualizacao } | null = null;
  let arquivo: string | null = null;
  let controle: AbortController | null = null;

  const cfg = (): ConfigAtualizacao => d.config.ler();
  const consentimento = (): boolean => cfg().consentimento_versao === CONSENTIMENTO_ATUALIZACAO_VERSAO;
  const aplicar = (e: EventoMaquina): void => {
    fase = transicao(fase, e);
  };
  const estado = (): EstadoAtualizacao => ({
    fase,
    versao_atual: d.versaoAtual,
    canal: cfg().canal,
    ...(aprovado !== null ? { disponivel: { versao: aprovado.manifesto.versao, canal: aprovado.manifesto.canal, notas: aprovado.manifesto.notas, tamanho: aprovado.artefato.tamanho, publicado_em: aprovado.manifesto.publicado_em } } : {}),
    ...(progresso !== undefined ? { progresso } : {}),
    habilitada_no_build: d.build.habilitada,
    consentimento: consentimento(),
    ultima_verificacao: d.persistido.ler().ultimaVerificacaoEm,
    ...(motivo !== undefined ? { motivo } : {}),
  });
  const emitir = (): void => d.aoMudar?.(estado());
  const registrar = (e: EntradaEvento): void => {
    try {
      d.historico?.(criarEvento(e, d.novoId(), d.relogio()));
    } catch {
      /* histórico nunca derruba a atualização */
    }
  };
  const permitido = (): ResultadoOperacao => {
    const g = decidirCarregamento({ habilitadaNoBuild: d.build.habilitada, config: cfg() });
    if (!g.carregar) return { ok: false, motivo: g.motivo };
    if (fase === "desligado") aplicar("ligar");
    return { ok: true };
  };
  const falhar = (m: MotivoAtualizacao, ev: EventoMaquina = "falhou"): ResultadoOperacao => {
    motivo = m;
    progresso = undefined;
    aplicar(ev);
    emitir();
    return { ok: false, motivo: m };
  };

  const servico: ServicoAtualizacao = {
    estado,

    async verificar(op = {}) {
      const p = permitido();
      if (!p.ok) return p;
      if (fase === "verificando" || fase === "baixando" || fase === "instalando") return { ok: false, motivo: "cancelado" };
      const agora = d.relogio();
      const ps = d.persistido.ler();
      if (op.manual !== true && ps.ultimaVerificacaoEm !== null && agora.getTime() - Date.parse(ps.ultimaVerificacaoEm) < INTERVALO_VERIFICACAO_MS) return { ok: false, motivo: "ja_atual" }; // ≤ 1 por 24 h
      if (fase === "erro") aplicar("reiniciar_erro");
      motivo = undefined;
      aplicar("verificar");
      emitir();
      controle = new AbortController();
      try {
        const r = await d.feed.obterManifesto(cfg().canal, { etag: ps.etag, sinal: controle.signal });
        d.persistido.gravar({ ultimaVerificacaoEm: agora.toISOString() });
        if (r.tipo === "nao_modificado") {
          aplicar("achou_atual");
          registrar({ tipo: "verificada", canal: cfg().canal, versao_de: d.versaoAtual });
          emitir();
          return { ok: true };
        }
        const a = avaliarManifesto({
          bytes: r.bytes,
          assinatura: r.assinatura,
          chavesAceitas: d.build.chavesAceitas,
          revogadasLocais: ps.revogadas,
          versaoAtual: d.versaoAtual,
          canal: cfg().canal,
          betaConsentido: cfg().canal === "beta",
          idInstalacao: ps.idInstalacao,
          agora,
          ultimoPublicadoEm: ps.ultimoPublicadoEm,
          plataforma: d.plataforma,
          arquitetura: d.arquitetura,
        });
        if (!a.ok) {
          registrar({ tipo: "recusada", canal: cfg().canal, versao_de: d.versaoAtual, motivo: a.motivo });
          return falhar(a.motivo);
        }
        // só o que passou pela política avança o estado monotônico (replay) e as revogações
        const novo: Partial<EstadoPersistido> = { etag: r.etag };
        if (ps.ultimoPublicadoEm === null || Date.parse(a.manifesto.publicado_em) > Date.parse(ps.ultimoPublicadoEm)) novo.ultimoPublicadoEm = a.manifesto.publicado_em;
        if (a.novasRevogadas.length > 0) novo.revogadas = [...ps.revogadas, ...a.novasRevogadas];
        d.persistido.gravar(novo);
        if (a.tipo === "atual") {
          aprovado = null;
          aplicar("achou_atual");
          registrar({ tipo: "verificada", canal: cfg().canal, versao_de: d.versaoAtual });
          emitir();
          return { ok: true };
        }
        aprovado = { manifesto: a.manifesto, artefato: a.artefato };
        aplicar("achou_disponivel");
        registrar({ tipo: "disponivel", canal: cfg().canal, versao_de: d.versaoAtual, versao_para: a.manifesto.versao });
        emitir();
        // download automático SÓ se a pessoa marcou a opção (AU-13, D-140); o padrão é nunca baixar sozinho
        if (cfg().baixar_automatico && d.backend.capacidades.baixa) {
          controle = null;
          return await servico.baixar();
        }
        return { ok: true };
      } catch (e) {
        const m = motivoDeErro(e);
        registrar({ tipo: "verificacao_falhou", canal: cfg().canal, versao_de: d.versaoAtual, motivo: m });
        return falhar(m, m === "cancelado" ? "cancelar" : "falhou");
      } finally {
        controle = null;
      }
    },

    async baixar() {
      const p = permitido();
      if (!p.ok) return p;
      if (fase !== "disponivel" || aprovado === null) return { ok: false, motivo: "sem_artefato" };
      if (!d.backend.capacidades.baixa) return { ok: false, motivo: "backend_indisponivel" };
      const { manifesto, artefato } = aprovado;
      aplicar("baixar");
      progresso = 0;
      emitir();
      controle = new AbortController();
      try {
        const r = await d.backend.baixar({ manifesto, artefato, destinoDir: d.destinoDir, onProgresso: (f) => { progresso = f; emitir(); }, sinal: controle.signal });
        aplicar("baixado");
        await reverificarArquivo(r.caminho, artefato); // camada (ii) vale para QUALQUER backend
        aplicar("hash_ok");
        arquivo = r.caminho;
        progresso = undefined;
        registrar({ tipo: "baixada", canal: cfg().canal, versao_de: d.versaoAtual, versao_para: manifesto.versao });
        emitir();
        return { ok: true };
      } catch (e) {
        const m = motivoDeErro(e);
        registrar({ tipo: "verificacao_falhou", canal: cfg().canal, versao_de: d.versaoAtual, versao_para: manifesto.versao, motivo: m });
        return falhar(m, m === "cancelado" ? "cancelar" : "falhou");
      } finally {
        controle = null;
      }
    },

    cancelar() {
      controle?.abort();
    },

    async instalar(op) {
      const p = permitido();
      if (!p.ok) return p;
      if (fase !== "pronto" || aprovado === null || arquivo === null) return { ok: false, motivo: "sem_artefato" };
      if (!d.backend.capacidades.instala) return { ok: false, motivo: "backend_indisponivel" };
      const g = avaliarInstalacao({ panesTrabalhando: d.panesTrabalhando(), confirmarPanes: op.confirmar_panes, protocoloDaemonAtual: d.protocoloDaemonAtual, protocoloDaemonNovo: null });
      if (!g.ok) return { ok: false, motivo: g.motivo }; // recusa sem tocar em nada: o estado continua `pronto`
      const { manifesto, artefato } = aprovado;
      try {
        await reverificarArquivo(arquivo, artefato); // o arquivo pode ter sido trocado depois do download (AU-26)
        await d.salvarEstadoDoApp?.();
        aplicar("instalar");
        emitir();
        const ps = d.persistido.ler();
        d.persistido.gravar({ versoesInstaladas: [...new Set([...ps.versoesInstaladas, d.versaoAtual])] });
        registrar({ tipo: "instalada", canal: cfg().canal, versao_de: d.versaoAtual, versao_para: manifesto.versao });
        await d.backend.instalar(arquivo);
        return { ok: true };
      } catch (e) {
        const m = motivoDeErro(e);
        arquivo = null;
        return falhar(m);
      }
    },

    async reverter(op) {
      const p = permitido();
      if (!p.ok) return p;
      const ps = d.persistido.ler();
      const guardado = d.instaladorGuardado?.(op.versao) ?? null;
      // só versão que JÁ rodou aqui, com instalador guardado e verificável (AU-02): nunca "baixar qualquer versão antiga"
      if (!ps.versoesInstaladas.includes(op.versao) || guardado === null || compararTextos(op.versao, d.versaoAtual) !== -1) return { ok: false, motivo: "versao_nao_instalada_antes" };
      if (!d.backend.capacidades.instala) return { ok: false, motivo: "backend_indisponivel" };
      const g = avaliarInstalacao({ panesTrabalhando: d.panesTrabalhando(), confirmarPanes: false, protocoloDaemonAtual: d.protocoloDaemonAtual, protocoloDaemonNovo: null });
      if (!g.ok) return { ok: false, motivo: g.motivo };
      try {
        await reverificarArquivo(guardado.caminho, guardado.artefato);
        await d.salvarEstadoDoApp?.();
        registrar({ tipo: "revertida", canal: cfg().canal, versao_de: d.versaoAtual, versao_para: op.versao });
        await d.backend.instalar(guardado.caminho);
        return { ok: true };
      } catch (e) {
        return falhar(motivoDeErro(e));
      }
    },

    async abrirDownload() {
      const p = permitido();
      if (!p.ok) return p;
      if (aprovado === null || d.backend.abrirDownload === undefined) return { ok: false, motivo: "sem_artefato" };
      try {
        await d.backend.abrirDownload(aprovado);
        return { ok: true };
      } catch (e) {
        return { ok: false, motivo: motivoDeErro(e) };
      }
    },
  };
  return servico;
}
