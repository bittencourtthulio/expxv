import { memo, type ReactElement } from "react";
import type { SessaoUI } from "../../estado/terminais";
import type { Aba } from "./estado";
import { folhas } from "./layout";
import { atividadeDoGrupo, rotuloDaAtividade, type AbaSemaforo } from "./semaforo";
import type { AtividadeTerminal } from "../../../compartilhado/terminais";
import { SEM_MISSAO, type MapaMissao } from "./missao";

/** Sinaleira: forma + glifo + texto (a cor nunca é o único sinal). */
export function Sinal({ atividade }: { atividade: AtividadeTerminal | undefined }): ReactElement | null {
  const r = rotuloDaAtividade(atividade);
  if (r === null) return null;
  return (
    <span className="terminais-sinal" data-forma={r.forma} role="img" aria-label={r.texto} title={r.texto}>
      <i aria-hidden="true">{r.glifo}</i>
    </span>
  );
}

const GLIFO_CLI: Record<string, string> = { claude: "C", codex: "X", gemini: "G", opencode: "O", aider: "A", qwen: "Q", kilo: "K", terminal: ">_" };

/** Ícone mínimo da CLI (12–14 px): glifo em quadrado, sem imagem nem peso extra. */
export function IconeCli({ ferramenta }: { ferramenta: string | null | undefined }): ReactElement {
  return <span className="terminais-cli" data-cli={ferramenta ?? undefined} aria-hidden="true">{GLIFO_CLI[ferramenta ?? ""] ?? "·"}</span>;
}

export const rotuloDaSessao = (s: SessaoUI | undefined, nomeDaFerramenta: (s: SessaoUI) => string): string => (s === undefined ? "sessão" : `#${s.numero} · ${nomeDaFerramenta(s)}`);

interface Props {
  abas: readonly Aba[];
  ativaId: string | null;
  fixadas: readonly string[];
  sessoes: Readonly<Record<string, SessaoUI>>;
  nomeDaFerramenta(s: SessaoUI): string;
  /** panes de Missão: a aba de uma Missão leva o título dela. */
  missao?: MapaMissao;
  aoSelecionar(id: string): void;
  aoFechar(id: string): void;
  aoFixar(id: string): void;
}

export const Abas = memo(function Abas({ abas, ativaId, fixadas, sessoes, nomeDaFerramenta, missao = SEM_MISSAO, aoSelecionar, aoFechar, aoFixar }: Props): ReactElement {
  const semaforo: AbaSemaforo[] = abas.flatMap((a) => folhas(a.arvore).flatMap((id) => {
    const s = sessoes[id];
    return s === undefined ? [] : [{ sessao_id: id, aba_id: a.id, estado: s.estado, atividade: s.atividade }];
  }));
  const navegar = (e: React.KeyboardEvent, indice: number): void => {
    const alvo = e.key === "ArrowRight" ? indice + 1 : e.key === "ArrowLeft" ? indice - 1 : e.key === "Home" ? 0 : e.key === "End" ? abas.length - 1 : null;
    if (alvo === null || abas.length === 0) return;
    e.preventDefault();
    const proxima = abas[(alvo + abas.length) % abas.length];
    if (proxima === undefined) return;
    // ativação MANUAL (APG): a seta só move o foco; Enter/Espaço seleciona. Selecionar já leva o foco ao terminal da aba,
    // o que interromperia a navegação por setas.
    document.getElementById(`aba-${proxima.id}`)?.focus();
  };
  return (
    <div className="terminais-abas" role="tablist" aria-label="Abas de terminais">
      {abas.map((aba, i) => {
        const lista = folhas(aba.arvore);
        const primeira = sessoes[lista[0] ?? ""];
        const ativa = aba.id === ativaId;
        const atividade = atividadeDoGrupo(semaforo, aba.id);
        const daMissao = lista.map((id) => missao[id]).find((i) => i?.ehPiloto === true);
        const nome = daMissao !== undefined ? `Missão · ${daMissao.missaoTitulo}` : rotuloDaSessao(primeira, nomeDaFerramenta);
        const fixada = fixadas.includes(lista[0] ?? "");
        return (
          <div key={aba.id} role="presentation" className="terminais-aba" data-ativa={ativa || undefined} data-atividade={atividade}>
            <button
              type="button"
              role="tab"
              id={`aba-${aba.id}`}
              aria-selected={ativa}
              aria-controls="terminais-grade"
              tabIndex={ativa ? 0 : -1}
              className="terminais-aba-titulo"
              onClick={() => aoSelecionar(aba.id)}
              onKeyDown={(e) => navegar(e, i)}
              onDoubleClick={() => aoFixar(aba.id)}
              title={`${nome} · ${fixada ? "fixada (duplo clique desafixa)" : "duplo clique fixa"}`}
            >
              <IconeCli ferramenta={primeira?.ferramenta_id} />
              <Sinal atividade={atividade} />
              {fixada ? <span className="terminais-aba-extra">fixa</span> : null}
              <span className="terminais-aba-nome">{nome}</span>
              {lista.length > 1 ? <span className="terminais-aba-extra" aria-label={`mais ${lista.length - 1} painéis`}>+{lista.length - 1}</span> : null}
            </button>
            <button type="button" className="terminais-aba-fechar" aria-label={`Fechar aba ${nome}`} title="Fechar aba" onClick={() => aoFechar(aba.id)}>×</button>
          </div>
        );
      })}
    </div>
  );
});
