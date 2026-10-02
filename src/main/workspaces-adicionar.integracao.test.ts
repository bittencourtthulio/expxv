// Integração: o serviço do modal com o serviço de workspaces REAL (banco SQLite temporário). Nenhuma rede: clona um repositório local de teste.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventoClone } from "../compartilhado/workspaces-adicionar";
import { initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../tests/fixtures/vcs/repos";
import { abrirDominioBase, type DominioBase } from "./dominio-base";
import { criarServicoAdicionar } from "./workspaces-adicionar";

let casa: string;
let dominio: DominioBase | null = null;
beforeAll(isolarConfigGit);
afterEach(() => {
  dominio?.fechar();
  dominio = null;
  removerPasta(casa);
});

async function preparar() {
  casa = pastaTmp("adic-int-");
  mkdirSync(join(casa, "Developer"));
  const remoto = initRepo(join(casa, "origem", "remoto"));
  dominio = await abrirDominioBase({ pastaDeDados: join(casa, "dados"), escolherPasta: async () => null });
  const eventos: EventoClone[] = [];
  let mudou = 0;
  const s = criarServicoAdicionar({
    workspaces: dominio.workspaces,
    preferencias: { obter: () => null, definir: async () => undefined },
    escolherPasta: async () => null,
    emitir: ((canal: string, payload: unknown) => { if (canal === "workspaces:adicionar_progresso") eventos.push(payload as EventoClone); }) as never,
    aoMudar: () => { mudou++; },
    casa: () => casa,
  });
  const d = await s.destinoPadrao();
  return { s, d, remoto, eventos, mudou: () => mudou };
}
const terminou = async (eventos: EventoClone[]): Promise<void> => {
  const fim = Date.now() + 15_000;
  while (!eventos.some((e) => ["concluido", "falhou", "cancelado"].includes(e.fase)) && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
};

describe("adicionar + trocar com o serviço de workspaces real", () => {
  it("clone concluído: o workspace entra nos recentes, vira o ATUAL, é git, com permissão segura (padrão) e o main avisa a mudança", async () => {
    const { s, d, remoto, eventos, mudou } = await preparar();
    expect((await dominio!.workspaces.estado()).atual).toBeNull();
    const r = await s.iniciarClone({ entrada: remoto, permitir_local: true, destino_token: d.token, nome: "clonado", branch: null, raso: false, submodulos: false, consentimento: true });
    expect(r.ok).toBe(true);
    await terminou(eventos);
    expect(eventos.at(-1)?.fase).toBe("concluido");
    const estado = await dominio!.workspaces.estado();
    expect(estado.atual?.raiz).toBe(join(casa, "Developer", "clonado"));
    expect(estado.atual).toMatchObject({ nome: "clonado", e_git: true, permissao: "seguro" });
    expect(estado.recentes.map((w) => w.nome)).toEqual(["clonado"]);
    expect(eventos.at(-1)?.workspace?.id).toBe(estado.atual?.id);
    expect(mudou()).toBe(1);
  });
  it("novo projeto: entra como atual, não-git quando pedido", async () => {
    const { s, d } = await preparar();
    const r = await s.criarNovo({ nome: "doc", destino_token: d.token, git: false, gitignore: false, commit_inicial: false, readme: true, template: "docs", instalar_suite: false });
    expect(r.ok).toBe(true);
    const estado = await dominio!.workspaces.estado();
    expect(estado.atual).toMatchObject({ nome: "doc", e_git: false });
    expect(existsSync(join(casa, "Developer", "doc", "docs", "index.md"))).toBe(true);
  });
  it("clone cancelado/falho não deixa workspace nem pasta", async () => {
    const { s, d, eventos } = await preparar();
    await s.iniciarClone({ entrada: join(casa, "nao-existe"), permitir_local: true, destino_token: d.token, nome: "x", branch: null, raso: false, submodulos: false, consentimento: true });
    await terminou(eventos);
    expect(eventos.at(-1)?.fase).toBe("falhou");
    expect((await dominio!.workspaces.estado()).recentes).toEqual([]);
    expect(existsSync(join(casa, "Developer", "x"))).toBe(false);
  });
  it("reabrir a pasta de um workspace removido restaura o histórico (AUD-11) em vez de duplicar", async () => {
    const { s, d, remoto, eventos } = await preparar();
    await s.iniciarClone({ entrada: remoto, permitir_local: true, destino_token: d.token, nome: "c", branch: null, raso: false, submodulos: false, consentimento: true });
    await terminou(eventos);
    const ws = (await dominio!.workspaces.estado()).atual!;
    await dominio!.workspaces.remover(ws.id);
    const a = await s.avaliarDestino({ destino_token: d.token, nome: "c" });
    expect(a).toMatchObject({ ok: false, situacao: "ocupado" });
    const reaberto = await s.abrirDestinoExistente({ destino_token: d.token, nome: "c" });
    expect(reaberto?.id).toBe(ws.id);
  });
});
