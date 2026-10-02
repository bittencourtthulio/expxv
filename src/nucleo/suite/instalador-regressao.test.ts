// Regressão do defeito achado pelo dono ao usar o assistente (o `init` falhou com "nenhuma skill selecionada": o app não passava --skills nem --yes) e dos riscos
// do CLI real `expxdev` 0.9.0 lidos do pacote (troca atômica de .expx/, git obrigatório, catálogo de skills da versão, EXPX_SKILLS_LOCAIS). Sem rede: npm e CLI falsos.
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { listarProcessos } from "../../../tests/limpeza";
import { classificarFalha } from "./instalador";
import { compararManifestos, criarManifesto } from "./manifesto";
import { executarProcesso } from "./processo";
import { FIX, criarAmbienteDeTeste, type Cenario, type Opc } from "../../../tests/suite/instalador-util";

const T = criarAmbienteDeTeste("suite-regressao-");
const { base, esperarLog } = T;
const cenario = (o: Opc = {}): Promise<Cenario> => T.cenario(o);
afterEach(() => T.liberarPermissoes());
afterAll(() => T.encerrar());

const NOVE = "sprintx,runx,legadox,stackx,mergex,memox,prodx,buildx,designx";
const initDe = (c: Cenario): Record<string, unknown> => c.chamadas().find((x) => x["quem"] === "expxdev" && (x["argv"] as string[])[0] === "init")!;

describe("o init real exige --skills e --yes", () => {
  const BIN = join(FIX, "expxdev-falso", "dist", "cli", "expx-bin.js");
  const rodarBin = async (args: string[]): Promise<{ codigo: number | null; saida: string; arvore: string[] }> => {
    const proj = join(base, `bin${T.proximo()}`);
    mkdirSync(proj, { recursive: true });
    let saida = "";
    const r = await executarProcesso({
      executavel: process.execPath, argumentos: [BIN, ...args], cwd: proj, env: { PATH: process.env["PATH"] ?? "" }, tempoTotalMs: 20_000, silencioMs: 20_000, maxBytes: 1 << 20,
      aoLinha: (l) => { saida += `${l}\n`; },
    });
    return { codigo: r.codigo, saida, arvore: readdirSync(proj) };
  };

  it("sem --skills: falha com a mensagem EXATA do CLI real e não escreve nada", async () => {
    const r = await rodarBin(["init"]);
    expect(r.codigo).toBe(1);
    expect(r.saida).toContain("nenhuma skill selecionada");
    expect(r.saida).toContain("escolha as skills com --skills, ou rode num terminal para responder na hora:");
    expect(r.saida).toContain("disponiveis: sprintx, runx, legadox, stackx, mergex, memox, prodx, buildx, designx");
    expect(r.arvore).toEqual([]);
    const soYes = await rodarBin(["init", "--yes"]);
    expect(soYes.codigo).toBe(1);
    expect(soYes.saida).toContain("nenhuma skill selecionada");
  });

  it("com --skills mas sem --yes (sem terminal): só simula e não escreve", async () => {
    const r = await rodarBin(["init", "--skills", "sprintx,runx"]);
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("instalaria: sprintx, runx");
    expect(r.arvore).toEqual([]);
  });

  it("com --skills e --yes instala só as pedidas", async () => {
    const r = await rodarBin(["init", "--yes", "--skills", "sprintx,runx", "--harness", "claude"]);
    expect(r.codigo).toBe(0);
    expect(r.arvore.sort()).toEqual([".claude", ".expx"]);
  });

  it("o comando que o app monta SEMPRE leva --yes e --skills com a suíte completa", async () => {
    const c = await cenario();
    await c.rodar();
    expect(initDe(c)["argv"]).toEqual(["init", "--yes", "--skills", NOVE, "--harness", "claude,opencode"]);
  });

  it("pedido recusado pelo CLI é defeito do app: mensagem sem instruir o usuário a rodar comando e projeto intacto", async () => {
    const c = await cenario();
    c.deps.extras = ["--inexistente"];
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("defeito_do_app");
    expect(p.falha?.mensagem).toMatch(/defeito do app, não algo que você fez/);
    expect(`${p.falha?.mensagem} ${p.falha?.sugestao}`).not.toMatch(/npx|terminal|--skills|--yes/);
    expect(p.situacao_projeto).toBe("O projeto não foi alterado.");
    expect(classificarFalha(["nenhuma skill selecionada", "npx expxdev init --skills sprintx,runx --yes"])).toBe("defeito_do_app");
  });
});

