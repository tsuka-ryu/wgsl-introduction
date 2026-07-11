# The Study of Shaders with React Three Fiber 読書メモ

資料: https://blog.maximeheckel.com/posts/the-study-of-shaders-with-react-three-fiber/
実装: [01-wave-varying/main.ts](./01-wave-varying/main.ts) — この記事の内容をバニラ WebGPU + WGSL に読み替えて自作したもの

原典は **R3F + GLSL**。読みながら「GLSL(記事) → WGSL(自分の実装) の対応」と、疑問 → 回答を下に追記していくナレッジベース。

## 全体像 (頂点シェーダーが主役になる)

README §4 の狙い。2D の `色 = f(uv)` から、頂点シェーダーが仕事をする世界へ:

- **頂点段** `位置 = g(頂点, t)` … メッシュの各頂点を変形する純関数
- (ラスタライザ … 三角形を塗り、頂点の値を内部へ**補間**して配る)
- **画素段** `色 = h(補間された値)` … 届いた varying を色に翻訳

$$頂点(x,z) \xrightarrow{\text{vs: 変位 + 射影}} (\text{clip},\ \text{varying}) \xrightarrow{\text{補間}} 画素 \xrightarrow{\text{fs}} 色$$

- 変位 = 座標への関数適用 `p ↦ g(p)`。法線はその微分、ツイストは領域変形 (§4 の次の回) [[user-fp-pl-background]]
- **Varying = 頂点で計算 → 面へ補間して配る**。2D フルスクリーンでは恩恵ゼロだった `@location` の本領がここで出る
- 2D との一番の違い: 頂点シェーダーが「置物」から「主役」へ

## GLSL(R3F) ↔ WGSL 対応

記事は Three.js の `shaderMaterial` + GLSL。自分の実装は生 WGSL。Three が"勝手に"くれるものを、WGSL では全部自分で配線する (= 3D の本質が見える)。

| 概念 | GLSL / R3F (記事) | WGSL (自分の実装) |
|---|---|---|
| 頂点入力(位置) | `attribute vec3 position` (Three が自動供給) | 頂点バッファ + `@location(0)` |
| 出力クリップ座標 | `gl_Position` | `@builtin(position)` |
| Varying | `varying float vX;` を vs/fs 両方に宣言 | `struct VSOut { @location(0) x: f32 }` 1 箇所 |
| uniform | `uniform float uTime;` | `struct Uniforms{...}` + `@group(0) @binding(0)` |
| MVP 行列 | `projectionMatrix * modelViewMatrix` (Three が供給) | 自前で `perspective · lookAt` を計算 |
| UV 座標 | `vUv` (`attribute uv` 由来) | 今回は height を自前で varying |
| 時間 | `useFrame` で uniform 更新 | `requestAnimationFrame` で `writeBuffer` |
| 組み込み関数 | `mix / fract / clamp / sin …` | 同じ (`mix / fract / clamp / sin …`) |
| ベクトル型 | `vec2/vec3/vec4` | `vec2f/vec3f/vec4f` |

<!-- 読みながら行を足す -->

## 3D の座標変換 (MVP) — Three が隠してる部分を WGSL で手書き

記事(Three)は `projectionMatrix`/`viewMatrix`/`modelMatrix` を勝手にくれるので触らずに済む。自分の実装はここを全部書いたので、3D の本質＝**「3D の点を画面のどこに映すか」= 点を段階変換する旅**が見える。

**旅の全体像**（写真を撮るのと同じ3段）:

| 段 | 行列 | やること | 例え |
|---|---|---|---|
| Model | `modelMatrix` | 物体を世界のどこに置くか | 板を床に置く（今回は原点＝**単位行列で省略**）|
| View | `lookAt` | カメラの位置と向きへ世界を測り直す | カメラを構える |
| Projection | `perspective` | 遠近をつけて画面の箱へ潰す | シャッターを切る |

- 頂点シェーダーの [main.ts `out.clip = u.mvp * vec4f(x,y,z,1.0)`] 1行が、この旅ぜんぶ。
- `u.mvp` は CPU (render) で毎フレーム1回だけ組んで uniform で送る。**全頂点で共通の切符**、各頂点はそれを掛けるだけ（重い計算1回・軽い適用を14641回）。
- 順番は **変位 → 射影**。`waveHeight()` で y を持ち上げてから mvp を掛ける。逆にすると画面座標を直接ずらす別物になる。

