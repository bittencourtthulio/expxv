// Plano de instalação e texto do consentimento (Fase 7B, T-07B.07/.08). Puro: NÃO executa nada, não toca
// disco nem rede. Responde "o que vai acontecer se a pessoa clicar em Instalar": passos, comando exato,
// pasta isolada, hosts, variáveis (secretas só pelo nome), riscos, nível de verificação e avisos honestos.

import { createHash } from "node:crypto";
import { variavelReservada } from "./ambiente";
import { licencaRestritiva } from "./catalogo";
import type { Bloqueio } from "./bloqueio";
import { montarPermissoes, pastaDoServidor, caminhoDe, citar, type ContextoComando, type PermissoesMcp } from "./comando";
import { motivoNaoInstalavel, nivelVerificacao, type EntradaMcp, type MetodoInstalacaoMcp, type NivelVerificacao } from "./esquema";

export interface DiagnosticoMcp {
  npm?: { ok: boolean; versao?: string | null };
  node?: { ok: boolean; versao?: string | null };
  uv?: { ok: boolean; versao?: string | null };
  docker?: { ok: boolean };
  cofre?: { disponivel: boolean };
}

export type CodigoBloqueioPlano =
  | "catalogo_adulterado" | "nao_confirmado" | "descartado" | "sem_versao_pinada" | "sem_integridade"
  | "bloqueado" | "bloqueio_ilegivel" | "prerequisito_ausente" | "node_antigo" | "comando_invalido";

export interface BloqueioPlano {
  codigo: CodigoBloqueioPlano;
  motivo: string;
  /** Instrução acionável para a pessoa (quando há). */
  acao: string | null;
}

export type AcaoInstalacao =
  | { tipo: "exec"; argv: string[]; rotulo: string }
  | { tipo: "download"; url: string; sha256: string; destino: string; rotulo: string }
  | { tipo: "registrar"; url: string; rotulo: string };

export interface PassoPlano {
  id: "consentimento" | "instalar" | "variaveis" | "saude" | "habilitar";
  rotulo: string;
  detalhe: string;
  aplicavel: boolean;
  /** exige clique/ação explícita da pessoa. */
  requer_clique: boolean;
}

export interface AvisoPlano {
  codigo: string;
  nivel: "info" | "atencao" | "alto";
  texto: string;
}

export interface PlanoInstalacao {
  id: string;
  nome: string;
  versao: string | null;
  metodo: MetodoInstalacaoMcp;
  nivel_verificacao: NivelVerificacao;
  passos: PassoPlano[];
  /** Comando de execução (o que o Pane roda); segredos só pelo nome. */
  comando_exato: string;
  /** Ações do instalador, na ordem. A UI mostra exatamente isto. */
  acoes: AcaoInstalacao[];
  comando_instalacao: string[];
  pasta: string | null;
  permissoes: PermissoesMcp;
  /** sha256 do que foi consentido: muda se qualquer arg, versão, host, integridade ou variável mudar. */
  comando_hash: string;
  avisos: AvisoPlano[];
}

export type ResultadoPlano = { ok: true; plano: PlanoInstalacao } | { ok: false; bloqueio: BloqueioPlano };

export interface OpcoesPlano extends ContextoComando {
  bloqueio?: Bloqueio;
  /** Catálogo aberto em modo só-leitura (hash divergente). */
  catalogoAdulterado?: boolean;
  /** Identificador do diretório temporário (padrão: `<id>-<ulid>` literal, para exibição). */
  tmpId?: string;
}

const NODE_MINIMO = 18;

function versaoMaior(versao: string | null | undefined): number | null {
  const m = /(\d+)\./.exec(versao ?? "");
  return m ? Number(m[1]) : null;
}

