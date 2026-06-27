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

- [x] [01 シェーダーとは？](https://thebookofshaders.com/01/?lan=jp) — 復習。サラッと（ざっと読了）
- [x] [02 ハロー・ワールド！](https://thebookofshaders.com/02/?lan=jp) — 最初の一枚を出す（ざっと読了）
- [x] [03 ユニフォーム変数](https://thebookofshaders.com/03/?lan=jp) — 「時間」を送る（ざっと読了）
- [x] [04 シェーダーを使う](https://thebookofshaders.com/04/?lan=jp) — 実際の動かし方（ざっと読了）

**アルゴリズムで絵を描く（本丸）**

- [x] [05 シェイピング関数](https://thebookofshaders.com/05/?lan=jp) — sin で波 = うねうねの素。最重要。じっくり（01〜04 は Fundamentals の復習なのでざっと読んで通過）
- [x] [06 色について](https://thebookofshaders.com/06/?lan=jp) — 波を「色」に変換する。`mix` で 2 色補間／RGB を位相ずらしの sin 波にして虹。本家の作例 (`pct` を vec3 にして R/G/B を別カーブで補間 + `plot`) も別フォルダで用意
  - 演習: `step()` の三色旗 / ターナーの夕日グラデーション (`mix` を縦に) / それに `u_time` を足した日の出→日の入りアニメ / HSB カラーピッカー (`hsb2rgb`) / HSB と極座標のカラーホイール (`atan2` で角度=色相・`length` で距離=彩度)
- [ ] [07 形について](https://thebookofshaders.com/07/?lan=jp) — 円や四角を数式で描く
  - `step()` を x/y に使い掛け算 (= 論理積 AND) で角を切り出す。四角形を描く最初の一歩 → `1.0 - st` で右上 2 辺も削り、4 辺の `step` を掛けて中央に四角形を完成 → 中心 + `size(幅,高さ)` で角の座標を出し、長方形の大きさ・縦横比を自由に変える → `step` を `smoothstep` に差し替え、`blur` で縁をくっきり↔ぼんやりに調整 → `floor(x*N)/N` でグラデを N 段の階段に区切る (ポスタリゼーション) → 四角を `box()` 関数に切り出し位置を変えて複数配置、`mix` で塗り重ねてモンドリアン風 → 同じ `box()` で実在作 (1937-42) に寄せ、大きさバラバラの長方形を非対称に配置
  - 円へ: `distance` で中心からの距離を色に (距離フィールド = `SDF: Point→Distance` の場)。これを step/smoothstep に通すと円になる → `step(0.5, 距離)` で 2 値化 (しきい値=半径)。0.5 以上を白にすると黒い円 → `1.0 - step(...)` でマスク反転 (or 引数入替) して黒地に白い円 → `step`→`smoothstep` で縁をなめらかに、`blur` でくっきり↔ふわっと (アンチエイリアス) → 円を `circle()` 関数化 (Point→被覆率) し `mix` で色をつける (box() の円版) → `u_time` で半径を脈動させ鼓動する円 (形は固定、radius だけ動かす) → `center` を `time` の関数 (cos/sin で円軌道) にして円を動かし、`circle()` を別中心で再呼出しして 2 つ目を描く → 2 つの距離フィールドを `+ * min max pow` で組合せ (コメント切替)。和=楕円 / 積=∞字 / min=合体 / max=レンズ、アニメ付き → 本家の `circle()` 関数: `dot(d,d)`=距離の2乗で sqrt を省き、ぼかし幅を半径比例に → 距離フィールドの便利な性質: `abs` で空間を折り `min/max` で角丸四角の SDF、`fract`可視化/`step`描画 (コメント切替) → 極座標の形: `atan2` の角度でしきい半径 `f=cos(a*N)` を変化させ花/星/歯車 (コメント切替) → 角度に `time` を足して回転＋`sin`脈動する花アニメ / 外マスク×`(1-内マスク)` でくり抜き (subtract)＋放射スポークで雪の結晶 → 正N角形SDF: 角度を `floor` で N 等分のくさびに畳み最寄りの辺までの距離を測る (N で角数可変) → SDF を `min`=和集合 / `max`=積集合 / `max(d1,-d2)`=差 で合成 (円と四角を動かして体感、コメント切替)
- [ ] [08 二次元行列](https://thebookofshaders.com/08/?lan=jp) — 回す・ずらす・動かす
- [ ] [09 パターン](https://thebookofshaders.com/09/?lan=jp) — 模様を繰り返す

**Generative designs（化ける）**

- [ ] [10 ランダム](https://thebookofshaders.com/10/?lan=jp) — ノイズの前段
- [ ] [11 ノイズ](https://thebookofshaders.com/11/?lan=jp) — 自然なゆらぎの正体。水・煙・雲っぽいうねうね
- [ ] [12 セルラーノイズ](https://thebookofshaders.com/12/?lan=jp) — 細胞っぽい模様
- [ ] [13 Fractional Brownian Motion](https://thebookofshaders.com/13/) — ノイズを重ねて本格化
