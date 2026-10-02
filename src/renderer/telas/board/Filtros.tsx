import { useEffect, useId, useRef, useState } from "react";
import { SELOS_CARD, type BoardModelo, type ColunaBoard, type SeloCard } from "../../../compartilhado/custo";
import { filtrosVazios, FILTROS_VAZIOS, type FiltrosUi } from "../../estado/board-filtros";
import { MenuLazy } from "./MenuLazy";
import { COLUNAS_BOARD, ROTULO_COLUNA, ROTULO_SELO } from "./rotulos";

const alternar = <T,>(lista: readonly T[] | undefined, v: T): T[] | undefined => {
  const base = lista ?? [];
  const nova = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
  return nova.length === 0 ? undefined : nova;
};
type Parcial = { [K in keyof FiltrosUi]?: FiltrosUi[K] | undefined };
const limpo = (f: Parcial): FiltrosUi => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as FiltrosUi;

export interface PropsFiltros {
  filtros: FiltrosUi;
  modelo: BoardModelo | null;
  aoMudar: (f: FiltrosUi) => void;
  /** atraso da busca (ms); 0 nos testes. */
  atrasoBusca?: number;
}

/** Linha de filtros: trabalhos (multi), painel de filtros (coluna, selo, modelo, custo, Missão, descartados), busca e agrupar. Teclado completo (são `<details>` nativos). */
export function Filtros({ filtros, modelo, aoMudar, atrasoBusca = 150 }: PropsFiltros) {
  const [busca, setBusca] = useState(filtros.busca ?? "");
  const idBusca = useId();
  const f = useRef(filtros);
  f.current = filtros;
  useEffect(() => { setBusca(filtros.busca ?? ""); }, [filtros.busca]);
  useEffect(() => {
    if (busca === (f.current.busca ?? "")) return undefined;
    const t = setTimeout(() => aoMudar(limpo({ ...f.current, busca: busca === "" ? undefined : busca })), atrasoBusca);
    return () => clearTimeout(t);
  }, [busca, aoMudar, atrasoBusca]);

  const trabalhos = modelo?.trabalhos ?? [];
  const modelos = modelo?.custo.modelos ?? [];
  const missoes = trabalhos.filter((t) => t.mission_id !== null);
  const n = (filtros.trabalho_ids?.length ?? 0);
  const nOutros = (filtros.colunas?.length ?? 0) + (filtros.selos?.length ?? 0) + (filtros.modelo === undefined ? 0 : 1) + (filtros.com_custo === undefined ? 0 : 1) + (filtros.mission_id === undefined ? 0 : 1) + (filtros.mostrar_descartados === true ? 1 : 0);
  const mudar = (p: Parcial): void => aoMudar(limpo({ ...filtros, ...p }));

  return (
    <div className="bd-filtros" role="group" aria-label="Filtros do board">
      <MenuLazy ariaLabel={`Trabalhos${n > 0 ? `, ${n} selecionados` : ", todos"}`} titulo={`Trabalho${n > 0 ? ` (${n})` : ""} ▾`}>
        <div className="bd-menu-painel" role="group" aria-label="Trabalhos">
          {trabalhos.length === 0 ? <p className="bd-nota">Nenhum trabalho do método neste workspace.</p> : trabalhos.map((t) => (
            <label key={t.trabalho_id} className="bd-check"><input type="checkbox" checked={filtros.trabalho_ids?.includes(t.trabalho_id) ?? false} onChange={() => mudar({ trabalho_ids: alternar(filtros.trabalho_ids, t.trabalho_id) })} />{t.titulo}</label>
          ))}
        </div>
      </MenuLazy>
      <MenuLazy ariaLabel={`Filtros${nOutros > 0 ? `, ${nOutros} ativos` : ""}`} titulo={`Filtros${nOutros > 0 ? ` (${nOutros})` : ""} ▾`}>
        <div className="bd-menu-painel" role="group" aria-label="Filtros">
          <fieldset><legend>Coluna</legend>
            {COLUNAS_BOARD.map((c: ColunaBoard) => <label key={c} className="bd-check"><input type="checkbox" checked={filtros.colunas?.includes(c) ?? false} onChange={() => mudar({ colunas: alternar(filtros.colunas, c) })} />{ROTULO_COLUNA[c]}</label>)}
          </fieldset>
          <fieldset><legend>Selo</legend>
            {SELOS_CARD.filter((s) => s !== "descartada").map((s: SeloCard) => <label key={s} className="bd-check"><input type="checkbox" checked={filtros.selos?.includes(s) ?? false} onChange={() => mudar({ selos: alternar(filtros.selos, s) })} />{ROTULO_SELO[s]}</label>)}
          </fieldset>
          <label className="bd-campo">Modelo
            <select value={filtros.modelo ?? ""} onChange={(e) => mudar({ modelo: e.target.value === "" ? undefined : e.target.value })}>
              <option value="">todos</option>{modelos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="bd-campo">Custo
            <select value={filtros.com_custo === undefined ? "" : filtros.com_custo ? "com" : "sem"} onChange={(e) => mudar({ com_custo: e.target.value === "" ? undefined : e.target.value === "com" })}>
              <option value="">todos</option><option value="com">com custo</option><option value="sem">sem custo</option>
            </select>
          </label>
          <label className="bd-campo">Missão
            <select value={filtros.mission_id ?? ""} onChange={(e) => mudar({ mission_id: e.target.value === "" ? undefined : e.target.value })}>
              <option value="">todas</option>{missoes.map((t) => <option key={t.mission_id} value={t.mission_id ?? ""}>{t.titulo}</option>)}
            </select>
          </label>
          <label className="bd-check"><input type="checkbox" checked={filtros.mostrar_descartados === true} onChange={(e) => mudar({ mostrar_descartados: e.target.checked ? true : undefined })} />Mostrar descartados</label>
        </div>
      </MenuLazy>
      <label htmlFor={idBusca} className="bd-oculto">Buscar por id ou título</label>
      <input id={idBusca} type="search" className="bd-busca" placeholder="Buscar T-NN.MM ou título" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <label className="bd-campo-inline"><span className="bd-oculto">Agrupar por</span>
        <select value={filtros.agrupar ?? "nenhum"} onChange={(e) => mudar({ agrupar: e.target.value as "nenhum" | "trabalho" | "fase" })}>
          <option value="nenhum">Agrupar: nenhum</option><option value="trabalho">Agrupar: trabalho</option><option value="fase">Agrupar: fase</option>
        </select>
      </label>
      {!filtrosVazios(filtros) ? <button type="button" className="botao-mini" onClick={() => { setBusca(""); aoMudar({ ...FILTROS_VAZIOS }); }}>Limpar filtros</button> : null}
    </div>
  );
}
