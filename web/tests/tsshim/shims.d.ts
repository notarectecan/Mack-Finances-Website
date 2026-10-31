declare module "react" {
  export type ReactNode = any;
  export type FormEvent = { preventDefault(): void };
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: unknown[]): T;
  export function useRef<T>(init: T | null): { current: T | null };
  export interface Context<T> { Provider: (p: { value: T; children?: any }) => any }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export const StrictMode: (p: { children?: any }) => any;
}
declare module "react/jsx-runtime" { export const jsx: any, jsxs: any, Fragment: any; }
declare module "react-dom/client" { export function createRoot(el: Element): { render(n: any): void }; }
declare module "@supabase/supabase-js" { export function createClient(url: string, key: string, o?: any): any; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } type Element = any; interface ElementAttributesProperty {} interface IntrinsicAttributes { key?: any } }
interface ImportMeta { env: Record<string, string> }
declare module "*.css";
