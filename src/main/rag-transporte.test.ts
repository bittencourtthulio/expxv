import { afterEach, describe, expect, it } from "vitest";
import { CHAVE_SEMENTE } from "../../tests/fixtures/rag/ambiente";
import { subirStubRag, type StubRag } from "../../tests/fixtures/rag/servidor-stub";
import { criarClienteRede, criarRegistroConsentimento, type ClienteRede } from "../nucleo/rede";
import { criarTransporteRagDoApp, hostsDeConsentimentos } from "./rag-transporte";

const abertos: StubRag[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as StubRag).fechar();
});

describe("src/main/rag-transporte: ligação do transporte ao ClienteRede do app", () => {
  it("sem consentimento gravado nada sai; com ele a chamada passa pelo cliente real (loopback de teste)", async () => {
    const s = await subirStubRag({ provedor: "qdrant", chave: CHAVE_SEMENTE });
    abertos.push(s);
    const consentimento = criarRegistroConsentimento();
    const rede: ClienteRede = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
    let config: { consentimento: { host: string } | null } | null = { consentimento: null };
    const t = criarTransporteRagDoApp({ rede, consentimento, hostsConsentidos: hostsDeConsentimentos(() => [config]) });
    await expect(t({ url: `${s.url}/collections`, metodo: "GET", cabecalhos: { "api-key": CHAVE_SEMENTE } })).rejects.toThrow(/consent_required/);
    expect(s.conexoes()).toBe(0);
    config = { consentimento: { host: s.host } };
    const r = await t({ url: `${s.url}/collections`, metodo: "GET", cabecalhos: { "api-key": CHAVE_SEMENTE } });
    expect(r.ok).toBe(true);
    config = null; // consentimento removido (voltar para local)
    await expect(t({ url: `${s.url}/collections`, metodo: "GET" })).rejects.toThrow(/consent_required/);
    expect(s.requisicoes).toHaveLength(1);
  });
  it("hostsDeConsentimentos ignora configs sem consentimento", () => {
    expect(hostsDeConsentimentos(() => [null, undefined, { consentimento: null }, { consentimento: { host: "a.exemplo.com" } }])()).toEqual(["a.exemplo.com"]);
  });
});
