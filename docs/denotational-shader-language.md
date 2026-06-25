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