### projection = 遠近をつくる（proj の一番の仕事）

- 遠近の正体 = **x, y を奥行きで割る**（遠いほど中心寄り・小さく）。近い点は割る数(w)が小さい→大きく広がる。
- でも**行列は割り算ができない**。so: 奥行き `-z` を **w 成分に仕込んでおく**（行列の `-1` の所）→ 掛けた後 **GPU が自動で `x/w, y/w`** する (= perspective divide)。
- **頂点を `vec4f(x,y,z,1.0)` と 4 成分で渡すのはこの w の置き場のため**。3 成分だと割り算用の枠が無い。
- `w = -z` なので **fov や far をどう変えても w は変わらない**。fov は x,y のズーム、far は深度の範囲を触るだけで、w には無関係。w を動かしたいならカメラ(eye)か点の奥行きを変える。

### view = カメラ（lookAt）／ multiply = 合成

- `lookAt(eye, center, up)`: **eye**=カメラの居場所 / **center**=見てる先 / **up**=上向き(基本 `[0,1,0]` 固定)。**カメラを動かす＝ここの引数を変える**。
- `multiply(proj, view)` = 2 変換を1本に畳む（BoS 08 の `R*S` 合成の4×4版）。結合法則 `proj·(view·p) = (proj·view)·p` で、先に合成しておける＝頂点ごとの掛け算が1回で済む。
- **順番は右から左**: `proj · view · p` は「p にまず view、次に proj」。逆順にすると壊れる（非可換 = BoS 08）。

### 座標空間は「範囲と向きの約束」を確認するだけ

新しい空間が出たら範囲/向きの約束だけ見る。2D で踏んだ話の再来:

| 空間 | 範囲 | 場面 |
|---|---|---|
| ピクセル | `[0,w]×[0,h]` | `fragCoord` |
| UV / st | `[0,1]` | `fragCoord/resolution` |
| 中心そろえ | `[-0.5,0.5]` | `st - 0.5` |
| クリップ(NDC) xy | `[-1,1]` | 大三角形の頂点 |
| 深度 z | WebGPU `[0,1]` / OpenGL `[-1,1]` | ← ネットの perspective コピペ事故ポイント |

- 2D の `st*2-1`（`[0,1]→[-1,1]`）や `st-0.5`（中心へ）は「約束の違う空間の乗り換え」そのもの。proj が深度を `[0,1]` に写すのも同じ。
- もう1つの定番食い違い: **y の向き**（テクスチャUVは上が0・クリップは上が+1で上下逆）。
- この手書きヘルパは「列優先・深度 [0,1]」の流儀。別流儀をコピペすると崩れる。

### コントロールパネル早見表（道具として使う）

`perspective`/`lookAt`/`multiply` は定番のおまじない（普通は gl-matrix 等を import）。中身は導出しなくてよく、**どの引数を回すか**だけ:

- **カメラを動かす** → `lookAt` の `eye`（居場所）/ `center`（狙い）
- **レンズを変える** → `perspective` の `fovy`（ズーム）/ `near,far`（見える奥行き）
- **`multiply`** → 触らない（合成するだけ）
- 例: カメラ円周回転 `lookAt([sin(t)*r, 1.4, cos(t)*r], [0,0,0], [0,1,0])`

## 頂点データの流れ (バケツリレー) と `grid`

JS の点配列 → シェーダーの引数まで、4段のリレーで届く:

```
① positions: Float32Array          … 14641点の (x,z) をループ生成
   │  writeBuffer(vertexBuffer, 0, positions)
② vertexBuffer (GPU 上のメモリ)     … ①をGPUへコピー
   │  pipeline の vertex.buffers で「読み方」を宣言
   │    arrayStride: 8 (=f32×2) / format:"float32x2" / shaderLocation: 0
③ pass.setVertexBuffer(0, vertexBuffer) … 描画でこれを使うと指定
   │  drawIndexed で GPU が1頂点ずつ取り出す
④ @vertex fn vs(@location(0) grid: vec2f) … 各頂点の (x,z) が grid に届く
```

- **`shaderLocation: 0` ⇄ `@location(0)`** の番号が①〜④を繋ぐ。ここが一致しないと届かない。
- Three の `attribute vec3 position` に当たるのが、この「vertexBuffer + `@location(0)`」。

### `grid` = 今処理してる1頂点の板上の位置 (x, z)

