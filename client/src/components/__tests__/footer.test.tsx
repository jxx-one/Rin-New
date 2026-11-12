import "../../test/setup";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { ClientConfigContext, defaultClientConfig, ConfigWrapper } from "../../state/config";
import Footer from "../footer";

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

mock.module("wouter", () => ({
  useLocation: () => ["/", mock()],
}));

mock.module("reactjs-popup", () => ({
  default: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

mock.module("react-helmet", () => ({
  Helmet: () => null,
}));

const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: matchMediaStub,
});

const storage = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, String(value));
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageStub,
});

function renderFooter(config: Record<string, unknown>) {
  const wrapper = new ConfigWrapper(config, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={wrapper}>
      <Footer />
    </ClientConfigContext.Provider>,
  );
}

describe("Footer badge", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders the default copyright badge when no custom badge is configured", () => {
    const { container } = renderFooter({});
    const footer = container.querySelector("footer");
    const year = new Date().getFullYear();

    expect(footer?.textContent).toContain(`© ${year} Powered by`);
  });

  it("renders the custom badge html including its link", () => {
    const { getByText } = renderFooter({
      "footer.copyright": '<a href="https://example.com/about">我的角标</a>',
    });

    const link = getByText("我的角标").closest("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/about");
    expect(getByText("我的角标").closest("footer")?.textContent).not.toContain("Powered by");
  });

  it("falls back to the default badge when the custom value is emptied", () => {
    const { container } = renderFooter({ "footer.copyright": "" });
    expect(container.querySelector("footer")?.textContent).toContain("Powered by");
  });
});
