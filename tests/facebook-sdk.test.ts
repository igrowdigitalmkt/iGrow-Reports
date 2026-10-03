import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

it("does not enable login on the SDK buffering facade and initializes the popup flow only when ready", async () => {
  const init = vi.fn();
  const facade = { __buffer: {}, init, login: vi.fn() };
  const browser: { FB: typeof facade | { init: typeof init; login: ReturnType<typeof vi.fn> }; fbAsyncInit?: () => void } = { FB: facade };
  const script: { onload?: () => void; onerror?: () => void } = {};
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", { querySelector: () => null, createElement: () => script, head: { appendChild: vi.fn() } });
  const { loadFacebookSdk } = await import("@/modules/meta/facebook-sdk");
  const ready = vi.fn();
  const promise = loadFacebookSdk("v26.0").then(ready);
  script.onload?.();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  expect(init).not.toHaveBeenCalled();
  browser.FB = { init, login: vi.fn() };
  browser.fbAsyncInit?.();
  await promise;
  expect(init).toHaveBeenCalledWith(expect.objectContaining({ fedCM: false, version: "v26.0" }));
  expect(ready).toHaveBeenCalledWith(browser.FB);
});

it("stops loading with an actionable error if the SDK bundle is blocked", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { querySelector: () => null, createElement: () => ({}), head: { appendChild: vi.fn() } });
  const { loadFacebookSdk } = await import("@/modules/meta/facebook-sdk");
  const failure = expect(loadFacebookSdk("v26.0")).rejects.toThrow("não carregou");
  await vi.advanceTimersByTimeAsync(20000);
  await failure;
});
