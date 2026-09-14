// スプレッドシート・CSV・外部システムからの取込パイプライン(doc/proposal/tech-stack.md 第8章)。
// 取得 → デコード → パース → マッピング → 検証/差分計算 → レビュー → 適用(upsert + ソフトデリート)
export * from './reservaCsv';
