import type { ImportBruto } from "../tipos";
import { Acumulador, arquivosDe, dirnameRel, idArquivo, idExterno, normalizarRel, type ContextoResolucao, type Resolvedor, type ResultadoResolucao } from "./comum";

// Resolvedor de imports Python (T-17.16). Raízes de busca: raiz do repositório, `src/`, raízes declaradas no
// `pyproject` e pais de pacotes de topo (pastas com `__init__.py`); relativos por nível; pacotes de namespace;
// `from pkg import nome` (submódulo × símbolo); stdlib embutida; o resto é `externo pip`. Nada é executado.

export const STDLIB_PYTHON: ReadonlySet<string> = new Set(
  ("__future__ _thread abc aifc argparse array ast asynchat asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msvcrt multiprocessing netrc nis nntplib ntpath numbers opcode operator optparse os ossaudiodev pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile pstats pty pwd py_compile pyclbr pydoc queue quopri random re readline reprlib resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib sndhdr socket socketserver spwd sqlite3 ssl stat statistics string stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc tty turtle types typing unicodedata unittest urllib uu uuid venv warnings wave weakref webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo").split(/\s+/),
);

const BUILTIN_EXTRA = new Set(["typing_extensions"]); // não é stdlib; fica como pip

/** Raízes de busca em ordem de prioridade. */
export function raizesPython(ctx: ContextoResolucao): string[] {
  const raizes: string[] = [""];
  const add = (r: string | null): void => {
    if (r !== null && !raizes.includes(r)) raizes.push(r);
  };
  add("src");
  for (const m of ctx.manifestos) {
    if (m.eco === "pip") {
      for (const r of m.raizes_python) add(r);
      if (m.pasta !== "") add(m.pasta);
      add(normalizarRel(m.pasta, "src"));
    }
  }
  // pais de pacotes de topo: pasta com __init__.py cujo pai não tem __init__.py
  for (const c of ctx.arquivos.keys()) {
    if (!c.endsWith("/__init__.py") && c !== "__init__.py") continue;
    const pasta = dirnameRel(c);
    if (pasta === "") continue;
    const pai = dirnameRel(pasta);
    if (!ctx.arquivos.has(pai === "" ? "__init__.py" : `${pai}/__init__.py`)) add(pai);
  }
  return raizes;
}

type Modulo = { arquivo: string } | { namespace: string } | null;