- vs は **14641回**呼ばれ、毎回その頂点自身の値が `grid` に入る（共通の関数・違う材料 = uniform と同じ構図の逆側）。
- **`grid.x` / `grid.y` の注意**: vec2 の成分名は必ず `.x`/`.y`。詰めたのは板の (x, z) なので **`grid.y` の中身は板の z**（`let z = grid.y`）。
- なぜ y を渡さない? → 板は xz 平面に寝かせ、**高さ y はシェーダーで `waveHeight` から作る**から。頂点データは x, z だけ。

### 点の数 = (N+1)²

- `N=120` は1辺の**分割数**。点は **N+1=121**（杭とフェンス: 3分割は線4本）。`121×121 = 14641`。
- N を上げるほど波が滑らか、頂点数は2乗で増えて重い。`N=8` にするとカクカクの低ポリになり「頂点で持ち上げてる」のが目で見える。

## メッシュ = 2D→3D の関数 (パラメトリック曲面) 〔03 blob の気づき〕

格子 `(i, j)`（= uv）は**2次元**。それを 3D の点へ写す関数が、メッシュの形を決める:

- **曲面 = `(u, v) ↦ 点(x,y,z)`** を格子でサンプリングしただけ [[user-fp-pl-background]]
- **01 の平面**: `(i,j) → (x, 0, z)`（平べったい写像）
- **03 の球**: `(i,j) → (φ,θ) → R·(sinφ·cosθ, cosφ, sinφ·sinθ)`（緯度 φ・経度 θ で球面へ）
- **関数を差し替えれば形が変わる**（トーラス等）。平面も球も「2Dパラメータ→3D点」の関数が違うだけ
- 頂点の `uv = (j/SLICES, i/STACKS)` は**この 2D パラメータそのもの**（UV マッピングの U,V）。模様/テクスチャはこれで貼る
- ★球の **normal は原点中心なら `normalize(position)` = 単位ベクトルそのまま**でタダで手に入る（`(nx,ny,nz)`）

## 法線方向へ変位 (03 blob)

01 は固定方向 (y=真上) へ、03 は**各点の normal (外向き) 方向**へ動かす。点ごとに量を変えるとボコボコの blob（全点同じ量ならただの大きい球）。

**形**: `newPos = position + normal * amount`
- `normal * amount` = 長さ1の外向き矢印を amount 倍 = 外向きに長さ amount のベクトル。それを元の位置に足す = 外へスライド
- amount>0 で膨らみ、<0 でへこむ。例: `(1.4,0,0) + (1,0,0)*0.3 = (1.7,0,0)`

**量 `amount = intensity × displacement`**:
- `displacement = cnoise(position + 2*time)` … 点ごとのノイズ (−1〜1) = **凹凸の模様**（どこが出っ張るか）。`+2*time` で場が動く=うねる。cnoise 内部はおまじない
- `intensity` … **全体の強さツマミ**。hover で 0.15↔0.6 を lerp（毎フレーム目標へ寄せてなめらか）、uniform へ書いて `u.intensity` に。※簡易実装でキャンバス全体の hover（本来は blob へのレイキャスト）
- 模様(点ごと) × 強さ(共通) = amount。hover で強さが上がると模様のまま全体が膨らむ

**normal のリレー**: JS で `(nx,ny,nz)` を1回計算 → `position=R×それ` / `normal=それ` を頂点データへ → `@location(1)` で vs へ → 変位に使う。position∥normal は原点中心の球だから成立（球を歪めたら normal の再計算が要る → §4「法線の再計算」への伏線）。

## cnoise と blob の色 (03)

**cnoise = Classic Perlin noise の3D版**（BoS 11 の 2D 勾配ノイズ [11-gradient-noise] の立体版）。ノイズ3兄弟: value(値を置く) / gradient=Perlin(勾配=向きを置く) / simplex(勾配だが三角格子)。cnoise は真ん中=**勾配ノイズ**。

- やること4手（各行はおまじないでOK）: ①P を囲む**立方体の8隅**を特定 (`floor(P)`, `+1`) ②各隅に擬似ランダムな**勾配(向き)** を `permute` ハッシュで割当 ③各隅で `dot(勾配, 隅→P のずれ)` = 8値（**格子点で必ず0**）④`fade(t)=6t⁵−15t⁴+10t³` で立方体補間 → だいたい −1〜1
- value との差: 値でなく**向き**を置く → 格子点0・方眼が消え有機的。simplex(02) との差: **立方体(8隅) vs 四面体(4頂点)**、格子の形だけ
- 2D(4隅)→3D(8隅) に増えただけで理屈は同じ。作者は Ken Perlin（映画トロン用に発明・アカデミー技術賞）