describe("catálogo de skills da versão baixada", () => {
  it("usa a interseção com o catálogo real: skill que a versão não tem fica de fora, avisa e a instalação conclui", async () => {
    const c = await cenario({ npm: "catalogo_sem_designx" });
    const { progresso: p } = await c.rodar();
    expect(p.falha).toBeNull();
    expect(p.fase).toBe("concluida");
    expect((initDe(c)["argv"] as string[])[3]).toBe("sprintx,runx,legadox,stackx,mergex,memox,prodx,buildx");
    expect(p.log.join("\n")).toMatch(/Não existem nesta versão e ficam de fora: designx/);
    expect(p.resumo?.skills).toHaveLength(8);
  });

  it.each(["sem_catalogo", "catalogo_ilegivel"])("catálogo %s: cai na lista de nove e avisa", async (npm) => {
    const c = await cenario({ npm });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect((initDe(c)["argv"] as string[])[3]).toBe(NOVE);
    expect(p.log.join("\n")).toMatch(/Não foi possível ler o catálogo do instalador/);
  });

  it("catálogo sem nenhuma skill da suíte → pacote_invalido, antes de tocar no projeto", async () => {
    const c = await cenario({ npm: "catalogo_vazio" });
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("pacote_invalido");
    expect(c.chamadas().some((x) => x["quem"] === "expxdev")).toBe(false);
    expect(p.situacao_projeto).toBe("O projeto não foi alterado.");
  });
});

describe("requisitos do CLI real: git obrigatório", () => {
  it("sem git no PATH → git_ausente (o init baixa cada skill com git clone)", async () => {
    const solo = join(base, `solo${T.proximo()}`);
    mkdirSync(solo, { recursive: true });
    symlinkSync(process.execPath, join(solo, "node"));
    symlinkSync(join(FIX, "npm-falso", "npm"), join(solo, "npm"));
    const c = await cenario({ ambienteBruto: { PATH: solo } });
    const { progresso: p } = await c.rodar();
    expect(p.falha).toMatchObject({ causa: "git_ausente", etapa: "requisitos" });
    expect(p.falha?.sugestao).toMatch(/Instale o Git/);
  });
});

