// Apoio dos testes da memória: banco em memória migrado + semeadura de workspace/Missão/Pane por SQL.
import { abrirBanco, type Banco } from "../../../src/nucleo/banco/banco";
import { migrar } from "../../../src/nucleo/banco/migrar";
import { garantirFts } from "../../../src/nucleo/memoria/fts";

export const TS = "2026-10-01T10:00:00.000Z";

export function novoBancoMemoria(op: { fts?: boolean; caminho?: string } = {}): Banco {
  const b = abrirBanco(op.caminho ?? ":memory:");
  migrar(b);
  if (op.fts !== false) garantirFts(b);
  return b;
}

export function semearWorkspace(b: Banco, id = "ws_1", nome = "Projeto"): string {
  b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [id, nome, `/work/${id}`, TS, TS]);
  return id;
}

export function semearMissao(b: Banco, id: string, ws: string, modo: "livre" | "squad" | "agentico" = "agentico", squad?: string): string {
  b.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)", [id, ws, modo, "livre", "t", "executando", TS, TS]);
  if (squad) b.executar("INSERT INTO mission_squad (mission_id,squad_slug,squad_hash,criado_em) VALUES (?,?,?,?)", [id, squad, "a".repeat(64), TS]);
  return id;
}

let contadorDisplay = 0;
export function semearPane(
  b: Banco,
  p: { id: string; ws: string; mission?: string | null; display?: number; respawn_de?: string | null; estado?: string; papel?: string; cli?: string | null; tipo?: "cli" | "shell" },
): string {
  const display = p.display ?? ++contadorDisplay + 1000;
  b.executar(
    "INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,cli,papel,eh_piloto,estado,respawn_de,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [p.id, p.mission ?? null, p.ws, display, p.tipo ?? "cli", p.cli === undefined ? "claude" : p.cli, p.papel ?? "nenhum", p.papel === "piloto" ? 1 : 0, p.estado ?? "pronto", p.respawn_de ?? null, TS, TS],
  );
  return p.id;
}
