// Ciclo de vida de um servidor da Loja (Fase 7B, T-07B.17/.18/.19/.22): instalar → configurar → testar →
// habilitar → atualizar → desinstalar, tudo por AÇÃO EXPLÍCITA (nada em segundo plano, nada no boot, nada por
// pedido de agente). Núcleo sem Electron: estado no `RepoLojaMcp`, segredos no cofre (`SegredosMcp`), execução
// pelo `Executor`, saúde pelo handshake MCP. Falha em qualquer passo deixa o estado anterior intacto.

import { createHash } from "node:crypto";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import type { Bloqueio } from "./bloqueio";
import type { CatalogoCarregado } from "./catalogo";
import type { ServicoCliUsuario } from "./cli-usuario";
import { montarComando } from "./comando";
import type { EntradaMcp } from "./esquema";
import type { Executor } from "./executor";
import { instalarServidor, type CodigoInstalacao, type OpcoesInstalar } from "./instalar";
import { isolamentoPorCli, resolverServidoresLoja, type AlvoPolitica, type NivelIsolamento, type ResultadoPolitica } from "./politica";
import { hashDoComando, planejarInstalacao, type BloqueioPlano, type DiagnosticoMcp, type PlanoInstalacao, type ResultadoPlano } from "./plano";
import type { AlvoTipo, CliLoja, NivelLog, OrigemConsentimento, RegistroHabilitacao, RegistroInstalado, RepoLojaMcp } from "./repositorio";
import { variaveisFaltando, type SegredosMcp, type CodigoVariavel } from "./segredos";
import { testarServidorDaLoja } from "./saude-servidor";
import type { ServidorLojaPane } from "./injecao";
import { redigir } from "./verificacao";

export type CodigoCiclo =
  | "catalogo_desconhecido" | "consentimento_invalido" | "ja_instalado" | "ja_instalando" | "nao_instalado" | "sem_atualizacao"
  | "em_uso" | "nao_configurado" | "bloqueado" | "alvo_invalido" | "plano_recusado" | CodigoInstalacao | "saude_falhou_restaurado";

export type ResultadoAcao = { ok: true } | { ok: false; codigo: CodigoCiclo; detalhe?: string | undefined };

export interface Consentimento { aceito: boolean; comando_hash: string }

export interface DepsCiclo {
  repo: RepoLojaMcp;
  catalogo: CatalogoCarregado;
  segredos: SegredosMcp;
  executor: Executor;
  userData: string;
  bloqueio?: Bloqueio;
  diagnostico: () => Promise<DiagnosticoMcp>;
  instalacao?: Partial<Pick<OpcoesInstalar, "registroNpm" | "locksDir" | "binarios" | "baixar" | "pathOrigem" | "timeoutMs">>;
  node?: string;
  nodeEhElectron?: boolean;
  plataforma?: NodeJS.Platform;
  agora?: () => string;
  gerarId?: () => string;
  ulid?: () => string;
  /** `true` se algum Pane ativo usa o servidor (impede desinstalar). */
  emUso?: (id: string) => boolean;
  /** Barramento de domínio (`mcp_store.*`). Nunca recebe segredo. */
  evento?: (nome: string, payload: Record<string, unknown>) => void;
  progresso?: (p: { id: string; passo: number; rotulo: string }) => void;
  cliUsuario?: ServicoCliUsuario;
  fetch?: typeof fetch;
  origem?: NodeJS.ProcessEnv;
  timeoutSaudeMs?: number;
}

export interface ResultadoTeste {
  estado: "ok" | "indisponivel";
  n_ferramentas: number;
  latencia_ms: number;
  erro: string | null;
  variaveis_faltando: string[];
}

export interface DiffAtualizacao {
  disponivel: boolean;
  versao_de: string | null;
  versao_para: string | null;
  comando: { antes: string | null; depois: string };
  variaveis: { adicionadas: string[]; removidas: string[] };
  riscos: { adicionados: string[]; removidos: string[] };
  /** hash que a pessoa precisa consentir. */
  comando_hash: string;
}

export interface SaudePassiva {
  id: string;
  pasta_ok: boolean;
  executavel_ok: boolean;
  comando_hash_ok: boolean;
  atualizacao_disponivel: boolean;
  bloqueado: boolean;
}