**blob の色 = 形と同じノイズ値を Varying で fs にも渡す**:
- vs で `displacement`(生ノイズ −1〜1) を ①形 `normal*intensity*disp` に使い、②**同じ値**を `@location(1) vDisplacement` で fs へ。**1つの値が形と色を同時駆動**（出っ張り＝色も変化）
- fs: `distort = 2*vDisplacement*intensity` → `color = abs(vUv-0.5)*2 * (1-distort)`。uv 由来のグラデを変位量で変調
- ★Varying で渡すのは intensity **前の生ノイズ**なので fs で intensity を掛け直す＝色も hover に連動（形と一緒に呼吸）。※vs で先に掛けて渡せば fs 不要＝**設計次第**（原典は「生を渡して各所で掛ける」流儀）

## Varying (頂点→fs) の仕組みと増やし方

vs の出力 `VSOut` は2種類を詰める箱。**詰めた2つは行き先が違う**:

| 出力 | 印 | 行き先 |
|---|---|---|
| clip | `@builtin(position)` | ラスタライザ (画面のどこに置くか)。**fs には直接来ない** |
| height 等 | `@location(N)` | 補間器 → fs (三角形内を補間して届く) = **Varying** |

**増やし方**: `VSOut` にフィールドを足すだけ。
- `@location` 番号は varying ごとに**ユニーク** (0,1,2…)。名前は自由（中身と合わせる）。**配線してるのは名前でなく番号**。
- vs で `out.○○ = 計算`、fs で `in.○○` で受け取る。型は自由 (`f32/vec2f/vec3f…`)、全部補間される。上限は ~16 ロケーション程度。

### 補間の正体（今日いちばんの腑落ち）

- 三角形の3頂点が持つ値を、ピクセルの位置に応じてブレンド = **3点版の `mix`**（重心座標が重み）。BoS の `mix(a,b,t)` の三角形版。
- **疎(頂点)→密(ピクセル)の復元**: `waveHeight` を計算したのは頂点3つだけ。三角形が覆う数千ピクセルには、補間器が中間値を**タダで配る**。だから頂点しか計算してないのに面が滑らか。
- `out.worldXZ = vec2f(x,z)` を渡すと、fs の `in.worldXZ` = **そのピクセル真下の板の位置そのもの**。頂点は格子点にしか無いのに、ピクセル位置ぴったりの値が手に入る（→ グリッド線・フォグに使える）。

### 一般形

**頂点で疎に計算 → ラスタライザが補間 → 各ピクセルが「自分の位置での値」を受け取る**。
何でも渡せる: UV座標 / ワールド位置 / **法線 (§4 次回、ライティング用に `@location(1) normal: vec3f`)**。`out.○○` で載せ `in.○○` で受け取るのが頂点シェーダーの基本パターン。

## セクション別メモ (記事の流れ)

### 1. Shader とは / vertex・fragment の役割

<!-- 読みながら追記 -->

### 2. Vertex shader — wobbling plane (頂点変位)

<!-- 読みながら追記。自分の実装との対応: waveHeight() が記事の displacement に当たる -->

### 3. Fragment shader — gradient / color mixing

<!-- 読みながら追記 -->

### 4. Uniforms と Varyings (動的なエフェクト)

<!-- 読みながら追記 -->

### 5. Noise (Perlin / Simplex) と応用 (blob hover 等)

<!-- 読みながら追記。ノイズ本体は BoS 11 章で既習 -->

## Q&A

<!-- 疑問が出たらここに 質問 → 回答 で積む -->

## 次回 (明日) やること

- [ ] **03-blob を理解する**（法線方向へのノイズ変位）。新しいのは数点だけ: 球の生成 / `y`でなく**法線方向**へ押し出す / 頂点属性3つ+Varying2つ / hover。cnoise はおまじないでOK。※01・02 の骨格(MVP→変位→Varying)はそのまま
- [ ] 記事の **Lamina** の節を読む（composable shader layers = マテリアルをレイヤーで合成するライブラリ。Three の shaderMaterial の一歩上の抽象）

（今日ここまで: 01 完全理解。02=波を3Dノイズに差し替え / 03=球を法線変位、はコード実装済みで**理解はこれから**）
