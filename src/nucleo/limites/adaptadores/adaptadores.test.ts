import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { derivarUso } from "../derivar";
import { juntarSettingsDoClaude } from "../../terminais/settings-claude";
import { statuslineDoPane, VARIAVEL_ARQUIVO_STATUSLINE, fragmentoStatusLine } from "../statusline";
import type { ContaLimite, ContextoLeitura } from "./adaptador";
import { caminhoStatusline, criarAdaptadorClaudeStatusline } from "./claude-statusline";
import { criarAdaptadorCodexRollout, lerFinal, rolloutsRecentes, ultimoRateLimits } from "./codex-rollout";
import { criarAdaptadorEstimado } from "./estimado";
import { criarAdaptadorManual } from "./manual";
import { criarAdaptadorPrecisaoMaxima, precisaoMaximaAtiva, VERSAO_CONSENTIMENTO_PRECISAO } from "./precisao-maxima";

const FIX = resolve(__dirname, "../../../../tests/fixtures/limites");
const SCRIPT = resolve(__dirname, "../scripts/statusline-claude.mjs");
const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const ctx = (): ContextoLeitura => ({ sinal: new AbortController().signal, agora: AGORA });
const contaCodex = (dir: string | null): ContaLimite => ({ id: "conta_codex", provedor: "codex", rotulo: "cx·1", config_dir: dir, habilitada: true });
const contaClaude: ContaLimite = { id: "conta_claude", provedor: "claude", rotulo: "cl·1", config_dir: null, habilitada: true };

import type { LimitSnapshot } from "../../../compartilhado/limites";
const um = async (p: Promise<LimitSnapshot | LimitSnapshot[] | null>): Promise<LimitSnapshot | null> => {
  const r = await p;
  return Array.isArray(r) ? (r[0] ?? null) : r;
};

const tmps: string[] = [];
const pasta = (): string => {
  const p = mkdtempSync(join(tmpdir(), "ade-limites-"));
  tmps.push(p);
  return p;
};
afterAll(() => { for (const p of tmps) rmSync(p, { recursive: true, force: true }); });

