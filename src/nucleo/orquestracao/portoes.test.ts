import { afterEach, describe, expect, it, vi } from "vitest";
import { limpar, novoBanco } from "../../../tests/fixtures/dominio/ambiente";
import { criarServicoPortoes, estadoDosPortoes } from "./portoes";

afterEach(limpar);

function montar() {
  const { banco, repos } = novoBanco();
  const ws = repos.workspace.criar({ nome: "ws", raiz: "/tmp/ws-portoes" });
  const missao = repos.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "livre", titulo: "M" });
  const aoMudar = vi.fn();
  const servico = criarServicoPortoes({ repos, banco, aoMudar });
  return { banco, repos, ws, missao, aoMudar, servico };
}

describe("serviço de portões", () => {
  it("estado: tudo pendente no início; null se a Missão não existe", () => {
    const m = montar();
    expect(m.servico.estado(m.missao.id)).toEqual({ mission_id: m.missao.id, liberados: [], pendentes: ["direction", "content", "build", "qa"] });
    expect(m.servico.estado("mis_nao_existe")).toBeNull();
    expect(m.servico.liberar("mis_nao_existe", "build")).toBeNull();
  });

  it("libera, é idempotente, avisa a UI uma vez e registra o evento sem segredos", () => {
    const m = montar();
    const r = m.servico.liberar(m.missao.id, "build");
    expect(r).toEqual({ mission_id: m.missao.id, liberados: ["build"], pendentes: ["direction", "content", "qa"] });
    expect(m.servico.liberar(m.missao.id, "build")).toEqual(r);
    expect(m.aoMudar).toHaveBeenCalledTimes(1);
    expect(m.aoMudar).toHaveBeenCalledWith({ workspace_id: m.ws.id, mission_id: m.missao.id });
    const eventos = m.banco.consultar<{ tipo: string; payload_json: string }>("SELECT tipo, payload_json FROM evento_dominio WHERE tipo = 'mission.gate_released'");
    expect(eventos).toHaveLength(1);
    expect(JSON.parse(eventos[0]!.payload_json)).toEqual({ mission_id: m.missao.id, workspace_id: m.ws.id, portao: "build", por: "usuario" });
    m.servico.liberar(m.missao.id, "direction");
    expect(estadoDosPortoes(m.repos.config, m.missao.id).liberados).toEqual(["direction", "build"]); // ordem canônica
  });

  it("só Missão em andamento: encerrada/abortada recusa e não grava nada", () => {
    const m = montar();
    m.banco.executar("UPDATE mission SET estado = 'abortada' WHERE id = ?", [m.missao.id]);
    expect(() => m.servico.liberar(m.missao.id, "qa")).toThrow(/encerrada/);
    expect(estadoDosPortoes(m.repos.config, m.missao.id).liberados).toEqual([]);
    expect(m.aoMudar).not.toHaveBeenCalled();
  });
});
