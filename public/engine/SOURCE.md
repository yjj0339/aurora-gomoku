# Rapfi WebAssembly source notice

The `rapfi.js` and `rapfi-single-simd128.wasm` files in this directory are a
WebAssembly build of Rapfi. The data bundle pins the official public freestyle
NNUE weight used by the Rapfi web distribution.

- Upstream: https://github.com/dhbloo/rapfi
- Source commit: `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`
- Engine core commit date: `2026-07-23`
- Public NNUE weight release: `250615`
- License: GNU General Public License v3 (`LICENSE-RAPFI-GPL-3.0.txt`)
- Authors: see `RAPFI-AUTHORS.txt`

Build configuration:

```text
Emscripten 3.1.64
CMake 3.31.8
-DCMAKE_BUILD_TYPE=Release
-DNO_COMMAND_MODULES=ON
-DNO_MULTI_THREADING=ON
-DUSE_WASM_SIMD=ON
-DUSE_WASM_SIMD_RELAXED=OFF
```

The preloaded data bundle contains the upstream `config.toml`,
`model210901.bin`, and `mix9svqfreestyle_bsmix.bin.lz4` from the official
Rapfi `250615` web release. The freestyle weight is 10,030,398 bytes and its
SHA-256 is:

```text
6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62
```

The 2026 engine core no longer accepts the legacy classical-model entry in the
2025 configuration. `rapfi-worker.js` therefore comments out only that entry
in an in-memory copy before initialization. The on-disk bundle and NNUE weight
bytes remain unchanged. Warmup succeeds only after Rapfi reports that the
`mix9svq` evaluator and its weight were loaded.