describe("T-09.05 · adaptador Codex (rollout)", () => {
  const ad = criarAdaptadorCodexRollout();

  it("fixture com rate_limits: o rollout MAIS RECENTE vence e a linha final truncada é ignorada", async () => {
    const s = await um(ad.ler(contaCodex(join(FIX, "codex/conta-ok")), ctx()));
    expect(s).not.toBeNull();
    expect(s?.fonte).toBe("codex_rollout");
    expect(s?.confianca).toBe("medido");
    expect(s?.windows.find((j) => j.kind === "five_hour")?.used_pct).toBe(33.5); // 2ª leitura do dia 28 (a 3ª é null, a 4ª truncada)
    expect(s?.windows.find((j) => j.kind === "weekly")?.used_pct).toBe(46.5);
    expect(s?.fetched_at).toBe("2026-09-28T13:09:00.000Z");
    const uso = derivarUso(s!, AGORA);
    expect(uso.bottleneck).toBe("weekly");
    expect(uso.slack_pct).toBe(53.5);
  });

  it("fixture só com semanal (primary 10080) mapeia weekly", async () => {
    const d = pasta();
    mkdirSync(join(d, "sessions/2026/09/27"), { recursive: true });
    copyFileSync(join(FIX, "codex/conta-ok/sessions/2026/09/27/rollout-2026-09-27T18-43-01-aaaaaaaa-0000-0000-0000-000000000001.jsonl"), join(d, "sessions/2026/09/27/rollout-x.jsonl"));
    const s = await um(ad.ler(contaCodex(d), ctx()));
    expect(s?.windows).toEqual([{ kind: "weekly", used_pct: 45, resets_at: new Date(1791058572 * 1000).toISOString() }]);
  });

  it("sem rate_limits (null) → null, não erro", async () => {
    expect(await um(ad.ler(contaCodex(join(FIX, "codex/conta-sem-rate")), ctx()))).toBeNull();
  });

  it("conta sem pasta, pasta inexistente ou sem sessions → null", async () => {
    expect(await um(ad.ler(contaCodex(null), ctx()))).toBeNull();
    expect(await um(ad.ler(contaCodex(join(pasta(), "nao-existe")), ctx()))).toBeNull();
    expect(await um(ad.ler(contaCodex(pasta()), ctx()))).toBeNull();
  });

  it("só provedor codex com config dir é aplicável", () => {
    expect(ad.aplicavel(contaCodex("/x"))).toBe(true);
    expect(ad.aplicavel(contaCodex(null))).toBe(false);
    expect(ad.aplicavel(contaClaude)).toBe(false);
  });

  it("nunca lê auth.json: arquivo isca fora de sessions/ não é aberto", async () => {
    const d = pasta();
    writeFileSync(join(d, "auth.json"), '{"rate_limits":{"primary":{"used_percent":99,"window_minutes":300}}}');
    expect(await um(ad.ler(contaCodex(d), ctx()))).toBeNull();
  });

  it("rolloutsRecentes percorre dia a dia em ordem decrescente e para em 3", async () => {
    const d = pasta();
    for (const dia of ["01", "02", "03"]) {
      mkdirSync(join(d, `2026/09/${dia}`), { recursive: true });
      for (const h of ["10", "11"]) writeFileSync(join(d, `2026/09/${dia}/rollout-2026-09-${dia}T${h}-x.jsonl`), "{}\n");
    }
    mkdirSync(join(d, "2025/12/31"), { recursive: true });
    writeFileSync(join(d, "2025/12/31/rollout-velho.jsonl"), "{}\n");
    writeFileSync(join(d, "2026/09/03/notas.txt"), "x");
    const r = await rolloutsRecentes(d);
    expect(r.map((c) => c.slice(d.length + 1))).toEqual(["2026/09/03/rollout-2026-09-03T11-x.jsonl", "2026/09/03/rollout-2026-09-03T10-x.jsonl", "2026/09/02/rollout-2026-09-02T11-x.jsonl"]);
  });

  it("arquivo de 50 MB: lê só o final (64 KB) e acha o rate_limits", async () => {
    const d = pasta();
    const dir = join(d, "sessions/2026/09/28");
    mkdirSync(dir, { recursive: true });
    const arquivo = join(dir, "rollout-2026-09-28T10-00-00-grande.jsonl");
    const linhaRuido = JSON.stringify({ timestamp: "2026-09-28T13:00:00.000Z", type: "response_item", payload: { type: "message", content: [{ text: "x".repeat(900) }] } }) + "\n";
    const bloco = linhaRuido.repeat(1000); // ~0,9 MB
    writeFileSync(arquivo, "");
    for (let i = 0; i < 55; i++) appendFileSync(arquivo, bloco);
    appendFileSync(arquivo, JSON.stringify({ timestamp: "2026-09-28T14:00:00.000Z", type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: 61, window_minutes: 300, resets_at: 1790900000 }, secondary: { used_percent: 20, window_minutes: 10080, resets_at: 1791058572 } } } }) + "\n");
    appendFileSync(arquivo, linhaRuido.repeat(50));
    expect(statSync(arquivo).size).toBeGreaterThan(50 * 1024 * 1024);
    const t0 = performance.now();
    const s = await um(ad.ler(contaCodex(d), ctx()));
    const ms = performance.now() - t0;
    expect(s?.windows.find((j) => j.kind === "five_hour")?.used_pct).toBe(61);
    expect(ms).toBeLessThan(150 * 5); // folga larga para CI lenta; o orçamento P-100 estrito é medido em tests/perf
    expect((await lerFinal(arquivo))!.length).toBeLessThanOrEqual(64 * 1024);
  });

  it("ultimoRateLimits: lixo, linha curta e JSON sem payload não derrubam", () => {
    expect(ultimoRateLimits("")).toBeNull();
    expect(ultimoRateLimits('lixo rate_limits sem json\n{"payload":1,"rate_limits":2}\n')).toBeNull();
    expect(ultimoRateLimits('{"payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":5,"window_minutes":300}}}}')?.rate_limits).toBeTruthy();
  });
});

