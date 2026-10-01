import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { Permissao } from "../../compartilhado/dominio";
import { ade } from "../ade";

// Configurações persistidas por app:config_ler/app:config_gravar. Faixas validadas aqui E no main
// (src/main/ipc/app.ts): o mesmo contrato dos dois lados.
export const LIMITES_CONFIG = {
  scrollback: { min: 500, max: 50_000, padrao: 5_000 },
  limitePaineis: { min: 1, max: 64, padrao: 16 },
} as const;

export const CHAVES_CONFIG = {
  scrollback: "terminal_scrollback",
  limitePaineis: "limite_paineis",
  permissaoPadrao: "permissao_padrao",
  cor: "cor_destaque",
  notificacoes: "notificacoes",
} as const;

export interface ValoresConfig {
  scrollback: number;
  limitePaineis: number;
  permissaoPadrao: Permissao;
  /** null = destaque padrão do tema (azul). */
  cor: string | null;
  notificacoes: boolean;
}

export interface EstadoConfig extends ValoresConfig {
  carregado: boolean;
  erro: string | null;
}

export type ResultadoConfig = { ok: true } | { ok: false; erro: string };

const HEX = /^#[0-9a-f]{6}$/i;
export const corValida = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
const inteiroNaFaixa = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

const fmt = (n: number): string => n.toLocaleString("pt-BR");

/** Valida um valor por chave de ajuste; devolve a mensagem de erro (PT-BR) ou null. */
export function validarConfig<K extends keyof ValoresConfig>(chave: K, valor: unknown): string | null {
  switch (chave) {
    case "scrollback": {
      const { min, max } = LIMITES_CONFIG.scrollback;
      return inteiroNaFaixa(valor, min, max) ? null : `Informe um número inteiro entre ${fmt(min)} e ${fmt(max)}.`;
    }
    case "limitePaineis": {
      const { min, max } = LIMITES_CONFIG.limitePaineis;
      return inteiroNaFaixa(valor, min, max) ? null : `Informe um número inteiro entre ${min} e ${max}.`;
    }
    case "permissaoPadrao":
      return valor === "seguro" || valor === "automatico" ? null : "Escolha seguro ou automático.";
    case "cor":
      return valor === null || corValida(valor) ? null : "Cor inválida. Use o formato hexadecimal, no padrão #rrggbb.";
    case "notificacoes":
      return typeof valor === "boolean" ? null : "Valor inválido.";
    default:
      return "Ajuste desconhecido.";
  }
}

export const PADROES_CONFIG: Readonly<ValoresConfig> = {
  scrollback: LIMITES_CONFIG.scrollback.padrao,
  limitePaineis: LIMITES_CONFIG.limitePaineis.padrao,
  permissaoPadrao: "seguro",
  cor: null,
  notificacoes: true,
};

interface Deps {
  api: () => ApiAde["config"] | undefined;
  raiz?: HTMLElement;
}

/** Aplica a cor por variável CSS: nenhuma árvore React é tocada (sem re-render). */
export function aplicarCorDestaque(raiz: HTMLElement, cor: string | null): void {
  if (cor === null) {
    raiz.style.removeProperty("--destaque");
    raiz.style.removeProperty("--destaque-2");
    return;
  }
  raiz.style.setProperty("--destaque", cor);
  raiz.style.setProperty("--destaque-2", `color-mix(in srgb, ${cor} 62%, white)`);
}

/** Store mínimo de configurações. Leitura em paralelo, sem bloquear a abertura; cor aplicada assim que lida. */
export function criarStoreConfig({ api: obter, raiz: raizInjetada }: Deps) {
  // resolvida na hora do uso: importar o módulo (ex.: pelo store de terminais) não exige DOM
  const raiz = (): HTMLElement => raizInjetada ?? document.documentElement;
  const ouvintes = new Set<() => void>();
  let iniciado: Promise<void> | null = null;
  let estado: EstadoConfig = { ...PADROES_CONFIG, carregado: false, erro: null };

  const publicar = (p: Partial<EstadoConfig>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };

  const lerChave = async <K extends keyof ValoresConfig>(a: ApiAde["config"], chave: K): Promise<ValoresConfig[K]> => {
    const bruto = await a.ler(CHAVES_CONFIG[chave]);
    // valor ausente ou fora de faixa no disco: cai no padrão (nunca propaga lixo)
    return bruto !== undefined && bruto !== null && validarConfig(chave, bruto) === null ? (bruto as ValoresConfig[K]) : PADROES_CONFIG[chave];
  };

  /** Valida (rejeita fora de faixa), grava e só então publica. Cor aplica na hora, sem recarregar. */
  async function definir<K extends keyof ValoresConfig>(chave: K, valor: ValoresConfig[K]): Promise<ResultadoConfig> {
    const invalido = validarConfig(chave, valor);
    if (invalido !== null) return { ok: false, erro: invalido };
    const a = obter();
    if (a === undefined) return { ok: false, erro: "Configurações indisponíveis fora do aplicativo." };
    try {
      await a.gravar(CHAVES_CONFIG[chave], valor);
    } catch (e) {
      return { ok: false, erro: `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (chave === "cor") aplicarCorDestaque(raiz(), valor as string | null);
    publicar({ [chave]: valor, erro: null } as Partial<EstadoConfig>);
    return { ok: true };
  }

  return {
    obter: (): EstadoConfig => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        const a = obter();
        if (a === undefined) { publicar({ carregado: true }); return; }
        try {
          const [scrollback, limitePaineis, permissaoPadrao, cor, notificacoes] = await Promise.all([
            lerChave(a, "scrollback"), lerChave(a, "limitePaineis"), lerChave(a, "permissaoPadrao"), lerChave(a, "cor"), lerChave(a, "notificacoes"),
          ]);
          aplicarCorDestaque(raiz(), cor);
          publicar({ scrollback, limitePaineis, permissaoPadrao, cor, notificacoes, carregado: true });
        } catch (e) {
          publicar({ carregado: true, erro: `Não foi possível ler as configurações: ${e instanceof Error ? e.message : String(e)}` });
        }
      })();
      return iniciado;
    },
    definir,
    restaurarCor: (): Promise<ResultadoConfig> => definir("cor", null),
  };
}

export type StoreConfig = ReturnType<typeof criarStoreConfig>;
export const storeConfig: StoreConfig = criarStoreConfig({ api: () => ade()?.config });

/** Assina só uma fatia: o componente re-renderiza apenas quando o valor selecionado muda. */
export function useConfig<T>(seletor: (e: EstadoConfig) => T, store: StoreConfig = storeConfig): T {
  return useSyncExternalStore(store.assinar, () => seletor(store.obter()));
}
