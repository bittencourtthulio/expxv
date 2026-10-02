// Shift + clique no bichinho = atalho escondido do passeio (D-653); NÃO documentar em tooltip nem na ajuda.
// Slot do Bichinho no rodapé do menu lateral (D-468): o ser vivo do WORKSPACE ATUAL. Recolhido (56 px): só a cabeça, ~40 px. Aberto: corpo, apelido,
// espécie, estágio e a barra de maturidade. Clique abre o popover; o estado do bichinho vem do main (nada calculado aqui).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import { CATALOGO } from "../../nucleo/bichinho/catalogo";
import { Figura } from "./Figura";
import { PopoverBichinho } from "./Popover";
import { Casinha, useCasa, useForaDoPosto } from "./passeio/casa";
import { controlePadrao } from "./passeio/controle";
import { storeBichinho, useBichinhos, type StoreBichinho } from "./estado";
import { dicaDoBichinho, ROTULO_ESTAGIO, rotuloDoBichinho, type Retangulo } from "./util";
import "./bichinho.css";

export interface PropsSlot { recolhido: boolean; store?: StoreBichinho; workspaces?: StoreWorkspaces }

export default function BichinhoSlot({ recolhido, store = storeBichinho, workspaces = storeWorkspaces }: PropsSlot): ReactNode {
  const { atual } = useWorkspaces(workspaces);
  const { visoes, subiu, nasceu, mostrar, silenciar, disponivel } = useBichinhos(store);
  const botao = useRef<HTMLButtonElement>(null);
  const [ancora, setAncora] = useState<Retangulo | null>(null);
  const id = atual?.id ?? null;
  const figuraRef = useRef<HTMLSpanElement>(null);
  useCasa("slot", id, figuraRef);
  const fora = useForaDoPosto("slot");
  useEffect(() => { if (id !== null) void store.garantir([id]).then(() => store.atencao(id)); }, [store, id]);
  const fechar = useCallback(() => { setAncora(null); botao.current?.focus(); }, []);
  useEffect(() => { setAncora(null); }, [id]);
  const visao = id === null ? undefined : visoes.get(id);
  if (!mostrar || !disponivel || visao === undefined || atual === null) return null;
  const abrir = (): void => {
    if (ancora !== null) { fechar(); return; }
    const r = botao.current?.getBoundingClientRect();
    if (r !== undefined) setAncora({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  };
  const nome = visao.apelido ?? CATALOGO[visao.especie].rotulo;
  return (
    <div className="bi-slot" data-bichinho-slot>
      <button ref={botao} type="button" className="bi-slot-botao" data-bichinho-ancora aria-haspopup="dialog" aria-expanded={ancora !== null} title={visao.ovo === null || visao.ovo === undefined ? undefined : dicaDoBichinho(visao)} aria-label={`${rotuloDoBichinho(visao, atual.nome)}. Abrir detalhes`} onClick={(e) => { if (e.shiftKey) { controlePadrao().segredo(); return; } abrir(); }}>
        <span ref={figuraRef} className="bi-slot-figura">{fora ? <Casinha /> : <Figura visao={visao} nomeProjeto={atual.nome} cabeca={recolhido} subiu={subiu.has(visao.workspace_id)} nasceu={nasceu.has(visao.workspace_id)} silenciar={silenciar} rotulado={false} />}</span>
        <span className="bi-slot-texto" aria-hidden="true">
          <strong>{nome}</strong>
          <small>{CATALOGO[visao.especie].rotulo} · {ROTULO_ESTAGIO[visao.estagio]}{visao.ovo === null || visao.ovo === undefined ? "" : ` ${visao.ovo.progresso}%`}</small>
          <span className="bi-barra"><i style={{ width: `${visao.ovo === null || visao.ovo === undefined ? visao.maturidade : visao.ovo.progresso}%` }} /></span>
        </span>
      </button>
      {ancora !== null && <PopoverBichinho visao={visao} nomeProjeto={atual.nome} store={store} silenciar={silenciar} ancora={ancora} aoFechar={fechar} />}
    </div>
  );
}
