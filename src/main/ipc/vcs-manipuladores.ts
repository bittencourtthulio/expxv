// Registro dos 14 canais `vcs:*` (Fase 6E). Finos: validação estrita em `./vcs`, regra em `main/vcs.ts`.
import type { CanaisInvoke } from "../../compartilhado/ipc";
import type { VcsMain } from "../vcs";
import type { RegistroIpc } from "./registro";
import { VALIDADORES_VCS } from "./vcs";

export interface DependenciasIpcVcs {
  registro: RegistroIpc;
  vcs: Pick<VcsMain, "estado" | "observar" | "diff" | "familia" | "missao">;
}

type CanalFamilia = "vcs:estagio" | "vcs:commit" | "vcs:ramos" | "vcs:stash" | "vcs:historico" | "vcs:remoto" | "vcs:operacao" | "vcs:conflitos" | "vcs:svn" | "vcs:forge";
const FAMILIAS: readonly CanalFamilia[] = ["vcs:estagio", "vcs:commit", "vcs:ramos", "vcs:stash", "vcs:historico", "vcs:remoto", "vcs:operacao", "vcs:conflitos", "vcs:svn", "vcs:forge"];

export function registrarIpcVcs({ registro, vcs }: DependenciasIpcVcs): void {
  const V = VALIDADORES_VCS;
  registro.invoke("vcs:estado", V["vcs:estado"], (p) => vcs.estado(p));
  registro.invoke("vcs:observar", V["vcs:observar"], (p) => vcs.observar(p));
  registro.invoke("vcs:diff", V["vcs:diff"], (p) => vcs.diff(p));
  for (const canal of FAMILIAS) {
    registro.invoke(canal, V[canal] as never, ((p: { workspace_id: string; mission_id: string | null; op: string }) => vcs.familia(canal, p)) as never);
  }
  registro.invoke("vcs:missao", V["vcs:missao"], (p) => vcs.missao(p as never) as Promise<CanaisInvoke["vcs:missao"]["saida"]>);
}
