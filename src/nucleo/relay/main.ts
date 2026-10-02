// Ponto de entrada do relay (T-22.08): `node dist/nucleo/relay/main.js`. Configuração SÓ por variáveis de ambiente, lidas POR NOME (nunca por arquivo de ambiente); valor inválido cai no padrão
// seguro. Encerra limpo em SIGTERM/SIGINT (<= 2 s). Nada de segredo: o relay não tem chaves nem contas.
import { iniciarRelay, type OpcoesRelay } from "./servidor";

type Env = Record<string, string | undefined>;
const inteiro = (v: string | undefined, padrao: number, min: number, max: number): number => {
  const n = v === undefined || !/^\d{1,9}$/.test(v) ? NaN : Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : padrao;
};
/** Variáveis: RELAY_PORTA, RELAY_BIND, RELAY_MAX_CANAIS, RELAY_MAX_CONEXOES, RELAY_MAX_POR_IP, RELAY_CONFIAR_PROXY. */
export function lerConfig(env: Env): OpcoesRelay {
  return {
    bind: env["RELAY_BIND"] !== undefined && /^[0-9a-fA-F:.]{2,45}$/.test(env["RELAY_BIND"]) ? env["RELAY_BIND"] : "127.0.0.1",
    porta: inteiro(env["RELAY_PORTA"], 8080, 1, 65535),
    confiarProxy: env["RELAY_CONFIAR_PROXY"] === "1",
    limites: { maxCanais: inteiro(env["RELAY_MAX_CANAIS"], 5000, 1, 100_000), maxConexoes: inteiro(env["RELAY_MAX_CONEXOES"], 10_000, 1, 200_000), maxConexoesPorIp: inteiro(env["RELAY_MAX_POR_IP"], 32, 1, 1000) },
  };
}

if (require.main === module) {
  void iniciarRelay(lerConfig(process.env)).then((s) => {
    const sair = (): void => {
      const t = setTimeout(() => process.exit(0), 2000);
      t.unref();
      void s.fechar().then(() => process.exit(0));
    };
    process.once("SIGTERM", sair);
    process.once("SIGINT", sair);
  });
}
