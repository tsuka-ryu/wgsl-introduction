# wgsl-introduction

WebGPU で 2D「うねうね」を描けるようになるための学習リポジトリ。
TypeScript + [Vite](https://vite.dev/) 構成で、`@webgpu/types` により WebGPU API の型補完が効きます。

## セットアップ

```sh
pnpm install        # または npm install
pnpm dev            # http://localhost:5173 → トップでレッスン選択
```

WebGPU 対応ブラウザが必要です（Chrome / Edge 113+ など）。

```sh
pnpm typecheck      # 型チェック
pnpm build          # tsc + vite build
pnpm preview        # ビルド結果をプレビュー
```

## ディレクトリ構成

```
.
├── index.html                       トップページ（レッスン一覧）
├── vite.config.ts                   src/**/index.html を自動でビルド対象に追加
└── src/
    ├── webgpu-fundamentals/
    │   ├── 01-fundamentals/         各レッスン = 1 フォルダ
    │   │   ├── index.html
    │   │   └── main.ts
    │   ├── 02-inter-stage-variables/
    │   ├── 03-uniforms/
    │   └── 04-large-triangle/
    └── book-of-shaders/             これから 1 つずつ追加
```

新しいレッスンは `src/<track>/<番号>-<名前>/` に `index.html` と `main.ts` を置くだけで、
Vite が自動認識します（トップページの一覧リンクは手動で追加）。

---

## ロードマップ

### WebGPU Fundamentals

**STEP 1 ・ 土台をつくる（順番通りに）**

- [x] [01 基本](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html) — すべての出発点。まずこれから
- [x] [02 inter-stage 変数](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-inter-stage-variables.html) — `@location` の棚でデータを渡す
- [x] [03 ユニフォーム](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-uniforms.html) — シェーダに渡すグローバル変数 (color / scale / offset)。バッファを static/changing に分割する最適化まで

**STEP 2 ・ うねうねの舞台**

- [x] [大きなクリップ空間の三角形](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-large-triangle-to-cover-clip-space.html) — 3 頂点 1 枚で画面いっぱいを覆う。フラグメントシェーダで絵を描く「うねうねの舞台」

> **参考**（必要になったら見る。内容は The Book of Shaders でも扱う）
>
> - [WebGPU の仕組み](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-how-it-works.html) — 頂点/フラグメントシェーダを `Array.map` に例えて、GPU がどう三角形を描くか・なぜ並列で速いかを説明。土台の理解に◎
> - [WGSL 関数リファレンス](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-wgsl-function-reference.html) — sin / cos / `fract` など。辞書として引く
> - [ポストプロセッシング（CRT エフェクト）](https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-post-processing.html) — 既存の絵を歪ませる応用

### The Book of Shaders（読む順）

**初めの一歩（全部読む・土台）**

- [ ] [01 シェーダーとは？](https://thebookofshaders.com/01/?lan=jp) — 復習。サラッと
- [ ] [02 ハロー・ワールド！](https://thebookofshaders.com/02/?lan=jp) — 最初の一枚を出す
- [ ] [03 ユニフォーム変数](https://thebookofshaders.com/03/?lan=jp) — 「時間」を送る
- [ ] [04 シェーダーを使う](https://thebookofshaders.com/04/?lan=jp) — 実際の動かし方

**アルゴリズムで絵を描く（本丸）**

- [ ] [05 シェイピング関数](https://thebookofshaders.com/05/?lan=jp) — sin で波 = うねうねの素。最重要。じっくり
- [ ] [06 色について](https://thebookofshaders.com/06/?lan=jp) — 波を「色」に変換する
- [ ] [07 形について](https://thebookofshaders.com/07/?lan=jp) — 円や四角を数式で描く
- [ ] [08 二次元行列](https://thebookofshaders.com/08/?lan=jp) — 回す・ずらす・動かす
- [ ] [09 パターン](https://thebookofshaders.com/09/?lan=jp) — 模様を繰り返す

**Generative designs（化ける）**

- [ ] [10 ランダム](https://thebookofshaders.com/10/?lan=jp) — ノイズの前段
- [ ] [11 ノイズ](https://thebookofshaders.com/11/?lan=jp) — 自然なゆらぎの正体。水・煙・雲っぽいうねうね
- [ ] [12 セルラーノイズ](https://thebookofshaders.com/12/?lan=jp) — 細胞っぽい模様
- [ ] [13 Fractional Brownian Motion](https://thebookofshaders.com/13/) — ノイズを重ねて本格化
