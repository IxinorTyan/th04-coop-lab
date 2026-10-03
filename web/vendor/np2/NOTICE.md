# Upstream components

NP2-wasm by irori, based on Neko Project II.

- Source: https://github.com/irori/np2-wasm
- Prebuilt distribution: https://irori.github.io/np2-wasm/
- Downloaded: 2026-10-03
- License: BSD-3-Clause; see LICENSE in this directory.
- Local copies: np2-wasm.js, np21.js, np21.wasm, font.bmp.
- The launcher uses NP21 (i386) for compatibility with the disk's VEM486 driver.
- font_cn.bmp is copied from the user's existing local game bundle, not from upstream.

The local wrapper removes the unused NP2 factory; NP21 remains unchanged.
SHA256SUMS.json records hashes of the shipped runtime files, including this wrapper.
The original wrapper and unused NP2 core are retained in the sibling maintenance directory.

## Separate input-lockstep adapter

`np21-lockstep.js` is generated locally by `tools/build_lockstep_runtime.py`
from the shipped `np21.js`; it shares the existing `np21.wasm`. The generated
adapter changes scheduling, clocks, input dispatch and audio callback ownership.
`web/netplay/np2-clock.js` holds the readable deterministic clock/audio adapter.
The ordinary local-play runtime remains `np21.js`. Source/build fingerprints
are recorded in `web/netplay/runtime.json`. Runtime behavior is pending user
acceptance; generation is not gameplay or network verification.
