// Download de modelo de voz local (Fase 11, D-542). Usa EXCLUSIVAMENTE o cliente de rede do app (`nucleo/rede`): consentimento por pedido (token de uso único emitido a cada requisição), host da
// origem e CDN do catálogo, https, teto de bytes. Garantias:
//  - cada arquivo vem do catálogo (nome simples, tamanho e sha256 fixos); o hash é calculado EM STREAMING e a divergência apaga o parcial (`checksum_invalido`, sem retentativa);
//  - tamanho declarado (Content-Length/Content-Range) e recebido TÊM de bater com o catálogo (`tamanho_invalido`): servidor que manda mais ou menos é abortado;
//  - retomada por HTTP Range a partir do `.part` (o hash é refeito lendo o prefixo); servidor que ignora Range (200) recomeça do zero; 416 recomeça;
//  - gravação em `<pasta>/.parcial/<id>/` (0700, arquivos 0600, sem seguir symlink) e, só com TUDO verificado, uma troca atômica da pasta para `<pasta>/<id>/` com a marca de integridade;
//  - disco: confere espaço livre antes e trata ENOSPC (`disco_cheio`), mantendo o parcial para retomar depois de liberar espaço;
//  - nada de áudio, transcrição, URL com parâmetros, cabeçalho ou corpo em erro/log.
import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { CodigoErroModelo } from "../../../compartilhado/voz-local";
import { LIMITES_MODELO } from "../../../compartilhado/voz-local";
import { RedeErro, type ClienteRede } from "../../rede";
import { motivoNaoBaixavel, nomeArquivoSeguro, urlDoArquivo, type ArquivoCatalogo, type Catalogo, type ModeloCatalogo } from "./catalogo";
import { gravarManifesto, MARCA_INTEGRIDADE, type Manifesto } from "./integridade";

export class ErroModelo extends Error {
  constructor(readonly codigo: CodigoErroModelo, mensagem: string = codigo, readonly motivo: "pausa" | "cancelamento" | null = null) {
    super(mensagem);
    this.name = "ErroModelo";
  }
}

export interface Escritor {
  escrever(dados: Buffer): Promise<void>;
  fechar(): Promise<void>;
}

export interface PortasDownload {
  rede: Pick<ClienteRede, "stream">;
  /** token de USO ÚNICO para o host (um por requisição HTTP); emitido pela ação do usuário que iniciou/retomou o download. */
  token(host: string): string;
  /** só servidores falsos de teste (loopback). */
  porta?: number;
  /** espaço livre em bytes na pasta (ou `null` se o SO não informa). */
  espacoLivre?(pasta: string): Promise<number | null>;
  /** testes injetam falha de escrita (ENOSPC). */
  abrirEscritor?(caminho: string, anexar: boolean): Promise<Escritor>;
  esperar?(ms: number): Promise<void>;
}

