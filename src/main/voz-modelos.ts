// Serviço de modelos de voz local (Fase 11, D-540 a D-549): catálogo versionado, download CONSENTIDO, instalação verificada, autoteste, ativação e ciclo de vida do runtime.
// Regras (todas testadas em `voz-modelos.test.ts`):
//  - o renderer só envia `modelo_id` do catálogo; URL, host, caminho e checksum vêm do catálogo; nenhum caminho volta ao renderer (só um texto de exibição);
//  - o download exige o aceite da VERSÃO vigente do texto (gravado), libera o host só enquanto o download está ativo e emite um token de USO ÚNICO por requisição (`nucleo/rede`);
//  - um download por vez; pausar/retomar por Range; cancelar apaga os parciais; erro de checksum/tamanho apaga o parcial ("apagar e tentar de novo");
//  - depois de instalado: verificação completa (sha256) → autoteste (amostra embutida) → ativação do motor local, tudo sem a janela aberta;
//  - nada de áudio, transcrição, caminho absoluto ou URL em evento/log: só códigos e contagens.
import { statfs } from "node:fs/promises";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LIMITES_MODELO,
  VERSAO_CONSENTIMENTO_MODELO,
  type CodigoErroModelo,
  type FaseModelo,
  type ListaModelosVoz,
  type ModeloVozInfo,
  type PedidoBaixarModelo,
  type ProgressoModelo,
  type ResultadoAutoteste,
} from "../compartilhado/voz-local";
import { PRODUTO } from "../nucleo/produto";
import type { IdiomaVoz } from "../compartilhado/captura";
import { criarConsentimentos, type Consentimentos, type RegistroConsentimento as RegistroAceite } from "../nucleo/privacidade/consentimento";
import type { ClienteRede, RegistroConsentimento as RegistroRede } from "../nucleo/rede";
import { modeloPorId, motivoNaoBaixavel, nomeArquivoSeguro, type Catalogo, type ModeloCatalogo } from "../nucleo/voz/local/catalogo";
import type { CatalogoCarregado } from "../nucleo/voz/local/catalogo-arquivo";
import { montarConfigCarga, threadsPadrao } from "../nucleo/voz/local/config-sherpa";
import { baixarModelo, descartarParcial, ErroModelo, limparOrfaos } from "../nucleo/voz/local/download";
import { apagarPasta, bytesEmDisco, lerManifesto, pastasInstaladas, verificarCompleto, verificarRapido } from "../nucleo/voz/local/integridade";
import type { ConfigCarga } from "../nucleo/voz/local/protocolo";
import type { RuntimeVoz } from "../nucleo/voz/local/runtime";
import { criarMotorLocalEmbutido, pcmDoWav } from "../nucleo/voz/motores/local-embutido";
import { ErroMotor } from "../nucleo/voz/motores/motor";
import type { PortaLocalVoz, PreferenciasVoz } from "./voz";

export class ErroVozModelosIpc extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(`[${codigo}] ${mensagem}`);
    this.name = "ErroVozModelosIpc";
  }
}