const hashHex = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface CicloLoja {
  planoInstalacao(id: string, workspace?: string): Promise<{ ok: true; plano: PlanoInstalacao } | { ok: false; bloqueio: BloqueioPlano }>;
  instalar(id: string, consentimento: Consentimento, opcoes?: { origem?: OrigemConsentimento; sinal?: AbortSignal; workspace?: string }): Promise<ResultadoAcao>;
  planoAtualizacao(id: string, workspace?: string): Promise<DiffAtualizacao | null>;
  atualizar(id: string, consentimento: Consentimento, opcoes?: { sinal?: AbortSignal; workspace?: string }): Promise<ResultadoAcao>;
  desinstalar(id: string, opcoes: { apagar_segredos: boolean }): Promise<{ ok: boolean; codigo?: CodigoCiclo; residuos: string[] }>;
  gravarVariavel(id: string, nome: string, valor: string): Promise<{ ok: true; codigo: null } | { ok: false; codigo: CodigoVariavel | CodigoCiclo }>;
  apagarVariavel(id: string, nome: string): Promise<{ ok: boolean }>;
  variaveisEstado(id: string): Promise<Array<{ nome: string; obrigatoria: boolean; secreta: boolean; definida: boolean }>>;
  testar(id: string, opcoes?: { workspace?: string }): Promise<ResultadoTeste>;
  habilitar(id: string, alvo_tipo: AlvoTipo, alvo_valor: string, habilitado: boolean): Promise<ResultadoAcao>;
  habilitacoes(workspace: string): Array<RegistroHabilitacao & { isolamento: Record<CliLoja, NivelIsolamento> }>;
  /** Desabilita (em todo alvo) servidor instalado que entrou na lista de bloqueio. Devolve os ids afetados. */
  aplicarBloqueio(): string[];
  /** Servidores que entram num Pane + a forma para a injeção. */
  servidoresDoPane(alvo: AlvoPolitica): Promise<{ politica: ResultadoPolitica; servidores: ServidorLojaPane[] }>;
  saudePassiva(): Promise<SaudePassiva[]>;
  /** Apaga `.tmp` órfãos mais velhos que `idadeMs` (padrão 1 h). Rodar no boot OCIOSO. */
  limparTmpOrfaos(idadeMs?: number): Promise<number>;
}

