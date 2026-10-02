import { describe, expect, it } from "vitest";
import { desescapar, documento, filhosDe, parseXml, textoDe } from "./xml";
import { lerFixtureSvn } from "../../../../tests/fixtures/vcs/svn-util";

describe("xml do svn", () => {
  it("lê atributos em linhas separadas, entidades e texto aninhado das saídas gravadas", () => {
    const log = documento(lerFixtureSvn("log.xml"), "log");
    const e = filhosDe(log, "logentry")[0];
    expect(e?.attrs.revision).toBe("6");
    expect(textoDe(e, "msg")).toBe("segundo ✓ com acento");
    expect(desescapar("a &lt;b&gt; &amp; &#233; &#x41;")).toBe("a <b> & é A");
  });
  it("XML truncado nunca lança: fecha o que estava aberto", () => {
    const r = parseXml(lerFixtureSvn("status.xml").slice(0, 400));
    expect(r.filhos[0]?.nome).toBe("status");
    expect(() => parseXml("<a><b x='1'")).not.toThrow();
    expect(() => parseXml("")).not.toThrow();
  });
});