function prerequisito(e: EntradaMcp, d: DiagnosticoMcp): BloqueioPlano | null {
  const m = e.instalacao.metodo;
  if (m === "npm") {
    if (!d.npm?.ok || !d.node?.ok) {
      return { codigo: "prerequisito_ausente", motivo: "npm ou Node.js não encontrados nesta máquina", acao: "Instale o Node.js 18 ou mais novo (o npm vem junto) em nodejs.org, ou use \"Instalar runtime gerenciado\" em Configurações → Loja de MCPs." };
    }
    const maior = versaoMaior(d.node.versao);
    if (maior !== null && maior < NODE_MINIMO) return { codigo: "node_antigo", motivo: `Node.js ${d.node.versao} é antigo demais (mínimo ${NODE_MINIMO})`, acao: `Atualize o Node.js para a versão ${NODE_MINIMO} ou mais nova.` };
  } else if (m === "uvx") {
    if (!d.uv?.ok) return { codigo: "prerequisito_ausente", motivo: "uv não encontrado nesta máquina", acao: "Instale o uv (docs.astral.sh/uv) ou use \"Instalar runtime gerenciado\" em Configurações → Loja de MCPs." };
  } else if (m === "docker") {
    if (!d.docker?.ok) return { codigo: "prerequisito_ausente", motivo: "Docker não encontrado ou não está em execução", acao: "Instale e abra o Docker Desktop, ou escolha um servidor sem Docker." };
  }
  return null;
}

/** Ações do instalador (texto exato). `<tmp>` = `<userData>/mcp/.tmp/<id>-<ulid>`. */
export function acoesDeInstalacao(e: EntradaMcp, ctx: ContextoComando & { tmpId?: string }): AcaoInstalacao[] {
  const plataforma = ctx.plataforma ?? process.platform;
  const p = caminhoDe(plataforma);
  const i = e.instalacao;
  const tmp = p.join(ctx.userData, "mcp", ".tmp", ctx.tmpId ?? `${e.id}-<ulid>`);
  switch (i.metodo) {
    case "npm": {
      const comuns = ["--omit=dev", "--no-audit", "--no-fund", "--prefix", tmp];
      const scripts = i.scripts_permitidos === true ? [] : ["--ignore-scripts"];
      const forte = nivelVerificacao(e) === "forte";
      return [forte
        ? { tipo: "exec", argv: ["npm", "ci", ...scripts, ...comuns], rotulo: `npm ci com o lock curado (${e.id}.package-lock.json)` }
        : { tipo: "exec", argv: ["npm", "install", ...scripts, ...comuns, "--save-exact", `${i.pacote}@${i.versao}`], rotulo: `npm install ${i.pacote}@${i.versao}` }];
    }
    case "uvx": {
      const python = plataformaPython(p, plataforma, tmp);
      const venv: AcaoInstalacao = { tipo: "exec", argv: ["uv", "venv", p.join(tmp, "venv")], rotulo: "criar ambiente virtual isolado" };
      const forte = nivelVerificacao(e) === "forte";
      return [venv, forte
        ? { tipo: "exec", argv: ["uv", "pip", "install", "--require-hashes", "-r", p.join(tmp, "requirements.txt"), "--python", python], rotulo: "uv pip install com hashes travados" }
        : { tipo: "exec", argv: ["uv", "pip", "install", "--python", python, `${i.pacote}==${i.versao}`], rotulo: `uv pip install ${i.pacote}==${i.versao}` }];
    }
    case "binario": {
      const plat = `${plataforma}-${process.arch === "arm64" ? "arm64" : "x64"}`;
      const art = i.artefatos?.[plat] ?? Object.values(i.artefatos ?? {})[0];
      if (!art) return [];
      return [{ tipo: "download", url: art.url, sha256: art.sha256, destino: p.join(tmp, "bin"), rotulo: `baixar ${art.url} e conferir o sha256` }];
    }
    case "docker":
      return [{ tipo: "exec", argv: ["docker", "pull", i.pacote ?? ""], rotulo: "baixar a imagem por digest (ação separada)" }];
    default:
      return [{ tipo: "registrar", url: e.url ?? "", rotulo: "registrar o servidor remoto (sem download)" }];
  }
}

function plataformaPython(p: typeof import("node:path").posix, plataforma: NodeJS.Platform, tmp: string): string {
  return plataforma === "win32" ? p.join(tmp, "venv", "Scripts", "python.exe") : p.join(tmp, "venv", "bin", "python");
}

const textoAcao = (a: AcaoInstalacao): string =>
  a.tipo === "exec" ? a.argv.map(citar).join(" ") : a.tipo === "download" ? `baixar ${a.url} (sha256 ${a.sha256})` : `registrar ${a.url}`;

