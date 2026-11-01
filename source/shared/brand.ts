// The key is a symbol that's declared, never created, so the mark exists
// only for the type checker: nothing at runtime has it, and nothing can name
// it outside this file.
declare const brand: unique symbol;
type _Brand_<__Value__, __Name__ extends string> = __Value__ & { readonly [brand]: __Name__ };

export type _Role_<__Value__, __Name__ extends string> = _Brand_<__Value__, __Name__>;
export type _Proof_<__Value__, __Name__ extends string> = _Brand_<__Value__, __Name__>;
