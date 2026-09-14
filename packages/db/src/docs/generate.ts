import { writeFileSync } from 'node:fs';
import { collectTables } from './collectSchema';
import { REFERENCE_PATH } from './referencePath';
import { renderReference } from './renderReference';

/** `pnpm db:docs` の実体。doc/db/reference.md を書き出す。 */
writeFileSync(REFERENCE_PATH, renderReference(collectTables()), 'utf8');
console.log(`生成しました: ${REFERENCE_PATH}`);