describe("troca atômica de .expx, cópia de segurança e ambiente do CLI real", () => {
  it("o init troca .expx inteiro: hooks.json do usuário volta da cópia de segurança; o resto que sumiu aparece como removido", async () => {
    const c = await cenario({ projeto: "ausente-com-claude" });
    mkdirSync(join(c.raiz, ".expx", "memoria"), { recursive: true });
    writeFileSync(join(c.raiz, ".expx", "hooks.json"), '{"hooks":{"segredo-no-commit":"bloqueio"}}');
    writeFileSync(join(c.raiz, ".expx", "memoria", "indice.json"), "{}");
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect(readFileSync(join(c.raiz, ".expx", "hooks.json"), "utf8")).toBe('{"hooks":{"segredo-no-commit":"bloqueio"}}');
    expect(p.resumo?.restaurados).toEqual([".expx/hooks.json"]);
    expect(p.resumo?.removidos).toEqual([".expx/memoria/indice.json"]);
    expect(p.resumo?.backup).not.toBeNull();
    expect(p.resumo?.como_restaurar).toMatch(/copie-o de .* para o mesmo caminho/);
    expect(existsSync(join(c.pastaBackups, c.backups()[0]!, ".expx", "memoria", "indice.json"))).toBe(true);
  });

  it("nada que já existia mudou: a cópia de segurança (duplicata) é apagada e o resumo não a menciona", async () => {
    const c = await cenario({ projeto: "ausente-com-claude" });
    const { progresso: p } = await c.rodar();
    expect(p.fase).toBe("concluida");
    expect(p.resumo?.alterados).toEqual([]);
    expect(p.resumo?.backup).toBeNull();
    expect(p.resumo?.como_restaurar).toBeNull();
    expect(c.backups()).toEqual([]);
  });

  it("falha sem escrever nada: 'O projeto não foi alterado' e nenhuma cópia de segurança sobra", async () => {
    for (const init of ["erro", "falha"]) {
      const c = await cenario({ projeto: "ausente-com-claude", init });
      const { progresso: p } = await c.rodar();
      expect(p.fase, init).toBe("falhou");
      expect(p.situacao_projeto, init).toBe("O projeto não foi alterado.");
      expect(c.backups(), init).toEqual([]);
    }
  });

  it("falha DEPOIS de gravar parte: diz que ficou pela metade, com a cópia de segurança e o caminho de reparo", async () => {
    // silêncio longo o bastante para o Node subir (e gravar parte das skills) antes de o instalador ser dado como parado, mesmo com a máquina carregada
    const c = await cenario({ projeto: "ausente-com-claude", init: "trava", silencio: 3_000 });
    const { progresso: p } = await c.rodar();
    expect(p.falha?.causa).toBe("sem_resposta");
    expect(p.situacao_projeto).toMatch(/pela metade.*cópia de segurança.*Reparar suíte ExpxDev/);
    expect(p.situacao_projeto).toContain(join("dados", "suite", "backups"));
  });

  it("cancelar no meio da troca atômica remove a temporária .expx.tmp-* e mantém o .expx anterior", async () => {
    const c = await cenario({ projeto: "ausente-com-claude", init: "trava" });
    mkdirSync(join(c.raiz, ".expx"), { recursive: true });
    writeFileSync(join(c.raiz, ".expx", "hooks.json"), '{"hooks":{}}');
    const antes = await criarManifesto(c.raiz);
    const promessa = c.rodar();
    await esperarLog(c, "meio da instalacao");
    expect(readdirSync(c.raiz).some((x) => x.startsWith(".expx.tmp-"))).toBe(true);
    c.ac.abort();
    const { progresso: p } = await promessa;
    expect(p.fase).toBe("cancelada");
    expect(readdirSync(c.raiz).some((x) => x.startsWith(".expx.tmp-"))).toBe(false);
    expect(readFileSync(join(c.raiz, ".expx", "hooks.json"), "utf8")).toBe('{"hooks":{}}');
    expect(compararManifestos(antes.mapa, (await criarManifesto(c.raiz)).mapa)).toEqual({ criados: [], alterados: [], removidos: [], fora_do_esperado: [] });
    expect(listarProcessos().filter((x) => x.comando.includes(c.dir))).toEqual([]);
  });

  it("EXPX_SKILLS_LOCAIS (troca a origem das skills) e GIT_* hostis não chegam ao CLI; o git nunca pergunta", async () => {
    const c = await cenario({ extraAmbiente: { EXPX_SKILLS_LOCAIS: "/tmp/skills-evil", GIT_SSH_COMMAND: "evil", GIT_DIR: "/x" } });
    await c.rodar();
    const variaveis = initDe(c)["env"] as Record<string, string>;
    expect(Object.keys(variaveis).filter((k) => /^EXPX_|^GIT_(SSH|DIR)/.test(k))).toEqual([]);
    expect(variaveis["GIT_TERMINAL_PROMPT"]).toBe("0");
  });
});