export interface OpcoesDownload {
  modelo: ModeloCatalogo;
  catalogo: Catalogo;
  /** `<userData>/voz/modelos`. */
  pastaModelos: string;
  sinal: AbortSignal;
  aoProgresso(p: { bytes: number; total: number; arquivo: string }): void;
  tentativas?: number;
  agora?: () => number;
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function escritorPadrao(caminho: string, anexar: boolean): Promise<Escritor> {
  const flags = constants.O_WRONLY | constants.O_CREAT | (anexar ? constants.O_APPEND : constants.O_TRUNC) | NOFOLLOW;
  const fh: FileHandle = await open(caminho, flags, 0o600);
  return {
    escrever: async (d) => { await fh.write(d); },
    fechar: async () => { await fh.close(); },
  };
}

async function espacoLivrePadrao(pasta: string): Promise<number | null> {
  try {
    const s = await statfs(pasta);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

const ehErrno = (e: unknown, ...codigos: string[]): boolean => typeof e === "object" && e !== null && codigos.includes((e as NodeJS.ErrnoException).code ?? "");

/** pasta 0700; recusa symlink no lugar de pasta (alguém pode ter plantado um para redirecionar a gravação). */
export async function garantirPasta(caminho: string): Promise<void> {
  await mkdir(caminho, { recursive: true, mode: 0o700 });
  const l = await lstat(caminho);
  if (l.isSymbolicLink() || !l.isDirectory()) throw new ErroModelo("indisponivel", "pasta de modelos inválida");
  if (process.platform !== "win32") await chmod(caminho, 0o700);
}

async function hashDoPrefixo(caminho: string, bytes: number): Promise<ReturnType<typeof createHash>> {
  const h = createHash("sha256");
  if (bytes === 0) return h;
  await new Promise<void>((ok, falha) => {
    const r = createReadStream(caminho, { start: 0, end: bytes - 1 });
    r.on("data", (d) => h.update(d));
    r.on("end", () => ok());
    r.on("error", falha);
  });
  return h;
}

async function tamanhoRegular(caminho: string): Promise<number | null> {
  try {
    const l = await lstat(caminho);
    if (l.isSymbolicLink() || !l.isFile()) { await rm(caminho, { force: true, recursive: true }); return null; }
    return l.size;
  } catch {
    return null;
  }
}

function traduzirRede(e: unknown): ErroModelo {
  if (e instanceof ErroModelo) return e;
  if (e instanceof RedeErro) {
    switch (e.codigo) {
      case "consent_required":
      case "host_nao_permitido": return new ErroModelo("consentimento_ausente");
      case "redirect_outro_host":
      case "redirect_demais": return new ErroModelo("redirect_recusado");
      case "resposta_grande_demais": return new ErroModelo("tamanho_invalido");
      case "timeout":
      case "falha_rede":
      case "proxy_falhou": return new ErroModelo("sem_internet");
      default: return new ErroModelo("indisponivel");
    }
  }
  if (ehErrno(e, "ENOSPC", "EDQUOT")) return new ErroModelo("disco_cheio");
  return new ErroModelo("indisponivel");
}

const RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

/** Baixa e verifica todos os arquivos do modelo e instala a pasta de forma atômica. Lança `ErroModelo`. */
export async function baixarModelo(portas: PortasDownload, op: OpcoesDownload): Promise<{ pasta: string; manifesto: Manifesto }> {
  const { modelo } = op;
  const naoBaixavel = motivoNaoBaixavel(modelo);
  if (naoBaixavel !== null) throw new ErroModelo("sem_checksum", naoBaixavel);
  // defesa em profundidade (o validador do catálogo já barra): nenhum nome pode sair da pasta do modelo
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(modelo.id) || !modelo.arquivos.every((a) => nomeArquivoSeguro(a.nome))) throw new ErroModelo("indisponivel", "nome de arquivo inseguro");
  const esperar = portas.esperar ?? ((ms: number) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); t.unref?.(); }));
  const abrir = portas.abrirEscritor ?? escritorPadrao;
  const livre = portas.espacoLivre ?? espacoLivrePadrao;
  const tentativas = op.tentativas ?? 3;
  const agora = op.agora ?? Date.now;

  await garantirPasta(op.pastaModelos);
  const raizParcial = join(op.pastaModelos, ".parcial");
  await garantirPasta(raizParcial);
  const parcial = join(raizParcial, modelo.id);
  await garantirPasta(parcial);

  const total = modelo.tamanho_bytes;
  const interrompido = (): ErroModelo => new ErroModelo("cancelado", "interrompido", op.sinal.reason === "pausa" ? "pausa" : "cancelamento");
  if (op.sinal.aborted) throw interrompido();

  // espaço: o que falta baixar (parciais já gravados contam a favor) + margem
  let jaNoDisco = 0;
  for (const a of modelo.arquivos) jaNoDisco += Math.min(a.bytes, (await tamanhoRegular(join(parcial, a.nome))) ?? (await tamanhoRegular(join(parcial, `${a.nome}.part`))) ?? 0);
  const folga = await livre(op.pastaModelos);
  if (folga !== null && folga < total - jaNoDisco + LIMITES_MODELO.margem_disco_bytes) throw new ErroModelo("disco_cheio", "espaço livre insuficiente");

  let concluidos = 0; // bytes de arquivos já verificados
  const arquivosFinais: Manifesto["arquivos"] = [];

  for (const arq of modelo.arquivos) {
    const final = join(parcial, arq.nome);
    const part = `${final}.part`;
    const sha = arq.sha256 as string;

    // arquivo já completo de uma execução anterior (pausa/retomada): re-hash antes de confiar
    const tamFinal = await tamanhoRegular(final);
    if (tamFinal !== null) {
      if (tamFinal === arq.bytes && (await hashDoPrefixo(final, arq.bytes)).digest("hex") === sha) {
        concluidos += arq.bytes;
        op.aoProgresso({ bytes: concluidos, total, arquivo: arq.nome });
        arquivosFinais.push({ nome: arq.nome, bytes: arq.bytes, sha256: sha, mtime_ms: (await stat(final)).mtimeMs });
        continue;
      }
      await rm(final, { force: true });
    }

    let ultimoErro: ErroModelo | null = null;
    let reiniciouPor416 = false;
    for (let tentativa = 0; tentativa < tentativas; tentativa++) {
      if (op.sinal.aborted) throw interrompido();
      if (tentativa > 0) await esperar(Math.min(4_000, 500 * 2 ** (tentativa - 1)));
      if (op.sinal.aborted) throw interrompido();
      try {
        await baixarArquivo(arq, (await tamanhoRegular(part)) ?? 0);
        ultimoErro = null;
        break;
      } catch (e) {
        const erro = traduzirRede(e);
        if (erro.codigo === "cancelado" || (op.sinal.aborted && erro.codigo === "sem_internet")) throw interrompido();
        if (erro.codigo === "servidor_recusou" && (erro.message === "416") && !reiniciouPor416) { reiniciouPor416 = true; await rm(part, { force: true }); tentativa--; continue; }
        if (erro.codigo !== "sem_internet" && !(erro.codigo === "servidor_recusou" && erro.message === "5xx")) throw erro;
        ultimoErro = erro;
      }
    }
    if (ultimoErro !== null) throw ultimoErro.message === "5xx" ? new ErroModelo("servidor_recusou") : ultimoErro;
    concluidos += arq.bytes;
    arquivosFinais.push({ nome: arq.nome, bytes: arq.bytes, sha256: sha, mtime_ms: (await stat(final)).mtimeMs });
  }

  async function baixarArquivo(arq: ArquivoCatalogo, existente: number): Promise<void> {
    const final = join(parcial, arq.nome);
    const part = `${final}.part`;
    if (existente > arq.bytes) { await rm(part, { force: true }); existente = 0; }
    const { host, caminho } = urlDoArquivo(modelo, arq);
    const cabecalhos: Record<string, string> = { accept: "application/octet-stream" };
    if (existente > 0) cabecalhos["range"] = `bytes=${existente}-`;
    let resp;
    try {
      resp = await portas.rede.stream({
        host, caminho, cabecalhos, tokenDeConsentimento: portas.token(host), redirecionar_para: op.catalogo.hosts_arquivos,
        max_bytes: arq.bytes, timeout_ms: 30_000, ocioso_ms: 30_000, ...(portas.porta !== undefined ? { porta: portas.porta } : {}),
      });
    } catch (e) {
      throw traduzirRede(e);
    }
    const aoAbortar = (): void => resp.cancelar();
    op.sinal.addEventListener("abort", aoAbortar, { once: true });
    let escritor: Escritor | null = null;
    try {
      if (op.sinal.aborted) throw interrompido();
      const status = resp.status;
      if (status === 416) throw new ErroModelo("servidor_recusou", "416");
      if (status >= 500 || status === 429) throw new ErroModelo("servidor_recusou", "5xx");
      if (status !== 200 && status !== 206) throw new ErroModelo("servidor_recusou", String(status));
      let inicio = existente;
      const cl = Number(resp.cabecalhos["content-length"]);
      if (status === 206) {
        const m = RANGE.exec(resp.cabecalhos["content-range"] ?? "");
        if (m === null || Number(m[1]) !== existente || Number(m[2]) !== arq.bytes - 1 || (m[3] !== "*" && Number(m[3]) !== arq.bytes)) throw new ErroModelo("tamanho_invalido", "content-range");
        if (Number.isFinite(cl) && cl !== arq.bytes - existente) throw new ErroModelo("tamanho_invalido", "content-length");
      } else {
        // 200: o servidor ignorou o Range (ou não havia parcial): recomeça do zero
        if (Number.isFinite(cl) && cl !== arq.bytes) throw new ErroModelo("tamanho_invalido", "content-length");
        inicio = 0;
      }
      const hash = inicio === 0 ? createHash("sha256") : await hashDoPrefixo(part, inicio);
      escritor = await abrirOuFalhar(part, inicio > 0);
      let recebido = inicio;
      for await (const pedaco of resp.corpo) {
        if (op.sinal.aborted) throw interrompido();
        recebido += pedaco.length;
        if (recebido > arq.bytes) throw new ErroModelo("tamanho_invalido", "acima do declarado");
        hash.update(pedaco);
        try { await escritor.escrever(pedaco); } catch (e) { throw ehErrno(e, "ENOSPC", "EDQUOT") ? new ErroModelo("disco_cheio") : new ErroModelo("indisponivel", "escrita"); }
        op.aoProgresso({ bytes: concluidos + recebido, total, arquivo: arq.nome });
      }
      if (op.sinal.aborted) throw interrompido();
      await escritor.fechar();
      escritor = null;
      if (recebido !== arq.bytes) throw new ErroModelo("sem_internet", "corpo curto"); // conexão cortada: retoma do que chegou
      if (hash.digest("hex") !== arq.sha256) {
        await rm(part, { force: true });
        throw new ErroModelo("checksum_invalido");
      }
      await rename(part, final);
      if (process.platform !== "win32") await chmod(final, 0o600);
    } catch (e) {
      if (op.sinal.aborted && !(e instanceof ErroModelo && e.codigo !== "cancelado" && e.codigo !== "sem_internet")) throw interrompido();
      throw e;
    } finally {
      op.sinal.removeEventListener("abort", aoAbortar);
      resp.cancelar();
      await escritor?.fechar().catch(() => undefined);
    }
  }

  async function abrirOuFalhar(caminho: string, anexar: boolean): Promise<Escritor> {
    try { return await abrir(caminho, anexar); } catch (e) { throw ehErrno(e, "ENOSPC", "EDQUOT") ? new ErroModelo("disco_cheio") : new ErroModelo("indisponivel", "abrir"); }
  }

  // tudo verificado: marca de integridade e troca atômica da pasta
  const manifesto: Manifesto = { versao: 1, modelo_id: modelo.id, instalado_em: new Date(agora()).toISOString(), verificado_em: new Date(agora()).toISOString(), arquivos: arquivosFinais };
  await gravarManifesto(parcial, manifesto);
  const destino = join(op.pastaModelos, modelo.id);
  const antigo = join(op.pastaModelos, `.antigo-${randomBytes(4).toString("hex")}`);
  let moveuAntigo = false;
  try { await rename(destino, antigo); moveuAntigo = true; } catch (e) { if (!ehErrno(e, "ENOENT")) throw new ErroModelo("indisponivel", "troca"); }
  try {
    await rename(parcial, destino);
  } catch {
    if (moveuAntigo) await rename(antigo, destino).catch(() => undefined);
    throw new ErroModelo("indisponivel", "troca");
  }
  if (moveuAntigo) await rm(antigo, { recursive: true, force: true }).catch(() => undefined);
  return { pasta: destino, manifesto };
}

/** Apaga o parcial de um modelo (cancelamento, ou "apagar e tentar de novo" depois de checksum inválido). */
export async function descartarParcial(pastaModelos: string, modeloId: string): Promise<void> {
  await rm(join(pastaModelos, ".parcial", modeloId), { recursive: true, force: true });
}

/** Limpeza de partidas interrompidas (processo morto no meio da troca): `.antigo-*` e parciais sem dono. Seguro de chamar a qualquer hora fora de um download. */
export async function limparOrfaos(pastaModelos: string, idsEmAndamento: ReadonlySet<string> = new Set()): Promise<void> {
  try {
    for (const n of await readdir(pastaModelos)) if (n.startsWith(".antigo-")) await rm(join(pastaModelos, n), { recursive: true, force: true });
    for (const n of await readdir(join(pastaModelos, ".parcial")).catch(() => [] as string[])) if (!idsEmAndamento.has(n) && n.startsWith(".")) await rm(join(pastaModelos, ".parcial", n), { recursive: true, force: true });
  } catch { /* pasta ainda não existe */ }
}

export { MARCA_INTEGRIDADE };
