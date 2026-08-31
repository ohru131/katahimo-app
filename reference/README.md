# reference/

katahimo-appはGAS版 `gas-childcare-visit-app` からの移行プロジェクトであり、移植元ロジックを都度参照する運用のため、その時点のコピーをここに置いている。

## gas-childcare-visit-app

- **これは何か**: 移行元のGoogle Apps Scriptプロジェクト(`gas-childcare-visit-app`)のスナップショット。
- **スナップショット時点**: 2026-09-01(旧モノレポ `C001-cutest-internal` のコミット `ab5fb26e76063d83f561060b12a33564dd9b8385`、2026-08-30時点の内容)。
- **正(live)ではない**: このディレクトリは**その場限りのコピー**であり、以後GAS側で行われる不具合修正等には追従しない。GAS版は現在も本番稼働中で、旧モノレポ側(`C001-cutest-internal/01_GAS/gas-childcare-visit-app`)で独立に更新され続ける。最新の実装を確認したい場合は必ず旧モノレポ側を参照すること。
- **なぜ置いているか**: 本リポジトリのdoc/CHANGELOGは「GAS版の`Xxx.js`の`yyy`関数と同じ」という形でロジック移植の根拠を頻繁に参照しており、旧モノレポにアクセスできない環境でも移植元コードを読めるようにするため。
- `.clasp.json`のscriptId等は本プロジェクトの命名規約上シークレットではない(APIキー等の認証情報はScript Propertiesにあり、このスナップショットには含まれていない)。