/** Hash do que a pessoa consentiu. Independe de caminhos e do workspace (usa os campos lógicos do catálogo). */
export function hashDoComando(e: EntradaMcp): string {
  const i = e.instalacao;
  const estavel = JSON.stringify({
    v: 1, metodo: i.metodo, pacote: i.pacote, versao: i.versao, integridade: i.integridade, lock: i.lock_sha256 ?? null,
    scripts: i.scripts_permitidos === true, artefatos: i.artefatos ?? null, transporte: e.transporte, comando: e.comando, bin: e.bin,
    args: e.args, url: e.url, variaveis: e.variaveis.map((v) => [v.nome, v.obrigatoria, v.secreta]),
    // o consentimento mostra os riscos e o tipo de autenticação: mudar qualquer um exige novo consentimento
    riscos: [...e.riscos].sort(), autenticacao: e.autenticacao,
    hosts: hostsParaHash(e),
  });
  return createHash("sha256").update(estavel).digest("hex");
}

function hostsParaHash(e: EntradaMcp): string[] {
  const hosts = new Set<string>();
  const add = (u: string | null | undefined): void => { if (!u) return; try { hosts.add(new URL(u.replace(/\{\{[^{}]*\}\}/g, "x")).hostname); } catch { /* ignora */ } };
  add(e.url);
  for (const a of Object.values(e.instalacao.artefatos ?? {})) add(a.url);
  hosts.add(e.instalacao.metodo);
  return [...hosts].sort();
}

