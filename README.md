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
- [x] [12 セルラーノイズ](https://thebookofshaders.com/12/?lan=jp) — 細胞っぽい模様。特徴点までの**距離場** (`min` で最短だけ残す) が出発点。全点総当たりは重いので空間をタイルに切り `floor`=セル番地/`fract`=セル内座標、番地を種に各セルへ点1個。最短点は必ず自分+隣接8マスにあるので **3×3近傍** だけ走査=点が無限でも `O(9)` 定数コスト (Worley noise)。距離だけでなく勝者点も覚える **argmin** にすると平面が縄張りに分かれる **ボロノイ**、境界は2点の垂直二等分線。応用に F2−F1 のひび割れ・距離を掛けて融合させるメタボール・点描 (stippling)・セル境界線までの距離 (`dot(中点, normalize(r−mr))`) で細胞組織・格子を捨て100点ばらまく総当たり Voronoi (Unicorn Puke)。production 版は `permute=mod((34x+1)x,289)` 多項式ハッシュ + 2×2窓を `vec4` 並列で分岐なし計算 (cellular2x2)
- [x] [13 Fractional Brownian Motion](https://thebookofshaders.com/13/) — ノイズを重ねて本格化。**fBm**: 同じ noise を「周波数×2・振幅×0.5」しながら足すだけ `fbm(x)=Σ gⁱ·noise(lⁱx)` (g=gain, l=lacunarity)。和の i=0 を外に出すと `fbm(x)=noise(x)+g·fbm(l·x)` = 自分をズームして縮めたコピーを内に含む不動点的な再帰式 → どのスケールでも同じ手触り = 自己相似。有限ループはこれを数段 unfold した近似 (g<1 で等比級数収束・lᴺ より細部は無い「なんちゃってフラクタル」)。応用: `abs()` で谷を折り返す **turbulence** (鋭い峰の乱流)、それを反転し²で尖らせ一つ粗い層 `prev` で変調して積む **ridged multifractal** (侵食地形風・場所ごとに粗さが変わる)、**domain warping** = fBm の出力を fBm の入力座標へ注ぎ込む `f=fbm(st+fbm(st+fbm(st)))` (空間がぐにゃり伸びる雲/大理石)。octave ごとに座標を回転させ value noise の軸バイアス (方眼) を消すのも定番

### 楽しい！Unityシェーダーお絵描き入門！

- [x] [楽しい！Unityシェーダーお絵描き入門！](https://docs.google.com/presentation/d/1NMhx4HWuNZsjNRRlaFOu2ysjo04NgcpFlEhzodE8Rlg/edit) — BoS の復習を兼ねて通読。内容は BoS(WGSL) と地続きなので、疑問をこのリポジトリのコードで再考しながら [`src/unity-shader-drawing/notes.md`](src/unity-shader-drawing/notes.md) にナレッジベース化。**得た全体像**: フラグメントシェーダの本質は `色 = 純関数(座標)`、それを `色 = 色付け ∘ 場 ∘ 座標変換` の3段で組む。デッキの5技法もここに畳まれる — **場**=ディスタンスフィールド(幾何の花形)/擬似乱数(ノイズ)、**座標変換**=極座標・歪み(domain warp)・繰り返し(frac/floor)、**色付け**=step/sin/mix・マスク合成。距離場からは `min`=セルラー / `argmin`=ボロノイ / `F2−F1`=ひび割れ / 境界=網目 / 掛け算=メタボール / ハーフトーン=点描 が枝分かれ。HLSL↔WGSL 方言(`frac`/`lerp`/`float2`)も対応表化。※3D レイマーチングでは距離場(SDF)が本質に昇格

### jz examples を WGSL で描く（学習順）

[dy/jz の examples](https://github.com/dy/jz/tree/main/examples) から、各ピクセルが `f(uv, time) → color` の純関数として独立に計算できる単一パス題材を選定。**ジャンル順 = 学習順**、原則は「新しい概念は一度にひとつ・前の題材の道具を次で再利用」。Inigo Quilez の記事（iquilezles.org/articles）は直結する3本をリストの該当位置に混ぜてある。残りは題材をやる日に辞書として引く。

**場の重ね合わせ（ウォームアップ・新道具ゼロ）**

数個のソースの場を足して色付けする `Σ field(p, sourceᵢ)` の型の3連発。

- [x] interference — 2波源の干渉。距離2つの sin の和、数行で書ける入門向き
- [ ] chladni — 定在波のノード模様。sin 積の和。interference の「足すもの」が変わるだけ
- [ ] metaballs — 逆二乗場の和 + しきい値。ボール数個なら uniform で渡してループ

**BoS 総復習の大物（距離場・パターン・ノイズ、各章の卒業制作）**

- [ ] IQ: Voronoi edges — F1−F2 の境界は歪む、正しくは垂直二等分線への距離。BoS 12章で写経した `dot(中点, normalize(r−mr))` の種明かし
- [ ] voronoi — 最近傍サイト探索のブルートフォース版。セルラーノイズ章の復習
- [ ] truchet — セル分割 + ハッシュ + 弧の SDF。パターン章の復習
- [ ] IQ: Domain warping — `fbm(p+fbm(p+fbm(p)))` の記事そのもの
- [ ] plasma — FBM ドメインワープの定番。fBm 章の総復習

**複素数と反復（唯一の新しい数学・段階的に導入）**

- [ ] domain-color — 複素関数 f(z) の偏角=色相・絶対値=明度で塗る。uv を複素数とみなすだけで**反復なし**。まず複素平面に慣れる。FP 的にも美しい
- [ ] IQ: Continuous iteration count — `n−log₂(log|z|)` の縞消しの導出
- [ ] mandelbrot / julia — エスケープ時間 `escape(c)=min{n:|zₙ|>2}, zₙ₊₁=zₙ²+c` を1ピクセルで反復するだけの純関数。domain-color の複素数に反復と脱出判定を足すだけで新しい道具ゼロ（複素2乗は `z²=(x²−y², 2xy)`）、Julia は c を定数化する1行差。縞消しは連続反復数 `n−log₂(log|z|)`
- [ ] burningship / newton / lyapunov — escape-time 系の変奏3連発。コードの骨格は前項のまま写像だけ差し替え。Newton は z³−1 の求根の収束先で塗り分け
- [ ] pascal-sierpinski — 二項係数 mod p。mod 2 なら `(x & y) == 0` の1行、ビット演算の箸休め。次の scatter 編の「逆写像で per-pixel 化」注記への伏線

※ Game of Life / reaction-diffusion 等は前フレーム参照（ping-pong 型）なので単一パスでは書けず後回し

**点蓄積（scatter 型）・compute shader 編**

**Mandelbrot の反復の記憶が新しいうちに**（buddhabrot が同じ数式の scatter 視点なので）。chaos-game な IFS/アトラクタは「ピクセルが値を集める (gather)」でなく「点がピクセルへ書き込む (scatter)」なので fragment shader 単体では書けない。FP 的には gather=関数の引き戻し (pullback)・scatter=測度の押し出し (pushforward) の双対。WGSL では storage buffer 上の `atomic<u32>` に `atomicAdd` でヒストグラムを蓄積し（u32 加算が可換モノイドなので書き込み順が不定でも結果は同じ）、fragment パスで log トーンマップして表示。新概念は **compute pipeline / storage buffer / atomics / 自作 RNG（PCG 系の状態付きハッシュ）** の4点セット。制約: atomic は整数のみ（`atomic<f32>` は無い）・storage texture に atomic は撃てないので蓄積先は必ず buffer・軌道の序盤はアトラクタ未収束なので burn-in で捨てる。

- [ ] fern（Barnsley Fern）— 4つのアフィン写像から確率で選んで反復する chaos game。scatter 入門に最適、ここで新概念4点セットを導入
- [ ] attractors（de Jong map）— `(x,y) ← (sin(a·y)−cos(b·x), sin(c·x)−cos(d·y))` を数百万回。骨格は fern のまま写像差し替え、パラメータで表情が激変
- [ ] buddhabrot — Mandelbrot の脱出軌道の通過密度。反復コードは mandelbrot 回のものがそのまま再利用できる。「密度は点 x での閉じた式を持たない」= per-pixel 化が本質的に不可能な scatter の代表例。同じ数式を gather で見たのが mandelbrot、scatter で見たのがこれ

※ 蛇足: IFS の「形（集合）だけ」なら逆写像の反復で per-pixel 判定に落とせる場合がある（Sierpiński は `p=fract(p*2)` の反復、mod 2 のビット判定はその極限形）。密度を描くなら scatter 一択

### 書籍「幾何学パターンづくりのすべて」（jz examples のあとで）

- [ ] 「幾何学パターンづくりのすべて — ファッション、建築、デザインのためのリピートパターン制作ガイド」— 座標変換の柱の体系化として読む。3章「平面対称」の17節はおそらく**壁紙群が17種類**あることに対応（平面充填リピートの対称性は並進・回転・鏡映・映進の組合せで厳密に17通り）。シェーダー的には各対称群 = 平面を基本領域に折りたたむ純関数で、**17個の壁紙群 = 17個の座標変換コンビネータ** — シェーダー生成言語の長期目標的にも群論がそのままコンポジションの API になる構造。既習との対応: 並進=`fract` / 鏡映=`abs`・三角波折り返し / 回転対称=極座標の角度 `mod` 扇形折りたたみ / 映進=並進∘鏡映（未実装の道具）。デザイナー向けでコードは無いので、Unity デッキと同じく「この対称操作は WGSL でどう書くか」を都度このリポジトリで再実装しながら読む。5章シームレス/エッシャー型リピートは truchet・タイリングの記憶があるうちだと効果的

### Paper Shaders を WGSL に移植する（実戦編）

[paper-design/shaders](https://github.com/paper-design/shaders)（ローカル: `~/ghq/github.com/paper-design/shaders`）— Paper が実際に出荷している production 品質の単一パス GLSL (ES 300) フラグメントシェーダー集（全29本、`packages/shaders/src/shaders/`）。既習の道具（ノイズ・距離場・パターン・domain warp）が製品コードでどう磨かれるか（`fwidth` によるAA・uniform 設計・アルファ合成）を読みながら GLSL→WGSL の方言変換を練習する。**既習トピックの焼き直し（waves・dot-grid・perlin/simplex-noise・voronoi・metaballs）とテクスチャ入力系は除外**。ただし grain-gradient / warp の `u_noiseTexture` は value noise の格子点乱数をテクスチャ参照に置き換えた高速化にすぎないので、既習の `fract(sin(dot))` ハッシュで代替すれば全部 `色 = 純関数(uv, time)` のまま今の道具だけで移植できる:

- [ ] spiral / swirl — 極座標の渦2種。スパイラルの線と、ねじれる色帯
- [ ] neuro-noise — 網目状に光る流線。ノイズの応用
- [ ] static-radial-gradient / static-mesh-gradient — 最大10色のグラデーション合成（放射・メッシュ）
- [ ] color-panels — 擬似3D の半透明パネル回転
- [ ] dithering — ノイズ・波・渦など7種のパターン源を2色ディザに落とす。順序ディザ (Bayer 行列) が新道具
- [ ] grain-gradient — 最大7色 + 粒子ノイズのグラデーション。wave/dots/truchet/ripple/blob/sphere の7形態、粒は `gl_FragCoord` 基準
- [ ] warp — checks/stripes/edge の下地を noise + 多段 swirl で歪ませる流体・大理石。BoS 13 domain warp の実戦版（かっこいいので焼き直しでも残し）
- [ ] mesh-gradient — 色スポットが軌道を流れる看板シェーダー（README の顔）