describe("T-09.06 · adaptador Claude (statusline por Pane)", () => {
  const pastaDados = pasta();
  const ad = criarAdaptadorClaudeStatusline({ pastaDeDados: pastaDados });
  const instalar = (fixture: string): void => {
    const alvo = caminhoStatusline(pastaDados, contaClaude.id)!;
    mkdirSync(join(alvo, ".."), { recursive: true });
    copyFileSync(join(FIX, "claude", fixture), alvo);
  };

  it("arquivo completo: five_hour, seven_day→weekly e seven_day_opus→balde", async () => {
    instalar("statusline-completo.json");
    const s = await um(ad.ler(contaClaude, ctx()));
    expect(s?.fonte).toBe("claude_statusline");
    expect(s?.windows.map((j) => [j.kind, j.used_pct])).toEqual([["five_hour", 62], ["weekly", 31]]);
    expect(s?.model_buckets["opus"]?.used_pct).toBe(74);
    expect(s?.fetched_at).toBe("2026-10-01T11:58:00.000Z");
    expect(derivarUso(s!, AGORA).bottleneck).toBe("five_hour");
  });

  it("parcial: campo ausente fica fora (nunca 0)", async () => {
    instalar("statusline-parcial.json");
    const s = await um(ad.ler(contaClaude, ctx()));
    expect(s?.windows).toHaveLength(1);
    expect(s?.windows.some((j) => j.kind === "weekly")).toBe(false);
  });

  it("sem rate_limits, corrompido ou ausente → null", async () => {
    instalar("statusline-sem-rate-limits.json");
    expect(await um(ad.ler(contaClaude, ctx()))).toBeNull();
    instalar("statusline-corrompido.json");
    expect(await um(ad.ler(contaClaude, ctx()))).toBeNull();
    expect(await um(ad.ler({ ...contaClaude, id: "conta_outra" }, ctx()))).toBeNull();
  });

  it("id de conta com path traversal não gera caminho; opt-out desliga o adaptador", () => {
    expect(caminhoStatusline(pastaDados, "../../etc/passwd")).toBeNull();
    expect(criarAdaptadorClaudeStatusline({ pastaDeDados: pastaDados, habilitado: () => false }).aplicavel(contaClaude)).toBe(false);
    expect(ad.aplicavel(contaClaude)).toBe(true);
    expect(ad.aplicavel(contaCodex("/x"))).toBe(false);
  });

  it("arquivo gigante é recusado", async () => {
    const alvo = caminhoStatusline(pastaDados, contaClaude.id)!;
    writeFileSync(alvo, " ".repeat(70 * 1024));
    expect(await um(ad.ler(contaClaude, ctx()))).toBeNull();
  });
});

