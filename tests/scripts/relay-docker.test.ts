// T-22.18/19 (AX-20, AX-21): regras ESTÁTICAS do deploy do relay (qualquer SO) e, opcionalmente, medição local e efêmera da imagem (P-168).
// Nada é enviado nem implantado: o teste de imagem só roda se `docker` existir E a imagem base já estiver em cache local (sem pull); caso contrário PULA e diz "não medido".
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const DEPLOY = resolve(RAIZ, "deploy/relay");
interface Verificador {
  verificar(a: { dockerfile: string; compose: string; dockerignore: string }): string[];
  lerArquivos(dir?: string): { dockerfile: string; compose: string; dockerignore: string };
  parseYaml(t: string): Record<string, unknown>;
}
const carregar = async (): Promise<Verificador> => (await import(/* @vite-ignore */ pathToFileURL(resolve(DEPLOY, "verificar.mjs")).href)) as Verificador;

describe("deploy/relay (estático)", () => {
  it("os arquivos esperados existem", () => {
    for (const n of ["Dockerfile", "compose.yaml", "Caddyfile", ".env.example", ".dockerignore", "LEIA-ME.md", "verificar.mjs"]) expect(existsSync(resolve(DEPLOY, n)), n).toBe(true);
    expect(existsSync(resolve(RAIZ, "tsconfig.relay.json"))).toBe(true);
  });
  it("ax21_dockerfile_endurecido: o verificador passa sem nenhuma violação", async () => {
    const m = await carregar();
    expect(m.verificar(m.lerArquivos())).toEqual([]);
  });
  it("ax21_dockerfile_endurecido: base fixada por digest, não-root, sem shell, HEALTHCHECK, sem segredo em ENV", async () => {
    const d = readFileSync(resolve(DEPLOY, "Dockerfile"), "utf8");
    expect(d).toMatch(/^FROM gcr\.io\/distroless\/nodejs22@sha256:[0-9a-f]{64}$/m);
    expect(d).toMatch(/^USER 65532:65532$/m);
    expect(d).toMatch(/^HEALTHCHECK /m);
    expect(d).not.toMatch(/\b(sh|bash)\b\s+-c/);
    expect(d).not.toMatch(/^ENV .*(TOKEN|SENHA|SECRET|SEGREDO|PASSWORD)/im);
  });
  it("ax20_limites_de_recurso: o relay tem mem_limit, cpus e pids_limit e nenhuma porta publicada", async () => {
    const m = await carregar();
    const y = m.parseYaml(readFileSync(resolve(DEPLOY, "compose.yaml"), "utf8")) as { services: Record<string, Record<string, unknown>> };
    const r = y.services["relay"] as Record<string, unknown>;
    expect(r["mem_limit"]).toBe("128m");
    expect(r["cpus"]).toBe(0.5);
    expect(Number(r["pids_limit"])).toBeGreaterThan(0);
    expect(r["ports"]).toBeUndefined();
    expect((y.services["caddy"] as Record<string, unknown>)["profiles"]).toEqual(["tls"]);
  });
  it("o ambiente de exemplo traz só nomes lidos pelo relay (sem valor) e o compose não usa nome desconhecido", () => {
    const ex = readFileSync(resolve(DEPLOY, ".env.example"), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));
    const main = readFileSync(resolve(RAIZ, "src/nucleo/relay/main.ts"), "utf8");
    for (const l of ex) {
      expect(l).toMatch(/^[A-Z_]+=$/);
      const nome = l.slice(0, -1);
      if (nome !== "RELAY_DOMINIO") expect(main, nome).toContain(nome);
    }
  });
  it("a saída do tsc do relay não cai em dist/ (o app não a empacota)", () => {
    const t = JSON.parse(readFileSync(resolve(RAIZ, "tsconfig.relay.json"), "utf8")) as { compilerOptions: { outDir: string }; include: string[] };
    expect(t.compilerOptions.outDir).toBe("dist-relay");
    expect(t.include.every((p) => p.startsWith("src/nucleo/relay/") || p === "src/compartilhado/relay.ts" || p === "src/nucleo/produto.ts")).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------ P-168 (opcional, local, efêmero, SEM pull)
const docker = (...a: string[]): ReturnType<typeof spawnSync> => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });
function motivoDePular(): string | null {
  if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 }).status !== 0) return "sem Docker";
  const base = /^FROM (gcr\.io\/distroless\/\S+)$/m.exec(readFileSync(resolve(DEPLOY, "Dockerfile"), "utf8"))?.[1];
  if (base === undefined || /@sha256:0{64}$/.test(base)) return "digest da imagem base ainda é o marcador";
  if (docker("image", "inspect", base).status !== 0) return "imagem base fora do cache local (sem pull)";
  if (docker("image", "inspect", "node:22-slim").status !== 0) return "node:22-slim fora do cache local (sem pull)";
  return null;
}
const PULAR = motivoDePular();
describe.skipIf(PULAR !== null)("P-168: imagem do relay (Docker local e efêmero)", () => {
  it("imagem <= 150 MB, inicia <= 2 s, HEALTHCHECK verde, não-root, com --memory=128m --cpus=0.5", async () => {
    const tag = `relay-teste-${process.pid}`;
    const nome = `relay-teste-${process.pid}`;
    try {
      execFileSync("docker", ["build", "--pull=false", "-f", "deploy/relay/Dockerfile", "-t", tag, "."], { cwd: RAIZ, stdio: "ignore", timeout: 300_000 });
      const tam = Number(execFileSync("docker", ["image", "inspect", tag, "--format", "{{.Size}}"], { encoding: "utf8" }).trim());
      expect(tam / 1024 / 1024).toBeLessThanOrEqual(150);
      const t0 = Date.now();
      execFileSync("docker", ["run", "-d", "--name", nome, "--memory=128m", "--cpus=0.5", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", tag], { stdio: "ignore" });
      let saude = "";
      while (Date.now() - t0 < 2000 && saude !== "healthy") {
        await new Promise((r) => setTimeout(r, 100));
        saude = execFileSync("docker", ["inspect", nome, "--format", "{{.State.Status}}"], { encoding: "utf8" }).trim() === "running" ? "healthy" : "";
      }
      expect(saude).toBe("healthy");
      expect(Date.now() - t0).toBeLessThanOrEqual(2000);
      expect(execFileSync("docker", ["inspect", tag, "--format", "{{.Config.User}}"], { encoding: "utf8" }).trim()).not.toMatch(/^(root|0)?$/);
    } finally {
      spawnSync("docker", ["rm", "-f", nome]);
      spawnSync("docker", ["rmi", "-f", tag]);
      expect(execFileSync("docker", ["ps", "-a", "--filter", `name=${nome}`, "-q"], { encoding: "utf8" }).trim()).toBe("");
    }
  }, 400_000);
});
if (PULAR !== null) console.warn(`P-168 não medido: ${PULAR}`);
