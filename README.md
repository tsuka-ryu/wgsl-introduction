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
- [x] [07 形について](https://thebookofshaders.com/07/?lan=jp) — `step`/`smoothstep` で四角・円を描き、距離フィールド (SDF) と極座標で形を作る。四角 (モンドリアン)／円 (アニメ)／距離フィールドの `min`/`max` 合成／極座標の花・雪の結晶／正N角形SDF まで作例多数
- [x] [08 二次元行列](https://thebookofshaders.com/08/?lan=jp) — 形でなく「空間」を変形すると形が逆向きに動く。`mat2x2f` で平行移動 (引き算)／回転／拡大縮小、回転×スケールの合成 (掛ける順序で変わる非可換)、`mat3x3f` で色空間変換 (YUV→RGB)。列優先・転置の罠も解説
- [x] [09 パターン](https://thebookofshaders.com/09/?lan=jp) — 形でなく「座標の畳み方」を変えて模様にする。`fract` でタイリング／`floor` でマス番地→分岐、パターンをずらす (レンガ・スライド)、マスごとに回転 (番地/floor+hash で向きをバラバラ)、形の差し替え (三角→半円・トルシェ円弧)。`image = 形 ∘ 座標変換` の合成として読む

**Generative designs（化ける）**

- [x] [10 ランダム](https://thebookofshaders.com/10/?lan=jp) — ノイズの前段。GPU に乱数生成器はないので `fract(sin(dot(st,k))*43758.5)` ハッシュで代用 (dotで1次元→sin→巨大倍→fractで折り畳み、隣の相関が壊れて砂嵐)。時間アニメは「乱数を位置で凍結し動きは連続関数 (sin) に任せる」で明滅 ※ノイズはこれから
- [x] [11 ノイズ](https://thebookofshaders.com/11/?lan=jp) — 自然なゆらぎの正体。水・煙・雲っぽいうねうね。**value noise**: `noise(x)=mix(random(floor x), random(floor x+1), smoothstep(fract x))` で「整数点は乱数・すきまをなめらかに補間」(1D/2D)。応用に等高線マップ・ロスコ風・木目・インク飛沫・ポロック風。**simplex noise** は gradient noise の正統進化: 値でなく勾配を格子点に置き `勾配·変位` の内積で作る (格子点で必ず0)。正方格子(4隅)を`skew`で三角格子に変え 3頂点を `max(0.5-d²,0)⁴` の丸い窓で重み付け→軸の癖が消え高次元でも軽い。応用に電光掲示板morph・`domain warp`(座標を別noiseの向き`(cos a,sin a)`へずらして大理石/流体)
- [ ] [12 セルラーノイズ](https://thebookofshaders.com/12/?lan=jp) — 細胞っぽい模様
- [ ] [13 Fractional Brownian Motion](https://thebookofshaders.com/13/) — ノイズを重ねて本格化

### 次にやりたい

- [ ] [楽しい！Unityシェーダーお絵描き入門！](https://docs.google.com/presentation/d/1NMhx4HWuNZsjNRRlaFOu2ysjo04NgcpFlEhzodE8Rlg/edit) — The Book of Shaders を読み終わったら
