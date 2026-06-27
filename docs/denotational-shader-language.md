# 構想メモ: 意味論でシェーダを書く言語（denotational shader language）

> このリポジトリで WGSL/GLSL を学ぶ過程で出てきた、長期的にやりたいことのメモ。
> Book of Shaders を進めながら「各作例の意味領域は何か？」を貯めていくためのノート。

## ゴール

WGSL/GLSL を十分理解したうえで、**シェーダコードを生成する自前のプログラミング言語**を実装したい。

- 動機: WGSL/GLSL は C ライクな手続き的記述。そうではなく **Haskell のように「意味（denotation）で書きたい」**。
  「どう描くか（手順）」ではなく「**これは何であるか**（意味）」を書き、そこから GPU コードを生成する。

## なぜシェーダは denotational と相性がいいのか

フラグメントシェーダの意味は 1 行で書ける:

```
画像 = λ(座標) → 色        -- Image = Point -> Color
```

- 各ピクセルは独立・純粋（`color = f(coord)`、副作用なし・参照透過）。
- 「for ループでピクセルを走査」などの手順は書かない。すでに宣言的＝意味的。
- だから `mix` のレイヤー合成を **fold（自己関数モノイドの畳み込み）** として読める。
  → 詳細は [07-mondrian/main.ts](../src/book-of-shaders/07-mondrian/main.ts) の `color = mix(color, ...)` の連鎖。

## 設計の核 = 意味領域（semantic domain）を決めること

denotational design の本体は「対象を表す数学的な意味領域を決め、構文をそこへの写像として定義する」こと。
シェーダで使えそうな意味領域の候補:

| 概念 | 意味領域 | Book of Shaders での出どころ |
|---|---|---|
| 画像 | `Image = Point -> Color` | 07 全般 |
| 形 / マスク | `Mask = Point -> {0,1}`（または `[0,1]`） | step / smoothstep の四角・円 |
| 距離フィールド | `SDF = Point -> Distance` | 07 円（`length`/`distance`） |
| アニメーション | `Behavior a = Time -> a` | `u_time` を使う作例 |
| 合成 | レイヤーのモノイド（`mix` / over 合成） | 07-mondrian |
| パターン | 座標変換の合成（タイル化など） | 09 パターン（予定） |

## 距離フィールド / SDF（07 章で腹落ちした中核の意味領域）

距離フィールドとは「各点に**最寄りの形までの距離**を入れた場（= 標高の地図）」。
SDF (Signed Distance Field/Function) はそれに**符号**を付けたもの:

```
SDF = Point -> Distance     -- 外=正(+) / 縁=0 / 中=負(-)
```

ポイントは「形を 0/1 のマスクで持つ」のではなく「**距離で持つ**」こと。情報が豊かになり、
地図への操作がそのまま形の操作になる:

```
Mask = Point -> Bool        -- 中か外か (情報が少ない・捨てられない)
SDF  = Point -> Distance    -- 距離 (Mask へはいつでも step で落とせるが逆は不可)
```

### SDF の代数（これが言語の合成演算になる）

| 演算 | 式 | 意味 |
|---|---|---|
| 和集合 union | `min(a, b)` | くっつける |
| 共通部分 intersect | `max(a, b)` | 重なり |
| 差 subtract | `max(a, -b)` | a から b をくり抜く（`-b` で内外反転＝符号のおかげ）|
| 太らせ/丸角 offset | `a - r` | 全体を r 膨らます |
| 縁取り outline | `abs(a) - w` | 輪郭リング |
| 鏡映 / 繰り返し | 座標を `abs` / `mod` してから測る | 対称・タイル化 |

→ ほぼ**半環的な代数**（`min`/`max` が和/積、`-` が補集合）。これが SDF が宣言的設計と
相性抜群な理由。プリミティブ（`circle`/`box`）＋合成（上表）＋描画（`smoothstep` で
`SDF -> Mask`、`mix` で配色）に分解でき、Conal Elliott の画像代数や IQ のレイマーチングも同じ構造。

### 設計メモ

- プリミティブ例: `circle p = length p - r`, `box p = length(max(|p|-b,0)) + min(max(p.x,p.y),0)`
- 「中を負にする項」が "Signed" の正体（07-distance-field の min/max 分解で確認）。
- `circle` の distance 版 / dot 版（sqrt 省略）は**意味は同じ・実装違い** →「意味は 1 つ、
  実装はコンパイラが最適化で選ぶ」の好例（07-circle-dot）。
- 関連作例: [07-distance-field](../src/book-of-shaders/07-distance-field/main.ts)（abs/min/max/fract）、
  [07-fields-combine](../src/book-of-shaders/07-fields-combine/main.ts)（min=union / max=intersect）、
  [07-circle-dot](../src/book-of-shaders/07-circle-dot/main.ts)（dot で sqrt 省略）。

## 参考（denotational design / compiling to GPU）

- **Conal Elliott** — この構想のほぼ先駆。
  - *Functional Reactive Animation*（Fran）: `Behavior a = Time -> a`、`Event` を意味で定義。
  - *Pan / Vertigo*: 画像を `Point -> Color` と意味定義し、式を GPU コードへ**コンパイル**。
  - *Denotational design with type class morphisms*: 「型クラスの準同型で意味を設計する」方法論。API 設計の指針。
  - *Compiling to Categories*: 式を圏の射として扱い、GPU/回路など別ターゲットへ落とす。
- **GPipe**（Haskell）: 型安全なシェーダを式として書き、裏で GLSL を生成（EDSL の実例）。
- **Futhark / Accelerate**: 純関数型で書いて GPU 用にコンパイル。`map`/`fold`/`scan` が GPU 並列プリミティブに対応。

キーワード: denotational semantics, denotational design, semantic domain, EDSL, compiling to categories, SDF。

## 実装アプローチの分岐

1. **EDSL + コード生成**（GPipe 型）
   - ホスト言語（Haskell/TS など）で式（AST）を組み立て、WGSL 文字列 / SPIR-V を出力。
   - 現実的・小さく始められる。型検査をホストの型システムに乗せられる。
2. **独立言語 + 自前コンパイラ**（Futhark 型）
   - 自前の構文・型検査・最適化器を持ち、GPU IR（SPIR-V/WGSL）へ。
   - 学びは最大、工数も最大。

最小形のイメージ:

```haskell
type Image = Vec2 -> Color

circle :: Vec2 -> Float -> Image
circle c r = \st -> if length (st - c) < r then white else black
  -- これは「意味」。GPU では分岐せず step / smoothstep に落とす（= コンパイラの仕事）
```

ポイント: **意味（分岐や `if`、連続な定義）で書き、GPU 都合の表現（分岐回避・`step`/`mix`・fold への潰し込み）はコンパイラが担う**。

## 学習との接続（このリポジトリの進め方）

- 各作例を「1 ピクセルを追って意味を腹落ちさせる」方式で読む（既存の学習スタイル）。
- そのうえで各作例に「**この式の意味領域は何か？**」を一言添えると、そのまま言語設計のネタ帳になる。
- 次の 07「円」は `SDF = Point -> Distance` という綺麗な意味領域が出てくるので、その視点で読むと良い。