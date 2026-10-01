import { describe, expect, it, vi } from "vitest";
import { argumentoCmd, encerrarArvorePty, prepararLancamento } from "./lancamento";

describe("encerramento da árvore", () => {
  it("sinaliza o grupo do forkpty no Unix", () => {
    const sinais: Array<[number, string]> = [];
    const processo = { pid: 4321, kill: vi.fn() };
    encerrarArvorePty(processo, "SIGTERM", "darwin", (pid, sinal) => { sinais.push([pid, sinal]); return true; });
    expect(sinais).toEqual([[-4321, "SIGTERM"]]);
    expect(processo.kill).not.toHaveBeenCalled();
  });

  it("cai no kill do processo se o grupo não existe mais", () => {
    const processo = { pid: 4321, kill: vi.fn() };
    encerrarArvorePty(processo, "SIGKILL", "linux", () => { throw new Error("ESRCH"); });
    expect(processo.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("usa taskkill com árvore no Windows e cai no kill se ele falhar", () => {
    const comandos: Array<[string, readonly string[]]> = [];
    let aoErro: (() => void) | undefined;
    const processo = { pid: 7654, kill: vi.fn() };
    encerrarArvorePty(processo, "SIGTERM", "win32", undefined, (arquivo, argumentos) => {
      comandos.push([arquivo, argumentos]);
      return { once: (_e: string, fn: () => void) => { aoErro = fn; return undefined as never; }, unref: () => undefined } as never;
    });
    expect(comandos).toEqual([["taskkill.exe", ["/pid", "7654", "/t", "/f"]]]);
    aoErro?.();
    expect(processo.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("prepararLancamento", () => {
  it("direto: argv separado, sem shell e sem reinterpretar metacaracteres", () => {
    const r = prepararLancamento({ ferramenta_id: "terminal", caminho: "/bin/x", modo_lancamento: "direto" }, ["a b", "$(rm -rf /)", "; ls"]);
    expect(r).toEqual({ arquivo: "/bin/x", argumentos: ["a b", "$(rm -rf /)", "; ls"] });
  });

  it("cmd_wrapper: usa call e preserva caminho e argumentos entre aspas", () => {
    const anterior = process.env["ComSpec"];
    process.env["ComSpec"] = "C:\\Windows\\System32\\cmd.exe";
    try {
      expect(prepararLancamento({ ferramenta_id: "opencode", caminho: "C:\\Users\\U\\npm\\opencode.cmd", modo_lancamento: "cmd_wrapper" }, ["--auto"])).toEqual({
        arquivo: "C:\\Windows\\System32\\cmd.exe",
        argumentos: '/d /q /c call "C:\\Users\\U\\npm\\opencode.cmd" "--auto"',
      });
    } finally {
      if (anterior === undefined) delete process.env["ComSpec"]; else process.env["ComSpec"] = anterior;
    }
  });

  it("cmd_wrapper: escapa ^ & | < > ( ) ! \" com ^ e dobra %", () => {
    expect(argumentoCmd("a^b")).toBe('"a^^b"');
    expect(argumentoCmd("100%")).toBe('"100%%"');
    expect(argumentoCmd("%PATH%")).toBe('"%%PATH%%"');
    expect(argumentoCmd('x&y|z<w>(v)!"')).toBe('"x^&y^|z^<w^>^(v^)^!^""');
    const r = prepararLancamento({ ferramenta_id: "x", caminho: "C:\\a b\\x.cmd", modo_lancamento: "cmd_wrapper" }, ["^", "%%"]);
    expect(r.argumentos).toContain('"^^" "%%%%"');
  });

  it("cmd_wrapper: recusa quebra de linha e NUL no argumento", () => {
    expect(() => argumentoCmd("a\nb")).toThrow();
    expect(() => argumentoCmd("a\0b")).toThrow();
    expect(() => prepararLancamento({ ferramenta_id: "x", caminho: "x.cmd", modo_lancamento: "cmd_wrapper" }, ["a\rb"])).toThrow();
  });

  it("powershell_wrapper: -File com argumentos separados", () => {
    const r = prepararLancamento({ ferramenta_id: "x", caminho: "C:\\x.ps1", modo_lancamento: "powershell_wrapper" }, ["--a"]);
    expect(r.arquivo).toBe("powershell.exe");
    expect(r.argumentos).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\x.ps1", "--a"]);
  });
});
