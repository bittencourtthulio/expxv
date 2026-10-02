import type { ArquivoMapa } from "./tipos";
import { pastaDe } from "./tipos";

// Zonas de risco CANDIDATAS (T-17.29): dicionário PT/EN sobre caminhos, símbolos e tabelas. Sempre "candidata"; quem valida
// é NÃO DETERMINADO (decisão humana: a zona declarada vem do PERFIL do legadox, nunca daqui).

export const QUEM_VALIDA = "NÃO DETERMINADO";

export type CategoriaZona = "financeiro" | "fiscal" | "folha" | "autenticacao" | "pagamento" | "auditoria" | "contratual" | "lgpd";

/** Termos (já sem acento, minúsculos) que formam a zona. Casam por TERMO inteiro de caminho/nome (camelCase e snake_case separados). */
export const DICIONARIO_ZONAS: Readonly<Record<CategoriaZona, readonly string[]>> = {
  financeiro: ["financeiro", "financeira", "finance", "financial", "saldo", "balance", "ledger", "lancamento", "lancamentos", "contabil", "contabilidade", "accounting", "tesouraria"],
  fiscal: ["fiscal", "fiscais", "nfe", "nfce", "nfse", "nf", "sped", "icms", "ipi", "pis", "cofins", "iss", "imposto", "impostos", "tributo", "tributos", "tax", "taxes", "cfop", "danfe"],
  folha: ["folha", "payroll", "holerite", "salario", "salary", "ferias", "rescisao", "ponto", "timesheet", "fgts", "inss", "decimo"],
  autenticacao: ["auth", "authentication", "authorization", "login", "logout", "senha", "password", "permissao", "permissoes", "permission", "permissions", "jwt", "oauth", "sso", "session", "credential", "credentials", "acl", "rbac"],
  pagamento: ["pagamento", "pagamentos", "payment", "payments", "boleto", "boletos", "pix", "gateway", "cobranca", "billing", "fatura", "invoice", "checkout", "cartao", "stripe", "adquirente"],
  auditoria: ["auditoria", "audit", "auditlog", "trilha", "imutavel", "immutable"],
  contratual: ["contrato", "contratos", "contract", "contracts", "juros", "amortizacao", "parcela", "parcelas", "comissao", "comissoes", "apolice"],
  lgpd: ["lgpd", "gdpr", "cpf", "cnpj", "pii", "consentimento", "consent", "privacidade", "privacy", "titular", "anonimizacao", "anonymize"],
};

function sem(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function termosDe(texto: string): string[] {
  return sem(texto.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

const INDICE: ReadonlyMap<string, CategoriaZona> = new Map(Object.entries(DICIONARIO_ZONAS).flatMap(([cat, termos]) => termos.map((t) => [t, cat as CategoriaZona] as const)));

export interface ZonaCandidata {
  categoria: CategoriaZona;
  rotulo: "candidata";
  pastas: string[];
  arquivos: string[];
  tabelas: string[];
  /** Símbolos cujo NOME casou (qualificado, `arquivo#nome`). */
  simbolos: string[];
  /** Até 5 `arquivo:linha` (ou `arquivo` quando só o caminho casou). */
  evidencias: string[];
  quem_valida: typeof QUEM_VALIDA;
}

export interface EntradaZonas {
  arquivos: readonly ArquivoMapa[];
  /** Nomes de tabela normalizados (`tab:` sem prefixo). */
  tabelas?: readonly string[];
}

const MAX_LISTA = 30;

/** Agrupa as ocorrências do dicionário em zonas candidatas por categoria. Testes e arquivos gerados são ignorados. */
export function zonasCandidatas(e: EntradaZonas): ZonaCandidata[] {
  const por = new Map<CategoriaZona, { pastas: Set<string>; arquivos: Set<string>; tabelas: Set<string>; simbolos: Set<string>; evid: string[] }>();
  const zona = (c: CategoriaZona) => {
    let z = por.get(c);
    if (z === undefined) por.set(c, (z = { pastas: new Set(), arquivos: new Set(), tabelas: new Set(), simbolos: new Set(), evid: [] }));
    return z;
  };
  for (const a of e.arquivos) {
    if (a.extracao.e_teste || a.extracao.e_gerado) continue;
    const cats = new Set<CategoriaZona>();
    for (const t of termosDe(a.caminho)) {
      const c = INDICE.get(t);
      if (c !== undefined) cats.add(c);
    }
    for (const c of cats) {
      const z = zona(c);
      z.arquivos.add(a.caminho);
      z.pastas.add(pastaDe(a.caminho));
      if (z.evid.length < 5) z.evid.push(a.caminho);
    }
    for (const s of a.extracao.simbolos) {
      for (const t of new Set(termosDe(s.nome))) {
        const c = INDICE.get(t);
        if (c === undefined) continue;
        const z = zona(c);
        z.arquivos.add(a.caminho);
        z.pastas.add(pastaDe(a.caminho));
        z.simbolos.add(`${a.caminho}#${s.qualificado}`);
        if (z.evid.length < 5) z.evid.push(`${a.caminho}:${s.linha}`);
      }
    }
  }
  for (const t of e.tabelas ?? []) {
    for (const termo of new Set(termosDe(t))) {
      const c = INDICE.get(termo);
      if (c !== undefined) zona(c).tabelas.add(t);
    }
  }
  return [...por]
    .map(([categoria, z]) => ({
      categoria,
      rotulo: "candidata" as const,
      pastas: [...z.pastas].sort().slice(0, MAX_LISTA),
      arquivos: [...z.arquivos].sort().slice(0, MAX_LISTA),
      tabelas: [...z.tabelas].sort().slice(0, MAX_LISTA),
      simbolos: [...z.simbolos].sort().slice(0, MAX_LISTA),
      evidencias: z.evid,
      quem_valida: QUEM_VALIDA as typeof QUEM_VALIDA,
    }))
    .sort((a, b) => b.arquivos.length - a.arquivos.length || a.categoria.localeCompare(b.categoria));
}
