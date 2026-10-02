// Seletor "Trocar bichinho" (D-674): grade pesquisável das 100 espécies, com filtro por grupo, prévia viva, marca das espécies já em uso e a preferência
// "Sem repetir espécie". Carregado SOB DEMANDA (lazy no Popover): nada disto roda enquanto o seletor está fechado. Escolher uma espécie já usada é permitido
// (a escolha do dono vale), com um aviso discreto de onde ela já está. Só tokens do tema (seletor.css).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ESPECIES, GRUPOS_ESPECIE, type BichinhoVisao, type EspecieId, type GrupoEspecie } from "../../compartilhado/bichinho";
import { CATALOGO, ROTULO_GRUPO } from "../../nucleo/bichinho/catalogo";
import { storeBichinho, useBichinhos, type StoreBichinho } from "./estado";
import { BichinhoSprite } from "./Sprite";
import "./seletor.css";

export interface PropsSeletor {
  visao: BichinhoVisao;
  store?: StoreBichinho;
  silenciar?: boolean;
  aoFechar: () => void;
}

const normalizar = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Espécies que casam com a busca (nome, id ou o que representam, sem acento) e com o grupo; ordem do catálogo. Pura e testada. */
export function filtrarEspecies(busca: string, grupo: GrupoEspecie | "todos"): EspecieId[] {
  const q = normalizar(busca);
  return ESPECIES.filter((e) => {
    const d = CATALOGO[e];
    if (grupo !== "todos" && d.grupo !== grupo) return false;
    return q === "" || normalizar(`${d.rotulo} ${e} ${d.representa}`).includes(q);
  });
}

export default function SeletorEspecie({ visao, store = storeBichinho, silenciar = false, aoFechar }: PropsSeletor): ReactNode {
  const { usos, semRepetir } = useBichinhos(store);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<GrupoEspecie | "todos">("todos");
  const [previa, setPrevia] = useState<EspecieId>(visao.especie);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); void store.carregarUsos(); }, [store]);
  useEffect(() => { setPrevia(visao.especie); }, [visao.especie]);

  // quem usa cada espécie, sem contar o próprio workspace
  const usadas = useMemo(() => {
    const m = new Map<EspecieId, string[]>();
    for (const u of usos) if (u.workspace_id !== visao.workspace_id) m.set(u.especie, [...(m.get(u.especie) ?? []), u.workspace_nome]);
    return m;
  }, [usos, visao.workspace_id]);
  const lista = useMemo(() => filtrarEspecies(busca, grupo), [busca, grupo]);

  const escolher = async (e: EspecieId | null): Promise<void> => {
    const onde = e === null ? undefined : usadas.get(e);
    setAviso(onde === undefined ? null : `${CATALOGO[e!].rotulo} já está em uso em ${onde.join(", ")}. A escolha é sua e vale.`);
    const erro = await store.trocarEspecie(visao.workspace_id, e);
    if (erro !== null) setAviso(erro);
  };
  const estagioPrevia = visao.estagio === "ovo" ? "filhote" : visao.estagio;
  const emUsoDaPrevia = usadas.get(previa);

  return (
    <div className="bi-seletor" role="dialog" aria-label="Trocar bichinho" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); aoFechar(); } }}>
      <div className="bi-sel-topo">
        <span className="bi-sel-previa" data-testid="bichinho-previa">
          <span className="bi-wrap" data-quieto={silenciar || undefined}>
            <BichinhoSprite especie={previa} estagio={estagioPrevia} humor={visao.humor} nivel={visao.esforco?.nivel ?? 0} rotulo={`Prévia: ${CATALOGO[previa].rotulo}`} />
          </span>
        </span>
        <div className="bi-sel-info">
          <strong>{CATALOGO[previa].rotulo}</strong>
          <span>{ROTULO_GRUPO[CATALOGO[previa].grupo]} · {CATALOGO[previa].representa}</span>
          <small>{CATALOGO[previa].personalidade}</small>
          {emUsoDaPrevia !== undefined && <small className="bi-sel-uso">Já em uso em {emUsoDaPrevia.join(", ")}</small>}
        </div>
      </div>
      <div className="bi-sel-filtros">
        <input ref={campo} type="search" className="bi-sel-busca" aria-label="Buscar bichinho pelo nome" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="bi-sel-grupos" role="group" aria-label="Filtrar por grupo">
          {(["todos", ...GRUPOS_ESPECIE] as const).map((g) => (
            <button key={g} type="button" className="bi-botao bi-sel-grupo" aria-pressed={grupo === g} onClick={() => setGrupo(g)}>{g === "todos" ? "Todos" : ROTULO_GRUPO[g]}</button>
          ))}
        </div>
      </div>
      <div className="bi-sel-grade" role="group" aria-label={`${lista.length} espécies`}>
        {lista.length === 0 && <p className="bi-sel-vazio" role="status">Nenhum bichinho com esse nome.</p>}
        {lista.map((e) => {
          const em = usadas.get(e);
          return (
            <button
              key={e}
              type="button"
              className="bi-sel-item"
              data-especie-item={e}
              data-atual={visao.especie === e || undefined}
              data-uso={em !== undefined || undefined}
              aria-pressed={visao.especie === e}
              aria-label={`${CATALOGO[e].rotulo}, ${ROTULO_GRUPO[CATALOGO[e].grupo].toLowerCase()}${em === undefined ? "" : `, já em uso em ${em.join(", ")}`}`}
              title={em === undefined ? CATALOGO[e].representa : `Já em uso em ${em.join(", ")}`}
              onClick={() => void escolher(e)}
              onPointerEnter={() => setPrevia(e)}
              onFocus={() => setPrevia(e)}
            >
              <span className="bi-sel-mini"><span className="bi-wrap" data-quieto="true"><BichinhoSprite especie={e} estagio="jovem" rotulo={CATALOGO[e].rotulo} /></span></span>
              <span className="bi-sel-nome">{CATALOGO[e].rotulo}</span>
              {em !== undefined && <i className="bi-sel-marca" aria-hidden="true">em uso</i>}
            </button>
          );
        })}
      </div>
      {aviso !== null && <p className="bi-pop-aviso bi-sel-aviso" role="status">{aviso}</p>}
      <div className="bi-sel-rodape">
        <button type="button" className="bi-botao" role="switch" aria-checked={semRepetir} onClick={() => void store.definirSemRepetir(!semRepetir)}>Sem repetir espécie: {semRepetir ? "ligado" : "desligado"}</button>
        <button type="button" className="bi-botao" disabled={!visao.manual} onClick={() => void escolher(null)}>Automático ({CATALOGO[visao.especie_automatica].rotulo})</button>
        <button type="button" className="bi-botao" onClick={aoFechar}>Fechar</button>
      </div>
    </div>
  );
}