const INSTRUCOES: Record<CodigoErroModelo, string> = {
  sem_internet: "Sem conexão com a internet (ou o servidor não respondeu). Confira a rede e toque em Retomar: o que já foi baixado é aproveitado.",
  servidor_recusou: "O servidor de origem recusou o download agora. Tente de novo em alguns minutos; nada foi instalado.",
  disco_cheio: "Falta espaço em disco. Libere espaço e toque em Retomar: o que já foi baixado é aproveitado.",
  checksum_invalido: "O arquivo baixado não confere com o checksum do catálogo (pode estar corrompido ou adulterado). Ele foi apagado: toque em Baixar de novo.",
  tamanho_invalido: "O servidor enviou um tamanho diferente do esperado. O arquivo foi descartado: toque em Baixar de novo.",
  redirect_recusado: "O servidor tentou levar o download para um endereço fora da lista aprovada. Foi recusado por segurança; nada foi instalado.",
  runtime_indisponivel: "O motor de voz local não está disponível neste computador (o componente nativo não carregou). Use o comando local ou o serviço HTTP compatível.",
  modelo_corrompido: "Os arquivos do modelo não conferem com o que foi instalado (corrompidos ou trocados). Apague o modelo e baixe de novo.",
  autoteste_falhou: "O modelo foi baixado, mas o teste com a amostra embutida não reconheceu as palavras esperadas. Apague e baixe de novo ou escolha outro modelo.",
  consentimento_ausente: "Falta o seu aceite para baixar este modelo. Abra o assistente e confirme o download.",
  sem_checksum: `Este modelo não tem checksum confirmado no catálogo, então o ${PRODUTO.nomeDeExibicao} se recusa a baixá-lo.`,
  modelo_desconhecido: "Modelo desconhecido.",
  ja_baixando: "Já existe um download de modelo em andamento. Pause ou cancele antes de iniciar outro.",
  nao_instalado: "Este modelo ainda não está instalado.",
  cancelado: "Download cancelado.",
  indisponivel: "Não foi possível concluir agora. Tente de novo.",
};

export interface DependenciasVozModelos {
  catalogo: () => CatalogoCarregado;
  /** `<userData>/voz/modelos` */
  pastaModelos: string;
  /** pasta das amostras do autoteste (`resources/voz`). */
  pastaAmostras: string;
  prefs: PreferenciasVoz;
  rede: Pick<ClienteRede, "stream">;
  registroRede: RegistroRede;
  runtime: RuntimeVoz;
  runtimeDisponivel: () => { ok: boolean; motivo: string | null };
  /** grava motor e modelo ativos pelo serviço de voz. */
  ativarMotor: (modeloId: string | null) => Promise<void>;
  motorAtual: () => { motor: string; modelo_local: string | null };
  ociosidade_s: () => number;
  emitir: (e: ProgressoModelo) => void;
  cpus?: number;
  agora?: () => number;
  /** só testes. */
  porta?: number;
  espacoLivre?: (pasta: string) => Promise<number | null>;
  esperar?: (ms: number) => Promise<void>;
  /** o que o usuário vê como pasta (texto de exibição). */
  pastaExibicao?: string;
}

export interface ServicoVozModelos {
  listar(): Promise<ListaModelosVoz>;
  baixar(p: PedidoBaixarModelo): Promise<{ modelo_id: string }>;
  pausar(id: string): Promise<{ ok: boolean }>;
  retomar(id: string): Promise<{ ok: boolean }>;
  cancelar(id: string): Promise<{ ok: boolean }>;
  apagar(id: string): Promise<{ ok: boolean }>;
  ativar(id: string): Promise<{ ok: boolean; codigo: CodigoErroModelo | null; instrucao: string | null }>;
  autoteste(id: string): Promise<ResultadoAutoteste>;
  /** download em andamento (ou aguardando continuar)? */
  baixando(): boolean;
  /** porta que o serviço de voz usa (motor local embutido). */
  local: PortaLocalVoz;
  encerrar(): Promise<void>;
}

interface Job {
  id: string;
  ac: AbortController;
  fase: FaseModelo;
  bytes: number;
  total: number;
  arquivo: string | null;
  codigo: CodigoErroModelo | null;
  amostras: Array<{ t: number; b: number }>;
  velocidade: number;
  seq: number;
  ativar: boolean;
  rodando: boolean;
  ultimaEmissao: number;
  trailing: NodeJS.Timeout | null;
}

const semAcento = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normalizarPalavras = (t: string): string[] => semAcento(t.toLowerCase()).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((x) => x !== "");

