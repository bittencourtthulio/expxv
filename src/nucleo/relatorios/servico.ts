// Fábrica `criarRelatorios` (T-19.03/22/23): compõe o pipeline fechar sprint -> pacote sobre PORTAS, repositório e armazenamento injetados. Nada roda no boot.
// Regras desta camada:
//  - gerar é IDEMPOTENTE por (hash dos fatos + modo + ajustes humanos): mesmo hash reaproveita o pacote; mudança gera `rN+1`; `rN` é imutável;
//  - fila SERIAL por workspace (duas sprints fechadas seguidas enfileiram); falha vira pacote `falhou` com motivo limpo e evento, nunca exceção para o chamador do gatilho;
//  - IA só com consentimento registrado e SOBRE FATOS saneados; texto de template é o piso; texto humano nunca é reescrito;
//  - aprovar/enviar/exportar são AÇÕES HUMANAS (entram só pelos canais `relatorios:*`); nada é publicado; envio a canal externo exige pacote aprovado + item aprovado + consentimento do canal;
//  - todo texto que sai passa por `limparTexto` (cofre, segredos, caminho absoluto); escrita só em `<pasta do produto>/relatorios/**` do workspace ou na pasta que a pessoa escolheu.
import type { EventoAgil } from "../../compartilhado/agil";
import {
  CANAIS_DIVULGACAO, LIMITES_VARIANTE, VERSAO_CONSENTIMENTO_ENVIO,
  type CanalDivulgacao, type ConfigRelatorios, type EnvioDivulgacao, type EscopoRelatorio, type EstadoCanalDivulgacao, type FatosSprint, type FiltroPacotes, type OpcoesGerarRelatorio,
  type PacoteDetalhe, type PacoteResumo, type PreviaPacote, type ResultadoExportarRel, type SprintCandidata, type VarianteDivulgacao,
} from "../../compartilhado/relatorios";
import { configPadrao, consentimentoCanalValido, mesclarConfig } from "./config";
import { invalido, naoEncontrado, regraViolada, semConsentimento } from "./erros";
import { validarDestino, rotuloDoDestino } from "./exportar/destino";
import { exportarPasta, exportarZip } from "./exportar/escrever";
import { criarArmazenamento, refPacote, type Armazenamento } from "./exportar/armazenamento";
import { coletarFatos } from "./fatos/coletar";
import { resumoRedes } from "./formatos/divulgacao";
import { lerPacoteJson } from "./formatos/json";
import { portasIndisponiveis, type PortasRelatorios } from "./portas";
import { entradasDe, montarArquivos, montarManifesto, type ArquivoGerado } from "./pacote/montar";
import { BLOCOS_TECNICOS, BLOCOS_USUARIO, montarBlocos } from "./redacao/deterministico";
import { redigirComIa } from "./redacao/llm";
import { verificarBlocos } from "./redacao/verificar";
import { criarRepoMemoria, type RegistroPacote, type RepoRelatorios } from "./repos";
import { limparLinha, limparTexto, nomeDePacoteValido } from "./seguranca";
import { criarGeradorId, isoDe, jsonCanonico, relogioSistema, sha256, truncarPalavra, type GeradorId, type Relogio } from "./util";

const MAX_PREVIA = 5 * 1024 * 1024;
const ceder = (): Promise<void> => new Promise((r) => setImmediate(r));

export interface OpcoesRelatorios {
  portas?: Partial<PortasRelatorios>;
  repo?: RepoRelatorios;
  armazenamento?: Armazenamento;
  relogio?: Relogio;
  id?: GeradorId;
  /** só para o main: emite o evento IPC de andamento. */
  aoMudar?: (e: import("../../compartilhado/relatorios").EventoRelatoriosIpc) => void;
}
export type EscolherPasta = () => Promise<string | null>;