describe("T-09.06 · script statusline-claude.mjs", () => {
  const rodar = (entrada: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [SCRIPT, "VAR_ARQUIVO_TESTE"], { input: entrada, env: { PATH: process.env["PATH"] ?? "", ...env }, encoding: "utf8", timeout: 10_000 });

  it("grava só {v, recebido_em, rate_limits, model} (0600) e imprime a linha curta; caminho com espaços funciona", () => {
    const d = join(pasta(), "pasta com espaços", "claude");
    const arquivo = join(d, "conta_x.json");
    const r = rodar(readFileSync(join(FIX, "claude/stdin-claude-completo.json"), "utf8"), { VAR_ARQUIVO_TESTE: arquivo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("5h 62% · 7d 31%\n");
    const gravado = JSON.parse(readFileSync(arquivo, "utf8")) as Record<string, unknown>;
    expect(Object.keys(gravado).sort()).toEqual(["model", "rate_limits", "recebido_em", "v"]);
    expect(gravado["v"]).toBe(1);
    expect(JSON.stringify(gravado)).not.toContain("transcript_path");
    expect(JSON.stringify(gravado)).not.toContain("/work/projeto");
    if (process.platform !== "win32") expect(statSync(arquivo).mode & 0o777).toBe(0o600);
    expect(readdirSync(d).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("sem rate_limits: não grava nada, não quebra (exit 0) e imprime linha vazia", () => {
    const arquivo = join(pasta(), "c.json");
    const r = rodar(readFileSync(join(FIX, "claude/stdin-claude-sem-rate-limits.json"), "utf8"), { VAR_ARQUIVO_TESTE: arquivo });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("\n");
    expect(existsSync(arquivo)).toBe(false);
  });

  it("entrada lixo, vazia, variável ausente ou caminho relativo: exit 0 e nada gravado", () => {
    for (const [entrada, env] of [["lixo{{", { VAR_ARQUIVO_TESTE: join(pasta(), "a.json") }], ["", { VAR_ARQUIVO_TESTE: join(pasta(), "b.json") }], [JSON.stringify({ rate_limits: { five_hour: { used_percentage: 5 } } }), {}], [JSON.stringify({ rate_limits: { five_hour: { used_percentage: 5 } } }), { VAR_ARQUIVO_TESTE: "relativo.json" }]] as const) {
      const r = rodar(entrada, env);
      expect(r.status).toBe(0);
      if ("VAR_ARQUIVO_TESTE" in env) expect(existsSync(env.VAR_ARQUIVO_TESTE)).toBe(false);
    }
    expect(existsSync(join(process.cwd(), "relativo.json"))).toBe(false);
  });

  it("dois Panes da mesma conta em paralelo não corrompem o arquivo", async () => {
    const arquivo = join(pasta(), "claude", "conta_x.json");
    const entrada = (n: number) => JSON.stringify({ rate_limits: { five_hour: { used_percentage: n, resets_at: 1790860800 } } });
    await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise<void>((ok) => {
      const p = require("node:child_process").spawn(process.execPath, [SCRIPT, "VAR_ARQUIVO_TESTE"], { env: { PATH: process.env["PATH"] ?? "", VAR_ARQUIVO_TESTE: arquivo } });
      p.stdin.end(entrada(10 + i));
      p.on("close", () => ok());
    })));
    const j = JSON.parse(readFileSync(arquivo, "utf8")) as { v: number; rate_limits: { five_hour: { used_percentage: number } } };
    expect(j.v).toBe(1);
    expect(j.rate_limits.five_hour.used_percentage).toBeGreaterThanOrEqual(10);
    expect(readdirSync(join(arquivo, "..")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("o trecho statusLine usa a variável do produto, aspas para caminho com espaço e recusa aspas no caminho", () => {
    const f = fragmentoStatusLine({ script: "/a b/statusline-claude.mjs" });
    expect(f?.statusLine.command).toBe(`"node" "/a b/statusline-claude.mjs" ${VARIAVEL_ARQUIVO_STATUSLINE}`);
    expect(fragmentoStatusLine({ script: '/a"b/x.mjs' })).toBeNull();
    const p = statuslineDoPane({ script: "/a/s.mjs", pastaDeDados: "/dados com espaço", contaId: "conta_x" });
    expect(p?.ambiente[VARIAVEL_ARQUIVO_STATUSLINE]).toBe(join("/dados com espaço", "limites", "claude", "conta_x.json"));
    expect(JSON.parse(p!.argumentos[1] as string).statusLine.type).toBe("command");
    expect(statuslineDoPane({ script: "/a/s.mjs", pastaDeDados: "/d", contaId: "../x" })).toBeNull();
  });

  it("junta-se aos demais --settings sem perder hooks nem o statusLine; settings do usuário intactos", () => {
    const d = pasta();
    const a = join(d, "hooks.json");
    writeFileSync(a, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "http", url: "http://x" }] }] } }));
    const frag = statuslineDoPane({ script: "/a/s.mjs", pastaDeDados: d, contaId: "conta_x" })!;
    const b = join(d, "orq.json");
    writeFileSync(b, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "http", url: "http://y" }] }] } }));
    const usuario = join(d, "settings-usuario.json");
    writeFileSync(usuario, '{"theme":"dark"}');
    const argv = juntarSettingsDoClaude(["--settings", a, ...frag.argumentos, "--settings", b]);
    expect(argv.filter((x) => x === "--settings")).toHaveLength(1);
    const juntado = JSON.parse(readFileSync(argv[argv.indexOf("--settings") + 1] as string, "utf8")) as { statusLine?: { command: string }; hooks: { Stop: unknown[] } };
    expect(juntado.statusLine?.command).toContain("s.mjs");
    expect(juntado.hooks.Stop).toHaveLength(2);
    expect(readFileSync(usuario, "utf8")).toBe('{"theme":"dark"}');
  });
});