function lerAceites(v: unknown): RegistroAceite[] {
  if (!Array.isArray(v)) return [];
  const saida: RegistroAceite[] = [];
  for (const x of v) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    if (typeof o["servico"] === "string" && typeof o["host"] === "string" && typeof o["concedido_em"] === "string" && typeof o["versao_texto"] === "string" && (o["revogado_em"] === null || typeof o["revogado_em"] === "string")) {
      saida.push({ servico: o["servico"], host: o["host"], concedido_em: o["concedido_em"], versao_texto: o["versao_texto"], revogado_em: o["revogado_em"] });
    }
  }
  return saida;
}

const CHAVE_ACEITES = "voz_modelo_consentimentos";
const servicoAceite = (modeloId: string): string => `voz_modelo:${modeloId}`;

export function criarServicoVozModelos(d: DependenciasVozModelos): ServicoVozModelos {
  const agora = d.agora ?? ((): number => Date.now());
  const cpus = d.cpus ?? 4;
  const jobs = new Map<string, Job>();
  let orfaosLimpos = false;
  const aceites: Consentimentos = criarConsentimentos({
    armazenamento: { ler: () => lerAceites(d.prefs.obter(CHAVE_ACEITES)), gravar: (r) => d.prefs.definir(CHAVE_ACEITES, r) },
    versao_texto: VERSAO_CONSENTIMENTO_MODELO,
  });

  const cat = (): Catalogo | null => { const c = d.catalogo(); return c.ok ? c.catalogo : null; };
  const ativoId = (): string | null => { const a = d.motorAtual(); return a.motor === "local_embutido" ? a.modelo_local : null; };
  const instrucao = (c: CodigoErroModelo): string => INSTRUCOES[c];

  function modeloOuErro(id: unknown): { c: Catalogo; m: ModeloCatalogo } {
    const c = cat();
    const m = c === null ? null : modeloPorId(c, id);
    if (c === null || m === null) throw new ErroVozModelosIpc("modelo_desconhecido", INSTRUCOES.modelo_desconhecido);
    return { c, m };
  }

  // ------------------------------------------------------------------ progresso (coalescido)
  function snapshot(j: Job): ProgressoModelo {
    const restante = j.velocidade > 1_024 && j.total > j.bytes ? Math.ceil((j.total - j.bytes) / j.velocidade) : null;
    return {
      modelo_id: j.id, fase: j.fase, bytes: j.bytes, total: j.total, velocidade_bps: Math.round(j.velocidade), restante_s: j.fase === "baixando" ? restante : null, arquivo_atual: j.arquivo,
      codigo: j.codigo, instrucao: j.codigo === null ? null : instrucao(j.codigo), sequencia: ++j.seq,
    };
  }
  function emitir(j: Job, forcar: boolean): void {
    const t = agora();
    if (!forcar && t - j.ultimaEmissao < LIMITES_MODELO.progresso_min_ms) {
      if (j.trailing === null) {
        j.trailing = setTimeout(() => { j.trailing = null; j.ultimaEmissao = agora(); d.emitir(snapshot(j)); }, LIMITES_MODELO.progresso_min_ms - (t - j.ultimaEmissao));
        j.trailing.unref?.();
      }
      return;
    }
    if (j.trailing !== null) { clearTimeout(j.trailing); j.trailing = null; }
    j.ultimaEmissao = t;
    d.emitir(snapshot(j));
  }
  function medir(j: Job, bytes: number): void {
    const t = agora();
    j.bytes = bytes;
    j.amostras.push({ t, b: bytes });
    while (j.amostras.length > 2 && t - (j.amostras[0] as { t: number }).t > 3_000) j.amostras.shift();
    const a = j.amostras[0] as { t: number; b: number };
    j.velocidade = t - a.t >= 500 ? ((bytes - a.b) / (t - a.t)) * 1000 : j.velocidade;
  }
  const mudarFase = (j: Job, fase: FaseModelo, codigo: CodigoErroModelo | null = null): void => { j.fase = fase; j.codigo = codigo; if (fase !== "baixando") j.velocidade = 0; emitir(j, true); };

  // ------------------------------------------------------------------ pipeline
  async function executar(j: Job, c: Catalogo, m: ModeloCatalogo): Promise<void> {
    j.rodando = true;
    const host = m.origem.host;
    d.registroRede.permitirHost(host); // o host só fica liberado enquanto ESTE download roda
    try {
      mudarFase(j, "baixando");
      await baixarModelo(
        { rede: d.rede, token: (h) => d.registroRede.conceder(h), ...(d.porta !== undefined ? { porta: d.porta } : {}), ...(d.espacoLivre !== undefined ? { espacoLivre: d.espacoLivre } : {}), ...(d.esperar !== undefined ? { esperar: d.esperar } : {}) },
        { modelo: m, catalogo: c, pastaModelos: d.pastaModelos, sinal: j.ac.signal, aoProgresso: (p) => { j.arquivo = p.arquivo; medir(j, p.bytes); emitir(j, false); } },
      );
      mudarFase(j, "verificando");
      const v = await verificarCompleto(d.pastaModelos, m);
      if (!v.ok) { await apagarPasta(d.pastaModelos, m.id); throw new ErroModelo("modelo_corrompido"); }
      if (j.ativar) {
        mudarFase(j, "autoteste");
        const r = await autotesteInterno(c, m);
        if (!r.ok) throw new ErroModelo(r.codigo ?? "autoteste_falhou");
        await d.ativarMotor(m.id);
      }
      j.bytes = j.total;
      mudarFase(j, "instalado");
      jobs.delete(j.id);
    } catch (e) {
      const erro = e instanceof ErroModelo ? e : new ErroModelo("indisponivel");
      if (erro.codigo === "cancelado") {
        if (erro.motivo === "pausa") { mudarFase(j, "pausado"); }
        else { await descartarParcial(d.pastaModelos, m.id).catch(() => undefined); j.bytes = 0; mudarFase(j, "nao_instalado"); jobs.delete(j.id); }
      } else {
        if (erro.codigo === "checksum_invalido" || erro.codigo === "tamanho_invalido") await descartarParcial(d.pastaModelos, m.id).catch(() => undefined);
        mudarFase(j, "erro", erro.codigo);
      }
    } finally {
      j.rodando = false;
      d.registroRede.revogarHost(host);
    }
  }

  function novoJob(m: ModeloCatalogo, ativar: boolean, bytes = 0): Job {
    return { id: m.id, ac: new AbortController(), fase: "baixando", bytes, total: m.tamanho_bytes, arquivo: null, codigo: null, amostras: [], velocidade: 0, seq: 0, ativar, rodando: false, ultimaEmissao: 0, trailing: null };
  }

  function outroBaixando(id: string): boolean {
    for (const j of jobs.values()) if (j.id !== id && j.rodando) return true;
    return false;
  }

  async function garantirOrfaosLimpos(): Promise<void> {
    if (orfaosLimpos) return;
    orfaosLimpos = true;
    await limparOrfaos(d.pastaModelos, new Set(jobs.keys()));
  }

  // ------------------------------------------------------------------ autoteste
  function idiomaDaAmostra(chave: string): IdiomaVoz { return chave === "en" ? "en" : "pt"; }

  async function autotesteInterno(c: Catalogo, m: ModeloCatalogo): Promise<ResultadoAutoteste> {
    const falha = (codigo: CodigoErroModelo): ResultadoAutoteste => ({ ok: false, acertos: 0, esperadas: 0, carregamento_ms: null, transcricao_ms: null, rtf: null, codigo, instrucao: instrucao(codigo) });
    const disp = d.runtimeDisponivel();
    if (!disp.ok) return falha("runtime_indisponivel");
    const rapida = await verificarRapido(d.pastaModelos, m);
    if (!rapida.ok) return falha(rapida.motivo === "ausente" ? "nao_instalado" : "modelo_corrompido");
    const amostra = c.amostras[m.amostra];
    if (amostra === undefined || !nomeArquivoSeguro(amostra.arquivo)) return falha("indisponivel");
    let pcm: Uint8Array;
    try { pcm = pcmDoWav(new Uint8Array(await readFile(join(d.pastaAmostras, amostra.arquivo)))); } catch { return falha("indisponivel"); }
    try {
      const config = montarConfigCarga(m, d.pastaModelos, idiomaDaAmostra(m.amostra), threadsPadrao(cpus));
      const r = await d.runtime.transcrever(config, pcm);
      const falado = new Set(normalizarPalavras(r.texto));
      const acertos = amostra.palavras_esperadas.filter((p) => falado.has(semAcento(p.toLowerCase()))).length;
      const ok = acertos >= amostra.minimo;
      return { ok, acertos, esperadas: amostra.palavras_esperadas.length, carregamento_ms: r.carregamento_ms, transcricao_ms: r.ms, rtf: r.duracao_ms > 0 ? Math.round((r.ms / r.duracao_ms) * 1000) / 1000 : null, codigo: ok ? null : "autoteste_falhou", instrucao: ok ? null : instrucao("autoteste_falhou") };
    } catch (e) {
      const codigo: CodigoErroModelo = e instanceof ErroMotor && e.codigo === "runtime_indisponivel" ? "runtime_indisponivel" : e instanceof ErroMotor && e.codigo === "modelo_corrompido" ? "modelo_corrompido" : "autoteste_falhou";
      return falha(codigo);
    }
  }

  // ------------------------------------------------------------------ listagem
  async function espacoLivre(): Promise<number | null> {
    if (d.espacoLivre !== undefined) return d.espacoLivre(d.pastaModelos);
    for (let p = d.pastaModelos; ; p = dirname(p)) {
      try { const s = await statfs(p); return Number(s.bavail) * Number(s.bsize); } catch { if (dirname(p) === p) return null; }
    }
  }

  async function bytesParciais(m: ModeloCatalogo): Promise<number> {
    try {
      const dir = join(d.pastaModelos, ".parcial", m.id);
      let total = 0;
      for (const n of await readdir(dir)) total += (await stat(join(dir, n))).size;
      return total;
    } catch { return 0; }
  }

  async function infoDe(c: Catalogo, m: ModeloCatalogo, presentes: Set<string>): Promise<ModeloVozInfo> {
    const motivo = motivoNaoBaixavel(m);
    let integridade: ModeloVozInfo["integridade"] = null;
    let verificadoEm: string | null = null;
    if (presentes.has(m.id)) {
      const v = await verificarRapido(d.pastaModelos, m);
      integridade = v.ok ? "ok" : "corrompido";
      if (v.ok) verificadoEm = v.manifesto.verificado_em;
      else verificadoEm = (await lerManifesto(join(d.pastaModelos, m.id)))?.verificado_em ?? null;
    }
    const j = jobs.get(m.id);
    let download: ProgressoModelo | null = j === undefined ? null : snapshot(j);
    if (download === null) {
      const parcial = await bytesParciais(m);
      if (parcial > 0) download = { modelo_id: m.id, fase: "pausado", bytes: parcial, total: m.tamanho_bytes, velocidade_bps: 0, restante_s: null, arquivo_atual: null, codigo: null, instrucao: null, sequencia: 0 };
    }
    return {
      id: m.id, nome: m.nome, descricao: m.descricao, idiomas: m.idiomas, pt_br: m.idiomas.includes("pt"), tamanho_bytes: m.tamanho_bytes, ram_estimada_mb: m.ram_estimada_mb, velocidade: m.velocidade, qualidade: m.qualidade,
      perfil: m.perfil, recomendado: m.recomendado, licenca: m.licenca, host_origem: m.origem.host, hosts_arquivos: [...c.hosts_arquivos], baixavel: motivo === null, motivo_nao_baixavel: motivo,
      instalado: integridade === "ok", bytes_em_disco: integridade === null ? null : await bytesEmDisco(d.pastaModelos, m), ativo: ativoId() === m.id && integridade === "ok", integridade, verificado_em: verificadoEm, download,
    };
  }

  const svc: ServicoVozModelos = {
    async listar() {
      await garantirOrfaosLimpos();
      const c = cat();
      const disp = d.runtimeDisponivel();
      const est = d.runtime.estado();
      const base = {
        espaco_livre_bytes: await espacoLivre(), runtime_disponivel: disp.ok, motivo_runtime: disp.motivo, pasta_exibicao: d.pastaExibicao ?? "pasta de dados do app › voz › modelos",
        versao_consentimento: VERSAO_CONSENTIMENTO_MODELO, ociosidade_s: d.ociosidade_s(), carregado: est.carregado, ram_mb: est.ram_mb, modelo_ativo: ativoId(),
      };
      if (c === null) return { ...base, modelos: [], runtime_disponivel: false, motivo_runtime: d.catalogo().ok ? base.motivo_runtime : "O catálogo de modelos não pôde ser lido." };
      const presentes = new Set(await pastasInstaladas(d.pastaModelos));
      return { ...base, modelos: await Promise.all(c.modelos.map((m) => infoDe(c, m, presentes))) };
    },

    async baixar(p) {
      const { c, m } = modeloOuErro(p.modelo_id);
      if (p.aceite_versao !== VERSAO_CONSENTIMENTO_MODELO) throw new ErroVozModelosIpc("consentimento_ausente", INSTRUCOES.consentimento_ausente);
      if (motivoNaoBaixavel(m) !== null) throw new ErroVozModelosIpc("sem_checksum", INSTRUCOES.sem_checksum);
      if (!d.runtimeDisponivel().ok) throw new ErroVozModelosIpc("runtime_indisponivel", INSTRUCOES.runtime_indisponivel);
      const existente = jobs.get(m.id);
      if (existente?.rodando === true || outroBaixando(m.id)) throw new ErroVozModelosIpc("ja_baixando", INSTRUCOES.ja_baixando);
      await garantirOrfaosLimpos();
      // o aceite é GRAVADO (host de origem e hosts dos arquivos) antes de abrir qualquer conexão
      await aceites.conceder(servicoAceite(m.id), m.origem.host);
      for (const h of c.hosts_arquivos) await aceites.conceder(servicoAceite(m.id), h);
      const j = novoJob(m, p.ativar);
      jobs.set(m.id, j);
      void executar(j, c, m);
      return { modelo_id: m.id };
    },

    async pausar(id) {
      modeloOuErro(id);
      const j = jobs.get(id);
      if (j === undefined || !j.rodando) return { ok: false };
      j.ac.abort("pausa");
      return { ok: true };
    },

    async retomar(id) {
      const { c, m } = modeloOuErro(id);
      const anterior = jobs.get(id);
      if (anterior?.rodando === true) return { ok: false };
      if (outroBaixando(id)) throw new ErroVozModelosIpc("ja_baixando", INSTRUCOES.ja_baixando);
      if (!aceites.vigente(servicoAceite(m.id), m.origem.host)) throw new ErroVozModelosIpc("consentimento_ausente", INSTRUCOES.consentimento_ausente);
      if (!d.runtimeDisponivel().ok) throw new ErroVozModelosIpc("runtime_indisponivel", INSTRUCOES.runtime_indisponivel);
      const bytes = anterior?.bytes ?? (await bytesParciais(m));
      if (anterior === undefined && bytes === 0) return { ok: false };
      const j = novoJob(m, anterior?.ativar ?? true, bytes);
      jobs.set(id, j);
      void executar(j, c, m);
      return { ok: true };
    },

    async cancelar(id) {
      const { m } = modeloOuErro(id);
      const j = jobs.get(id);
      if (j?.rodando === true) { j.ac.abort("cancelamento"); return { ok: true }; }
      await descartarParcial(d.pastaModelos, m.id);
      if (j !== undefined) { j.bytes = 0; mudarFase(j, "nao_instalado"); jobs.delete(id); }
      return { ok: true };
    },

    async apagar(id) {
      const { m } = modeloOuErro(id);
      const j = jobs.get(id);
      if (j?.rodando === true) {
        j.ac.abort("cancelamento");
        const fim = agora() + 5_000;
        while (j.rodando && agora() < fim) await new Promise((ok) => setTimeout(ok, 10));
      }
      jobs.delete(id);
      d.runtime.descarregar(); // solta os arquivos (e a RAM) antes de apagar
      await apagarPasta(d.pastaModelos, m.id);
      await descartarParcial(d.pastaModelos, m.id);
      if (ativoId() === m.id) await d.ativarMotor(null);
      return { ok: true };
    },

    async ativar(id) {
      const { m } = modeloOuErro(id);
      const disp = d.runtimeDisponivel();
      if (!disp.ok) return { ok: false, codigo: "runtime_indisponivel", instrucao: instrucao("runtime_indisponivel") };
      const v = await verificarRapido(d.pastaModelos, m);
      if (!v.ok) {
        const codigo: CodigoErroModelo = v.motivo === "ausente" ? "nao_instalado" : "modelo_corrompido";
        return { ok: false, codigo, instrucao: instrucao(codigo) };
      }
      await d.ativarMotor(m.id);
      return { ok: true, codigo: null, instrucao: null };
    },

    async autoteste(id) {
      const { c, m } = modeloOuErro(id);
      return autotesteInterno(c, m);
    },

    baixando: () => [...jobs.values()].some((j) => j.rodando),

    local: {
      existeNoCatalogo: (id) => { const c = cat(); return c !== null && modeloPorId(c, id) !== null; },
      async pronto(id) {
        const c = cat();
        const m = c === null ? null : modeloPorId(c, id);
        if (m === null || !d.runtimeDisponivel().ok) return false;
        return (await verificarRapido(d.pastaModelos, m)).ok;
      },
      motor(id) {
        return criarMotorLocalEmbutido({
          runtime: d.runtime,
          preparar: async (idioma): Promise<ConfigCarga> => {
            const c = cat();
            const m = c === null ? null : modeloPorId(c, id);
            if (m === null) throw new ErroMotor("modelo_ausente", "modelo");
            if (!d.runtimeDisponivel().ok) throw new ErroMotor("runtime_indisponivel", "runtime");
            const v = await verificarRapido(d.pastaModelos, m); // integridade ANTES de cada carga (modelo trocado depois da verificação não carrega)
            if (!v.ok) throw new ErroMotor(v.motivo === "ausente" ? "modelo_ausente" : "modelo_corrompido", "integridade");
            return montarConfigCarga(m, d.pastaModelos, idioma, threadsPadrao(cpus));
          },
        });
      },
      preaquecer(id, idioma) {
        const c = cat();
        const m = c === null ? null : modeloPorId(c, id);
        if (m === null || !d.runtimeDisponivel().ok) return;
        void verificarRapido(d.pastaModelos, m)
          .then((v) => (v.ok ? d.runtime.preaquecer(montarConfigCarga(m, d.pastaModelos, idioma, threadsPadrao(cpus))) : undefined))
          .catch(() => undefined);
      },
      encerrar: () => d.runtime.encerrar(),
    },

    async encerrar() {
      for (const j of jobs.values()) { if (j.rodando) j.ac.abort("pausa"); if (j.trailing !== null) clearTimeout(j.trailing); }
      d.runtime.encerrar();
    },
  };
  return svc;
}
