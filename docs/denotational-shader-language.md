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

## 対称性 = 商への畳み込み（fold）

パターンの意味は「平面を対称群 G で畳んで、基本領域の中身を塗る」に分解できる:

```
Painting = Vec2 -> Color      -- 基本領域の中身（コンテンツ）
Symmetry = Vec2 -> Vec2       -- 平面を基本領域へ畳む = 軌道の代表元をとる（商 ℝ²/G）

wallpaper fold paint = paint . fold
```

`fold` は「点 p を、G で p と同値な点のうち基本領域内の代表元へ送る」写像。パターン生成とは
**商への射影 → 基本領域を塗る** の合成にすぎない。並進格子なら `fract` 一発、回転・鏡映が
入ると鏡の線での折り返し reduction になる（SDF の `abs`/`mod` 対称と地続き）。

### 壁紙群の「17」は列挙じゃなく代数の帰結

平面の周期パターンは17種類（壁紙群）しかない。これは17を覚えるものではなく、**少数の生成子を
合成して閉じさせた結果17しか作れない**という分類定理。生成子はごく少数:

- 平行移動（格子ベクトル2本） / 回転（2,3,4,6回のみ＝結晶学的制限） / 鏡映 / すべり鏡映

PL 的には **群の表示（generators + relations）**。言語では17をハードコードせず、4種の等長変換を
primitive として与え合成で閉じさせれば、17が**創発する**。列挙でなく代数で出るのがこの設計の勘所。

### 「対称性で2Dは十分か」→ No。直交する3軸で捉える

`wallpaper` が扱うのは「周期的な装飾」という1軸だけ。畳んだ後の話が抜けている:

| 軸 | 型 | 壁紙群がカバーするか |
|---|---|---|
| コンテンツ | `Vec2 -> Color` | ✗（自由。グラデ・ノイズ・単一物体） |
| 対称性 | `Vec2 -> Vec2`（fold） | ✓ ← ここだけが17 |
| 幾何 / warp | どの計量で群を組むか | ✗（ユークリッド固定で17。双曲なら群は無限＝エッシャー Circle Limit） |

つまり「17で足りる」のではなく「**17を生む生成子と `商` combinator を持てば、対称性の軸が綺麗に閉じる**」。
対称性は `Painting` と `warp` に直交合成される3本柱の1本。

## 2D の具体ターゲット: ゼンタングル

長期ゴール（シェーダ生成言語）の最初の 2D 題材を **ゼンタングル**（構造的な反復タイル画）に置く。
上の3軸を全部使わせた上で、**2つ新しい primitive** を要求してくるので necessity-driven に噛み合う。

```
Tangle = Vec2 -> Ink        -- 局所座標 → インク（＝ SDF のしきい値。Color でなく線画）
String = Vec2 -> CellId     -- 平面の分割（どのセルか）
render string tangleOf frame p = ink (tangleOf c) (frame c p) where c = string p
```

壁紙群の議論に対して新しいのは2つ:

- **分割（string）**: 平面を畳むのでなく、**切って別々の関数を貼る**。FP 的には region への `case` / dispatch。
- **インク = SDF**: 出力が Color でなく「線があるか」。ストロークまでの距離を `smoothstep` で閾値。線画は全部これ。

### tangle の3系統（格子系は上の `fold` の再利用）

| 系統 | 例 | 実装 | 使う軸 |
|---|---|---|---|
| 格子系 | Tipple, グリッド, Bales | `motif . fold_G` | 対称性の `fold` |
| フロー系 | Flux, Mooka, Printemps | 背骨曲線に沿う再パラメータ化 `Vec2→(弧長,法線)` | warp 軸の具体化 |
| 再帰系 | Fragments, 成長 | 文法 / L-system + 深さパラメータ | 新軸（再帰） |

**格子系 tangle ＝ 対称性の `fold` をセル内に閉じ込めたもの**。壁紙群の議論はここで部品として回収される。

### 一番難しい所（＝ SDF を学ぶ必然）

境界追従の tangle（模様がセル輪郭に沿って流れる）は、任意形状セルの大域パラメータ化が要る。
逃げ道は綺麗で、**セル自身の SDF（境界までの距離）を座標の1本に使う**。距離の等高線が
輪郭沿いのカーブ座標を自動でくれる。「境界追従を描きたい」欲求が、そのまま SDF 構築を学ぶ動機になる。

### 最初の一歩（新概念を1つに絞る）

**1セル・格子系 tangle 1個・出力はインク（SDF閾値）** から。新しいのは「Color 出力 → 距離出力の線画」だけ。
中身の反復は `fold` の使い回し。具体は *Tipple*（点を敷き詰める）か *Bales*（グリッド各マスに円弧1本）:
並進格子を `fract` で畳み、ストロークの SDF を1本置いて `min` で union、が全パイプライン。

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