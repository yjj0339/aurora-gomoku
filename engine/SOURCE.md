# Rapfi WebAssembly source notice

The `rapfi.js`, `rapfi-single-simd128.wasm`, and `rapfi-single-simd128.data`
files in this directory are an unmodified WebAssembly build of Rapfi.

- Upstream: https://github.com/dhbloo/rapfi
- Source commit: `3c94c2a976f24a0dd1c5517623e9ab6fffe66bd7`
- Engine/model release: `250615`
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
Rapfi `250615` release. No Rapfi source modifications were made.
