// Compile-time zh↔en parity: every `en/<ns>.ts` file declares
// `satisfies TranslationShape<typeof zhCounterpart>`, so a key added to one language without the
// other is a typecheck error (in this package and in both apps' locale trees).
export type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>;
};
