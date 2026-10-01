// Setup global dos testes. Testes de UI usam `// @vitest-environment jsdom` por arquivo.
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