export function criarRelatorios(o: OpcoesRelatorios = {}) {
  const portas: PortasRelatorios = { ...portasIndisponiveis(), ...(o.portas ?? {}) };
  const repo = o.repo ?? criarRepoMemoria();
  const relogio = o.relogio ?? relogioSistema;
  const novoId = o.id ?? criarGeradorId(relogio);
  const armaz = o.armazenamento ?? criarArmazenamento({ raizDe: (ws) => portas.workspace.raiz(ws) });
  const agora = (): string => isoDe(relogio());
  const aoMudar = (e: import("../../compartilhado/relatorios").EventoRelatoriosIpc): void => { try { o.aoMudar?.(e); } catch { /* UI nunca derruba o fluxo */ } };
  const publicar = (tipo: string, p: Record<string, unknown>): void => { try { portas.eventos.publicar(tipo, p); } catch { /* integrações nunca derrubam o fluxo */ } };

  // ------------------------------------------------------------------ fila serial por workspace
  const filas = new Map<string, Promise<unknown>>();
  const pendentes = new Set<Promise<unknown>>();
  function emFila<T>(ws: string, fn: () => Promise<T>): Promise<T> {
    const anterior = filas.get(ws) ?? Promise.resolve();
    const p = anterior.then(fn, fn);
    const seguro = p.catch(() => undefined);
    filas.set(ws, seguro);
    pendentes.add(seguro);
    void seguro.then(() => { pendentes.delete(seguro); if (filas.get(ws) === seguro) filas.delete(ws); });
    return p;
  }

  // ------------------------------------------------------------------ config
  const configLer = (ws: string): ConfigRelatorios => ({ ...configPadrao(), ...(repo.configObter(ws) ?? {}) });
  function configGravar(ws: string, parcial: unknown): ConfigRelatorios {
    const c = mesclarConfig(configLer(ws), parcial);
    repo.configGravar(ws, c, agora());
    return c;
  }
  function consentimentoLlm(ws: string, consentido: boolean): ConfigRelatorios {
    const c = { ...configLer(ws), consentimento_llm_em: consentido ? agora() : null };
    repo.configGravar(ws, c, agora());
    return c;
  }

  // ------------------------------------------------------------------ leitura
  const resumo = (p: RegistroPacote): PacoteResumo => ({
    id: p.id, workspace_id: p.workspace_id, sprint_id: p.sprint_id, titulo: p.titulo, versao: p.versao, versao_lancamento: p.versao_lancamento, estado: p.estado, etapa: p.etapa, modo_redacao: p.modo_redacao,
    revisao_usuario: p.revisao_usuario, aprovado_em: p.aprovado_em, avisos_qtd: p.avisos.length, bytes: p.bytes, gerado_em: p.gerado_em, pasta_ref: p.pasta_ref,
  });
  /** TODO id citado é conferido contra o workspace do pedido: vazamento entre workspaces é falha, não opção. */
  function pacote(ws: string, id: string): RegistroPacote {
    const p = repo.pacoteObter(id);
    if (p === undefined || p.workspace_id !== ws) throw naoEncontrado("pacote não encontrado");
    return p;
  }
  async function lerJson(ws: string, p: RegistroPacote) {
    const t = await armaz.ler(ws, p.pasta_ref, "pacote.json");
    if (t === null) throw naoEncontrado("arquivos do pacote não encontrados na pasta do projeto");
    return lerPacoteJson(t);
  }

  async function sprints(ws: string): Promise<SprintCandidata[]> {
    const fechadas = await portas.agil.sprintsFechadas(ws);
    return fechadas.map((s) => {
      const p = repo.pacotesListar(ws, { sprint_id: s.id })[0];
      return { id: s.id, nome: limparLinha(s.nome, portas.scrub, 120), fechada_em: s.fechada_em, versao_lancamento: s.versao_lancamento, pacote_atual: p ? { id: p.id, versao: p.versao, estado: p.estado } : null };
    });
  }
  const listar = (ws: string, f: FiltroPacotes = {}): PacoteResumo[] => repo.pacotesListar(ws, f).map(resumo);

  async function ler(ws: string, id: string): Promise<PacoteDetalhe> {
    const p = pacote(ws, id);
    const ajustes = repo.ajustesListar(ws, p.sprint_id);
    let blocos: PacoteDetalhe["blocos_usuario"] = [];
    if (p.estado === "pronto") {
      try {
        const j = await lerJson(ws, p);
        blocos = j.blocos.filter((b) => b.publico === "usuario").map((b) => ({ id: b.id, titulo: b.titulo, texto: b.afirmacoes.map((a) => a.texto).join("\n"), origem: b.origem, precisa_revisao: b.precisa_revisao, ajustado: ajustes.has(b.id) }));
      } catch { /* sem arquivos: a lista de revisão fica vazia e o aviso aparece na UI */ }
    }
    return { ...resumo(p), arquivos: repo.arquivosListar(id), avisos: p.avisos, verificacao: p.verificacao, metricas: p.metricas, motivo_falha: p.motivo_falha, blocos_usuario: blocos };
  }

  async function previa(ws: string, id: string, nome: string): Promise<PreviaPacote> {
    const p = pacote(ws, id);
    if (!nomeDePacoteValido(nome)) throw invalido("nome de arquivo inválido");
    const a = repo.arquivosListar(id).find((x) => x.nome === nome);
    if (a === undefined) throw naoEncontrado("arquivo não faz parte do pacote");
    if (a.bytes > MAX_PREVIA) throw regraViolada("arquivo grande demais para a prévia");
    const t = await armaz.ler(ws, p.pasta_ref, nome);
    if (t === null) throw naoEncontrado("arquivo não encontrado na pasta do projeto");
    return { conteudo: t, tipo: a.formato === "html" ? "html" : "texto", bytes: Buffer.byteLength(t, "utf8"), integro: sha256(t) === a.sha256 };
  }

  // ------------------------------------------------------------------ geração
  interface Preparo { fatos: FatosSprint; hash: string; ajustes: Map<string, string>; hashGeracao: string; usarIa: boolean }
  async function preparar(ws: string, escopo: EscopoRelatorio, opcoes: OpcoesGerarRelatorio): Promise<Preparo> {
    const cfg = configLer(ws);
    const coleta = await coletarFatos(portas, ws, escopo.sprint_id);
    if (coleta === null) throw naoEncontrado("sprint não encontrada neste workspace");
    let { fatos } = coleta;
    if (opcoes.versao_lancamento !== undefined) fatos = { ...fatos, sprint: { ...fatos.sprint, versao_lancamento: opcoes.versao_lancamento === null ? null : limparLinha(opcoes.versao_lancamento, portas.scrub, 40) || null } };
    const hash = sha256(jsonCanonico(fatos));
    const ajustes = repo.ajustesListar(ws, escopo.sprint_id);
    const modo = opcoes.redacao_modo ?? cfg.redacao_modo;
    const usarIa = modo !== "template" && cfg.consentimento_llm_em !== null;
    const hashGeracao = sha256(jsonCanonico({ hash, ia: usarIa, ajustes: [...ajustes].sort(([a], [b]) => (a < b ? -1 : 1)), cfg: { bom: cfg.csv_bom, hashtags: cfg.hashtags, cta: cfg.cta }, v: 1 }));
    return { fatos, hash, ajustes, hashGeracao, usarIa };
  }

  /** `soSeIa`: roda a IA ANTES de abrir o registro e só cria versão nova se algum bloco foi aceito (narrativa em segundo plano). */
  async function gerarInterno(ws: string, escopo: EscopoRelatorio, opcoes: OpcoesGerarRelatorio, soSeIa = false): Promise<{ pacote_id: string | null; reaproveitado: boolean }> {
    const pr = await preparar(ws, escopo, opcoes);
    const existente = repo.pacotePorGeracao(ws, escopo.sprint_id, pr.hashGeracao);
    if (existente !== undefined) return { pacote_id: existente.id, reaproveitado: true };
    const cfg = configLer(ws);
    const modoBloco: Record<string, "template" | "llm" | "humano"> = {};
    let blocos = montarBlocos(pr.fatos, pr.ajustes);
    let avisosIa: string[] = [];
    let blocosIa: string[] = [];
    let tokens: number | null = null;
    if (soSeIa) {
      if (!pr.usarIa) return { pacote_id: null, reaproveitado: false };
      const r = await redigirComIa({ portas, workspaceId: ws, fatos: pr.fatos, blocos, consentimento: cfg.consentimento_llm_em !== null });
      if (r.blocos_ia.length === 0) return { pacote_id: null, reaproveitado: false };
      ({ blocos, blocos_ia: blocosIa, avisos: avisosIa, tokens } = r);
    }
    const versao = repo.ultimaVersao(ws, escopo.sprint_id) + 1;
    const id = novoId("rel");
    const reg: RegistroPacote = {
      id, workspace_id: ws, sprint_id: escopo.sprint_id, titulo: `${pr.fatos.sprint.nome} — r${versao}`, versao, versao_lancamento: pr.fatos.sprint.versao_lancamento, hash_fatos: pr.hash, hash_geracao: pr.hashGeracao,
      modo_redacao: "template", modo_bloco: {}, estado: "gerando", etapa: "coletar", revisao_usuario: "rascunho", aprovado_em: null, pasta_ref: refPacote(escopo.sprint_id, versao), bytes: 0, avisos: [], metricas: {},
      verificacao: null, motivo_falha: null, gerado_em: agora(),
    };
    repo.pacoteInserir(reg);
    const etapa = (e: string): void => { repo.pacoteAtualizar(id, { etapa: e }); aoMudar({ tipo: "gerando", workspace_id: ws, pacote_id: id, sprint_id: escopo.sprint_id, etapa: e, quando: agora() }); };
    aoMudar({ tipo: "gerando", workspace_id: ws, pacote_id: id, sprint_id: escopo.sprint_id, etapa: "coletar", quando: agora() });
    publicar("relatorio.gerando", { workspace_id: ws, sprint_id: escopo.sprint_id, pacote_id: id, versao });
    try {
      await ceder();
      if (!soSeIa && pr.usarIa) {
        etapa("redigir");
        const r = await redigirComIa({ portas, workspaceId: ws, fatos: pr.fatos, blocos, consentimento: cfg.consentimento_llm_em !== null });
        ({ blocos, blocos_ia: blocosIa, avisos: avisosIa, tokens } = r);
      }
      for (const b of blocos) modoBloco[b.id] = b.origem;
      etapa("verificar");
      await ceder();
      const verificacao = verificarBlocos(pr.fatos, blocos);
      const avisos = [...pr.fatos.avisos, ...avisosIa, ...verificacao.violacoes.slice(0, 12).map((v) => `Verificação ${v.regra} em ${v.bloco}: ${limparLinha(v.detalhe, portas.scrub, 160)}`), ...(tokens === null ? [] : [])];
      etapa("renderizar");
      const entrada = { fatos: pr.fatos, hash_fatos: pr.hash, blocos, verificacao, modo_bloco: modoBloco, cfg, gerado_em: reg.gerado_em, revisao: "rascunho" as const, avisos };
      const arquivos = montarArquivos(entrada);
      const modo = blocosIa.length > 0 ? "misto" : "template";
      const manifesto = montarManifesto({ entradas: entradasDe(arquivos), versao, hash_fatos: pr.hash, gerado_em: reg.gerado_em, modo_redacao: modo, modo_bloco: modoBloco, avisos });
      etapa("gravar");
      await armaz.gravarPacote(ws, reg.pasta_ref, [...arquivos.map((a) => ({ nome: a.nome, conteudo: a.conteudo })), { nome: "manifesto.json", conteudo: manifesto }]);
      const m = pr.fatos.metricas;
      repo.transacao(() => {
        repo.arquivosSubstituir(id, arquivos.map((a) => ({ nome: a.nome, formato: a.formato, publico: a.publico, sha256: sha256(a.conteudo), bytes: Buffer.byteLength(a.conteudo, "utf8"), revisao: a.revisao })));
        repo.pacoteAtualizar(id, {
          estado: "pronto", etapa: null, modo_redacao: modo, modo_bloco: modoBloco, avisos, verificacao, bytes: arquivos.reduce((s, a) => s + Buffer.byteLength(a.conteudo, "utf8"), 0),
          metricas: { ...m, custo_usd: pr.fatos.custo.usd, custo_tokens: pr.fatos.custo.tokens, tokens_redacao: tokens },
        });
      });
      aoMudar({ tipo: "pronto", workspace_id: ws, pacote_id: id, sprint_id: escopo.sprint_id, versao, quando: agora() });
      publicar("relatorio.pronto", { workspace_id: ws, sprint_id: escopo.sprint_id, pacote_id: id, versao, pontos_entregues: m.pontos_entregues, itens: m.itens_entregues, avisos_qtd: avisos.length });
    } catch (e) {
      const motivo = limparLinha(e instanceof Error ? e.message : "falha desconhecida", portas.scrub, 200);
      repo.pacoteAtualizar(id, { estado: "falhou", etapa: null, motivo_falha: motivo });
      aoMudar({ tipo: "falhou", workspace_id: ws, pacote_id: id, sprint_id: escopo.sprint_id, motivo, quando: agora() });
      publicar("relatorio.falhou", { workspace_id: ws, sprint_id: escopo.sprint_id, pacote_id: id, versao, motivo });
    }
    return { pacote_id: id, reaproveitado: false };
  }

  const gerar = (ws: string, escopo: EscopoRelatorio, opcoes: OpcoesGerarRelatorio = {}): Promise<{ pacote_id: string; reaproveitado: boolean }> =>
    emFila(ws, async () => { const r = await gerarInterno(ws, escopo, opcoes); return { pacote_id: r.pacote_id as string, reaproveitado: r.reaproveitado }; });
  async function regenerar(ws: string, id: string): Promise<{ pacote_id: string; reaproveitado: boolean }> {
    const p = pacote(ws, id);
    return gerar(ws, { tipo: "sprint", sprint_id: p.sprint_id });
  }

  /** gatilho `sprint.fechada` (Fase 18): template primeiro (rápido, local); narrativa por IA depois, só com consentimento e modo ≠ template. */
  function aoFecharSprint(ev: EventoAgil): Promise<void> {
    if (ev.tipo !== "sprint.fechada" || ev.sprint_id === null) return Promise.resolve();
    const ws = ev.workspace_id;
    const sprintId = ev.sprint_id;
    if (!configLer(ws).gerar_ao_fechar) return Promise.resolve();
    const escopo: EscopoRelatorio = { tipo: "sprint", sprint_id: sprintId };
    const versaoLanc = typeof ev.dados["versao_lancamento"] === "string" ? (ev.dados["versao_lancamento"] as string) : undefined;
    const p1 = emFila(ws, () => gerarInterno(ws, escopo, { redacao_modo: "template", ...(versaoLanc ? { versao_lancamento: versaoLanc } : {}) }));
    const cfg = configLer(ws);
    const p2 = cfg.redacao_modo !== "template" && cfg.consentimento_llm_em !== null ? emFila(ws, () => gerarInterno(ws, escopo, { ...(versaoLanc ? { versao_lancamento: versaoLanc } : {}) }, true)) : Promise.resolve(null);
    return Promise.all([p1, p2]).then(() => undefined, () => undefined);
  }

  // ------------------------------------------------------------------ revisão humana
  function ajusteGravar(ws: string, sprintId: string, blocoId: string, texto: string | null): { ok: true } {
    if (![...BLOCOS_USUARIO, ...BLOCOS_TECNICOS].includes(blocoId as never)) throw invalido("bloco desconhecido");
    if (repo.ultimaVersao(ws, sprintId) === 0) throw naoEncontrado("sprint sem pacote neste workspace");
    if (texto === null || texto.trim() === "") { repo.ajusteApagar(ws, sprintId, blocoId); return { ok: true }; }
    const limpo = texto.split(/\r?\n/).map((l) => limparLinha(l, portas.scrub, 600)).filter(Boolean).join("\n");
    if (limpo === "") throw invalido("o texto ficou vazio depois da limpeza de segredos e caminhos");
    repo.ajusteGravar(ws, sprintId, blocoId, limpo.slice(0, 4000), agora());
    return { ok: true };
  }

  async function aprovar(ws: string, id: string, aprovarFlag: boolean): Promise<PacoteResumo> {
    const p = pacote(ws, id);
    if (p.estado !== "pronto") throw regraViolada("só um pacote pronto pode ser aprovado");
    if (aprovarFlag) {
      const bloqueios = (p.verificacao?.violacoes ?? []).filter((v) => v.bloco.startsWith("u_") || v.bloco === "usuario");
      if (bloqueios.length > 0) throw regraViolada(`o texto do cliente ainda tem ${bloqueios.length} problema(s) de linguagem ou cobertura: corrija e gere de novo antes de aprovar`);
    }
    const j = await lerJson(ws, p);
    const cfg = configLer(ws);
    const revisao = aprovarFlag ? "aprovado" : "rascunho";
    const arquivos: ArquivoGerado[] = montarArquivos({ fatos: j.fatos, hash_fatos: j.hash_fatos, blocos: j.blocos, verificacao: j.verificacao, modo_bloco: j.modo_bloco, cfg, gerado_em: p.gerado_em, revisao, avisos: p.avisos });
    const cliente = arquivos.filter((a) => a.publico === "cliente");
    // só os arquivos do cliente mudam (a faixa de rascunho/aprovado); os demais mantêm o que JÁ está no disco e no registro (a config pode ter mudado desde a geração)
    const novasLinhas = new Map(entradasDe(cliente).map((e) => [e.nome, e]));
    const existentes = repo.arquivosListar(id);
    const linhas = existentes.map((a) => { const n = novasLinhas.get(a.nome); return n === undefined ? a : { ...a, sha256: n.sha256, bytes: n.bytes, revisao: revisao as "rascunho" | "aprovado" }; });
    const manifesto = montarManifesto({ entradas: linhas.map((a) => ({ nome: a.nome, sha256: a.sha256, bytes: a.bytes })), versao: p.versao, hash_fatos: j.hash_fatos, gerado_em: p.gerado_em, modo_redacao: p.modo_redacao, modo_bloco: p.modo_bloco, avisos: p.avisos });
    await armaz.substituirArquivos(ws, p.pasta_ref, [...cliente.map((a) => ({ nome: a.nome, conteudo: a.conteudo })), { nome: "manifesto.json", conteudo: manifesto }]);
    repo.transacao(() => {
      repo.arquivosSubstituir(id, linhas);
      repo.pacoteAtualizar(id, { revisao_usuario: revisao, aprovado_em: aprovarFlag ? agora() : null });
    });
    if (aprovarFlag) { aoMudar({ tipo: "aprovado", workspace_id: ws, pacote_id: id, quando: agora() }); publicar("relatorio.aprovado", { workspace_id: ws, sprint_id: p.sprint_id, pacote_id: id, versao: p.versao }); }
    return resumo(pacote(ws, id));
  }

  // ------------------------------------------------------------------ exportação (ação explícita; destino escolhido pela pessoa)
  async function exportar(ws: string, id: string, nomes: string[] | "todos", modo: "pasta" | "zip", escolher: EscolherPasta): Promise<ResultadoExportarRel> {
    const p = pacote(ws, id);
    if (p.estado !== "pronto") throw regraViolada("só um pacote pronto pode ser exportado");
    const disponiveis = repo.arquivosListar(id);
    const alvo = nomes === "todos" ? disponiveis : nomes.map((n) => disponiveis.find((a) => a.nome === n) ?? (() => { throw naoEncontrado("arquivo não faz parte do pacote"); })());
    if (alvo.length === 0) throw invalido("nenhum arquivo escolhido");
    const conteudos: { nome: string; conteudo: string }[] = [];
    for (const a of alvo) {
      const t = await armaz.ler(ws, p.pasta_ref, a.nome);
      if (t === null) throw naoEncontrado(`arquivo ausente: ${a.nome}`);
      if (sha256(t) !== a.sha256) throw regraViolada(`o arquivo ${a.nome} foi alterado fora do app: gere o pacote de novo`);
      conteudos.push({ nome: a.nome, conteudo: t });
    }
    if (nomes === "todos") { const m = await armaz.ler(ws, p.pasta_ref, "manifesto.json"); if (m !== null) conteudos.push({ nome: "manifesto.json", conteudo: m }); }
    const bruto = await escolher();
    if (bruto === null) return { cancelado: true, destino_rotulo: null, arquivos: [], bytes: 0 };
    const destino = await validarDestino(bruto, portas.workspace.raiz(ws));
    const nome = `relatorio-${p.sprint_id}-r${p.versao}`;
    const r = modo === "zip" ? await exportarZip(destino, nome, conteudos, new Date(relogio())) : await exportarPasta(destino, nome, conteudos);
    repo.exportacaoInserir({ id: novoId("exp"), pacote_id: id, modo, destino, arquivos: conteudos.map((c) => c.nome), bytes: r.bytes, em: agora() });
    return { cancelado: false, destino_rotulo: `${rotuloDoDestino(destino)}/${r.nome}`, arquivos: conteudos.map((c) => c.nome), bytes: r.bytes };
  }

  // ------------------------------------------------------------------ divulgação (fila por canal; nada sai sem aprovação + consentimento)
  async function estadoCanais(ws: string): Promise<EstadoCanalDivulgacao[]> {
    const cfg = configLer(ws);
    const disp = await portas.canais.disponiveis(ws).catch((): CanalDivulgacao[] => []);
    return CANAIS_DIVULGACAO.map((canal) => {
      const disponivel = disp.includes(canal);
      const consentido = consentimentoCanalValido(cfg, canal);
      return { canal, disponivel, consentido, motivo: !disponivel ? "Canal ainda não configurado neste app." : !consentido ? "Falta o seu consentimento para enviar por este canal." : null };
    });
  }
  async function consentimentoCanal(ws: string, canal: CanalDivulgacao, consentido: boolean): Promise<EstadoCanalDivulgacao[]> {
    if (!CANAIS_DIVULGACAO.includes(canal)) throw invalido("canal desconhecido");
    const c = configLer(ws);
    const mapa = { ...c.consentimento_canais };
    if (consentido) mapa[canal] = { aceito_em: agora(), versao_texto: VERSAO_CONSENTIMENTO_ENVIO }; else delete mapa[canal];
    repo.configGravar(ws, { ...c, consentimento_canais: mapa }, agora());
    return estadoCanais(ws);
  }
  function envio(ws: string, id: string): EnvioDivulgacao {
    const e = repo.envioObter(id);
    if (e === undefined || e.workspace_id !== ws) throw naoEncontrado("item da fila não encontrado");
    return e;
  }
  const fila = (ws: string, pacoteId: string): EnvioDivulgacao[] => { pacote(ws, pacoteId); return repo.enviosListar(pacoteId); };
  async function enfileirar(ws: string, pacoteId: string, canal: CanalDivulgacao, variante: VarianteDivulgacao): Promise<EnvioDivulgacao> {
    if (!CANAIS_DIVULGACAO.includes(canal)) throw invalido("canal desconhecido");
    const p = pacote(ws, pacoteId);
    if (p.estado !== "pronto") throw regraViolada("só um pacote pronto pode gerar divulgação");
    const j = await lerJson(ws, p);
    const cfg = configLer(ws);
    const limite = LIMITES_VARIANTE[variante];
    let texto = limparTexto(resumoRedes(j.fatos, cfg)[variante], portas.scrub, 2000);
    if (texto.length > limite) texto = truncarPalavra(texto, limite);
    const e: EnvioDivulgacao = { id: novoId("env"), pacote_id: pacoteId, workspace_id: ws, canal, variante, texto, estado: "rascunho", criado_em: agora(), enviado_em: null, erro: null };
    repo.envioInserir(e);
    aoMudar({ tipo: "divulgacao_mudou", workspace_id: ws, pacote_id: pacoteId, quando: agora() });
    return e;
  }
  function aprovarEnvio(ws: string, id: string, aprovarFlag: boolean): EnvioDivulgacao {
    const e = envio(ws, id);
    if (e.estado !== "rascunho" && e.estado !== "aprovado") throw regraViolada("este item já foi enviado ou cancelado");
    if (aprovarFlag && pacote(ws, e.pacote_id).revisao_usuario !== "aprovado") throw regraViolada("aprove primeiro o relatório do cliente");
    repo.envioAtualizar(id, { estado: aprovarFlag ? "aprovado" : "rascunho" });
    aoMudar({ tipo: "divulgacao_mudou", workspace_id: ws, pacote_id: e.pacote_id, quando: agora() });
    return envio(ws, id);
  }
  async function enviar(ws: string, id: string): Promise<EnvioDivulgacao> {
    const e = envio(ws, id);
    if (e.estado === "enviado") throw regraViolada("este item já foi enviado");
    if (e.estado !== "aprovado" && e.estado !== "falhou") throw regraViolada("aprove o item antes de enviar");
    if (pacote(ws, e.pacote_id).revisao_usuario !== "aprovado") throw regraViolada("o relatório do cliente não está aprovado");
    if (!consentimentoCanalValido(configLer(ws), e.canal)) throw semConsentimento("falta o consentimento para enviar por este canal");
    const disp = await portas.canais.disponiveis(ws).catch((): CanalDivulgacao[] => []);
    if (!disp.includes(e.canal)) throw regraViolada("o canal não está disponível neste app");
    const texto = limparTexto(e.texto, portas.scrub, 2000); // última barreira: segredo/caminho nunca saem
    let r: { ok: boolean; erro: string | null };
    try { r = await portas.canais.enviar(ws, e.canal, texto); } catch { r = { ok: false, erro: "falha ao enviar" }; }
    repo.envioAtualizar(id, r.ok ? { estado: "enviado", enviado_em: agora(), erro: null } : { estado: "falhou", erro: limparLinha(r.erro ?? "falha ao enviar", portas.scrub, 160) });
    aoMudar({ tipo: "divulgacao_mudou", workspace_id: ws, pacote_id: e.pacote_id, quando: agora() });
    return envio(ws, id);
  }
  function cancelarEnvio(ws: string, id: string): EnvioDivulgacao {
    const e = envio(ws, id);
    if (e.estado === "enviado") throw regraViolada("este item já foi enviado");
    repo.envioAtualizar(id, { estado: "cancelado" });
    aoMudar({ tipo: "divulgacao_mudou", workspace_id: ws, pacote_id: e.pacote_id, quando: agora() });
    return envio(ws, id);
  }

  return {
    portas, repo, armazenamento: armaz,
    configLer, configGravar, consentimentoLlm, sprints, listar, ler, previa, gerar, regenerar, aoFecharSprint, ajusteGravar, aprovar, exportar,
    divulgacao: { estado: estadoCanais, consentimento: consentimentoCanal, fila, enfileirar, aprovar: aprovarEnvio, enviar, cancelar: cancelarEnvio },
    /** espera a fila (testes e encerramento). */
    async aguardar(): Promise<void> { while (pendentes.size > 0) await Promise.all([...pendentes]); },
  };
}
export type Relatorios = ReturnType<typeof criarRelatorios>;
