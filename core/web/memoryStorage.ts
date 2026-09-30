/**
 * A `localStorage` that lives as long as the page.
 *
 * The app runs in an iframe on www.kavibay.com, which is the landing page's own
 * origin: the real localStorage is shared with the page around it, and with
 * whatever the last visitor did. Each visit should start from the demo desk and
 * leave nothing behind, so the app gets this instead.
 *
 * Entries are own enumerable properties and the methods are not, because the
 * app reads the store both ways: `getItem`/`key(i)` in layoutLogic and
 * durableStorage, `Object.keys(localStorage)` in the extension data store.
 */
export function installMemoryStorage(): void {
  const store = {} as Storage;
  const entries = () => Object.keys(store);
  const methods: Record<string, unknown> = {
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(store, key) ? (store as never)[key] : null,
    setItem: (key: string, value: string) => {
      (store as unknown as Record<string, string>)[key] = String(value);
    },
    removeItem: (key: string) => {
      delete (store as unknown as Record<string, string>)[key];
    },
    clear: () => {
      for (const key of entries()) delete (store as unknown as Record<string, string>)[key];
    },
    key: (index: number) => entries()[index] ?? null,
  };
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(store, name, { value, enumerable: false });
  }
  Object.defineProperty(store, "length", { get: () => entries().length, enumerable: false });
  Object.defineProperty(window, "localStorage", { value: store, configurable: true });
}
