import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarCofre, criarMotorSafeStorage, criarMotorSenhaMestra, CofreErro, type Cofre, type PortaSafeStorage } from "./index";

const SENTINELA = "SENTINELA-cofre-9f3a7c1e-valor-secreto";
const SENHA = "senha-mestra-de-teste-123";
const RAPIDO = { N: 1024, r: 8, p: 1 };
const pastas: string[] = [];
const novaPasta = (): string => {
  const p = mkdtempSync(join(tmpdir(), "cofre-teste-"));
  pastas.push(p);
  return p;
};
afterEach(() => {
  while (pastas.length) rmSync(pastas.pop() as string, { recursive: true, force: true });
});

/** cifrador FALSO (nunca o Keychain real): inverte e embrulha, sem o texto em claro. */
function portaFalsa(backend: string | null = null, disponivel = true): PortaSafeStorage {
  return {
    disponivel: () => disponivel,
    backend: () => backend,
    cifrar: (t) => Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`),
    decifrar: (b) => {
      const s = Buffer.from(b).toString();
      if (!s.startsWith("enc:")) throw new Error("ruim");
      return Buffer.from(s.slice(4), "base64").reverse().toString();
    },
  };
}
const pedido = (nome: string, valor: string, extra: Partial<{ sensivel: boolean; escopo: "global" | "workspace"; workspace_id: string | null; id: string | null }> = {}) => ({
  id: null, nome, escopo: "global" as const, workspace_id: null, sensivel: true, valor, ...extra,
});
function cofreSafe(dir: string, aviso?: (m: string) => void): Cofre {
  return criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(portaFalsa()), ...(aviso ? { aviso } : {}) });
}
function cofreMestra(dir: string, extra: { inatividade_ms?: number; agendar?: (fn: () => void, ms: number) => { cancelar(): void }; aviso?: (m: string) => void } = {}): Cofre {
  return criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSenhaMestra({ scrypt: RAPIDO }), ...extra });
}
const lerArquivo = (dir: string): string => readFileSync(join(dir, "cofre.json"), "utf8");

describe("cofre com safeStorage injetado", () => {
  it("guarda, lista só metadados, obtém para uso imediato, apaga", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    const e = await c.guardar(pedido("MINHA_CHAVE", SENTINELA));
    expect(e.id).toMatch(/^cof_[0-9A-Za-z]{10,40}$/);
    expect(JSON.stringify(e)).not.toContain(SENTINELA);
    expect(await c.existe("MINHA_CHAVE")).toBe(true);
    expect(await c.obter("MINHA_CHAVE")).toBe(SENTINELA);
    const lista = await c.listar();
    expect(lista).toHaveLength(1);
    expect(JSON.stringify(lista)).not.toContain(SENTINELA);
    expect(await c.apagar(e.id)).toBe(true);
    expect(await c.existe("MINHA_CHAVE")).toBe(false);
    await expect(c.obter("MINHA_CHAVE")).rejects.toMatchObject({ codigo: "entrada_inexistente" });
  });

  it("arquivo 0600, sem valor em claro, sem .tmp sobrando, persiste entre instâncias", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    expect(lerArquivo(dir)).not.toContain(SENTINELA);
    expect(lerArquivo(dir)).not.toContain(Buffer.from(SENTINELA).toString("base64"));
    if (process.platform !== "win32") expect(statSync(join(dir, "cofre.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const outra = cofreSafe(dir);
    expect(await outra.obter("A_CHAVE")).toBe(SENTINELA);
  });

  it("escritas concorrentes são serializadas (atômicas) e nenhuma se perde", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => c.guardar(pedido(`CHAVE_${i}`, `valor-numero-${i}-xxxxxx`))));
    expect(JSON.parse(lerArquivo(dir)).entradas).toHaveLength(20);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("recusa o backend basic_text do Linux (e cofre indisponível), com erro nominal", async () => {
    const dir = novaPasta();
    const c = criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(portaFalsa("basic_text")) });
    const e = await c.estado();
    expect(e.ok).toBe(false);
    expect(e.backend).toBe("indisponivel");
    expect(e.motivo).toMatch(/senha-mestra/);
    await expect(c.guardar(pedido("X_CHAVE", SENTINELA))).rejects.toMatchObject({ codigo: "cofre_indisponivel" });
    const semSo = criarCofre({ arquivo: join(dir, "c2.json"), motor: criarMotorSafeStorage(portaFalsa(null, false)) });
    expect((await semSo.estado()).ok).toBe(false);
  });

  it("mesmo nome+escopo atualiza a mesma entrada; workspace vence global; nome inválido recusado", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    const a = await c.guardar(pedido("TOKEN_X", "valor-global-111"));
    const b = await c.guardar(pedido("TOKEN_X", "valor-global-222"));
    expect(b.id).toBe(a.id);
    await c.guardar(pedido("TOKEN_X", "valor-do-workspace", { escopo: "workspace", workspace_id: "ws_01HAAAAAAAAA" }));
    expect(await c.obter("TOKEN_X")).toBe("valor-global-222");
    expect(await c.obter("TOKEN_X", { workspace_id: "ws_01HAAAAAAAAA" })).toBe("valor-do-workspace");
    expect(await c.obter("TOKEN_X", { workspace_id: "ws_01HBBBBBBBBB" })).toBe("valor-global-222");
    await expect(c.guardar(pedido("minha-chave", "x".repeat(10)))).rejects.toMatchObject({ codigo: "nome_invalido" });
    await expect(c.guardar(pedido("OK_NOME", ""))).rejects.toMatchObject({ codigo: "valor_invalido" });
    await expect(c.guardar(pedido("OK_NOME", "a\0b"))).rejects.toMatchObject({ codigo: "valor_invalido" });
  });

  it("abre sob demanda: criar o cofre não toca o disco", () => {
    const dir = novaPasta();
    cofreSafe(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("arquivo adulterado: entrada ignorada com aviso (só o NOME), as demais seguem; entradas trocadas de lugar são detectadas", async () => {
    const dir = novaPasta();
    const avisos: string[] = [];
    const c = cofreSafe(dir, (m) => avisos.push(m));
    await c.guardar(pedido("PRIMEIRA", "valor-primeira-aaaa"));
    await c.guardar(pedido("SEGUNDA", "valor-segunda-bbbb"));
    const j = JSON.parse(lerArquivo(dir));
    const [e1, e2] = j.entradas;
    const trocado = e1.cifrado_b64;
    e1.cifrado_b64 = e2.cifrado_b64;
    e2.cifrado_b64 = trocado;
    j.entradas.push({ lixo: true });
    writeFileSync(join(dir, "cofre.json"), JSON.stringify(j));
    const lido = cofreSafe(dir, (m) => avisos.push(m));
    await expect(lido.obter("PRIMEIRA")).rejects.toMatchObject({ codigo: "entrada_corrompida", nome: "PRIMEIRA" });
    await expect(lido.obter("SEGUNDA")).rejects.toMatchObject({ codigo: "entrada_corrompida" });
    expect((await lido.listar()).map((e) => e.nome)).toEqual(["PRIMEIRA", "SEGUNDA"]);
    expect(avisos.length).toBeGreaterThanOrEqual(3);
    expect(avisos.join("\n")).not.toMatch(/valor-(primeira|segunda)/);
  });

  it("arquivo ilegível nunca é sobrescrito", async () => {
    const dir = novaPasta();
    writeFileSync(join(dir, "cofre.json"), "{ isto não é json");
    const c = cofreSafe(dir);
    await expect(c.guardar(pedido("NOVA_CHAVE", "valor-qualquer-1"))).rejects.toMatchObject({ codigo: "arquivo_ilegivel" });
    expect(lerArquivo(dir)).toBe("{ isto não é json");
    expect((await c.estado()).ok).toBe(false);
  });
});

describe("cofre com senha-mestra (P-29)", () => {
  it("define, guarda, bloqueia, falha nominal bloqueado, desbloqueia", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    expect((await c.estado()).bloqueado).toBe(true);
    await expect(c.guardar(pedido("A_CHAVE", SENTINELA))).rejects.toMatchObject({ codigo: "senha_mestra_nao_definida" });
    expect((await c.definirSenhaMestra(SENHA)).bloqueado).toBe(false);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    expect((await c.bloquear()).bloqueado).toBe(true);
    await expect(c.obter("A_CHAVE")).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
    await expect(c.guardar(pedido("B_CHAVE", "valor-bbbbbbb"))).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
    expect((await c.listar()).map((e) => e.nome)).toEqual(["A_CHAVE"]);
    expect(await c.existe("A_CHAVE")).toBe(true);
    expect((await c.desbloquear(SENHA)).bloqueado).toBe(false);
    expect(await c.obter("A_CHAVE")).toBe(SENTINELA);
    // outra instância (reabertura do app) também desbloqueia
    const outra = cofreMestra(dir);
    expect((await outra.estado()).bloqueado).toBe(true);
    await outra.desbloquear(SENHA);
    expect(await outra.obter("A_CHAVE")).toBe(SENTINELA);
  });

  it("senha errada falha sem pista (mesma mensagem, sem a senha, sem o valor)", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    await c.bloquear();
    const erros: string[] = [];
    for (const tentativa of ["senha-errada-aaaaaa", `${SENHA}x`, SENHA.slice(0, -1), "x".repeat(300)]) {
      try {
        await c.desbloquear(tentativa);
        erros.push("NAO FALHOU");
      } catch (e) {
        expect(e).toBeInstanceOf(CofreErro);
        expect((e as CofreErro).codigo).toBe("senha_incorreta");
        erros.push((e as Error).message);
      }
    }
    expect(new Set(erros).size).toBe(1);
    for (const m of erros) expect(m).not.toMatch(/senha-errada/);
    expect(erros.join()).not.toContain(SENTINELA);
    await expect(c.obter("A_CHAVE")).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
  });

  it("arquivo: sem valor nem senha em claro, sal e nonce por segredo, 0600", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("UM_SEGREDO", SENTINELA));
    await c.guardar(pedido("OUTRO_SEGREDO", SENTINELA));
    const txt = lerArquivo(dir);
    expect(txt).not.toContain(SENTINELA);
    expect(txt).not.toContain(SENHA);
    const j = JSON.parse(txt);
    expect(j.motor).toBe("senha_mestra");
    expect(j.mestra.kdf).toBe("scrypt");
    const [a, b] = j.entradas.map((e: { cifrado_b64: string }) => Buffer.from(e.cifrado_b64, "base64"));
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false); // sal
    expect(a.subarray(16, 28).equals(b.subarray(16, 28))).toBe(false); // nonce
    expect(a.equals(b)).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(dir, "cofre.json")).mode & 0o777).toBe(0o600);
  });

  it("troca de senha-mestra re-cifra tudo; senha curta recusada; bloqueado não troca", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    await expect(c.definirSenhaMestra("curta")).rejects.toMatchObject({ codigo: "senha_mestra_invalida" });
    await c.definirSenhaMestra("outra-senha-mestra-456");
    await c.bloquear();
    await expect(c.definirSenhaMestra("terceira-senha-789")).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
    await expect(c.desbloquear(SENHA)).rejects.toMatchObject({ codigo: "senha_incorreta" });
    await c.desbloquear("outra-senha-mestra-456");
    expect(await c.obter("A_CHAVE")).toBe(SENTINELA);
  });

  it("bloqueio automático por inatividade configurável (relógio injetado)", async () => {
    const dir = novaPasta();
    let disparar: (() => void) | null = null;
    let msPedido = 0;
    let cancelados = 0;
    const c = cofreMestra(dir, {
      inatividade_ms: 5000,
      agendar: (fn, ms) => {
        disparar = fn;
        msPedido = ms;
        return {
          cancelar: () => {
            cancelados++;
            disparar = null;
          },
        };
      },
    });
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    expect(msPedido).toBe(5000);
    await c.obter("A_CHAVE"); // atividade reinicia o contador
    expect(cancelados).toBeGreaterThan(0);
    expect((await c.estado()).bloqueado).toBe(false);
    (disparar as unknown as () => void)();
    await new Promise((r) => setTimeout(r, 20));
    expect((await c.estado()).bloqueado).toBe(true);
    await expect(c.obter("A_CHAVE")).rejects.toMatchObject({ codigo: "cofre_bloqueado" });
  });

  it("inatividade 0 = nunca bloqueia sozinho", async () => {
    const dir = novaPasta();
    let agendou = false;
    const c = cofreMestra(dir, {
      inatividade_ms: 0,
      agendar: () => {
        agendou = true;
        return { cancelar() {} };
      },
    });
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    expect(agendou).toBe(false);
  });

  it("arquivo criado com senha-mestra não abre com safeStorage (incompatível)", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    await c.definirSenhaMestra(SENHA);
    await c.guardar(pedido("A_CHAVE", SENTINELA));
    const outro = cofreSafe(dir);
    expect((await outro.estado()).ok).toBe(false);
    await expect(outro.obter("A_CHAVE")).rejects.toMatchObject({ codigo: "cofre_indisponivel" });
  });
});

describe("modo broker: ambiente, scrubber, placeholders, sem salvar", () => {
  it("segredo sensível nunca vai para o ambiente do Pane; não sensível só com a chave ligada", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    await c.guardar(pedido("CHAVE_SENSIVEL", SENTINELA, { sensivel: true }));
    await c.guardar(pedido("MODO_LOG", "verboso-123", { sensivel: false }));
    expect(await c.ambienteDoPane(null, false)).toEqual({});
    const env = await c.ambienteDoPane(null, true);
    expect(env).toEqual({ MODO_LOG: "verboso-123" });
    expect(JSON.stringify(env)).not.toContain(SENTINELA);
  });

  it("scrubber remove o valor em várias codificações (literal, base64, URL, JSON, hex) e some ao bloquear", async () => {
    const dir = novaPasta();
    const c = cofreMestra(dir);
    await c.definirSenhaMestra(SENHA);
    const valor = 'sk-teste/valor+secreto=&com espaço"aspas';
    await c.guardar(pedido("CHAVE_X", valor));
    const b64 = Buffer.from(valor).toString("base64");
    const saida = [valor, b64, encodeURIComponent(valor), JSON.stringify({ k: valor }), Buffer.from(valor).toString("hex")].join(" | ");
    const limpo = await c.scrub(saida);
    expect(limpo).not.toContain(valor);
    expect(limpo).not.toContain(b64);
    expect(limpo).not.toContain(encodeURIComponent(valor));
    expect(limpo).not.toContain(Buffer.from(valor).toString("hex"));
    expect(limpo).toContain("«cofre:CHAVE_X»");
    expect(c.scrubSincrono(`x ${valor} y`)).toBe("x «cofre:CHAVE_X» y");
    await c.bloquear();
    expect(c.scrubSincrono(`x ${valor} y`)).toBe(`x ${valor} y`); // valores não ficam na memória trancada
  });

  it("scrub carrega do arquivo numa instância nova (valores de sessões anteriores)", async () => {
    const dir = novaPasta();
    await cofreSafe(dir).guardar(pedido("CHAVE_X", SENTINELA));
    const nova = cofreSafe(dir);
    expect(await nova.scrub(`log com ${SENTINELA} dentro`)).toBe("log com «cofre:CHAVE_X» dentro");
  });

  it("usar: erro do consumidor sai sem o valor; usarSemSalvar não toca o disco e limpa depois", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    await c.guardar(pedido("CHAVE_X", SENTINELA));
    const antes = lerArquivo(dir);
    await expect(
      c.usar("CHAVE_X", (v) => {
        throw new Error(`falhou com ${v}`);
      }),
    ).rejects.toThrow(/«cofre:CHAVE_X»/);
    const temp = "valor-temporario-digitado-1234";
    await expect(
      c.usarSemSalvar(temp, (v) => {
        throw new Error(`401 para ${v}`);
      }),
    ).rejects.toThrow(/«cofre:TEMPORARIO»/);
    expect(await c.usarSemSalvar(temp, (v) => v.length)).toBe(temp.length);
    expect(c.scrubSincrono(temp)).toBe(temp);
    await c.persistir();
    const norm = (t: string): string => t.replace(/"ultimo_uso_em": "[^"]+"/g, "").replace(/"ultimo_uso_em": null/g, "");
    expect(norm(lerArquivo(dir))).toBe(norm(antes));
    expect(lerArquivo(dir)).not.toContain(temp);
  });

  it("resolver {{vault:NOME}} para consumidores internos; nome inexistente é erro nominal", async () => {
    const dir = novaPasta();
    const c = cofreSafe(dir);
    await c.guardar(pedido("TOKEN_X", SENTINELA));
    expect(await c.resolver("Bearer {{vault:TOKEN_X}} e {{vault:TOKEN_X}}")).toBe(`Bearer ${SENTINELA} e ${SENTINELA}`);
    expect(await c.resolver("sem placeholder")).toBe("sem placeholder");
    await expect(c.resolver("{{vault:NAO_EXISTE}}")).rejects.toMatchObject({ codigo: "entrada_inexistente", nome: "NAO_EXISTE" });
  });
});

describe("varredura de sentinela: nenhum segredo fora do arquivo cifrado", () => {
  it("avisos, mensagens de erro, estado, lista e arquivos de teste não contêm valor nem senha", async () => {
    const dir = novaPasta();
    const avisos: string[] = [];
    const c = cofreMestra(dir, { aviso: (m) => avisos.push(m) });
    const saidas: string[] = [];
    const tenta = async (f: () => Promise<unknown>): Promise<void> => {
      try {
        saidas.push(JSON.stringify(await f()));
      } catch (e) {
        saidas.push(String((e as Error).message));
      }
    };
    await tenta(() => c.obter("A_CHAVE"));
    await tenta(() => c.definirSenhaMestra(SENHA));
    await tenta(() => c.guardar(pedido("A_CHAVE", SENTINELA)));
    await tenta(() => c.listar());
    await tenta(() => c.estado());
    await tenta(() => c.bloquear());
    await tenta(() => c.obter("A_CHAVE"));
    await tenta(() => c.desbloquear("errada-errada-1"));
    await tenta(() => c.desbloquear(SENHA));
    await tenta(() => c.resolver("{{vault:OUTRA}}"));
    const tudo = [...saidas, ...avisos, lerArquivo(dir), readdirSync(dir).join()].join("\n");
    expect(tudo).not.toContain(SENTINELA);
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain("errada-errada-1");
  });
});
