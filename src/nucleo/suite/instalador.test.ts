import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { listarProcessos, matarArvoreDaPasta } from "../../../tests/limpeza";
import { classificarFalha } from "./instalador";
import { compararManifestos, criarManifesto } from "./manifesto";
import type { ProgressoSuite } from "./modelo";
import { FIX, criarAmbienteDeTeste, type Cenario, type Opc } from "../../../tests/suite/instalador-util";

const T = criarAmbienteDeTeste();
const { base, esperarLog } = T;
const cenario = (o: Opc = {}): Promise<Cenario> => T.cenario(o);
afterEach(() => T.liberarPermissoes());
afterAll(() => T.encerrar());

describe("instalação com npm e expxdev falsos", () => {
  it("sucesso: etapas, resumo, lock conferido e diff da árvore", async () => {
    const c = await cenario();
    const { progresso: p, diferenca } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect(p.percentual).toBe(100);
    expect(p.etapas.map((e) => e.situacao)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(p.resumo?.versao).toBe("0.9.0");
    expect(p.resumo?.skills).toHaveLength(9);
    expect(p.resumo?.criados).toContain(".expx/expx-lock.json");
    expect(p.resumo?.criados).toContain(".claude/skills/runx/SKILL.md");
    expect(p.resumo?.fora_do_esperado).toEqual([]);
    expect(p.resumo?.doctor).toBe("ok");
    expect(diferenca?.removidos).toEqual([]);
    expect(p.falha).toBeNull();
    // o diff independente confere com o do instalador
    expect(compararManifestos(c.antes.mapa, (await criarManifesto(c.raiz)).mapa).criados).toEqual(diferenca?.criados);
    // percentual só sobe
    const pcts = c.eventos.map((e) => e.percentual);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    // log limpo de ANSI
    expect(p.log.join("\n")).not.toMatch(/\u001b/);
    expect(p.log.join("\n")).toContain("instalando runx");
  });

  it("argumentos, cwd e ambiente dos processos conforme a especificação (sem shell, versão fixada, registro explícito, sem ORCA_)", async () => {
    const c = await cenario();
    await c.rodar();
    const ch = c.chamadas();
    const npm = ch.find((x) => x["tipo"] === "install")!;
    const init = ch.find((x) => x["quem"] === "expxdev" && (x["argv"] as string[])[0] === "init")!;
    const doctor = ch.find((x) => x["quem"] === "expxdev" && (x["argv"] as string[])[0] === "doctor")!;
    const argv = npm["argv"] as string[];
    expect(argv).toEqual(expect.arrayContaining(["install", "--prefix", "--no-save", "--ignore-scripts", "--registry", "https://registry.npmjs.org/", "expxdev@0.9.0"]));
    expect(argv.join(" ")).not.toMatch(/latest|npx/);
    // download com cwd NEUTRO: nunca a raiz do projeto
    const raizReal = realpathSync(c.raiz);
    expect(npm["cwd"]).not.toBe(raizReal);
    expect(String(npm["cwd"]).startsWith(realpathSync(c.tmpPai))).toBe(true);
    const envNpm = npm["env"] as Record<string, string>;
    expect(envNpm["NPM_CONFIG_REGISTRY"]).toBe("https://registry.npmjs.org/");
    expect(envNpm["NPM_CONFIG_IGNORE_SCRIPTS"]).toBe("true");
    expect(envNpm["NPM_CONFIG_USERCONFIG"]).toContain("suite-");
    expect(envNpm["NPM_CONFIG_GLOBALCONFIG"]).toContain("suite-");
    expect(envNpm["npm_config_registry"]).toBeUndefined();
    // init e doctor no projeto, sem flags inventadas, CI=1, stdin fechado
    expect(init["cwd"]).toBe(raizReal);
    // SEMPRE `--yes` e `--skills` (sem elas o init falha com "nenhuma skill selecionada" ou só simula)
    expect(init["argv"]).toEqual(["init", "--yes", "--skills", "sprintx,runx,legadox,stackx,mergex,memox,prodx,buildx,designx", "--harness", "claude,opencode"]);
    expect(doctor["cwd"]).toBe(raizReal);
    expect(init["stdinTTY"]).toBe(false);
    for (const e of [npm["env"], init["env"], doctor["env"]] as Array<Record<string, string>>) {
      expect(Object.keys(e).filter((k) => /^ORCA_|^CLAUDE|^NODE_OPTIONS$|TOKEN|API_KEY/.test(k))).toEqual([]);
      expect(e["CI"]).toBe("1");
    }
    expect((init["env"] as Record<string, string>)["NPM_CONFIG_REGISTRY"]).toBeUndefined();
    // processos criados SEM shell: executável é um caminho absoluto resolvido, argumentos um array
    for (const p of c.pedidos) {
      expect(p.executavel.startsWith("/")).toBe(true);
      expect(p.executavel).not.toMatch(/\/(sh|bash|zsh|cmd\.exe)$/);
      expect(Array.isArray(p.argumentos)).toBe(true);
    }
    // temporária removida
    expect(readdirSync(c.tmpPai).filter((x) => x.startsWith("suite-"))).toEqual([]);
  });

  it("versão configurável chega ao npm e ao lock", async () => {
    const c = await cenario({ versao: "0.9.1" });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect((c.chamadas().find((x) => x["tipo"] === "install")!["argv"] as string[]).includes("expxdev@0.9.1")).toBe(true);
    expect(p.resumo?.versao).toBe("0.9.1");
  });

  it("segredo na saída é redigido antes de ir ao log", async () => {
    const c = await cenario({ extraAmbiente: { FAKE_SEGREDO: "1" } });
    const { progresso: p } = await c.rodar();
    expect(p.log.join("\n")).not.toMatch(/AAAAAAAA/);
    expect(p.log.join("\n")).toContain("npm_***");
  });

  it("arquivo do usuário em .claude que o init altera: aviso no resumo e cópia de segurança", async () => {
    const c = await cenario({ projeto: "ausente-com-claude", init: "existente" });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect(p.resumo?.alterados).toContain(".claude/settings.json");
    expect(p.resumo?.backup).not.toBeNull();
    const pasta = readdirSync(join(c.dir, "dados", "suite", "backups", "ws_teste"))[0]!;
    expect(readFileSync(join(c.dir, "dados", "suite", "backups", "ws_teste", pasta, ".claude", "settings.json"), "utf8")).toBe("{}\n");
  });
});

describe("falhas", () => {
  const nuncaVaza = (p: ProgressoSuite, c: Cenario): void => {
    expect(p.diagnostico).not.toBeNull();
    expect(p.diagnostico).not.toContain(c.raiz);
    expect(p.diagnostico).not.toContain(c.dir);
    expect(p.diagnostico).not.toMatch(/segredo-npm|evil/);
  };

  it("npm sem rede → sem_internet, na etapa de download", async () => {
    const c = await cenario({ npm: "rede" });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("falhou");
    expect(p.falha).toMatchObject({ causa: "sem_internet", etapa: "baixando" });
    expect(p.etapas.map((e) => e.situacao)).toEqual(["ok", "falhou", "pendente", "pendente", "pendente"]);
    nuncaVaza(p, c);
    expect(c.chamadas().some((x) => x["quem"] === "expxdev")).toBe(false);
  });

  it("sondagem do registro falha → sem_internet / registro_inacessivel, antes de baixar", async () => {
    for (const causa of ["sem_internet", "registro_inacessivel"] as const) {
      const c = await cenario({ sonda: async () => ({ ok: false, causa, detalhe: "x" }) });
      const { progresso: p } = await c.rodar();
      expect(p.falha?.causa).toBe(causa);
      expect(p.falha?.etapa).toBe("requisitos");
      expect(c.chamadas().some((x) => x["tipo"] === "install")).toBe(false);
      expect(existsSync(join(c.raiz, ".expx"))).toBe(false);
    }
  });

  it("init sai com código ≠ 0 → comando_falhou com o código; o projeto fica como o init deixou (reparar)", async () => {
    const c = await cenario({ init: "erro" });
    const { progresso: p } = await c.rodar();
    expect(p.falha).toMatchObject({ causa: "comando_falhou", codigo: 3, etapa: "instalando" });
    expect(p.falha?.mensagem).toContain("código 3");
    expect(p.log.join("\n")).toContain("boom");
    nuncaVaza(p, c);
  });

  it("init com erro de rede no GitHub → sem_internet", async () => {
    const c = await cenario({ init: "falha" });
    expect((await c.rodar()).progresso.falha?.causa).toBe("sem_internet");
  });

  it("silêncio (processo parado sem saída) → sem_resposta e o processo morre", async () => {
    const c = await cenario({ npm: "trava", silencio: 400 });
    const t0 = Date.now();
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("sem_resposta");
    expect(Date.now() - t0).toBeLessThan(8_000);
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
  });

  it("tempo total esgotado → tempo_esgotado e o processo morre", async () => {
    const c = await cenario({ npm: "trava", total: 700, silencio: 20_000 });
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("tempo_esgotado");
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
  });

  it("saída gigante → saida_excessiva, log limitado, processo morto", async () => {
    const c = await cenario({ npm: "gigante" });
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("saida_excessiva");
    expect(p.log.length).toBeLessThanOrEqual(150);
    expect(p.log.every((l) => l.length <= 405)).toBe(true);
    expect(p.log_truncado).toBe(true);
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
  });

  it("pacote com nome ou versão diferente da pedida → pacote_invalido", async () => {
    for (const npm of ["pacote_ruim", "versao_outra"]) {
      const c = await cenario({ npm });
      const { progresso: p } = await c.rodar();
      expect(p.falha?.causa, npm).toBe("pacote_invalido");
      expect(c.chamadas().some((x) => x["quem"] === "expxdev")).toBe(false);
    }
  });

  it("lock gravado com versão diferente da pedida → conferencia", async () => {
    const c = await cenario({ extraAmbiente: { FAKE_LOCK_VERSAO: "0.8.0" } });
    const { progresso: p } = await c.rodar();
    expect(p.falha).toMatchObject({ causa: "conferencia", etapa: "conferindo" });
  });

  it("doctor com aviso não derruba: resumo.doctor = avisos", async () => {
    const c = await cenario({ extraAmbiente: { FAKE_DOCTOR: "falha" } });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect(p.resumo?.doctor).toBe("avisos");
  });

  it("Node ausente → node_ausente", async () => {
    const c = await cenario({ ambienteBruto: { PATH: "/caminho/que/nao/existe" } });
    const { progresso: p } = await c.rodar();
    expect(p.falha).toMatchObject({ causa: "node_ausente", etapa: "requisitos" });
  });

  it("Node antigo → versao_incompativel", async () => {
    const c = await cenario({ path: `${join(FIX, "node-antigo")}:${join(FIX, "npm-falso")}:/usr/bin:/bin` });
    // `ambienteSeguro` acrescenta pastas de Homebrew/nvm ao fim do PATH; a antiga vem primeiro
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("versao_incompativel");
  });

  it("pasta sem permissão de escrita → sem_permissao", async () => {
    const c = await cenario({ semPermissao: true });
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("sem_permissao");
  });

  it("classificarFalha pela cauda do log", () => {
    expect(classificarFalha(["npm error code EACCES"])).toBe("sem_permissao");
    expect(classificarFalha(["getaddrinfo ENOTFOUND registry.npmjs.org"])).toBe("sem_internet");
    expect(classificarFalha(["npm error 404 Not Found - GET https://registry.npmjs.org/expxdev"])).toBe("registro_inacessivel");
    expect(classificarFalha(["boom"])).toBe("comando_falhou");
  });
});

describe("cancelamento", () => {
  it("no meio do init: mata a árvore, remove só o que foi criado e preserva o que já existia", async () => {
    const c = await cenario({ projeto: "ausente-com-claude", init: "trava" });
    const promessa = c.rodar();
    await esperarLog(c, "meio da instalacao");
    c.ac.abort();
    const { progresso: p } = await promessa;
    expect(p.fase).toBe("cancelada");
    expect(p.limpeza).toMatch(/Removi \d+ arquivo/);
    const depois = await criarManifesto(c.raiz);
    expect(compararManifestos(c.antes.mapa, depois.mapa)).toEqual({ criados: [], alterados: [], removidos: [], fora_do_esperado: [] });
    expect(readFileSync(join(c.raiz, ".claude/settings.json"), "utf8")).toBe("{}\n");
    expect(existsSync(join(c.raiz, ".expx"))).toBe(false);
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
    expect(p.diagnostico).not.toContain(c.dir);
  });

  it("no download: nada foi gravado no projeto e isso é dito", async () => {
    const c = await cenario({ npm: "trava" });
    const promessa = c.rodar();
    await esperarLog(c, "registry");
    c.ac.abort();
    const { progresso: p } = await promessa;
    expect(p.fase).toBe("cancelada");
    expect(p.limpeza).toMatch(/antes de gravar/);
    expect(compararManifestos(c.antes.mapa, (await criarManifesto(c.raiz)).mapa).criados).toEqual([]);
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
    expect(readdirSync(c.tmpPai).filter((x) => x.startsWith("suite-"))).toEqual([]);
  });

  it("cancelar já antes de começar não deixa nada", async () => {
    const c = await cenario();
    c.ac.abort();
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("cancelada");
    expect(c.chamadas().some((x) => x["tipo"] === "install")).toBe(false);
  });
});

describe("limpeza de processos desta suíte", () => {
  it("nenhum processo vivo cita a pasta de testes", () => {
    matarArvoreDaPasta(base);
    expect(listarProcessos().filter((x) => x.comando.includes(base))).toEqual([]);
  });
});
