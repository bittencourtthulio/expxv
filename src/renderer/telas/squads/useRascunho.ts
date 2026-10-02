// Rascunho editável de uma squad + validação AO VIVO (`squads:validar`, debounce) + gravação com `hash_esperado` (CT-14.10).
// Squad de fábrica é somente leitura (só se duplica); o rascunho dela existe para a caixa de prompt saber se é válida.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Achado, ResultadoGravarSquad, Squad } from "../../../compartilhado/squads";
import { useSquads, type StoreSquads } from "../../estado/squads";

export const ATRASO_VALIDACAO_MS = 250;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface EstadoGravacao {
  ocupado: boolean;
  erro: string | null;
  /** o arquivo mudou fora do app: oferecer [recarregar] e [sobrescrever]. */
  conflito: boolean;
}

export interface RascunhoSquad {
  carregando: boolean;
  erroCarga: string | null;
  original: Squad | null;
  rascunho: Squad | null;
  editar(fn: (s: Squad) => Squad): void;
  achados: Achado[];
  /** o main recusou a FORMA do rascunho (ex.: rótulo vazio): mensagem curta; `null` = forma aceita. */
  erroForma: string | null;
  sujo: boolean;
  editavel: boolean;
  /** o arquivo mudou fora do app e há edição local não salva. */
  externaMudou: boolean;
  gravacao: EstadoGravacao;
  salvar(opcoes?: { sobrescrever?: boolean }): Promise<ResultadoGravarSquad | null>;
  descartar(): void;
  recarregar(): Promise<void>;
}

export function useRascunhoSquad(slug: string | null, store: StoreSquads, workspaceId: string | null, atrasoMs = ATRASO_VALIDACAO_MS): RascunhoSquad {
  const { lista } = useSquads(store);
  const [original, setOriginal] = useState<Squad | null>(null);
  const [rascunho, setRascunho] = useState<Squad | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [achados, setAchados] = useState<Achado[]>([]);
  const [erroForma, setErroForma] = useState<string | null>(null);
  const [gravacao, setGravacao] = useState<EstadoGravacao>({ ocupado: false, erro: null, conflito: false });
  const [hashBase, setHashBase] = useState<string | null>(null);
  const geracao = useRef(0);

  const carregar = useCallback(async (): Promise<void> => {
    if (slug === null) {
      setOriginal(null);
      setRascunho(null);
      setAchados([]);
      return;
    }
    const minha = ++geracao.current;
    setCarregando(true);
    setErroCarga(null);
    try {
      const s = await store.obterSquad(slug);
      if (minha !== geracao.current) return;
      setOriginal(s);
      setRascunho(s);
      setHashBase(store.hashDe(slug));
      setGravacao({ ocupado: false, erro: null, conflito: false });
    } catch (e) {
      if (minha === geracao.current) {
        setOriginal(null);
        setRascunho(null);
        setErroCarga(`Não foi possível abrir a squad: ${msg(e)}`);
      }
    } finally {
      if (minha === geracao.current) setCarregando(false);
    }
  }, [slug, store]);

  useEffect(() => {
    void carregar();
    return () => void ++geracao.current;
  }, [carregar]);

  // validação ao vivo: debounce; só a última resposta vale
  const validacao = useRef(0);
  useEffect(() => {
    if (rascunho === null) return undefined;
    const minha = ++validacao.current;
    const t = setTimeout(() => {
      store
        .validar(rascunho, workspaceId)
        .then((a) => {
          if (minha === validacao.current) {
            setAchados(a);
            setErroForma(null);
          }
        })
        .catch((e: unknown) => {
          if (minha === validacao.current) setErroForma(msg(e));
        });
    }, atrasoMs);
    return () => clearTimeout(t);
  }, [rascunho, workspaceId, store, atrasoMs]);

  const sujo = useMemo(() => original !== null && rascunho !== null && JSON.stringify(original) !== JSON.stringify(rascunho), [original, rascunho]);
  const editavel = original !== null && original.origem !== "fabrica";
  const hashAtual = slug === null ? null : (lista?.find((s) => s.slug === slug)?.hash ?? null);
  const externaMudou = sujo && hashBase !== null && hashAtual !== null && hashAtual !== hashBase && !gravacao.ocupado;

  const salvar = useCallback(
    async (opcoes: { sobrescrever?: boolean } = {}): Promise<ResultadoGravarSquad | null> => {
      if (rascunho === null || !editavel) return null;
      setGravacao({ ocupado: true, erro: null, conflito: false });
      try {
        let hash = hashBase;
        if (opcoes.sobrescrever === true) {
          await store.carregar();
          hash = store.hashDe(rascunho.slug);
        }
        const r = await store.gravar({ squad: rascunho, hash_esperado: hash });
        if (r.ok) {
          setOriginal(r.squad);
          setRascunho(r.squad);
          setHashBase(r.hash);
          setAchados(r.achados);
          setGravacao({ ocupado: false, erro: null, conflito: false });
        } else if (r.erro === "conflito_de_hash") {
          setGravacao({ ocupado: false, erro: null, conflito: true });
        } else {
          setAchados(r.achados);
          setGravacao({ ocupado: false, erro: r.erro === "fabrica_somente_leitura" ? "Squad de fábrica é somente leitura: duplique para editar." : "A squad tem erros de validação: corrija e salve de novo.", conflito: false });
        }
        return r;
      } catch (e) {
        setGravacao({ ocupado: false, erro: `Não foi possível salvar: ${msg(e)}`, conflito: false });
        return null;
      }
    },
    [rascunho, editavel, hashBase, store],
  );

  return {
    carregando,
    erroCarga,
    original,
    rascunho,
    editar: (fn) => setRascunho((s) => (s === null ? s : fn(s))),
    achados,
    erroForma,
    sujo,
    editavel,
    externaMudou,
    gravacao,
    salvar,
    descartar: () => {
      setRascunho(original);
      setGravacao({ ocupado: false, erro: null, conflito: false });
    },
    recarregar: carregar,
  };
}
