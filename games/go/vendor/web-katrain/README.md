# Browser KataGo engine

Vendored from https://github.com/Sir-Teo/web-katrain at
`a6a67d645048a996d606a410c4e4c4b1051ffd43` (MIT).

This is its TypeScript/TensorFlow.js implementation of KataGo network evaluation,
features and MCTS, not the native KataGo binary. Only runtime engine dependencies
are included. UI helpers and shared types have been reduced to the exports used
by the engine; engine files are otherwise unchanged.

The model is KataGo's `kata1-b18c384nbt-s9996604416-d4316597426`, downloaded
from https://katagotraining.org/networks/ . Its license is published at
https://katagotraining.org/network_license/ and included in
`public/go/ai-NOTICES.txt`. The application's search settings have no calibrated
kyu/dan rating.

Set `VITE_GO_AI_MODEL_URL` at build time to enable enhanced difficulty using
a hosted b18 model. Unset or blank values omit this difficulty entirely. There
is no default external URL. The external host must allow CORS GET.

The b6 model (`g170-b6c96-s175395328-d26788732`) is bundled with the game as
`games/go/assets/katago-b6.bin.gz` (3,827,339 bytes, CC0-1.0), from
https://github.com/lightvector/KataGo/tree/master/cpp/tests/models .
Its SHA-256 is `f5d32604e3675c480c7c8f6aa579a1ea857135628a0afccc8fa56330fbacd38d`.

The worker streams the HTTP response into the gzip decoder, and accepts
responses already decoded by HTTP Content-Encoding. b18 weights and local
b18 fragments are not included in the repository or static build.
