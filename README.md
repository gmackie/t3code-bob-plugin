# T3 Code Bob plugin

Bob is a standalone, Bob-primary T3 Code plugin. It owns Bob credentials,
planning normalization, dispatch state, Bob-to-Linear links, and its own
persistence boundary. T3 only supplies the declared RPC capabilities.

This repository is intentionally independent from the T3 Code checkout. The
host protocol types currently mirror the versioned contracts in
`@t3tools/contracts`; publish those contracts as the SDK before external
distribution.

The source classification for the existing Bob work is tracked in
`custom-local/docs/plugins/migration-manifest.yaml` in the T3 checkout.

The proof-of-concept RPC boundary in `src/rpc.ts` keeps listing, detail, run,
and dispatch operations Bob-owned while returning normalized records to T3.
