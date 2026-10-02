// T-22.19: harness de mutação (sem dependência) do verificador estático do deploy do relay. Cada regra tem um arquivo MUTADO em memória que o verificador precisa pegar,
// e o original precisa continuar limpo (um mutante vivo = regra morta).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const DEPLOY = resolve(__dirname, "..", "..", "deploy/relay");
interface Arq {
  dockerfile: string;
  compose: string;
  dockerignore: string;
}
interface M {
  verificar(a: Arq): string[];
  lerArquivos(dir?: string): Arq;
}
const SOBRE = (t: string, de: string | RegExp, para: string): string => {
  const r = t.replace(de, para);
  if (r === t) throw new Error(`mutação sem efeito: ${String(de)}`);
  return r;
};
interface Mutante {
  nome: string;
  esperado: string;
  mutar(a: Arq): Arq;
}
const D = (f: (t: string) => string) => (a: Arq): Arq => ({ ...a, dockerfile: f(a.dockerfile) });
const C = (f: (t: string) => string) => (a: Arq): Arq => ({ ...a, compose: f(a.compose) });
const I = (f: (t: string) => string) => (a: Arq): Arq => ({ ...a, dockerignore: f(a.dockerignore) });

const MUTANTES: Mutante[] = [
  { nome: "base por tag em vez de digest", esperado: "base_sem_digest", mutar: D((t) => SOBRE(t, /@sha256:[0-9a-f]{64}/, ":latest")) },
  { nome: "digest curto", esperado: "base_sem_digest", mutar: D((t) => SOBRE(t, /@sha256:[0-9a-f]{64}/, "@sha256:abc")) },
  { nome: "USER root", esperado: "usuario_root", mutar: D((t) => SOBRE(t, /^USER .*$/m, "USER root")) },
  { nome: "sem USER", esperado: "usuario_root", mutar: D((t) => SOBRE(t, /^USER .*\n/m, "")) },
  { nome: "sem HEALTHCHECK", esperado: "sem_healthcheck", mutar: D((t) => SOBRE(t, /^HEALTHCHECK .*\n/m, "")) },
  { nome: "ENV com segredo", esperado: "env_com_segredo", mutar: D((t) => `${t}ENV RELAY_TOKEN=abc123\n`) },
  { nome: "ENTRYPOINT por shell", esperado: "usa_shell", mutar: D((t) => SOBRE(t, /^ENTRYPOINT .*$/m, 'ENTRYPOINT ["sh", "-c", "node dist/nucleo/relay/main.js"]')) },
  { nome: "relay sem read_only", esperado: "relay_nao_read_only", mutar: C((t) => SOBRE(t, "read_only: true", "read_only: false")) },
  { nome: "relay sem tmpfs", esperado: "relay_sem_tmpfs", mutar: C((t) => SOBRE(t, "    tmpfs:\n      - /tmp\n", "")) },
  { nome: "relay sem cap_drop ALL", esperado: "relay_sem_cap_drop_all", mutar: C((t) => SOBRE(t, "    cap_drop:\n      - ALL\n    security_opt", "    security_opt")) },
  { nome: "relay sem no-new-privileges", esperado: "relay_sem_no_new_privileges", mutar: C((t) => SOBRE(t, "no-new-privileges:true", "no-new-privileges:false")) },
  { nome: "relay sem mem_limit", esperado: "relay_sem_mem_limit", mutar: C((t) => SOBRE(t, "    mem_limit: 128m\n    cpus: 0.5\n    pids_limit: 128\n    restart", "    cpus: 0.5\n    pids_limit: 128\n    restart")) },
  { nome: "relay sem cpus", esperado: "relay_sem_cpus", mutar: C((t) => SOBRE(t, "    mem_limit: 128m\n    cpus: 0.5\n    pids_limit: 128\n    restart", "    mem_limit: 128m\n    pids_limit: 128\n    restart")) },
  { nome: "relay sem pids_limit", esperado: "relay_sem_pids_limit", mutar: C((t) => SOBRE(t, "    pids_limit: 128\n    restart", "    restart")) },
  { nome: "relay publica porta", esperado: "relay_publica_porta", mutar: C((t) => SOBRE(t, "    restart: unless-stopped\n", '    restart: unless-stopped\n    ports:\n      - "8080:8080"\n')) },
  { nome: "relay privileged", esperado: "relay_privileged", mutar: C((t) => SOBRE(t, "    restart: unless-stopped\n", "    restart: unless-stopped\n    privileged: true\n")) },
  { nome: "relay em rede host", esperado: "relay_rede_host", mutar: C((t) => SOBRE(t, "    restart: unless-stopped\n", "    restart: unless-stopped\n    network_mode: host\n")) },
  { nome: "relay com pid host", esperado: "relay_pid_host", mutar: C((t) => SOBRE(t, "    restart: unless-stopped\n", "    restart: unless-stopped\n    pid: host\n")) },
  { nome: "relay monta o socket do Docker", esperado: "relay_socket_docker", mutar: C((t) => SOBRE(t, "    restart: unless-stopped\n", "    restart: unless-stopped\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n")) },
  { nome: "relay com variável de segredo preenchida", esperado: "relay_env_com_segredo", mutar: C((t) => SOBRE(t, '      RELAY_CONFIAR_PROXY: "1"', '      RELAY_CONFIAR_PROXY: "1"\n      RELAY_TOKEN: valor-literal')) },
  { nome: "caddy com socket do Docker", esperado: "caddy_socket_docker", mutar: C((t) => SOBRE(t, "      - ./Caddyfile:/etc/caddy/Caddyfile:ro", "      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n      - /var/run/docker.sock:/var/run/docker.sock")) },
  { nome: "estágio de build por tag flutuante (A-10)", esperado: "base_sem_digest", mutar: D((t) => SOBRE(t, /^FROM node:22-slim@sha256:[0-9a-f]{64}/m, "FROM node:22-slim")) },
  { nome: "compilador do build sem versão exata (A-10)", esperado: "build_com_versao_flutuante", mutar: D((t) => SOBRE(t, "--package=typescript@5.9.3", "--package=typescript@5")) },
  { nome: "npx sem pinagem do pacote (A-10)", esperado: "build_com_versao_flutuante", mutar: D((t) => SOBRE(t, "npx --yes --ignore-scripts --package=typescript@5.9.3 tsc", "npx --yes tsc")) },
  { nome: "imagem do Caddy sem digest (A-10)", esperado: "caddy_imagem_sem_digest", mutar: C((t) => SOBRE(t, /image: caddy:2-alpine@sha256:[0-9a-f]{64}/, "image: caddy:2-alpine")) },
  { nome: "Caddy sem volume de dados: perde a chave TLS a cada recriação (A-11)", esperado: "caddy_sem_volume_de_dados", mutar: C((t) => SOBRE(t, "      - caddy_dados:/data\n", "")) },
  { nome: "Caddy sem read_only (A-11)", esperado: "caddy_nao_read_only", mutar: C((t) => SOBRE(t, /(    image: caddy[^\n]*\n)    read_only: true\n/, "$1")) },
  { nome: ".dockerignore sem arquivos de ambiente", esperado: "dockerignore_sem_.env", mutar: I((t) => SOBRE(t, /^\.env\n/m, "")) },
  { nome: ".dockerignore sem .env.*", esperado: "dockerignore_sem_.env.*", mutar: I((t) => SOBRE(t, /^\.env\.\*\n/m, "")) },
  { nome: ".dockerignore sem chaves", esperado: "dockerignore_sem_*.pem", mutar: I((t) => SOBRE(t, /^\*\.pem\n/m, "")) },
  { nome: ".dockerignore sem docs", esperado: "dockerignore_sem_docs", mutar: I((t) => SOBRE(t, /^docs\n/m, "")) },
];

describe("mutação do verificador de deploy do relay", () => {
  it("o original está limpo", async () => {
    const m = (await import(/* @vite-ignore */ pathToFileURL(resolve(DEPLOY, "verificar.mjs")).href)) as M;
    expect(m.verificar(m.lerArquivos())).toEqual([]);
  });
  for (const mu of MUTANTES) {
    it(`mutante morto: ${mu.nome}`, async () => {
      const m = (await import(/* @vite-ignore */ pathToFileURL(resolve(DEPLOY, "verificar.mjs")).href)) as M;
      expect(m.verificar(mu.mutar(m.lerArquivos()))).toContain(mu.esperado);
    });
  }
});
