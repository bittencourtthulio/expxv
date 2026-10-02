// Grok (xAI, "Grok Build TUI"): ferramenta de primeira classe (D-440 a D-443). Fatos verificados offline com `grok --help`,
// `grok mcp --help`, `grok models` e a documentação instalada com a CLI (~/.grok/docs/user-guide).
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ambienteSeguro } from "./ambiente";
import {
  argumentosAutomaticos, argumentosDeModelo, argumentosDePromptInicial, argumentosDeRetomada, CATALOGO_TERMINAIS, configuracaoDeMcp,
  FERRAMENTAS_COM_HOOK, modelosDaFerramenta, recursosDaFerramenta, teclaDeInterrupcao,
} from "./catalogo";
import { detectarFerramentas, RegistroExecutaveis } from "./deteccao";
import { FERRAMENTAS_IDS } from "./ipc-validadores";

const temporarios: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "expx-grok-"));
  temporarios.push(d);
  return d;
};
afterEach(() => temporarios.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

describe("grok no catálogo", () => {
  it("entrada mapeada, executável `grok`, id aceito pelo validador de IPC", () => {
    expect(CATALOGO_TERMINAIS.find((f) => f.id === "grok")).toMatchObject({ nome: "Grok", executaveis: ["grok"], mapeada: true });
    expect(FERRAMENTAS_IDS).toContain("grok");
  });

  it("detecção resolve o symlink (~/.local/bin/grok -> ~/.grok/bin/grok) por realpath", () => {
    const casa = tmp();
    const real = join(casa, ".grok", "bin", "grok");
    mkdirSync(join(casa, ".grok", "bin"), { recursive: true });
    writeFileSync(real, "#!/bin/sh\n");
    chmodSync(real, 0o755);
    mkdirSync(join(casa, ".local", "bin"), { recursive: true });
    symlinkSync(real, join(casa, ".local", "bin", "grok"));
    const reg = new RegistroExecutaveis({ plataforma: "darwin" });
    const r = detectarFerramentas({ plataforma: "darwin", path: "", diretorios_convencionais: [join(casa, ".local", "bin")], registro: reg });
    const g = r.find((f) => f.id === "grok");
    expect(g).toMatchObject({ instalado: true, erro_codigo: null, modo_lancamento: "direto" });
    expect(reg.obter(g!.executavel_id!)?.caminho).toBe(realpathSync(real));
  });
});

describe("grok: lançamento", () => {
  it("seguro: nenhum argumento; automático: --permission-mode auto, nunca bypassPermissions nem --always-approve", () => {
    expect(argumentosAutomaticos("grok", "seguro")).toEqual([]);
    expect(argumentosAutomaticos("grok", "automatico")).toEqual(["--permission-mode", "auto"]);
    const todos = argumentosAutomaticos("grok", "automatico").join(" ");
    for (const proibido of ["bypassPermissions", "--always-approve", "--yolo", "dontAsk"]) expect(todos).not.toContain(proibido);
  });

  it("retomada: --resume <id> com id validado (nunca começa com hífen)", () => {
    expect(argumentosDeRetomada("grok", "019a3c5e-7d21-7000-8000-000000000001")).toEqual(["--resume", "019a3c5e-7d21-7000-8000-000000000001"]);
    expect(argumentosDeRetomada("grok", "--always-approve")).toBeNull();
    expect(argumentosDeRetomada("grok", "a b")).toBeNull();
  });

  it("prompt inicial posicional; recusa o que o clap leria como opção ou subcomando (login, update, doctor...)", () => {
    expect(argumentosDePromptInicial("grok", "corrija o bug")).toEqual(["corrija o bug"]);
    expect(argumentosDePromptInicial("grok", "-p x")).toBeNull();
    for (const sub of ["login", "logout", "update", "doctor", "models", "mcp", "version"]) expect(argumentosDePromptInicial("grok", sub)).toBeNull();
    expect(argumentosDePromptInicial("grok", "models disponíveis")).toEqual(["models disponíveis"]);
  });

  it("modelo por --model (valor validado); `default` não gera flag", () => {
    expect(argumentosDeModelo("grok", "grok-4.7")).toEqual(["--model", "grok-4.7"]);
    expect(argumentosDeModelo("grok", "default")).toEqual([]);
    expect(argumentosDeModelo("grok", "--always-approve")).toEqual([]);
  });

  it("interrupção é Ctrl+C: na documentação do Grok o Esc nunca cancela um turno", () => {
    expect(teclaDeInterrupcao("grok")).toBe("\x03");
  });

  it("modelos estáticos: só o padrão da CLI e os ids listados por `grok models` (2026-10-01)", () => {
    expect(modelosDaFerramenta("grok").map((m) => m.modelo)).toEqual(["default", "grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5"]);
    expect(modelosDaFerramenta("grok").filter((m) => m.padrao === true).map((m) => m.modelo)).toEqual(["default"]);
  });
});

describe("grok: MCP e hooks por Pane (D-441)", () => {
  it("sem mecanismo seguro por Pane: configuracaoDeMcp devolve null e a UI recebe mcp=false, hook=false", () => {
    const s = { nome: "paineis", url: "http://127.0.0.1:4567/mcp", variavel_token: "APP_MCP_TOKEN", token: "tok" };
    expect(configuracaoDeMcp("grok", s, "/x.json")).toBeNull();
    expect(FERRAMENTAS_COM_HOOK).not.toContain("grok");
    expect(recursosDaFerramenta("grok")).toEqual({ prompt_inicial: true, retomar: true, mcp: false, hook: false });
  });
});

describe("grok: ambiente (D-442)", () => {
  it("GROK_* e XAI_* do usuário passam intactos; o app não os lê, só os repassa", () => {
    const origem = { GROK_SANDBOX: "workspace", GROK_HOME: "/x/.grok", XAI_API_KEY: "xai-valor-do-usuario", PATH: "/usr/bin", CLAUDECODE: "1" };
    const amb = ambienteSeguro({ caminho: "/h/.grok/bin/grok" }, { origem, scrub: null, inicio: "/h", plataforma: "darwin" });
    expect(amb["GROK_SANDBOX"]).toBe("workspace");
    expect(amb["GROK_HOME"]).toBe("/x/.grok");
    expect(amb["XAI_API_KEY"]).toBe("xai-valor-do-usuario");
    expect(amb["CLAUDECODE"]).toBeUndefined();
  });
});