describe("limite manual", () => {
  const linhas = [
    { conta_id: "conta_claude", janela: "five_hour" as const, usado_pct: 70, reinicia_em: new Date(AGORA + 3_600_000).toISOString(), informado_em: new Date(AGORA - 60_000).toISOString() },
    { conta_id: "conta_claude", janela: "weekly" as const, usado_pct: 20, reinicia_em: null, informado_em: new Date(AGORA - 600_000).toISOString() },
    { conta_id: "conta_claude", janela: "monthly" as const, usado_pct: 99, reinicia_em: new Date(AGORA - 1).toISOString(), informado_em: new Date(AGORA - 900_000).toISOString() },
  ];
  const ad = criarAdaptadorManual({ listar: (id) => linhas.filter((l) => l.conta_id === id) });

  it("um snapshot por linha, confiança manual, com o informado_em de cada uma; expiradas somem", async () => {
    const r = (await ad.ler(contaClaude, ctx())) as unknown as Array<{ confianca: string; fonte: string; fetched_at: string; windows: Array<{ kind: string }> }>;
    expect(r).toHaveLength(2);
    expect(r.every((s) => s.confianca === "manual" && s.fonte === "manual")).toBe(true);
    expect(r.map((s) => s.windows[0]?.kind)).toEqual(["five_hour", "weekly"]);
    expect(r[0]?.fetched_at).toBe(new Date(AGORA - 60_000).toISOString());
  });
  it("sem linhas → null", async () => {
    expect(await ad.ler({ ...contaClaude, id: "outra" }, ctx())).toBeNull();
  });
});

describe("estimativa por consumo observado", () => {
  it("só com teto informado E consumo medido; nunca inventa folga", async () => {
    const consumo = new Map<string, number | null>([["conta_claude", 400]]);
    const ad = criarAdaptadorEstimado({ tetos: () => ({ cinco_horas: 1000, semana: null }), consumo: (id) => consumo.get(id) ?? null });
    const s = (await ad.ler(contaClaude, ctx())) as { fonte: string; confianca: string; windows: Array<{ kind: string; used_pct: number }> };
    expect(s.fonte).toBe("estimado");
    expect(s.confianca).toBe("estimado");
    expect(s.windows).toEqual([{ kind: "five_hour", used_pct: 40, resets_at: null }]);
    expect(await ad.ler({ ...contaClaude, id: "sem-consumo" }, ctx())).toBeNull();
    expect(await criarAdaptadorEstimado({ tetos: () => ({ cinco_horas: null, semana: null }), consumo: () => 5 }).ler(contaClaude, ctx())).toBeNull();
    const estoura = (await criarAdaptadorEstimado({ tetos: () => ({ cinco_horas: 100, semana: null }), consumo: () => 500 }).ler(contaClaude, ctx())) as { windows: Array<{ used_pct: number }> };
    expect(estoura.windows[0]?.used_pct).toBe(100);
  });
});