function avisosDe(e: EntradaMcp, d: DiagnosticoMcp, recusadas: string[]): AvisoPlano[] {
  const avisos: AvisoPlano[] = [];
  const i = e.instalacao;
  const nivel = nivelVerificacao(e);
  if ((i.metodo === "npm" || i.metodo === "uvx") && nivel !== "forte")
    avisos.push({ codigo: "transitivas_nao_travadas", nivel: "atencao", texto: "Dependências transitivas não travadas: só o pacote principal tem versão e integridade conferidas." });
  if (i.scripts_permitidos === true)
    avisos.push({ codigo: "scripts_de_instalacao", nivel: "alto", texto: "ATENÇÃO: este pacote executa scripts de instalação (postinstall). A proteção --ignore-scripts foi desligada para ele." });
  if (e.args.some((a) => /\{\{SEGREDO:/.test(a)))
    avisos.push({ codigo: "segredo_em_argumento", nivel: "atencao", texto: "Este servidor recebe a chave como argumento de linha de comando: outros processos do seu usuário podem vê-la enquanto ele roda." });
  if (licencaRestritiva(e.licenca_spdx))
    avisos.push({ codigo: "licenca_restritiva", nivel: "atencao", texto: `Licença ${e.licenca_spdx}: restritiva ou source-available. O app não a redistribui; ela é baixada só por este clique.` });
  if (e.gratuito === "plano_gratis")
    avisos.push({ codigo: "plano_gratis", nivel: "info", texto: `Tem plano grátis com limites${e.plano_gratis_detalhe ? `: ${e.plano_gratis_detalhe}` : ""}. Confira o preço no site oficial.` });
  else if (e.gratuito === "pago")
    avisos.push({ codigo: "pago", nivel: "atencao", texto: "Serviço pago. Confira o preço no site oficial antes de usar." });
  else if (e.gratuito === "nao_confirmado")
    avisos.push({ codigo: "custo_nao_confirmado", nivel: "info", texto: "Custo não confirmado: não garantimos que seja grátis. Confira no site oficial." });
  if (e.autenticacao === "oauth")
    avisos.push({ codigo: "oauth_pela_cli", nivel: "info", texto: "A autenticação (OAuth) é feita pela sua CLI no primeiro uso; o app não guarda esse token." });
  if (e.variaveis.some((v) => v.secreta) && d.cofre?.disponivel === false)
    avisos.push({ codigo: "cofre_indisponivel", nivel: "atencao", texto: "O cofre do sistema está indisponível: será possível instalar, mas não salvar chaves." });
  if (e.riscos.includes("execucao_codigo") || e.riscos.includes("escrita_remota"))
    avisos.push({ codigo: "risco_alto", nivel: "atencao", texto: "Este servidor pode executar código ou escrever em serviços externos. Habilite só onde fizer sentido." });
  if (i.metodo === "docker")
    avisos.push({ codigo: "docker_pull_separado", nivel: "info", texto: "A imagem Docker só é baixada por uma ação separada; o servidor roda sem rede de build." });
  if (e.maturidade.arquivado || e.maturidade.status === "manutencao")
    avisos.push({ codigo: "manutencao_reduzida", nivel: "info", texto: e.maturidade.arquivado ? "Projeto arquivado pelo mantenedor." : "Projeto em manutenção reduzida." });
  if (recusadas.length > 0)
    avisos.push({ codigo: "variaveis_recusadas", nivel: "atencao", texto: `Variáveis reservadas ignoradas: ${recusadas.join(", ")}.` });
  return avisos;
}

/**
 * Planeja a instalação sem executar nada. Recusa: catálogo adulterado, entrada não confirmada/descartada/sem pino,
 * item na lista de bloqueio e pré-requisito ausente (com instrução acionável).
 */
export function planejarInstalacao(e: EntradaMcp, diagnostico: DiagnosticoMcp, opcoes: OpcoesPlano): ResultadoPlano {
  const recusa = (codigo: CodigoBloqueioPlano, motivo: string, acao: string | null = null): ResultadoPlano => ({ ok: false, bloqueio: { codigo, motivo, acao } });
  if (opcoes.catalogoAdulterado) return recusa("catalogo_adulterado", "catálogo adulterado: a Loja está em modo só-leitura");
  const motivo = motivoNaoInstalavel(e);
  if (motivo === "descartado") return recusa("descartado", "servidor descartado pela curadoria");
  if (motivo === "nao_confirmado") return recusa("nao_confirmado", "entrada não confirmada pela curadoria: não é instalável", "Abra o repositório oficial para instalar à mão, por sua conta e risco.");
  if (motivo) return recusa(motivo, motivo === "sem_versao_pinada" ? "entrada sem versão pinada" : "entrada sem integridade verificável");
  const bloqueado = opcoes.bloqueio?.consultarEntrada(e);
  if (bloqueado) return recusa(bloqueado.codigo === "bloqueio_ilegivel" ? "bloqueio_ilegivel" : "bloqueado", bloqueado.motivo);
  const falta = prerequisito(e, diagnostico);
  if (falta) return { ok: false, bloqueio: falta };

  let permissoes: PermissoesMcp;
  let comando_exato: string;
  try {
    permissoes = montarPermissoes(e, opcoes);
    comando_exato = permissoes.comando_exato;
  } catch (erro) {
    return recusa("comando_invalido", erro instanceof Error ? erro.message : "comando inválido");
  }
  const acoes = acoesDeInstalacao(e, opcoes);
  const pasta = e.instalacao.metodo === "remoto" ? null : pastaDoServidor(opcoes.userData, e.id, opcoes.plataforma);
  const obrigatorias = e.variaveis.filter((v) => v.obrigatoria);
  const recusadas = e.variaveis.map((v) => v.nome).filter(variavelReservada);
  const passos: PassoPlano[] = [
    { id: "consentimento", rotulo: "Revisar e aceitar", detalhe: `Confira o comando, a pasta, os endereços de rede, as variáveis e os riscos. Nada é instalado antes do clique.`, aplicavel: true, requer_clique: true },
    { id: "instalar", rotulo: "Instalar isolado", detalhe: pasta ? `Só dentro de ${pasta}: sem sudo, sem instalação global, sem tocar no PATH. ${acoes.map((a) => a.rotulo).join("; ")}.` : "Sem download: o servidor é remoto e só é registrado.", aplicavel: true, requer_clique: false },
    { id: "variaveis", rotulo: "Configurar variáveis", detalhe: e.variaveis.length === 0 ? "Este servidor não pede variáveis." : `${obrigatorias.length} obrigatória(s) de ${e.variaveis.length}. As chaves vão para o cofre do sistema.`, aplicavel: e.variaveis.length > 0, requer_clique: obrigatorias.length > 0 },
    { id: "saude", rotulo: "Testar saúde", detalhe: "Handshake MCP (initialize + tools/list) com limite de 3 s; o processo de teste é encerrado em seguida.", aplicavel: true, requer_clique: false },
    { id: "habilitar", rotulo: "Habilitar", detalhe: "Servidor instalado não é servidor habilitado: você escolhe o workspace, a Missão ou o agente.", aplicavel: true, requer_clique: true },
  ];
  return {
    ok: true,
    plano: {
      id: e.id, nome: e.nome, versao: e.instalacao.versao, metodo: e.instalacao.metodo, nivel_verificacao: nivelVerificacao(e),
      passos, comando_exato, acoes, comando_instalacao: acoes.map(textoAcao), pasta, permissoes,
      comando_hash: hashDoComando(e), avisos: avisosDe(e, diagnostico, recusadas),
    },
  };
}