export const resolvedorPython: Resolvedor = {
  linguagens: ["python"],
  resolver(ctx: ContextoResolucao): ResultadoResolucao {
    const ac = new Acumulador();
    const tem = (c: string): boolean => ctx.arquivos.has(c);
    const raizes = raizesPython(ctx);
    const pastas = new Set<string>();
    for (const c of ctx.arquivos.keys()) {
      let p = dirnameRel(c);
      for (;;) {
        pastas.add(p);
        if (p === "") break;
        p = dirnameRel(p);
      }
    }
    const pastaExiste = (p: string): boolean => pastas.has(p);

    /** Resolve `segs` sob uma pasta base: arquivo `x.py`, pacote `x/__init__.py` ou pacote de namespace. */
    const modulo = (base: string, segs: readonly string[]): Modulo => {
      const rel = normalizarRel(base, segs.join("/"));
      if (rel === null) return null;
      if (rel === "") return tem("__init__.py") ? { arquivo: "__init__.py" } : { namespace: "" };
      if (tem(`${rel}.py`)) return { arquivo: `${rel}.py` };
      if (tem(`${rel}/__init__.py`)) return { arquivo: `${rel}/__init__.py` };
      if (pastaExiste(rel)) return { namespace: rel };
      return null;
    };

    const raizDe = (arquivo: string): string => {
      let melhor = "";
      for (const r of raizes) if (r !== "" && arquivo.startsWith(`${r}/`) && r.length > melhor.length) melhor = r;
      return melhor;
    };

    const processar = (arquivo: string, imp: ImportBruto): void => {
      const esp = imp.especificador;
      const ehInit = arquivo.endsWith("/__init__.py") || arquivo === "__init__.py";
      const ehFrom = imp.nomes.some((n) => n.nome !== "*") || /^\.+$/.test(esp);
      const tipoAresta = ehInit && esp.startsWith(".") && imp.nomes.length > 0 ? "reexporta" : "importa";
      let base: string;
      let segs: string[];
      let relativo = false;

      if (esp.startsWith(".")) {
        relativo = true;
        const nivel = /^\.+/.exec(esp)?.[0].length ?? 0;
        const resto = esp.slice(nivel);
        const pastaDoArquivo = dirnameRel(arquivo);
        const subir = nivel - 1;
        const partes = pastaDoArquivo === "" ? [] : pastaDoArquivo.split("/");
        if (subir > partes.length) return ac.perdido(arquivo, imp, "fora_da_raiz");
        base = partes.slice(0, partes.length - subir).join("/");
        segs = resto === "" ? [] : resto.split(".");
      } else {
        base = "";
        segs = esp.split(".");
      }

      let achado: Modulo = null;
      let confianca: "exata" | "heuristica" = "exata";
      if (relativo) achado = modulo(base, segs);
      else {
        // raiz do próprio arquivo primeiro, depois as demais
        const ordem = [raizDe(arquivo), ...raizes.filter((r) => r !== raizDe(arquivo))];
        const nsCandidatos: string[] = [];
        for (const r of ordem) {
          const m = modulo(r, segs);
          if (m !== null && "arquivo" in m) {
            achado = m;
            break;
          }
          if (m !== null) nsCandidatos.push(m.namespace);
        }
        if (achado === null) {
          // script fora de pacote: a pasta do próprio arquivo está no sys.path (heurística)
          const pasta = dirnameRel(arquivo);
          if (!tem(pasta === "" ? "__init__.py" : `${pasta}/__init__.py`)) {
            const m = modulo(pasta, segs);
            if (m !== null && "arquivo" in m) {
              achado = m;
              confianca = "heuristica";
            }
          }
        }
        if (achado === null && nsCandidatos.length > 0) achado = { namespace: nsCandidatos[0] as string };
      }

      if (achado !== null && "arquivo" in achado) {
        ac.ligar(arquivo, imp, idArquivo(achado.arquivo), confianca, tipoAresta);
        submodulos(arquivo, imp, base, segs, relativo, achado.arquivo, tipoAresta, ehFrom, raizDe(arquivo));
        return;
      }
      if (achado !== null) {
        // pacote de namespace (ou `from . import x` numa pasta sem __init__): liga os submódulos nomeados
        const achouSub = submodulos(arquivo, imp, base, segs, relativo, null, tipoAresta, ehFrom, raizDe(arquivo), achado.namespace);
        if (achouSub) ac.ligar(arquivo, imp, null, "exata"); // ligação sem alvo único: o import em si não é um arquivo
        else ac.perdido(arquivo, imp, "nao_encontrado");
        return;
      }
      if (relativo) return ac.perdido(arquivo, imp, "nao_encontrado");
      const topo = segs[0] as string;
      if (STDLIB_PYTHON.has(topo) && !BUILTIN_EXTRA.has(topo)) return ac.ligar(arquivo, imp, idExterno("stdlib", topo), "exata");
      // nome de topo local (pasta/arquivo) mas submódulo ausente: não é pip
      const localTopo = raizes.some((r) => modulo(r, [topo]) !== null);
      if (localTopo && segs.length > 1) return ac.perdido(arquivo, imp, "nao_encontrado");
      ac.ligar(arquivo, imp, idExterno("pip", topo.toLowerCase().replace(/_/g, "-")), "exata");
    };

    /** `from pkg import nome`: nome pode ser submódulo (aresta extra, exata). Devolve se achou algum. */
    const submodulos = (
      arquivo: string,
      imp: ImportBruto,
      base: string,
      segs: readonly string[],
      relativo: boolean,
      _arquivoDoModulo: string | null,
      tipoAresta: "importa" | "reexporta",
      ehFrom: boolean,
      raiz: string,
      nsPasta?: string,
    ): boolean => {
      if (!ehFrom) return false;
      let achou = false;
      for (const n of imp.nomes) {
        if (n.nome === "*" || n.nome === "") continue;
        let m: Modulo = null;
        if (relativo) m = modulo(base, [...segs, n.nome]);
        else {
          for (const r of [raiz, ...raizes.filter((x) => x !== raiz)]) {
            m = modulo(r, [...segs, n.nome]);
            if (m !== null && "arquivo" in m) break;
          }
        }
        if (m !== null && "arquivo" in m) {
          ac.aresta(arquivo, imp.linha, idArquivo(m.arquivo), "exata", tipoAresta);
          achou = true;
        }
      }
      void nsPasta;
      return achou;
    };

    for (const a of arquivosDe(ctx, ["python"]))
      for (const imp of a.extracao.imports) {
        if (imp.tipo === "dinamico") {
          // `importlib.import_module("x")` literal: tenta; se não achar, dinâmico não resolvido (listado)
          const antes = ac.nao_resolvidos.length;
          processar(a.caminho, { ...imp, tipo: "estatico" });
          if (ac.nao_resolvidos.length > antes) (ac.nao_resolvidos[ac.nao_resolvidos.length - 1] as { motivo: string }).motivo = "dinamico";
          continue;
        }
        processar(a.caminho, imp);
      }
    return ac.resultado();
  },
};
