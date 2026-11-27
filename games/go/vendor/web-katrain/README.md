# Browser KataGo engine

Vendored from https://github.com/Sir-Teo/web-katrain at
`a6a67d645048a996d606a410c4e4c4b1051ffd43` (MIT).

This is its TypeScript/TensorFlow.js implementation of KataGo network evaluation,
features and MCTS, not the native KataGo binary. Only runtime engine dependencies
are included. UI helpers and shared types have been reduced to the exports used
by the engine. Local additions support v17 Transformer networks: binary headers,
SiLU, RMSNorm, grouped-query attention, learned/fixed 2D RoPE, and SwiGLU.
The implementation follows KataGo's `cpp/neuralnet/desc.cpp` and
`cpp/neuralnet/eigenbackend.cpp`; Transformer operations live in `transformer.ts`.
Residual blocks also release their intermediate tensors as they run, bounding
activation memory instead of retaining the entire network's intermediates.

The model is KataGo's `kata1-b18c384nbt-s9996604416-d4316597426`, downloaded
from https://katagotraining.org/networks/ . Its license is published at
https://katagotraining.org/network_license/ and included in
`public/go/ai-NOTICES.txt`. The application's search settings have no calibrated
kyu/dan rating.

Set `VITE_GO_AI_MODEL_URL` at build time to enable enhanced difficulty using
a hosted b18 or v17 Transformer model. Unset or blank values omit this difficulty entirely. There
is no default external URL. The external host must allow CORS GET.

The same URL enables win-rate analysis in saved-game review. Analysis is opt-in:
opening a record or its chart does not start a model download. Positions are
searched sequentially (up to 32 visits / 1 second per position), with Black's
estimated win rate shown consistently across turns. Pausing, leaving review or
backgrounding the page terminates the analysis worker. Completed points are
retained in memory for up to eight records during the page session.

The b6 model (`g170-b6c96-s175395328-d26788732`) is bundled with the game as
`games/go/assets/katago-b6.bin.gz` (3,827,339 bytes, CC0-1.0), from
https://github.com/lightvector/KataGo/tree/master/cpp/tests/models .
Its SHA-256 is `f5d32604e3675c480c7c8f6aa579a1ea857135628a0afccc8fa56330fbacd38d`.

The worker streams the HTTP response into the gzip decoder, and accepts
responses already decoded by HTTP Content-Encoding. b18 weights and local
b18 fragments are not included in the repository or static build.

## Tested v17 Transformer

`b10c512h8nbt3tflrs-fson-silu-rsnh.bin.gz` from
https://github.com/lightvector/KataGo/releases/tag/v1.17.0
is 94,281,753 bytes (94.3 MB decimal / 89.9 MiB compressed).
SHA-256: `c04db4a503721d948bb720324f3cbdac6088cc9eb243632f020e4b6846f58995`.
Its model format is v17; the internal name ends in `-swa`.

Host the file on a CORS-enabled server and point `VITE_GO_AI_MODEL_URL` at it.
This setting selects the existing enhanced difficulty; its stored `b18` ID is
retained for compatibility with saved games and is not a model-format restriction.
No Transformer weights or default external URL are added to the build.

The model has been tested with browser WebGPU and single-threaded WASM on 9×9
and 19×19 boards. WASM can take several seconds per move on 19×19, even with a
small search time budget: one network evaluation cannot be interrupted midway.
Phone performance requires real-device testing; a mobile viewport is not a
mobile GPU benchmark. The 94 MB download size is not its runtime memory usage.
Enhanced difficulty uses a 2,000 ms search budget and a 128-visit limit on every
backend; search stops at whichever limit is reached first. Ordinary difficulty
keeps its 48-visit limit and 800 ms WebGPU / 500 ms WASM or CPU budget.

`tests/go-ai-transformer.test.js` checks attention/RoPE and SwiGLU against
independent PyTorch float32 reference values, v17 binary parsing, tensor cleanup,
and the bundled v8 b6 network against pre-change reference outputs.