describe("modo Precisão máxima (P-27, opt-in)", () => {
  const bruto = { five_hour: { used_percentage: 41, resets_at: Math.floor(AGORA / 1000) + 3600 }, seven_day: { used_percentage: 12 } };
  const consentido = { ativo: true, versao: VERSAO_CONSENTIMENTO_PRECISAO, em: "2026-10-01T00:00:00.000Z" };

  it("padrão desligado: não é aplicável e a fonte oficial NUNCA é chamada", async () => {
    let chamadas = 0;
    const ad = criarAdaptadorPrecisaoMaxima({ provedor: "claude", config: () => undefined, fonte: { obter: async () => { chamadas++; return bruto; } } });
    expect(ad.aplicavel(contaClaude)).toBe(false);
    expect(await ad.ler(contaClaude, ctx())).toBeNull();
    expect(chamadas).toBe(0);
  });

  it("consentimento de versão antiga, sem data ou ativo:false não vale", () => {
    expect(precisaoMaximaAtiva({ ...consentido, versao: VERSAO_CONSENTIMENTO_PRECISAO - 1 })).toBe(false);
    expect(precisaoMaximaAtiva({ ...consentido, em: "" })).toBe(false);
    expect(precisaoMaximaAtiva({ ...consentido, ativo: false })).toBe(false);
    expect(precisaoMaximaAtiva(null)).toBe(false);
    expect(precisaoMaximaAtiva("true")).toBe(false);
    expect(precisaoMaximaAtiva(consentido)).toBe(true);
  });

  it("com consentimento: normaliza o JSON de uso (medido), rede declarada, intervalo 300 s, só o provedor ligado", async () => {
    const ad = criarAdaptadorPrecisaoMaxima({ provedor: "claude", config: () => consentido, fonte: { obter: async () => bruto } });
    expect(ad.rede).toBe(true);
    expect(ad.intervalo_min_s).toBe(300);
    expect(ad.aplicavel(contaClaude)).toBe(true);
    expect(ad.aplicavel(contaCodex("/x"))).toBe(false);
    const s = (await ad.ler(contaClaude, ctx())) as { confianca: string; windows: Array<{ kind: string; used_pct: number }> };
    expect(s.confianca).toBe("medido");
    expect(s.windows.map((j) => j.used_pct)).toEqual([41, 12]);
  });

  it("revogar no meio do caminho: não consulta; fonte que devolve lixo → null; fonte que lança propaga (breaker)", async () => {
    let ativo: unknown = consentido;
    let chamadas = 0;
    const ad = criarAdaptadorPrecisaoMaxima({ provedor: "claude", config: () => ativo, fonte: { obter: async () => { chamadas++; return "lixo"; } } });
    expect(await ad.ler(contaClaude, ctx())).toBeNull();
    expect(chamadas).toBe(1);
    ativo = undefined;
    expect(await ad.ler(contaClaude, ctx())).toBeNull();
    expect(chamadas).toBe(1);
    ativo = consentido;
    const quebra = criarAdaptadorPrecisaoMaxima({ provedor: "claude", config: () => ativo, fonte: { obter: async () => { throw new Error("rede"); } } });
    await expect(quebra.ler(contaClaude, ctx())).rejects.toThrow();
  });

  it("provedor sem mapeamento de fonte nunca é aplicável", () => {
    const ad = criarAdaptadorPrecisaoMaxima({ provedor: "gemini", config: () => consentido, fonte: { obter: async () => bruto } });
    expect(ad.aplicavel({ ...contaClaude, provedor: "gemini" })).toBe(false);
  });
});

describe("FORMA PRESUMIDA (REVISAR contra as CLIs instaladas antes de confiar)", () => {
  // Estes testes só provam que o parser entende as fixtures GRAVADAS no formato presumido. Se a CLI mudar o formato,
  // o que quebra primeiro é a fixture real recapturada, não o código.
  it("Claude: statusline entrega rate_limits.{five_hour,seven_day,seven_day_<familia>}.{used_percentage,resets_at(epoch s)} — presumido", () => {
    const stdin = JSON.parse(readFileSync(join(FIX, "claude/stdin-claude-completo.json"), "utf8")) as { rate_limits: Record<string, { used_percentage: number; resets_at: number }> };
    expect(Object.keys(stdin.rate_limits)).toEqual(["five_hour", "seven_day"]);
    expect(typeof stdin.rate_limits["five_hour"]?.resets_at).toBe("number");
  });
  it("Codex: token_count.rate_limits.{primary,secondary}.{used_percent,window_minutes,resets_at(epoch s)} — conferido em 2026-09 num rollout real (só a janela semanal apareceu)", () => {
    const linha = readFileSync(join(FIX, "codex/conta-ok/sessions/2026/09/27/rollout-2026-09-27T18-43-01-aaaaaaaa-0000-0000-0000-000000000001.jsonl"), "utf8").trim().split("\n").pop() as string;
    const rl = (JSON.parse(linha) as { payload: { rate_limits: { primary: Record<string, unknown> } } }).payload.rate_limits;
    expect(Object.keys(rl.primary).sort()).toEqual(["resets_at", "used_percent", "window_minutes"]);
  });
});
