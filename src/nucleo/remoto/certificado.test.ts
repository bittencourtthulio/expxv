import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey } from "node:crypto";
import { connect, createServer } from "node:tls";
import { describe, expect, it } from "vitest";
import { gerarCertificadoAutoassinado } from "./certificado";

describe("certificado autoassinado mínimo (T-13.12)", () => {
  it("X509Certificate lê, a assinatura confere, SAN de IP e CA:FALSE", () => {
    const t0 = performance.now();
    const { cert, certPem, keyPem } = gerarCertificadoAutoassinado({ ips: ["192.168.1.20"], dns: ["meu-mac.tailnet.ts.net"] });
    expect(performance.now() - t0).toBeLessThan(500); // P-65: 1ª geração <= 500 ms
    expect(cert.verify(createPublicKey(certPem))).toBe(true);
    expect(cert.checkIP("192.168.1.20")).toBe("192.168.1.20");
    expect(cert.checkIP("192.168.1.21")).toBeUndefined();
    expect(cert.checkHost("meu-mac.tailnet.ts.net")).toBeDefined();
    expect(cert.ca).toBe(false);
    expect(cert.subjectAltName).toContain("IP Address:192.168.1.20");
    expect(cert.keyUsage).toBeDefined();
    expect(Date.parse(cert.validTo)).toBeGreaterThan(Date.now());
    expect(keyPem).toContain("PRIVATE KEY");
  });
  it("IPv6 e dois certificados nunca repetem série nem chave", () => {
    const a = gerarCertificadoAutoassinado({ ips: ["fd00::1"] });
    const b = gerarCertificadoAutoassinado({ ips: ["fd00::1"] });
    expect(a.cert.checkIP("fd00::1")).toBeDefined();
    expect(a.cert.serialNumber).not.toBe(b.cert.serialNumber);
    expect(a.keyPem).not.toBe(b.keyPem);
  });
  const temOpenssl = spawnSync("openssl", ["version"]).status === 0;
  it.skipIf(!temOpenssl)("openssl concorda (-text)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cert-"));
    try {
      const { certPem } = gerarCertificadoAutoassinado({ ips: ["10.1.2.3"] });
      writeFileSync(join(dir, "c.pem"), certPem);
      const txt = execFileSync("openssl", ["x509", "-in", join(dir, "c.pem"), "-noout", "-text"]).toString();
      expect(txt).toContain("ecdsa-with-SHA256");
      expect(txt).toContain("IP Address:10.1.2.3");
      expect(txt).toContain("CA:FALSE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("uma conexão TLS com `ca` = certificado conecta (e sem o `ca` é recusada)", async () => {
    const { certPem, keyPem } = gerarCertificadoAutoassinado({ ips: ["127.0.0.1"] });
    const srv = createServer({ key: keyPem, cert: certPem }, (s) => s.end("ok"));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const porta = (srv.address() as { port: number }).port;
    try {
      const lido = await new Promise<string>((resolve, reject) => {
        const c = connect({ host: "127.0.0.1", port: porta, ca: certPem, servername: "" }, () => undefined);
        let t = "";
        c.on("data", (d) => (t += d.toString()));
        c.on("end", () => resolve(t));
        c.on("error", reject);
      });
      expect(lido).toBe("ok");
      await expect(new Promise((resolve, reject) => {
        const c = connect({ host: "127.0.0.1", port: porta, servername: "" }, () => resolve("conectou"));
        c.on("error", reject);
      })).rejects.toBeTruthy();
    } finally {
      srv.close();
    }
  });
});
