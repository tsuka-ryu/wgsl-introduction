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
