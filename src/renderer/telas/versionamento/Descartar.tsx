import { useEffect, useState } from "react";
import type { ResultadoDescartar } from "../../../compartilhado/vcs-tipos";
import { Dialogo } from "../../componentes/Dialogo";
import { mensagemDe, useVcs } from "./contexto";

/** Descartar nunca é um clique: simula (mostra o que se perde), exige confirmar; a cópia de segurança e a lixeira permitem desfazer. */
export function DialogoDescartar({ caminhos, incluirStaged, aoFechar }: { caminhos: string[]; incluirStaged: boolean; aoFechar: () => void }) {
  const { api, alvo, rodar, recarregar, avisar } = useVcs();
  const [sim, setSim] = useState<ResultadoDescartar | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    api.estagio(alvo, "descartar", { caminhos, incluir_staged: incluirStaged, simular: true, confirmar: false }).then((r) => { if (vivo) setSim(r); }, (e) => { if (vivo) setErro(mensagemDe(e)); });
    return () => { vivo = false; };
  }, [api, alvo, caminhos, incluirStaged]);
  const total = sim?.itens.filter((i) => i.acao !== "ignorado") ?? [];
  const confirmar = async (): Promise<void> => {
    setOcupado(true);
    const r = await rodar(() => api.estagio(alvo, "descartar", { caminhos, incluir_staged: incluirStaged, simular: false, confirmar: true }));
    setOcupado(false);
    if (r !== undefined) {
      avisar(r.idDesfazer !== null ? `Descartado. Cópia de segurança ${r.idDesfazer} (Descartes recentes permite desfazer).` : "Descartado (arquivos novos foram para a lixeira do sistema).");
      aoFechar();
      await recarregar();
    }
  };
  return (
    <Dialogo titulo="Descartar mudanças" aoFechar={aoFechar} largura={560}>
      <div className="dialogo-corpo">
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : sim === null ? <p aria-busy="true">Calculando o que se perderia…</p> : (
          <>
            <p>O que será perdido (uma cópia de segurança é guardada; arquivos novos vão para a lixeira):</p>
            <ul className="vc-lista-simples">
              {sim.itens.map((i) => (
                <li key={i.caminho}><code>{i.caminho}</code> — {i.acao === "ignorado" ? `ignorado${i.motivo ? ` (${i.motivo})` : ""}` : i.acao === "lixeira" ? "vai para a lixeira" : `restaura (−${i.insercoes ?? 0} +${i.delecoes ?? 0} linhas)`}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-perigo" disabled={sim === null || total.length === 0 || ocupado} onClick={() => void confirmar()}>Descartar {total.length} {total.length === 1 ? "arquivo" : "arquivos"}</button>
      </div>
    </Dialogo>
  );
}

export function DialogoDescartes({ aoFechar }: { aoFechar: () => void }) {
  const { api, alvo, rodar, recarregar, avisar } = useVcs();
  const [lista, setLista] = useState<Array<{ id: string; criadoEm: string; arquivos: string[]; desfeito: boolean }> | null>(null);
  useEffect(() => {
    let vivo = true;
    api.estagio(alvo, "descartes_listar", {}).then((r) => { if (vivo) setLista(r); }, () => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [api, alvo]);
  const desfazer = async (id: string): Promise<void> => {
    const r = await rodar(() => api.estagio(alvo, "desfazer_descarte", { id }));
    if (r !== undefined) {
      avisar(r.conflitos.length > 0 ? `Nada foi restaurado: ${r.conflitos.join(", ")} mudou depois do descarte.` : `Restaurado: ${r.restaurados.length} arquivo(s).`);
      aoFechar();
      await recarregar();
    }
  };
  return (
    <Dialogo titulo="Descartes recentes" aoFechar={aoFechar} largura={560}>
      <div className="dialogo-corpo">
        {lista === null ? <p aria-busy="true">Carregando…</p> : lista.length === 0 ? <p>Nenhum descarte guardado.</p> : (
          <ul className="vc-lista-simples">
            {lista.map((d) => (
              <li key={d.id}>
                <span>{new Date(d.criadoEm).toLocaleString("pt-BR")} · {d.arquivos.length} arquivo(s)</span>
                <button type="button" className="vc-mini" disabled={d.desfeito} onClick={() => void desfazer(d.id)}>{d.desfeito ? "Já desfeito" : "Desfazer"}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}
