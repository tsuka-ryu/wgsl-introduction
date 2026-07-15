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

> **📖 ここで色空間を読む** — [John Novak「What every coder should know about gamma」](https://blog.johnnovak.net/2016/09/21/what-every-coder-should-know-about-gamma/)。`mix` の混色・グラデ・アルファ合成は**線形空間**でしか物理的に正しくない（本当は BoS 06 の色の時点で効く話）。この先の 3D 法線ライティングは光の足し算＝線形空間必須なので、遅くともここで回収する。「色は"どの空間の値か"という型を持つ」= シェーダー生成言語の型設計に直結

### 頂点シェーダーで 3D メッシュを変形する

ここまでは `色 = f(uv, time)` のフラグメント一本勝負で、頂点シェーダーは画面いっぱいの三角形を出すだけの**置物**だった。この節で初めて頂点シェーダーが主役になる — `位置 = g(頂点, time)` でメッシュを変形し、その変位量を **Varying（`@location` 補間）でフラグメントに渡して色に使う**。2D フルスクリーンでは使わなかった「頂点→ラスタライザの自動補間→フラグメント」の流れを体で覚えるのが目的。FP 的には、変形は座標への関数適用 `p ↦ g(p)`、法線はその**導関数**（`g` の微分から接ベクトル→外積）という対応で読む。教材は [Maxime Heckel「The Study of Shaders with React Three Fiber」](https://blog.maximeheckel.com/posts/the-study-of-shaders-with-react-three-fiber/)（波・Varying・グラデはここでほぼ揃う。R3F+GLSL だが概念はそのまま WGSL に読み替え）。法線とツイストは記事外なので別ソースを併記。

- [x] 波打つ板 + 高さでグラデ（Varying）— 頂点の y を `sin`/ノイズで動かし、変位量を `@location` でフラグメントへ補間して色に。頂点シェーダーが主役になる感覚と Varying をここで掴む。ガウス `exp(-x²)` を波の formula に差し替えれば凸凹の重み付けも同じ枠で扱える（→ Maxime Heckel 記事）
- [x] ノイズ変位（その場でうねうね）— `Σ sin` を **3D simplex noise の fBm** に差し替え。`snoise3(x, z, t)` と**3つ目の軸に時間**を入れると模様が流れずその場で morph（→ [Varun Vachhar「Noise in Creative Coding」](https://varun.ca/noise/)）。BoS 11 の 2D simplex を 3D 拡張
- [x] Blob（法線方向へノイズ変位する球）— UV 球（`(φ,θ)→3D` のパラメトリック曲面、normal は原点中心なら `normalize(pos)` でタダ）の各頂点を**法線方向へ** `cnoise(p + 2t)` 分だけ押し出す `newPos = p + normal·intensity·disp`。任意形状に効く変位の一般形。**同じノイズ値を Varying で fs にも渡し形と色を1値で駆動**。Maxime Heckel の Blob を WGSL 移植（cnoise = Classic Perlin 3D = BoS 11 の2D勾配ノイズの立体版）。hover で intensity が上がり膨らむ
- [x] Layered Planet（Lamina 風レイヤー合成）— Maxime Heckel の Lamina 版 Planet を WGSL 移植。**4レイヤーを1つの fs で手合成**: ①雲（fbm ドメインワープ = BoS 13 の 2D 版）②Depth グラデ add ③Lambert 照明 `dot(法線,光)` ④Fresnel 縁光 add。`マテリアル = レイヤーの畳み込み` = Lamina/シェーダー生成言語の縮図。法線・視線を Varying で fs へ
- [x] 法線の再計算 — 変形すると元の法線がズレてライティングが破綻する。高さ場は `N = normalize(-∂f/∂x, 1, -∂f/∂z)`。**解析的**（変形関数を微分＝sin→cos、正確・安いが式が要る＝FP 向き）と**数値的**（隣接点を微小サンプリングして接ベクトル2本の外積、何でも効くが f を3回・ε 近似）の2通りを実装し `USE_ANALYTIC` で切替（結果は同じ）。Lambert 照明で波が立体的に。参考 [Ronja Wobble Displacement](https://www.ronja-tutorials.com/post/015-wobble-displacement/) / [Cyanilux](https://www.cyanilux.com/tutorials/vertex-displacement/)
- [x] ツイスト — 高さ `y` に応じて `(x,z)` を回転させる領域変形 `p ↦ rot(a(y))·p`（下は0°・上ほど大きく回る）。[Inigo Quilez の domain deformation](https://iquilezles.org/articles/)（「変形 = 座標への関数適用」の視点が一番クリア）。四角柱がらせんに捻れる（まっすぐな稜線が螺旋に）。回転は BoS 08 の 2x2 回転行列、法線も同じ角度で回して陰影
- [x] 🌴 **卒業制作: Vaporwave シーン** — [Maxime Heckel「Vaporwave 3D scene with Three.js」](https://blog.maximeheckel.com/posts/vaporwave-3d-scene-with-threejs/) を WGSL で再構成。ノイズ変位の地形（中央=道/両脇=山・カメラへ流れる）＋数値的法線(05)で陰影＋ネオングリッド線（`fwidth` で AA）＋フォグ＋夕日背景、仕上げに **RGBShift ポストプロセス**。§4 の変位に AA・色ずらし・ライティングを合流させた総仕上げ。**2パス（オフスクリーンに描く→サンプリングして色ずらし）と `textureSample` が初登場**（唯一の新capability）。原典は Three の `displacementMap` 任せなので WGSL 版はむしろ本物の頂点変位に格上げ

### レイマーチングで 3D を描く（wgld.org GLSL 全20回）

[wgld.org の GLSL 連載](https://wgld.org/d/glsl/)（作者 @h_doxas、全20回・日本語）。**頂点データを使わずフラグメント一本で3Dする**別トラック＝今までのフルスクリーン路線の正統進化で、頂点シェーダーは置物のまま。上の頂点シェーダー節が「本物のジオメトリを頂点で射影する3D」なのに対し、こっちは **「シーン = 距離関数 `vec3 → float`（SDF）」を数式で書いて3Dを錯覚させる**。BoS/Unity デッキで自分がメモした「※3D レイマーチングでは距離場(SDF)が本質に昇格」の昇格先そのもの。FP 的に一番おいしい路線で、**法線 = 距離場の勾配 `∇f`（近傍サンプリングの数値微分）**・**変形 = レイ座標への関数適用**という対応で、既習の道具が3Dへ持ち上がる。GLSL だが WGSL へは読み替え可能。

**第0回・まず全体像を掴む（写経の前に地図を見る）**

- [x] [シェーダだけで世界を創る！three.js によるレイマーチング（gam0022）](https://www.slideshare.net/slideshow/threejs-58238484/58238484) — wgld.org と同じ内容を1本のスライドで俯瞰。ラスタライズ vs レイトレ → SDF → CSG合成 → 無限複製 → 陰影の流れを先に一望してから、下の全20回で写経する。読書メモ: [`src/raymarching/notes.md`](src/raymarching/notes.md)

**舞台づくり（フルスクリーン路線の復習・新道具ゼロ）**

- [x] 01 GLSL だけでレンダリングする ([`src/raymarching/01-gl-rendering`](src/raymarching/01-gl-rendering/main.ts)) / ~~02 時間とマウス座標 / 03 オーブのレンダリング / 04 様々な図形を描く~~ — ここまでは今までの `色 = f(uv, time)` の復習。**02〜04 は BoS で既習のためスキップ**(器は 01 で用意済み、time/mouse は必要になった回で足す)

**フラクタル・ノイズ（既習トピックの GLSL 版）**

- [x] 05 マンデルブロ集合 ([`src/raymarching/05-mandelbrot`](src/raymarching/05-mandelbrot/main.ts)) / 06 ジュリア集合 ([`src/raymarching/06-julia`](src/raymarching/06-julia/main.ts)) / 07 フラグメントシェーダ ノイズ — フラクタルとノイズを GLSL で。エスケープ時間 `zₙ₊₁=zₙ²+c` の複素数フラクタルはここが初出（この反復は後の compute 編 buddhabrot で scatter 視点として再利用）、ノイズは BoS 11章の復習

**レイマーチング本体（ここから3D・新概念）**

- [x] 08 シェーダ内でレイを定義する ([`src/raymarching/08-ray-definition`](src/raymarching/08-ray-definition/main.ts)) — 各ピクセルからレイを飛ばす。3Dの入り口。カメラ基底(cDir/cUp/cSide=外積)で `ray = normalize(cSide·p.x + cUp·p.y + cDir·targetDepth)`、rd を色で可視化
- [x] 09 レイマーチングで球体を描く ([`src/raymarching/09-sphere`](src/raymarching/09-sphere/main.ts)) — SDF `length(p)−r` に沿ってレイを進める中核アルゴリズム。3D の初出(ro/rd + fold + 距離関数が合流、黒背景に白い球)
- [x] 10 法線の算出と簡単なライティング ([`src/raymarching/10-normal-lighting`](src/raymarching/10-normal-lighting/main.ts)) — **法線 = 距離場の勾配 `∇f`** を近傍サンプリングの数値微分で。頂点シェーダー節の「法線＝変形関数の導関数」と発想が同じ（対象が頂点→距離場）。09 の白い円が Lambert 陰影で立体的な球に
- [x] 11 視野角を考慮したレイの定義 ([`src/raymarching/11-fov`](src/raymarching/11-fov/main.ts)) — カメラの FOV。08 の `targetDepth` を画角 `angle=60°` で明示、`ray = normalize(vec3(sin(fov)·p.xy, −cos(fov)))`

**距離場の合成・変形（BoS の距離場・パターン・行列が3Dへ昇格）**

- [x] 12 オブジェクトの複製 repetition ([`src/raymarching/12-repetition`](src/raymarching/12-repetition/main.ts)) — `fract`/`mod` で空間を折って無限複製。BoS 9章パターンの3D版。`trans(p)=mod(p,4)−2` を距離関数の前に。※WGSL の `%` は負で GLSL `mod` と違うので `p−n·floor(p/n)` で明示
- [ ] 13 箱型のボックスモデル / 14 異なる形状 — 各種プリミティブ SDF
- [ ] 15 重なりを考慮した描画（`min` 合成）/ 16 補間して結合（smooth min）— BoS 12章の距離場 `min`/`max` 合成が3Dに
- [ ] 17 行列で回転 / 18 行列で捻じる（ツイスト）— レイ座標への領域変形。BoS 8章の `mat` と上の頂点シェーダー節ツイストの距離場版
- [ ] 19 テクスチャなどを投影する — SDF 表面への投影
- [ ] 20 レイマーチングソフトシャドウ — 卒業制作

> **📖 ここで AA / 微分を読む** — [FrostKiwi「Analytical Anti-Aliasing」](https://blog.frost.kiwi/analytical-anti-aliasing/)。§4 の解析微分（頂点の法線）・§5 の ∇f（距離場の法線）を通った今、**微分の三つ目の顔＝画面の `dFdx`/`fwidth`** が一撃で繋がる。`smoothstep` + `fwidth` で SDF の輪郭を 1px 幅だけボカすと、これまで描いた形・パターン・3D が一掃でプロ品質に（先に読むと三つ目だけ浮くので、ここがベスト）

### Compute shader 入門（scatter で描く）

fragment shader はここまで一貫して「各ピクセルが自分の色を計算しにいく」**gather 型** `色 = f(uv)` だった。この節で初めて逆向きの **scatter 型**を扱う — 「**点がピクセルへ書き込む**」。chaos game な IFS・アトラクタ・buddhabrot は各ピクセルの閉じた式を持たず、点を大量に飛ばして到達先を数え上げるしかないので、fragment 単体では原理的に書けず **compute shader** が要る。FP 的には gather = 関数の引き戻し (pullback)・scatter = 測度の押し出し (pushforward) の双対。WGSL では storage buffer 上の `atomic<u32>` に `atomicAdd` でヒストグラムを蓄積し（u32 加算が可換モノイドなので書き込み順が不定でも結果は同じ）、fragment パスで log トーンマップして表示。新概念は **compute pipeline / storage buffer / atomics / 自作 RNG（PCG 系の状態付きハッシュ）** の4点セット。制約: atomic は整数のみ（`atomic<f32>` は無い）・storage texture に atomic は撃てないので蓄積先は必ず buffer・軌道の序盤はアトラクタ未収束なので burn-in で捨てる。題材は [dy/jz の examples](https://github.com/dy/jz/tree/main/examples) から。

- [ ] fern（Barnsley Fern）— 4つのアフィン写像から確率で選んで反復する chaos game。scatter 入門に最適、ここで新概念4点セットを導入
- [ ] attractors（de Jong map）— `(x,y) ← (sin(a·y)−cos(b·x), sin(c·x)−cos(d·y))` を数百万回。骨格は fern のまま写像差し替え、パラメータで表情が激変
- [ ] buddhabrot — Mandelbrot の脱出軌道の通過密度。エスケープ反復 `zₙ₊₁=zₙ²+c` はレイマーチ 05 のマンデルブロと同じ式（今度は脱出**する**軌道の通過点を数える）。「密度は点 x での閉じた式を持たない」= per-pixel 化が本質的に不可能な scatter の代表例。同じ数式を gather で見たのがマンデルブロ、scatter で見たのがこれ

※ 蛇足: IFS の「形（集合）だけ」なら逆写像の反復で per-pixel 判定に落とせる場合がある（Sierpiński は `p=fract(p*2)` の反復、mod 2 の `(x & y)==0` ビット判定はその極限形）。密度を描くなら scatter 一択
**状態を持つシェーダー（ping-pong・時間方向に畳む）**

fragment も scatter も1フレーム完結だった。前フレームを入力に次を作る `状態(t+1) = step(状態(t))` は fragment 単体では書けず（2枚のテクスチャを交互に読み書き＝ping-pong）、FP 的には **unfold / 余代数（coalgebra）** そのもの。

- [ ] reaction-diffusion（Gray-Scott）— [Karl Sims「Reaction-Diffusion Tutorial」](https://karlsims.com/rd.html) が決定版。ラプラシアン畳み込み + 反応項でチューリング模様のうねうね、`DA/DB/f/k` の4値で表情が激変。うねうね美学のど真ん中
- [ ] Game of Life — 同じ ping-pong 骨格の離散版（近傍8マスの生死ルール）。状態機械の最小例

### 順序ディザ（Paper Shaders から1本だけ）

[paper-design/shaders](https://github.com/paper-design/shaders)（ローカル: `~/ghq/github.com/paper-design/shaders`）の production シェーダー集（全29本）は大半が既習の道具の応用なので、**唯一の新道具である順序ディザだけ**を取る。

- [ ] dithering — ノイズ・波・渦など複数のパターン源を2色に落とす。**順序ディザ（Bayer 行列）**が新道具：ピクセル座標で引く閾値マトリクスと画素値を比較し、少ない色数で階調を錯覚させる。`色 = f(uv)` の枠のまま、閾値が座標の周期関数になるだけ（テクスチャ入力は `fract(sin(dot))` ハッシュで代替すれば今の道具だけで書ける）

### 書籍「幾何学パターンづくりのすべて」（総仕上げ・座標変換の体系化）

- [ ] 「幾何学パターンづくりのすべて — ファッション、建築、デザインのためのリピートパターン制作ガイド」— 座標変換の柱の体系化として読む。3章「平面対称」の17節はおそらく**壁紙群が17種類**あることに対応（平面充填リピートの対称性は並進・回転・鏡映・映進の組合せで厳密に17通り）。シェーダー的には各対称群 = 平面を基本領域に折りたたむ純関数で、**17個の壁紙群 = 17個の座標変換コンビネータ** — シェーダー生成言語の長期目標的にも群論がそのままコンポジションの API になる構造。既習との対応: 並進=`fract` / 鏡映=`abs`・三角波折り返し / 回転対称=極座標の角度 `mod` 扇形折りたたみ / 映進=並進∘鏡映（未実装の道具）。デザイナー向けでコードは無いので、Unity デッキと同じく「この対称操作は WGSL でどう書くか」を都度このリポジトリで再実装しながら読む。5章シームレス/エッシャー型リピートは truchet・タイリングの記憶があるうちだと効果的