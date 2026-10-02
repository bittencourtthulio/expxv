import { suiteDeContrato } from "../../../../tests/fixtures/conhecimento/suite-contrato";
import { abrirBancoConhecimento } from "../banco";
import { criarRepos } from "../repos";
import { ArmazenamentoLocal } from "./local";
import { ArmazenamentoMemoria } from "./memoria";

suiteDeContrato("stub em memória (modo eventual desligado)", {
  criar: async (o) => {
    const a = new ArmazenamentoMemoria(o?.loteMaximo !== undefined ? { loteMaximo: o.loteMaximo } : {});
    return { armazenamento: a, limpar: () => undefined };
  },
});

suiteDeContrato("stub em memória com consistência eventual e híbrido nativo", {
  criar: async (o) => {
    const a = new ArmazenamentoMemoria({ eventual: true, hibrido: true, ...(o?.loteMaximo !== undefined ? { loteMaximo: o.loteMaximo } : {}) });
    return { armazenamento: a, limpar: () => undefined, assentar: () => a.assentar() };
  },
});

suiteDeContrato("ArmazenamentoLocal (conhecimento.db)", {
  unicoProjeto: true,
  criar: async (o) => {
    const { banco } = abrirBancoConhecimento(":memory:");
    const r = criarRepos(banco, () => "2026-09-01T10:00:00.000Z");
    const col = r.colecao.garantir({ escopo: "workspace", workspace_id: "w", nome: "n", modelo: "hash-test-v1", dimensao: 4 });
    const a = new ArmazenamentoLocal(r, col.id, "proj_a", undefined, o?.loteMaximo ?? 100);
    return { armazenamento: a, limpar: () => banco.fechar() };
  },
});