export function criarCicloLoja(d: DepsCiclo): CicloLoja {
  const agora = d.agora ?? ((): string => new Date().toISOString());
  const plataforma = d.plataforma ?? process.platform;
  const ctxPlano = (workspace?: string): Parameters<typeof planejarInstalacao>[2] => ({
    userData: d.userData, plataforma, workspace, ...(d.node ? { node: d.node } : {}), ...(d.nodeEhElectron !== undefined ? { nodeEhElectron: d.nodeEhElectron } : {}),
    ...(d.bloqueio ? { bloqueio: d.bloqueio } : {}), catalogoAdulterado: d.catalogo.somente_leitura,
  });
  const entradaDe = (id: string): EntradaMcp | null => (d.catalogo.porId.get(id)?.entrada as EntradaMcp | undefined) ?? null;
  const log = (id: string, nivel: NivelLog, evento: string, detalhe: Record<string, unknown> = {}): void => {
    d.repo.registrarLog({ servidor_id: id, nivel, evento, detalhe_json: redigir(JSON.stringify(detalhe)), em: agora() });
  };
  const emitir = (nome: string, payload: Record<string, unknown>): void => d.evento?.(nome, payload);
  const pastaRel = (id: string): string => `mcp/${id}`;

  async function planoDe(id: string, workspace?: string): Promise<ResultadoPlano> {
    const e = entradaDe(id);
    if (!e) return { ok: false, bloqueio: { codigo: "nao_confirmado", motivo: "servidor desconhecido no catálogo", acao: null } };
    return planejarInstalacao(e, await d.diagnostico(), ctxPlano(workspace));
  }

  function instalarOpcoes(e: EntradaMcp, sinal?: AbortSignal): OpcoesInstalar {
    return {
      entrada: e, userData: d.userData, executor: d.executor, plataforma, ...(d.ulid ? { ulid: d.ulid } : {}), ...(sinal ? { sinal } : {}),
      ...d.instalacao, aoProgresso: (p) => d.progresso?.({ id: e.id, passo: p.passo, rotulo: p.rotulo }),
    };
  }

  async function sincronizarVariaveis(e: EntradaMcp): Promise<void> {
    const definidas = await d.segredos.definidas(e);
    for (const v of e.variaveis) d.repo.gravarVariavel({ servidor_id: e.id, nome: v.nome, definida: definidas.has(v.nome), atualizada_em: agora() });
  }

  async function medirSaude(e: EntradaMcp, workspace?: string): Promise<ResultadoTeste> {
    const valores = await d.segredos.valores(e);
    const r = await testarServidorDaLoja({
      entrada: e, userData: d.userData, workspace, plataforma, valores,
      ...(d.node ? { node: d.node } : {}), ...(d.nodeEhElectron !== undefined ? { nodeEhElectron: d.nodeEhElectron } : {}),
      ...(d.timeoutSaudeMs ? { timeoutMs: d.timeoutSaudeMs } : {}), ...(d.fetch ? { fetch: d.fetch } : {}), ...(d.origem ? { origem: d.origem } : {}),
    });
    // `lento` com erro (timeout) NÃO é saudável; `lento` sem erro só demorou.
    const ok = r.erro_codigo === null && (r.estado === "ok" || r.estado === "lento");
    const erro = ok ? null : r.estado === "exige_variavel" ? "nao_configurado" : r.estado === "sem_ferramentas" ? "sem_ferramentas" : (r.erro_codigo ?? r.estado);
    const em = agora();
    d.repo.salvarSaude({ servidor_id: e.id, estado: ok ? "ok" : "indisponivel", testado_em: em, latencia_ms: r.latencia_ms, n_ferramentas: r.n_ferramentas, erro_codigo: erro });
    if (ok) d.repo.substituirFerramentas(e.id, r.ferramentas.map((f) => ({ nome: f.nome, descricao: f.descricao })), em);
    log(e.id, ok ? "info" : "aviso", "saude", { estado: r.estado, erro, latencia_ms: r.latencia_ms, stderr: r.stderr_redigido.slice(0, 1024) });
    emitir("mcp_store.health", { id: e.id, estado: ok ? "ok" : "indisponivel" });
    return { estado: ok ? "ok" : "indisponivel", n_ferramentas: r.n_ferramentas, latencia_ms: r.latencia_ms, erro, variaveis_faltando: r.variaveis_faltando };
  }

  function registrarConsentimento(plano: PlanoInstalacao, origem: OrigemConsentimento): void {
    d.repo.gravarConsentimento({
      id: d.gerarId?.() ?? `cons_${hashHex(plano.id + agora()).slice(0, 12)}`, servidor_id: plano.id, versao: plano.versao ?? "remoto", comando_hash: plano.comando_hash,
      permissoes_json: JSON.stringify({ comando_exato: plano.permissoes.comando_exato, riscos: plano.permissoes.riscos, hosts: plano.permissoes.hosts_rede, variaveis: plano.permissoes.variaveis.map((v) => v.nome), pasta: plano.pasta, nivel: plano.nivel_verificacao }),
      origem, aceito_em: agora(),
    });
    emitir("mcp_store.consent_recorded", { id: plano.id, origem });
  }

  return {
    planoInstalacao: planoDe,

    async instalar(id, consentimento, opcoes = {}) {
      const e = entradaDe(id);
      if (!e) return { ok: false, codigo: "catalogo_desconhecido" };
      const anterior = d.repo.obterInstalado(id);
      if (anterior?.estado === "instalado") return { ok: false, codigo: "ja_instalado" };
      if (anterior?.estado === "instalando") return { ok: false, codigo: "ja_instalando" };
      const r = await planoDe(id, opcoes.workspace);
      if (!r.ok) return { ok: false, codigo: "plano_recusado", detalhe: r.bloqueio.codigo };
      // Consentimento por instalação E por versão: o hash precisa ser o do plano mostrado agora.
      if (consentimento.aceito !== true || consentimento.comando_hash !== r.plano.comando_hash) return { ok: false, codigo: "consentimento_invalido" };
      const plano = r.plano;
      const inicio = agora();
      const base: RegistroInstalado = {
        servidor_id: id, versao: plano.versao ?? "remoto", metodo: plano.metodo, estado: "instalando", nivel_verificacao: plano.nivel_verificacao,
        integridade: e.instalacao.integridade, pasta_rel: plano.pasta ? pastaRel(id) : null, comando_hash: plano.comando_hash,
        seed_versao: d.catalogo.seed_versao ?? "", erro_codigo: null, instalado_em: inicio, atualizado_em: inicio,
      };
      d.repo.gravarInstalado(base);
      emitir("mcp_store.install_started", { id });
      log(id, "info", "instalacao_iniciada", { versao: base.versao, metodo: base.metodo });
      const res = await instalarServidor(instalarOpcoes(e, opcoes.sinal));
      if (!res.ok) {
        d.repo.gravarInstalado({ ...base, estado: "falhou", erro_codigo: res.codigo, atualizado_em: agora() });
        log(id, "erro", "instalacao_falhou", { codigo: res.codigo, detalhe: res.detalhe });
        emitir("mcp_store.install_failed", { id, codigo: res.codigo });
        return { ok: false, codigo: res.codigo, detalhe: res.detalhe };
      }
      await res.confirmar();
      d.repo.gravarInstalado({ ...base, estado: "instalado", atualizado_em: agora() });
      registrarConsentimento(plano, opcoes.origem ?? "loja");
      await sincronizarVariaveis(e);
      log(id, "info", "instalacao_concluida", { versao: base.versao });
      emitir("mcp_store.install_finished", { id });
      return { ok: true };
    },

    async planoAtualizacao(id, workspace) {
      const e = entradaDe(id);
      const inst = d.repo.obterInstalado(id);
      if (!e || !inst || inst.estado !== "instalado") return null;
      const r = await planoDe(id, workspace);
      if (!r.ok) return null;
      const ultimo = d.repo.consentimentosDe(id).at(-1);
      const antes = ultimo ? (JSON.parse(ultimo.permissoes_json) as { comando_exato?: string; riscos?: string[]; variaveis?: string[] }) : {};
      const novasVars = r.plano.permissoes.variaveis.map((v) => v.nome);
      const diff = (a: string[], b: string[]): string[] => b.filter((x) => !a.includes(x));
      return {
        disponivel: inst.comando_hash !== r.plano.comando_hash || inst.versao !== (r.plano.versao ?? "remoto"),
        versao_de: inst.versao, versao_para: r.plano.versao, comando: { antes: antes.comando_exato ?? null, depois: r.plano.permissoes.comando_exato },
        variaveis: { adicionadas: diff(antes.variaveis ?? [], novasVars), removidas: diff(novasVars, antes.variaveis ?? []) },
        riscos: { adicionados: diff(antes.riscos ?? [], r.plano.permissoes.riscos), removidos: diff(r.plano.permissoes.riscos, antes.riscos ?? []) },
        comando_hash: r.plano.comando_hash,
      };
    },

    async atualizar(id, consentimento, opcoes = {}) {
      const e = entradaDe(id);
      const inst = d.repo.obterInstalado(id);
      if (!e || !inst || inst.estado !== "instalado") return { ok: false, codigo: "nao_instalado" };
      const r = await planoDe(id, opcoes.workspace);
      if (!r.ok) return { ok: false, codigo: "plano_recusado", detalhe: r.bloqueio.codigo };
      if (inst.comando_hash === r.plano.comando_hash && inst.versao === (r.plano.versao ?? "remoto")) return { ok: false, codigo: "sem_atualizacao" };
      if (consentimento.aceito !== true || consentimento.comando_hash !== r.plano.comando_hash) return { ok: false, codigo: "consentimento_invalido" };
      emitir("mcp_store.install_started", { id });
      const res = await instalarServidor(instalarOpcoes(e, opcoes.sinal));
      if (!res.ok) { log(id, "erro", "atualizacao_falhou", { codigo: res.codigo }); emitir("mcp_store.install_failed", { id, codigo: res.codigo }); return { ok: false, codigo: res.codigo, detalhe: res.detalhe }; }
      // A pasta antiga fica até a saúde passar; se quebrou, restaura.
      if (res.promovido) {
        const t = await medirSaude(e, opcoes.workspace);
        if (t.estado !== "ok" && t.erro !== "nao_configurado") {
          await res.desfazer();
          log(id, "erro", "atualizacao_revertida", { erro: t.erro });
          emitir("mcp_store.install_failed", { id, codigo: "saude_falhou_restaurado" });
          return { ok: false, codigo: "saude_falhou_restaurado", detalhe: t.erro ?? undefined };
        }
      }
      await res.confirmar();
      d.repo.gravarInstalado({ ...inst, versao: r.plano.versao ?? "remoto", nivel_verificacao: r.plano.nivel_verificacao, integridade: e.instalacao.integridade, comando_hash: r.plano.comando_hash, seed_versao: d.catalogo.seed_versao ?? "", erro_codigo: null, atualizado_em: agora() });
      registrarConsentimento(r.plano, "atualizacao");
      log(id, "info", "atualizacao_concluida", { versao: r.plano.versao });
      emitir("mcp_store.install_finished", { id });
      return { ok: true };
    },

    async desinstalar(id, opcoes) {
      const e = entradaDe(id);
      const inst = d.repo.obterInstalado(id);
      if (!inst) return { ok: false, codigo: "nao_instalado", residuos: [] };
      if (d.emUso?.(id)) return { ok: false, codigo: "em_uso", residuos: [] };
      d.repo.gravarInstalado({ ...inst, estado: "removendo", atualizado_em: agora() });
      for (const c of d.repo.cliInstalacoesDe(id)) await d.cliUsuario?.remover(id, c.cli);
      const mcp = join(d.userData, "mcp");
      const pasta = join(mcp, id);
      await rm(pasta, { recursive: true, force: true });
      for (const sub of [".tmp", ".old"]) {
        try { for (const n of await readdir(join(mcp, sub))) if (n.startsWith(`${id}-`)) await rm(join(mcp, sub, n), { recursive: true, force: true }); } catch { /* sem pasta */ }
      }
      let apagados = 0;
      if (opcoes.apagar_segredos && e) apagados = await d.segredos.apagarServidor(e);
      d.repo.removerServidor(id);
      log(id, "info", "removido", { segredos_apagados: apagados });
      emitir("mcp_store.removed", { id });
      const residuos: string[] = [];
      if (await existe(pasta)) residuos.push(pastaRel(id));
      if (d.repo.obterInstalado(id) || d.repo.listarHabilitacoes({ servidor_id: id }).length > 0) residuos.push("banco");
      if (opcoes.apagar_segredos && e && (await d.segredos.definidas(e)).size > 0) residuos.push("cofre");
      return { ok: residuos.length === 0, residuos };
    },

    async gravarVariavel(id, nome, valor) {
      const e = entradaDe(id);
      if (!e) return { ok: false, codigo: "catalogo_desconhecido" };
      const r = await d.segredos.gravar(e, nome, valor);
      if (r.ok) d.repo.gravarVariavel({ servidor_id: id, nome, definida: true, atualizada_em: agora() });
      log(id, r.ok ? "info" : "aviso", "variavel_gravada", { nome, ok: r.ok, codigo: r.codigo });
      return r;
    },

    async apagarVariavel(id, nome) {
      const e = entradaDe(id);
      if (!e) return { ok: false };
      await d.segredos.apagar(e, nome);
      d.repo.gravarVariavel({ servidor_id: id, nome, definida: false, atualizada_em: agora() });
      // Servidor habilitado que deixa de estar configurado sai da política na hora (ver resolverServidoresLoja).
      return { ok: true };
    },

    async variaveisEstado(id) {
      const e = entradaDe(id);
      if (!e) return [];
      const definidas = await d.segredos.definidas(e);
      return e.variaveis.map((v) => ({ nome: v.nome, obrigatoria: v.obrigatoria, secreta: v.secreta, definida: definidas.has(v.nome) }));
    },

    async testar(id, opcoes = {}) {
      const e = entradaDe(id);
      const inst = d.repo.obterInstalado(id);
      if (!e || !inst || inst.estado !== "instalado") return { estado: "indisponivel", n_ferramentas: 0, latencia_ms: 0, erro: "nao_instalado", variaveis_faltando: [] };
      return medirSaude(e, opcoes.workspace);
    },

    async habilitar(id, alvo_tipo, alvo_valor, habilitado) {
      if (typeof alvo_valor !== "string" || alvo_valor === "" || alvo_valor.length > 200 || !["workspace", "missao", "agente"].includes(alvo_tipo)) return { ok: false, codigo: "alvo_invalido" };
      const e = entradaDe(id);
      if (habilitado) {
        if (!e) return { ok: false, codigo: "catalogo_desconhecido" };
        const inst = d.repo.obterInstalado(id);
        if (!inst || inst.estado !== "instalado") return { ok: false, codigo: "nao_instalado" };
        if (d.bloqueio?.consultarEntrada(e)) return { ok: false, codigo: "bloqueado" };
        const faltando = variaveisFaltando(e, await d.segredos.definidas(e));
        if (faltando.length > 0) return { ok: false, codigo: "nao_configurado", detalhe: faltando.join(",") };
      }
      d.repo.habilitar({ servidor_id: id, alvo_tipo, alvo_valor, habilitado, atualizado_em: agora() });
      emitir(habilitado ? "mcp_store.enabled" : "mcp_store.disabled", { id, alvo: { tipo: alvo_tipo, valor: alvo_valor } });
      return { ok: true };
    },

    habilitacoes(workspace) {
      const iso = isolamentoPorCli();
      return d.repo.listarHabilitacoes({ alvo_tipo: "workspace", alvo_valor: workspace }).map((h) => ({ ...h, isolamento: iso }));
    },

    aplicarBloqueio() {
      const afetados: string[] = [];
      if (!d.bloqueio) return afetados;
      for (const inst of d.repo.listarInstalados()) {
        const e = entradaDe(inst.servidor_id);
        if (!e || !d.bloqueio.consultarEntrada(e)) continue;
        for (const h of d.repo.listarHabilitacoes({ servidor_id: inst.servidor_id })) if (h.habilitado) d.repo.habilitar({ ...h, habilitado: false, atualizado_em: agora() });
        log(inst.servidor_id, "aviso", "bloqueado_desabilitado", {});
        afetados.push(inst.servidor_id);
      }
      return afetados;
    },

    async servidoresDoPane(alvo) {
      const instalados = new Map(d.repo.listarInstalados().map((r) => [r.servidor_id, r] as const));
      const definidas = new Map<string, ReadonlySet<string>>();
      const habilitacoes = d.repo.listarHabilitacoes();
      for (const id of new Set(habilitacoes.map((h) => h.servidor_id))) { const e = entradaDe(id); if (e && instalados.has(id)) definidas.set(id, await d.segredos.definidas(e)); }
      const politica = resolverServidoresLoja(alvo, { habilitacoes, instalados, catalogo: d.catalogo, ...(d.bloqueio ? { bloqueio: d.bloqueio } : {}), definidas });
      const servidores: ServidorLojaPane[] = [];
      for (const id of politica.servidores) {
        const e = entradaDe(id)!;
        const v = await d.segredos.valores(e);
        servidores.push({ entrada: e, definidas: definidas.get(id) ?? new Set(), publicos: v.publicos });
      }
      return { politica, servidores };
    },

    async saudePassiva() {
      const saida: SaudePassiva[] = [];
      for (const inst of d.repo.listarInstalados()) {
        const e = entradaDe(inst.servidor_id);
        if (!e || inst.estado !== "instalado") continue;
        let pasta_ok = true, executavel_ok = true;
        if (inst.metodo !== "remoto") {
          pasta_ok = await existe(join(d.userData, "mcp", inst.servidor_id));
          try { const c = montarComando(e, { userData: d.userData, plataforma, modo: "exibicao", ...(d.node ? { node: d.node } : {}) }); const alvo = c.args[0] && c.executavel === (d.node ?? process.execPath) ? c.args[0] : c.executavel; executavel_ok = alvo ? await acessivel(alvo) : false; } catch { executavel_ok = false; }
        }
        const hash = hashDoComando(e);
        saida.push({ id: inst.servidor_id, pasta_ok, executavel_ok, comando_hash_ok: hash === inst.comando_hash, atualizacao_disponivel: hash !== inst.comando_hash || inst.versao !== (e.instalacao.versao ?? "remoto"), bloqueado: !!d.bloqueio?.consultarEntrada(e) });
      }
      return saida;
    },

    async limparTmpOrfaos(idadeMs = 3_600_000) {
      const tmp = join(d.userData, "mcp", ".tmp");
      let n = 0;
      try {
        await mkdir(tmp, { recursive: true });
        for (const nome of await readdir(tmp)) {
          const s = await stat(join(tmp, nome));
          if (Date.now() - s.mtimeMs > idadeMs) { await rm(join(tmp, nome), { recursive: true, force: true }); n++; }
        }
      } catch { /* sem pasta: nada a limpar */ }
      return n;
    },
  };
}

async function existe(p: string): Promise<boolean> { try { await stat(p); return true; } catch { return false; } }
async function acessivel(p: string): Promise<boolean> { try { await access(p, constants.F_OK); return true; } catch { return false; } }
