// Ligação do Bench no main (Fase 12): monta o `ServicoBench` do núcleo com as portas do app. NADA no boot: o main só chama `criarBenchMain` no primeiro canal `bench:*`.
// Portas: contas (conta DEDICADA do Bench: `<userData>/contas/<id>` da conta escolhida + HOME próprio em `<userData>/bench/home/<id>`), limites (Fase 9: conta esgotada = par na fila,
// nunca troca silenciosa), preços (Fase 10: só preço CONFIRMADO), provedores habilitados (para a recomendação) e salvar relatório (diálogo do sistema, feito pelo main).
import { homedir } from "node:os";
import { join } from "node:path";
import type { Preco } from "../compartilhado/custo";
import type { RespostaLimites } from "../compartilhado/limites";
import type { Banco } from "../nucleo/banco/banco";
import { criarExecutor, criarRegistroPidsArquivo, type ExecutorProcessos, type RegistroPids } from "../nucleo/bench/execucao/executor";
import type { EstadoConta } from "../nucleo/bench/execucao/escalonador";
import { escolherPreco } from "../nucleo/custo/precos";
import { criarSandboxMacos } from "../nucleo/bench/sandbox/macos";
import { criarSandboxIndisponivel, criarSandboxNativo, criarSandboxNenhum, type Sandbox } from "../nucleo/bench/sandbox/sandbox";
import { criarServicoBench, type PortaContas, type PortaLimites, type PortaPrecos, type PortaProvedores, type ServicoBench } from "../nucleo/bench/servico";
import type { EventoBenchIpc, PrecoCongelado } from "../nucleo/bench/tipos";
import type { Conta } from "../nucleo/dominio";

export interface DepsBenchMain {
  banco: Banco;
  /** `app.getPath("userData")`. */
  userData: string;
  contas: { obter(id: string): Conta | undefined; configDirAbsoluto(c: Pick<Conta, "config_dir_ref">): string | null };
  /** snapshot da Fase 9 (ou `null` se o motor de limites ainda não subiu). */
  limites: () => RespostaLimites | null;
  /** tabela de preços da Fase 10 (ou `null` se o custo ainda não subiu). */
  precosFase10: () => readonly Preco[] | null;
  /** provedores habilitados com ao menos uma conta habilitada. */
  provedoresHabilitados: () => ReadonlySet<string>;
  emitir: (e: EventoBenchIpc) => void;
  /** diálogo de salvar do sistema; devolve o caminho escolhido ou `null` (cancelou). O main grava o arquivo. */
  salvarComo: (nomeSugerido: string, conteudo: string) => Promise<string | null>;
  /** scrub do cofre, se ele já estiver aberto (nunca força a abertura). */
  scrub?: () => ((t: string) => string) | undefined;
  plataforma?: NodeJS.Platform;
  homeReal?: string;
  executor?: ExecutorProcessos;
  registroPids?: RegistroPids;
}

/** Sandbox por plataforma/CLI: macOS = `sandbox-exec` (Claude) ou o nativo da CLI (Codex); Windows = nenhum (frase reforçada, P-38); Linux = indisponível (a Run é recusada). */
export function sandboxDaPlataforma(plataforma: NodeJS.Platform, pastaPerfis: string): { porCli: (cli: "claude" | "codex") => Sandbox; checagens: Sandbox } {
  if (plataforma === "darwin") {
    const mac = criarSandboxMacos({ pastaPerfis, plataforma });
    const nativo = criarSandboxNativo();
    return { porCli: (cli) => (cli === "codex" ? nativo : mac), checagens: mac };
  }
  const unico = plataforma === "win32" ? criarSandboxNenhum() : criarSandboxIndisponivel();
  return { porCli: () => unico, checagens: unico };
}

/** Conta sem limite = QUALQUER janela da conta em 100% ou mais; sem dado nenhum = desconhecido (a Run segue). */
export function estadoDaConta(snap: RespostaLimites | null, contaId: string): EstadoConta {
  const c = snap?.contas.find((x) => x.account_id === contaId);
  if (c === undefined) return "desconhecido";
  const usos = c.windows.map((w) => w.used_pct).filter((x): x is number => x !== null);
  if (usos.length === 0) return "desconhecido";
  return usos.some((u) => u >= 100) ? "sem_limite" : "ok";
}

/** Preço da Fase 10 por modelo: só o CONFIRMADO vira custo (sem preço = custo desconhecido, nunca zero). */
export function precoDaFase10(tabela: readonly Preco[] | null, modelo: string, ts: string): PrecoCongelado | null {
  if (tabela === null) return null;
  const p = escolherPreco(tabela, modelo, ts);
  if (p === null || !p.confirmado) return null;
  return { provedor: p.familia ?? "custo", modelo, preco_in_mtok: p.entrada_por_mtok, preco_out_mtok: p.saida_por_mtok, preco_cache_mtok: p.cache_leitura_por_mtok, vale_desde: p.valido_desde };
}

export function criarBenchMain(d: DepsBenchMain): ServicoBench {
  const plataforma = d.plataforma ?? process.platform;
  const pastaBench = join(d.userData, "bench");
  const sbx = sandboxDaPlataforma(plataforma, join(pastaBench, "perfis"));
  const contas: PortaContas = {
    resolver(contaId) {
      const c = d.contas.obter(contaId);
      if (c === undefined || !c.habilitada) return null;
      const configDir = d.contas.configDirAbsoluto(c);
      if (configDir === null) return null;
      return { home: join(pastaBench, "home", c.id), configDir };
    },
  };
  const limites: PortaLimites = { estadoConta: (id) => estadoDaConta(d.limites(), id) };
  const precos: PortaPrecos = { preco: (modelo, ts) => precoDaFase10(d.precosFase10(), modelo, ts) };
  const provedores: PortaProvedores = { habilitados: d.provedoresHabilitados };
  const registro = d.registroPids ?? criarRegistroPidsArquivo(join(pastaBench, "pids"));
  return criarServicoBench({
    banco: d.banco,
    pastaBench,
    pastaDados: d.userData,
    homeReal: d.homeReal ?? homedir(),
    sandboxPara: sbx.porCli,
    sandboxChecagens: sbx.checagens,
    contas, limites, precos, provedores,
    salvar: { salvar: d.salvarComo },
    emitir: d.emitir,
    executor: d.executor ?? criarExecutor({ registro }),
    registroPids: registro,
    ...(d.scrub === undefined ? {} : { scrub: (t: string) => { const f = d.scrub?.(); return f === undefined ? t : f(t); } }),
    plataforma,
  });
}
