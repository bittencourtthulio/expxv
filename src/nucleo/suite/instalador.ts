// Orquestração da instalação da suíte ExpxDev (D-472…D-476), sem Electron: requisitos → baixa o instalador (cwd NEUTRO) → roda `init` no projeto
// → confere (diff da árvore, `doctor`, lock). Todo processo passa por `executarProcesso` (sem shell, stdin fechado, timeouts, árvore morta no cancelamento).
import { access, constants, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { detectarSuite } from "./detectar";
import { compararManifestos, copiarBackup, criarManifesto, devolverArquivosDoUsuario, limparCriados, type DiferencaManifesto, type Manifesto } from "./manifesto";
import { estadoInicial, percentualDe, reduzir, terminal, type EstadoInstalacao } from "./maquina";
import {
  LIMITES_SUITE, NODE_MINIMO_VERSAO, PACOTE_SUITE, REGISTRO_PADRAO, SKILLS_DA_SUITE, comTil, dentroDe, mascararCaminho, nodeAtende, type CausaFalhaSuite, type EtapaSuiteId, type FalhaSuite,
  type ModoInstalacao, type ProgressoSuite, type ResumoSuite,
} from "./modelo";
import { argumentosDownload, argumentosInit, ambienteNpm, comandoNpm, lerCatalogoDoPacote, lerVersao, resolverFerramentas, skillsParaInstalar, type Ferramentas } from "./plano";
/** Sondagem opcional do registro (injetada; o app NÃO tem código de rede próprio, D-24/D-25: quem fala com o registro é o npm, e o erro dele é classificado). */
export type ResultadoSonda = { ok: true } | { ok: false; causa: "sem_internet" | "registro_inacessivel"; detalhe: string };
import { executarProcesso, type PedidoProcesso, type ResultadoProcesso } from "./processo";
import { criarCauda, linhaDeLog, redigir } from "./saida";

export interface DependenciasInstalador {
  workspace_id: string;
  instalacao_id: string;
  /** raiz do workspace (vem do main, nunca do renderer) */
  raiz: string;
  modo: ModoInstalacao;
  versao: string;
  registro?: string;
  /** harness do `init` (padrão: claude e opencode) e flags extras do usuário (já validadas) */
  harness?: readonly string[];
  extras?: readonly string[];
  /** ambiente de origem (padrão: `process.env`) e demais injeções */
  ambienteOrigem?: NodeJS.ProcessEnv;
  ambiente: Record<string, string>;
  inicio?: string;
  plataforma?: NodeJS.Platform;
  scrub?: (texto: string) => string;
  /** pasta de dados do app (cópias de segurança ficam em `<pasta>/suite/backups/<workspace>/`) */
  pastaDados: string;
  /** pasta pai das temporárias (padrão: `os.tmpdir()`) */
  pastaTemporaria?: string;
  executar?: (p: PedidoProcesso) => Promise<ResultadoProcesso>;
  sondarRegistro?: (registro: string, sinal: AbortSignal) => Promise<ResultadoSonda>;
  agora?: () => number;
  tempoTotalMs?: number;
  silencioMs?: number;
  /** mudou o estado/log: o chamador coalesce e publica */
  aoMudar: (p: ProgressoSuite) => void;
  versaoDaApp?: string;
}

const msg = (causa: CausaFalhaSuite): { mensagem: string; sugestao: string } => {
  switch (causa) {
    case "sem_internet": return { mensagem: "Sem conexão com a internet.", sugestao: "Confira sua conexão (e proxy, se houver) e tente de novo." };
    case "registro_inacessivel": return { mensagem: "O registro npm (ou o repositório das skills no GitHub) não respondeu como esperado.", sugestao: "Tente de novo em instantes. Se você usa proxy ou rede corporativa, libere registry.npmjs.org e github.com." };
    case "sem_permissao": return { mensagem: "Sem permissão para gravar nesta pasta.", sugestao: "Ajuste as permissões da pasta do projeto (ou do cache do npm) e tente de novo." };
    case "node_ausente": return { mensagem: "O Node.js/npm não foi encontrado nesta máquina.", sugestao: `Instale o Node.js ${NODE_MINIMO_VERSAO} ou mais novo (nodejs.org), abra o app de novo e tente outra vez.` };
    case "git_ausente": return { mensagem: "O Git não foi encontrado nesta máquina (o instalador baixa cada skill com git).", sugestao: "Instale o Git (git-scm.com), abra o app de novo e tente outra vez." };
    case "versao_incompativel": return { mensagem: "A versão do Node.js é antiga demais.", sugestao: `Atualize o Node.js para a versão ${NODE_MINIMO_VERSAO} ou mais nova e tente de novo.` };
    case "tempo_esgotado": return { mensagem: "A instalação demorou mais que o limite (5 minutos) e foi encerrada.", sugestao: "Verifique a internet e tente de novo." };
    case "sem_resposta": return { mensagem: "O instalador ficou parado sem responder e foi encerrado.", sugestao: "Tente de novo. Se repetir, copie o diagnóstico e avise a equipe do app." };
    case "saida_excessiva": return { mensagem: "O instalador produziu texto demais e foi encerrado por segurança.", sugestao: "Tente de novo. Se repetir, copie o diagnóstico e avise a equipe do app." };
    case "pacote_invalido": return { mensagem: "O pacote baixado não confere com o esperado (nome, versão, catálogo de skills ou programa de instalação).", sugestao: "Tente de novo. Se persistir, copie o diagnóstico." };
    case "conferencia": return { mensagem: "A instalação terminou, mas a conferência final encontrou diferenças.", sugestao: "Use “Reparar suíte ExpxDev” para completar." };
    case "defeito_do_app": return { mensagem: "O instalador recusou o pedido que este app montou. Isso é um defeito do app, não algo que você fez ou precise corrigir.", sugestao: "Copie o diagnóstico e avise a equipe do app. Seu projeto não foi alterado pelo app além do que está descrito abaixo." };
    case "comando_falhou": return { mensagem: "O instalador terminou com erro.", sugestao: "Veja o log, tente de novo ou copie o diagnóstico." };
    case "interna": return { mensagem: "Algo inesperado aconteceu durante a instalação.", sugestao: "Tente de novo ou copie o diagnóstico." };
  }
};

const REDE = /ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ENETDOWN|getaddrinfo|network is unreachable|could not resolve host|unable to access|failed to connect|connection timed out|could not read from remote|early EOF/i;
/** Recusas do CLI a um pedido mal montado pelo app (flag que faltou ou sobrou): defeito do app. Testado com a saída real do `expxdev` 0.9.0. */
const DEFEITO = /nenhuma skill selecionada|opcao desconhecida em (init|update)|--skills exige|--harness exige|harness desconhecido|skill desconhecida/i;
const REGISTRO = /E40[0-9]|E50[0-9]|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND registry|unable to get local issuer|CERT_|SSL|TLS|404 Not Found|403 Forbidden|repository not found/i;
const PERMISSAO = /EACCES|EPERM|EROFS|permission denied|operation not permitted/i;

/** Classifica pela cauda do log (já redigida): rede → registro → permissão → comando falhou. */
export function classificarFalha(linhas: readonly string[]): CausaFalhaSuite {
  const t = linhas.join("\n");
  if (DEFEITO.test(t)) return "defeito_do_app";
  if (PERMISSAO.test(t)) return "sem_permissao";
  if (REDE.test(t)) return "sem_internet";
  if (REGISTRO.test(t)) return "registro_inacessivel";
  return "comando_falhou";
}

export interface ResultadoInstalacao {
  progresso: ProgressoSuite;
  diferenca: DiferencaManifesto | null;
}

export async function executarInstalacao(d: DependenciasInstalador, sinal: AbortSignal): Promise<ResultadoInstalacao> {
  const agora = d.agora ?? Date.now;
  const inicio = d.inicio ?? homedir();
  const plataforma = d.plataforma ?? process.platform;
  const executar = d.executar ?? executarProcesso;
  const registro = d.registro ?? REGISTRO_PADRAO;
  const iniciadoEm = agora();
  const prazo = iniciadoEm + (d.tempoTotalMs ?? LIMITES_SUITE.tempo_total_ms);
  const cauda = criarCauda();
  let estado: EstadoInstalacao = estadoInicial();
  let limpeza: string | null = null;
  let situacaoProjeto: string | null = null;
  let diagnostico: string | null = null;
  let manifestoAntes: Manifesto | null = null;
  let truncadoManifesto = false;
  let backupDir: string | null = null;
  let iniciouInit = false;
  let diferenca: DiferencaManifesto | null = null;
  let etapaAtual: EtapaSuiteId = "requisitos";
  let temp: string | null = null;
  let raizCanonica: string | null = null;

  const log = (bruta: string): void => {
    const l = linhaDeLog(bruta, d.scrub, inicio);
    if (l !== null) cauda.adicionar(l);
  };
  const aviso = (texto: string): void => { cauda.adicionar(`› ${texto}`); };
  const foto = (): ProgressoSuite => ({
    tipo: "progresso", instalacao_id: d.instalacao_id, workspace_id: d.workspace_id, modo: d.modo, versao: d.versao, fase: estado.fase, etapas: estado.etapas, percentual: percentualDe(estado),
    iniciado_em: iniciadoEm, decorrido_ms: Math.max(0, agora() - iniciadoEm), log: cauda.linhas(LIMITES_SUITE.log_evento_linhas), log_truncado: cauda.truncado(), resumo: estado.resumo,
    falha: estado.falha, limpeza, situacao_projeto: situacaoProjeto, diagnostico,
  });
  const publicar = (): void => { try { d.aoMudar(foto()); } catch { /* ouvinte com erro não derruba a instalação */ } };
  const aplicar = (ev: Parameters<typeof reduzir>[1]): void => { estado = reduzir(estado, ev); if (ev.t === "etapa") etapaAtual = ev.id; publicar(); };

  const falhar = (causa: CausaFalhaSuite, codigo: number | null, detalhe?: string): FalhaSuite => {
    const base = msg(causa);
    return { causa, mensagem: detalhe === undefined ? base.mensagem : `${base.mensagem} ${detalhe}`.trim(), sugestao: base.sugestao, codigo, etapa: etapaAtual };
  };
  const cancelado = (): boolean => sinal.aborted;

  /** Roda um processo; transforma a saída em log e em progresso da etapa (`esperadas` linhas ≈ 90%). */
  async function rodar(executavel: string, args: readonly string[], cwd: string, env: Record<string, string>, opc: { esperadas: number; tempoMs?: number }): Promise<ResultadoProcesso> {
    let linhas = 0;
    const restante = prazo - agora();
    if (restante <= 0) return { codigo: null, sinal: null, motivo: "tempo_total", erro: null, bytes: 0 };
    const r = await executar({
      executavel, argumentos: args, cwd, env, sinal,
      tempoTotalMs: Math.min(restante, opc.tempoMs ?? restante), silencioMs: d.silencioMs ?? LIMITES_SUITE.silencio_ms, maxBytes: LIMITES_SUITE.saida_maxima_bytes,
      plataforma,
      aoLinha: (linha) => {
        linhas += 1;
        log(linha);
        estado = reduzir(estado, { t: "sub", fracao: Math.min(0.9, linhas / opc.esperadas) });
        publicar();
      },
    });
    return r;
  }

  const finalizarFalha = async (f: FalhaSuite): Promise<void> => {
    // falha causada por cancelamento (processo morto pelo sinal) é cancelamento
    if (cancelado()) { await aposCancelamento(); return; }
    situacaoProjeto = await descreverSituacaoDoProjeto();
    aplicar({ t: "falhou", falha: f });
    diagnostico = montarDiagnostico();
    publicar();
  };

  /** Em falha: o projeto foi alterado? Sem alteração, a cópia de segurança (idêntica ao que está no projeto) é apagada. */
  async function descreverSituacaoDoProjeto(): Promise<string | null> {
    if (!iniciouInit || manifestoAntes === null || raizCanonica === null) return "O projeto não foi alterado.";
    try {
      const depois = await criarManifesto(raizCanonica);
      const dif = compararManifestos(manifestoAntes, depois.mapa);
      diferenca = dif;
      const mexeu = dif.criados.length + dif.alterados.length + dif.removidos.length;
      if (mexeu === 0) { await apagarBackup(); return "O projeto não foi alterado."; }
      const partes = [`${dif.criados.length} arquivo(s) criado(s)`, `${dif.alterados.length} alterado(s)`, `${dif.removidos.length} removido(s)`];
      const bk = backupDir === null ? "" : ` A cópia de segurança do que existia antes está em ${comTil(backupDir, inicio)}.`;
      return `A instalação deixou o projeto pela metade (${partes.join(", ")}).${bk} Use “Reparar suíte ExpxDev” para completar, ou desfaça pelo git.`;
    } catch { return null; }
  }

  async function apagarBackup(): Promise<void> {
    if (backupDir === null) return;
    await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    backupDir = null;
  }

  function montarDiagnostico(): string {
    const f = estado.falha;
    const linhas = [
      `Diagnóstico da instalação da suíte ExpxDev`,
      `app: ${d.versaoDaApp ?? "?"} | sistema: ${plataforma} | node do app: ${redigir(process.version, undefined, inicio)}`,
      `modo: ${d.modo} | versão pedida: ${d.versao} | registro: ${registro}`,
      `projeto: ${mascararCaminho(d.raiz, inicio)}`,
      `fase: ${estado.fase} | etapa: ${etapaAtual}${f === null ? "" : ` | causa: ${f.causa} | código: ${f.codigo ?? "—"}`}`,
      f === null ? "" : `mensagem: ${f.mensagem}`,
      `duração: ${Math.round((agora() - iniciadoEm) / 1000)} s`,
      "--- últimas linhas do log (sem segredos) ---",
      ...cauda.linhas(40),
    ];
    let texto = linhas.filter((l) => l !== "").join("\n");
    // o diagnóstico circula (chat, issue): nenhum caminho da máquina, só o fim da pasta do projeto
    const trocas: Array<[string | null, string]> = [[raizCanonica, mascararCaminho(raizCanonica ?? d.raiz, inicio)], [d.raiz, mascararCaminho(d.raiz, inicio)], [temp, "<pasta temporária>"], [d.pastaTemporaria ?? null, "<temporárias>"], [d.pastaDados, "<dados do app>"]];
    for (const [de, para] of trocas.sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0))) if (de !== null && de.length > 3) texto = texto.split(de).join(para);
    return redigir(texto, d.scrub, inicio);
  }

  async function aposCancelamento(): Promise<void> {
    if (iniciouInit && manifestoAntes !== null) {
      const depois = await criarManifesto(d.raiz);
      const r = await limparCriados(d.raiz, manifestoAntes, depois.mapa, backupDir);
      const partes = [`Removi ${r.removidos} arquivo(s) que a instalação tinha criado`];
      if (r.restaurados > 0) partes.push(`devolvi ${r.restaurados} arquivo(s) alterado(s) ou removido(s) a partir da cópia de segurança`);
      if (r.restantes.length === 0) await apagarBackup();
      limpeza = `${partes.join(" e ")}.${r.restantes.length > 0 ? ` Não foi possível desfazer: ${r.restantes.slice(0, 10).join(", ")}${r.restantes.length > 10 ? "…" : ""}. Confira esses arquivos${backupDir === null ? "" : ` (cópia de segurança em ${comTil(backupDir, inicio)})`}.` : " O projeto voltou ao que era."}`;
      situacaoProjeto = r.restantes.length === 0 ? "O projeto voltou ao que era antes da instalação." : null;
    } else {
      limpeza = "A instalação foi cancelada antes de gravar qualquer coisa no projeto.";
      situacaoProjeto = "O projeto não foi alterado.";
      await apagarBackup();
    }
    aplicar({ t: "cancelada" });
    diagnostico = montarDiagnostico();
    publicar();
  }

  const rodarVersao = (exe: string, args: readonly string[]): Promise<string | null> =>
    lerVersao({ executavel: exe, argumentos: args, cwd: temp ?? tmpdir(), env: d.ambiente, executar, sinal, plataforma });

  try {
    publicar();
    // pasta temporária NEUTRA: cwd do download e `--prefix`; também guarda os `.npmrc` vazios
    const paiTemp = d.pastaTemporaria ?? tmpdir();
    temp = await mkdtemp(join(paiTemp, "suite-"));
    temp = await realpath(temp);
    await writeFile(join(temp, "npmrc-usuario-vazio"), "", { mode: 0o600 });
    await writeFile(join(temp, "npmrc-global-vazio"), "", { mode: 0o600 });
    const raizReal = await realpath(d.raiz);
    raizCanonica = raizReal;
    const ambiente = d.ambiente;

    // ------------------------------------------------ 1) requisitos
    aplicar({ t: "etapa", id: "requisitos" });
    const f: Ferramentas = resolverFerramentas(ambiente, temp, plataforma);
    const cmdNpm = comandoNpm(f, plataforma);
    if (f.node === null || cmdNpm === null) { await finalizarFalha(falhar("node_ausente", null)); return { progresso: foto(), diferenca }; }
    const vNode = await rodarVersao(f.node, ["--version"]);
    if (vNode === null) { await finalizarFalha(falhar("node_ausente", null)); return { progresso: foto(), diferenca }; }
    log(`node ${vNode}`);
    if (!nodeAtende(vNode)) { await finalizarFalha(falhar("versao_incompativel", null, `(encontrada ${vNode}).`)); return { progresso: foto(), diferenca }; }
    // o `init` baixa cada skill com `git clone`: sem git não há instalação
    const vGit = f.git === null ? null : await rodarVersao(f.git, ["--version"]);
    if (vGit === null) { await finalizarFalha(falhar("git_ausente", null)); return { progresso: foto(), diferenca }; }
    log(vGit);
    aplicar({ t: "sub", fracao: 0.3 });
    const vNpm = await rodarVersao(cmdNpm.executavel, [...cmdNpm.prefixo, "--version"]);
    if (vNpm === null) { await finalizarFalha(falhar("node_ausente", null)); return { progresso: foto(), diferenca }; }
    log(`npm ${vNpm}`);
    aplicar({ t: "sub", fracao: 0.5 });
    try { await access(raizReal, constants.W_OK); } catch { await finalizarFalha(falhar("sem_permissao", null)); return { progresso: foto(), diferenca }; }
    aplicar({ t: "sub", fracao: 0.7 });
    if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
    if (d.sondarRegistro !== undefined) {
      const sonda = await d.sondarRegistro(registro, sinal);
      if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
      if (!sonda.ok) { await finalizarFalha(falhar(sonda.causa, null, sonda.detalhe)); return { progresso: foto(), diferenca }; }
      log("registro npm acessível");
    }

    // manifesto ANTES + cópia de segurança do que já existe
    const antes = await criarManifesto(raizReal);
    manifestoAntes = antes.mapa;
    truncadoManifesto = antes.truncado;
    const preExistentes = [...antes.mapa].filter(([rel, e]) => e.tipo === "arquivo" && rel.includes("/")).length;
    if (preExistentes > 0) {
      const destino = join(d.pastaDados, "suite", "backups", d.workspace_id, new Date(agora()).toISOString().replace(/[:.]/g, "-"));
      const b = await copiarBackup(raizReal, antes.mapa, destino);
      if (b.copiados > 0) { backupDir = destino; log(`cópia de segurança de ${b.copiados} arquivo(s) existente(s)${b.truncado ? " (parcial)" : ""}`); await podarBackups(join(d.pastaDados, "suite", "backups", d.workspace_id)); }
    }
    aplicar({ t: "sub", fracao: 1 });

    // ------------------------------------------------ 2) baixa o instalador (cwd neutro)
    aplicar({ t: "etapa", id: "baixando" });
    aviso(`Baixando ${PACOTE_SUITE}@${d.versao} (cwd neutro, registro ${registro})`);
    const rDown = await rodar(cmdNpm.executavel, [...cmdNpm.prefixo, ...argumentosDownload(d.versao, temp, registro)], temp, ambienteNpm(ambiente, temp, registro), { esperadas: 12 });
    if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
    const f1 = falhaDoProcesso(rDown);
    if (f1 !== null) { await finalizarFalha(f1); return { progresso: foto(), diferenca }; }
    const bin = await localizarBin(temp, d.versao);
    if (typeof bin === "string" && bin.startsWith("!")) { await finalizarFalha(falhar("pacote_invalido", null, bin.slice(1))); return { progresso: foto(), diferenca }; }
    const binario = bin as string;
    // a lista de skills vem do catálogo REAL da versão baixada (interseção com a lista conhecida do app); se não der para ler, vale a lista conhecida
    const pacoteDir = join(temp, "node_modules", PACOTE_SUITE);
    const disponiveis = await lerCatalogoDoPacote({ node: f.node, pacote: pacoteDir, cwd: temp, env: ambiente, executar, sinal, plataforma });
    if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
    const escolha = skillsParaInstalar(SKILLS_DA_SUITE, disponiveis);
    if (disponiveis === null) aviso("Não foi possível ler o catálogo do instalador; usando a lista conhecida do app.");
    else log(`skills desta versão: ${disponiveis.join(", ")}`);
    if (escolha.ignoradas.length > 0) aviso(`Não existem nesta versão e ficam de fora: ${escolha.ignoradas.join(", ")}.`);
    if (escolha.skills.length === 0) { await finalizarFalha(falhar("pacote_invalido", null, "O catálogo do instalador não tem nenhuma das skills da suíte.")); return { progresso: foto(), diferenca }; }
    aplicar({ t: "sub", fracao: 1 });

    // ------------------------------------------------ 3) instala as skills (cwd = projeto)
    aplicar({ t: "etapa", id: "instalando" });
    const opcoesInit = { skills: escolha.skills, ...(d.harness === undefined ? {} : { harness: d.harness }), ...(d.extras === undefined ? {} : { extras: d.extras }) };
    aviso(`Rodando ${argumentosInit("<instalador>", d.modo, opcoesInit).slice(1).join(" ")} em ${mascararCaminho(raizReal, inicio)}`);
    iniciouInit = true;
    const rInit = await rodar(f.node, argumentosInit(binario, d.modo, opcoesInit), raizReal, ambiente, { esperadas: 40 });
    if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
    const f2 = falhaDoProcesso(rInit);
    if (f2 !== null) { await finalizarFalha(f2); return { progresso: foto(), diferenca }; }
    aplicar({ t: "sub", fracao: 1 });

    // ------------------------------------------------ 4) confere
    aplicar({ t: "etapa", id: "conferindo" });
    let depois = await criarManifesto(raizReal);
    // o `init` troca `.expx/` inteiro: o que era do usuário e não faz parte da instalação (hooks.json) volta da cópia de segurança
    const devolvidos = await devolverArquivosDoUsuario(raizReal, manifestoAntes, depois.mapa, backupDir);
    if (devolvidos.length > 0) { log(`devolvi o que era seu e a troca de .expx levou: ${devolvidos.join(", ")}`); depois = await criarManifesto(raizReal); }
    diferenca = compararManifestos(manifestoAntes, depois.mapa);
    aplicar({ t: "sub", fracao: 0.3 });
    let doctor: ResumoSuite["doctor"] = "ok";
    const rDoc = await rodar(f.node, [binario, "doctor"], raizReal, ambiente, { esperadas: 20, tempoMs: LIMITES_SUITE.doctor_ms });
    if (cancelado()) { await aposCancelamento(); return { progresso: foto(), diferenca }; }
    if (rDoc.motivo === "erro_ao_iniciar") doctor = "indisponivel";
    else if (rDoc.motivo !== "saiu" || rDoc.codigo !== 0) { doctor = "avisos"; aviso("O doctor apontou avisos (não impede o uso; veja acima)."); }
    aplicar({ t: "sub", fracao: 0.7 });
    const det = await detectarSuite(raizReal, { gravavel: async () => true });
    // skill que não existe nesta versão do instalador não conta como falta (ela ficou de fora de propósito)
    const faltaDeVerdade = det.skills_faltando.filter((n) => !escolha.ignoradas.includes(n));
    const aceita = det.estado === "completa" || (det.estado === "incompleta" && faltaDeVerdade.length === 0 && det.versao_instalada !== null);
    if (!aceita) { await finalizarFalha(falhar("conferencia", null, det.motivo)); return { progresso: foto(), diferenca }; }
    if (det.versao_instalada !== d.versao) { await finalizarFalha(falhar("conferencia", null, `A versão gravada no arquivo de controle (${det.versao_instalada ?? "?"}) não é a pedida (${d.versao}).`)); return { progresso: foto(), diferenca }; }
    aplicar({ t: "sub", fracao: 1 });

    // ------------------------------------------------ 5) pronto
    aplicar({ t: "etapa", id: "pronto" });
    const cap = LIMITES_SUITE.caminhos_resumo;
    // a cópia só fica se algo que JÁ existia mudou ou sumiu; sem isso ela seria só uma duplicata
    const precisaBackup = diferenca.alterados.length > 0 || diferenca.removidos.length > 0;
    if (!precisaBackup) await apagarBackup();
    const backupMostrado = precisaBackup && backupDir !== null ? comTil(backupDir, inicio) : null;
    const resumo: ResumoSuite = {
      versao: d.versao, skills: det.skills_presentes, criados: diferenca.criados.slice(0, cap), alterados: diferenca.alterados.slice(0, cap), removidos: diferenca.removidos.slice(0, cap),
      fora_do_esperado: diferenca.fora_do_esperado.slice(0, 50), truncado: truncadoManifesto || depois.truncado || diferenca.criados.length > cap, doctor, backup: backupMostrado,
      como_restaurar: backupMostrado === null ? null : `Para voltar um arquivo ao que era antes, copie-o de ${backupMostrado}/<caminho do arquivo> para o mesmo caminho dentro do projeto (ou use o git do projeto, se ele usa git).`,
      restaurados: devolvidos,
    };
    aplicar({ t: "concluida", resumo });
    return { progresso: foto(), diferenca };
  } catch (e) {
    if (terminal(estado)) return { progresso: foto(), diferenca };
    if (cancelado()) { try { await aposCancelamento(); } catch { /* sem o que fazer */ } return { progresso: foto(), diferenca }; }
    const codigo = (e as NodeJS.ErrnoException).code;
    const causa: CausaFalhaSuite = codigo === "EACCES" || codigo === "EPERM" || codigo === "EROFS" ? "sem_permissao" : "interna";
    await finalizarFalha(falhar(causa, null));
    return { progresso: foto(), diferenca };
  } finally {
    if (temp !== null && dentroDe(d.pastaTemporaria ?? tmpdir(), temp) && basename(temp).startsWith("suite-")) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }

  // ---- auxiliares (declaradas depois do try: hoisting de função)
  function falhaDoProcesso(r: ResultadoProcesso): FalhaSuite | null {
    if (r.motivo === "saiu" && r.codigo === 0) return null;
    if (r.motivo === "tempo_total") return falhar("tempo_esgotado", null);
    if (r.motivo === "silencio") return falhar("sem_resposta", null);
    if (r.motivo === "saida_excessiva") return falhar("saida_excessiva", null);
    if (r.motivo === "erro_ao_iniciar") return falhar(r.erro === "EACCES" || r.erro === "EPERM" ? "sem_permissao" : "node_ausente", null);
    const causa = classificarFalha(cauda.linhas(60));
    return falhar(causa, r.codigo, causa === "comando_falhou" ? `(código ${r.codigo ?? "sem código"}).` : undefined);
  }

  async function localizarBin(pastaTemp: string, versao: string): Promise<string> {
    const pacote = join(pastaTemp, "node_modules", PACOTE_SUITE);
    let pj: unknown;
    try { pj = JSON.parse(await readFile(join(pacote, "package.json"), "utf8")); } catch { return "!package.json do pacote não encontrado."; }
    const o = typeof pj === "object" && pj !== null ? (pj as Record<string, unknown>) : {};
    if (o["name"] !== PACOTE_SUITE) return "!nome do pacote diferente do esperado.";
    if (o["version"] !== versao) return `!versão baixada (${String(o["version"]).slice(0, 20)}) diferente da pedida (${versao}).`;
    const b = o["bin"];
    const rel = typeof b === "string" ? b : typeof b === "object" && b !== null && typeof (b as Record<string, unknown>)[PACOTE_SUITE] === "string" ? ((b as Record<string, string>)[PACOTE_SUITE] as string) : null;
    if (rel === null) return "!o pacote não declara o programa de instalação.";
    let real: string;
    try { real = await realpath(join(pacote, rel)); } catch { return "!programa de instalação ausente no pacote."; }
    let pacoteReal: string;
    try { pacoteReal = await realpath(pacote); } catch { return "!pacote ausente."; }
    if (!dentroDe(pacoteReal, real)) return "!programa de instalação fora do pacote.";
    return real;
  }

  async function podarBackups(pasta: string): Promise<void> {
    try {
      const nomes = (await readdir(pasta)).sort();
      for (const n of nomes.slice(0, Math.max(0, nomes.length - LIMITES_SUITE.backups_guardados))) await rm(join(pasta, n), { recursive: true, force: true });
    } catch { /* sem backups antigos */ }
  }
}
