// Catálogo no main (Fase 7, T-07.12): liga `nucleo/catalogo` ao app. SOB DEMANDA: criar o serviço não abre worker, não lê disco nem o manifesto; o worker nasce na
// primeira varredura (que só acontece por clique/abertura da tela) e é encerrado com o app sem segurar o `before-quit`. Nada aqui roda na onda 1 do boot.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EventoCatalogo } from "../compartilhado/catalogo";
import type { RepoCatalogo } from "../nucleo/banco/repos/catalogo";
import { lerManifesto, type Manifesto } from "../nucleo/catalogo/embarcadas/manifesto";
import { criarServicoCatalogo, type ServicoCatalogo } from "../nucleo/catalogo/servico";
import { criarClienteVarredura } from "../nucleo/catalogo/worker";
import { resolverHome } from "../nucleo/catalogo/raizes";
import { lerLockDoProjeto } from "../nucleo/metodo/instalacao";

/** `app.asar` → `app.asar.unpacked`: worker_threads não lê de dentro do asar. */
export const foraDoAsar = (c: string): string => c.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");

/** Onde vivem as skills embarcadas: `<resources>/skills` empacotado, `<app>/resources/skills` em desenvolvimento. */
export function pastaDasSkillsEmbarcadas(o: { empacotado: boolean; resourcesPath: string; appPath: string; existe?: (c: string) => boolean }): string {
  const existe = o.existe ?? existsSync;
  const candidatas = o.empacotado ? [join(o.resourcesPath, "skills")] : [join(o.appPath, "resources", "skills"), join(o.appPath, "dist", "resources", "skills")];
  return candidatas.find((c) => existe(c)) ?? candidatas[0] ?? "";
}

export interface DepsCatalogoMain {
  repo: RepoCatalogo;
  /** `dist/nucleo/catalogo/worker.js` (já resolvido para fora do asar) */
  caminhoWorker: string;
  dirSkills: string;
  workspaces: () => Array<{ id: string; raiz: string }>;
  emitirRenderer: (evento: EventoCatalogo) => void;
  barramento: (nome: string, payload: unknown) => void;
  lixeira: (abs: string) => Promise<void>;
  revelar: (abs: string) => void;
  membroDoAgente?: (agenteId: string) => { skills_permitidas: string[]; mcps_permitidos: string[] } | null;
  home?: () => string;
}

export interface CatalogoMain {
  servico: ServicoCatalogo;
  encerrar(): Promise<void>;
}

export function criarCatalogoMain(d: DepsCatalogoMain): CatalogoMain {
  let manifesto: Promise<Manifesto> | null = null;
  const servico = criarServicoCatalogo({
    repo: d.repo,
    cliente: () => criarClienteVarredura(d.caminhoWorker),
    home: d.home ?? ((): string => resolverHome()),
    workspaces: d.workspaces,
    manifesto: () => (manifesto ??= lerManifesto(d.dirSkills)),
    dirSkills: () => d.dirSkills,
    emitir: d.emitirRenderer,
    barramento: d.barramento,
    lixeira: d.lixeira,
    revelar: d.revelar,
    ...(d.membroDoAgente === undefined ? {} : { membroDoAgente: d.membroDoAgente }),
    metodoInstalado: async (wsId) => {
      const w = d.workspaces().find((x) => x.id === wsId);
      if (w === undefined) return false;
      try {
        return (await lerLockDoProjeto(w.raiz)).lock.presente;
      } catch {
        return false;
      }
    },
  });
  return { servico, encerrar: () => servico.encerrar() };
}
