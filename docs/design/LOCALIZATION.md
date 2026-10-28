# Boardloom localization and RTL design

Status: T05 design annotation. The message-key catalog is proposed for the first UI implementation. Full dictionaries, key-parity checks, browser switching and Arabic RTL implementation belong to T17.

## 1. Contract

- Project documentation and prose are English. Product UI copy comes from locale dictionaries, not from hard-coded English in components.
- Built-in locales: `en`, `ru`, `es`, `fr`, `de`, `pt-BR`, `zh-CN`, `ja`, `ko`, `ar` and `hi`.
- English is the deterministic fallback. Host overrides take precedence over the selected built-in locale; the selected built-in locale takes precedence over English.
- The persisted board document is locale-neutral. It stores stable IDs, values and timestamps, not UI locale, translated labels or display timezone.
- Dataset field labels and data values are host content. Boardloom localizes its own messages, ARIA names, status, empty/loading/error copy, diagnostics, editor controls and chart guidance. A host may provide localized dataset labels through its own data contract.
- No professional or native-speaker translation certification is claimed. T17 records functional coverage and linguistic limitations.

The machine-readable key catalog is `message-keys.json`. Reference mock copy carries `data-message-key` attributes so T06 can reuse the same keys from the first implementation. Visible host fixture content, such as board names and school names, is deliberately not a message key.

## 2. Key rules

- Keys are stable, lowercase namespaces with dot-separated segments, for example `viewer.filters.origin.group` and `a11y.removeFilter`. Diagnostic keys use `diagnostic.<CODE>` with the stable uppercase diagnostic code.
- A key is never renamed without a compatibility path for host overrides. A renamed key keeps the old key as an alias or the release records a breaking change.
- Interpolation placeholders are named and typed. Values are escaped as text, never evaluated as code or HTML.
- Plurals use `Intl.PluralRules` and `.one` / `.other` fallback keys. Translated sentences are not assembled by concatenating fragments.
- Missing selected-locale keys fall back to English. A missing English key shows a documented neutral message and raises a development diagnostic; raw internal identifiers are not normal UI copy.
- Unknown host keys are reported as diagnostics and are not accepted as a different message.
- ARIA names and descriptions use the same catalog and interpolation rules as visible copy.
- Numbers, dates, times, durations and units use `Intl` formatting with an explicit display timezone independent of UI language.

## 3. Locale metadata

| Locale  | Direction | Initial scope              | Design note                                                    |
| ------- | --------- | -------------------------- | -------------------------------------------------------------- |
| `en`    | LTR       | English foundation         | Shortest reference copy                                        |
| `ru`    | LTR       | Complete dictionary in T17 | Expect 15 to 30 percent expansion                              |
| `es`    | LTR       | Complete dictionary in T17 | Expect 15 to 25 percent expansion                              |
| `fr`    | LTR       | Complete dictionary in T17 | Expect 15 to 25 percent expansion                              |
| `de`    | LTR       | Complete dictionary in T17 | Expect 30 to 50 percent expansion; prefer short labels         |
| `pt-BR` | LTR       | Complete dictionary in T17 | Brazilian Portuguese formatting                                |
| `zh-CN` | LTR       | Complete dictionary in T17 | CJK glyph fallback and line breaking must be checked           |
| `ja`    | LTR       | Complete dictionary in T17 | CJK glyph fallback and line breaking must be checked           |
| `ko`    | LTR       | Complete dictionary in T17 | Korean glyph fallback and line breaking must be checked        |
| `ar`    | RTL       | Complete dictionary in T17 | Scoped `dir="rtl"`, logical layout, bidi isolation for numbers |
| `hi`    | LTR       | Complete dictionary in T17 | Devanagari fallback and line height must be checked            |

The font stacks include Noto Sans and Noto Serif per script followed by system families. No locale requires a remote font request. A missing platform font falls through to the next family; T17 must confirm real rendering rather than assume coverage.

## 4. Copy annotation examples

The following samples are functional design copy, not a claim of linguistic certification. They show expansion, script coverage and the keys that must be present in every dictionary.

| Key                    | English                 | Russian                     | German                             | Arabic                    | Chinese        | Japanese                     | Korean                          |
| ---------------------- | ----------------------- | --------------------------- | ---------------------------------- | ------------------------- | -------------- | ---------------------------- | ------------------------------- |
| `viewer.filters`       | Filters                 | Фильтры                     | Filter                             | عوامل التصفية             | 筛选条件       | フィルター                   | 필터                            |
| `viewer.filters.reset` | Reset filters           | Сбросить фильтры            | Filter zurücksetzen                | إعادة تعيين عوامل التصفية | 重置筛选条件   | フィルターをリセット         | 필터 초기화                     |
| `state.stale.title`    | Data may be out of date | Данные могли устареть       | Daten sind möglicherweise veraltet | قد تكون البيانات قديمة    | 数据可能已过期 | データが古い可能性があります | 데이터가 오래되었을 수 있습니다 |
| `draft.dirty`          | Unsaved changes         | Несохранённые изменения     | Nicht gespeicherte Änderungen      | تغييرات غير محفوظة        | 未保存的更改   | 未保存の変更                 | 저장되지 않은 변경 사항         |
| `editor.block.move`    | Move block              | Переместить блок            | Block verschieben                  | نقل الكتلة                | 移动区块       | ブロックを移動               | 블록 이동                       |
| `a11y.skipToContent`   | Skip to board content   | Перейти к содержимому доски | Zum Board-Inhalt springen          | الانتقال إلى محتوى اللوحة | 跳转到看板内容 | ボードの内容へスキップ       | 보드 콘텐츠로 건너뛰기          |

Board titles, series labels, school names, product names and numeric values in the reference mocks are host fixture data. They are not translated by the framework and are labeled as synthetic.

## 5. Layout direction

### 5.1 Scoped RTL

Arabic sets `dir="rtl"` on the scoped Boardloom root, not on `html` or `body`. The host page direction, scrollbars and unrelated content remain untouched. A Boardloom instance can be RTL while the host page is LTR, and multiple instances can use different directions.

All component spacing uses logical properties: `margin-inline`, `padding-inline`, `inset-inline-start`, `border-inline-start`, `text-align: start`. The board grid uses logical start and end. Flex ordering follows DOM order rather than physical left and right. Drawers open from the inline end; the filter sheet and inspector therefore appear on the right in LTR and on the left in RTL without separate layout code.

### 5.2 Icons and controls

- Direction-bearing icons, such as back, forward, chevron and drawer close, mirror in RTL.
- Non-directional icons, such as chart type, lock, filter, search and play/pause, do not mirror.
- Keyboard shortcuts are unchanged. Arrow-key layout movement follows physical screen direction in every locale: Right moves visually right and Left moves visually left. In Arabic RTL, visual right is the inline start and visual left is the inline end; Up and Down remain vertical. The announcement names the resulting row and column and may add the logical direction as a secondary description. Visible controls are labeled by physical arrow with an accessible description of the current logical direction. This one contract prevents an arrow from meaning "visually right" in one sentence and "inline end" in another.
- Focus order follows DOM order. In RTL the visual reading order reverses with logical layout while the DOM remains meaningful.
- Numeric values, percentages, dates and times are bidi-isolated so a leading sign or percent does not move. A negative value remains a single readable token.
- The display timezone and numeric locale follow the selected locale configuration, not the document direction.

### 5.3 Charts

Chart plot geometry is not flipped blindly. Time and numeric axes retain their data direction so a reader can compare values without reinterpreting the axis. Titles, legends, captions and data tables follow the reading direction. Category labels and horizontal bar charts are checked for readable alignment; an axis moves to the inline start when that improves comprehension and the data direction remains explicit.

The data table is the authoritative accessible alternative in every direction. It is navigable by keyboard and states units, missing counts and active filter scope.

## 6. State preservation on locale change

Changing locale or display timezone must not:

- Replace, reload or revalidate the committed document.
- Discard the editor draft, revision or undo history.
- Reset active filter values, cross-filter selection, comparison configuration or query generations.
- Recreate realtime subscriptions or hide their current status.
- Move focus to the document body or reset scroll without need.

The runtime rerenders framework-owned copy and re-formats values. Host dataset labels remain host-owned. Focus is preserved on the same control where it still exists; otherwise it moves to the nearest stable heading and is announced.

## 7. Copy and spacing constraints

- English labels are authored as short as possible without losing meaning; German and Russian expansion is planned for in the layout, not solved by truncating text.
- Buttons and chips wrap to a second line where the layout permits. Critical actions keep a stable minimum width and never rely on an ellipsis that hides the verb.
- The board title wraps up to two lines on narrow screens; metadata moves below it rather than shrinking to unreadable size.
- Numbers use tabular figures and locale-aware separators. Units are localized separately from raw dataset units.
- Date and time labels name the display timezone. A language change never changes the timezone or a date bucket boundary.
- No sentence is built by concatenating translated fragments. Interpolated values are complete parameters with translator-visible context in the catalog.

## 8. T17 verification plan

The later localization task must verify in a real browser:

1. Every built-in locale has exactly the required key set, including ARIA, status, diagnostics, empty/loading/error, editor, filter, comparison and realtime copy.
2. Missing-key fallback to English is deterministic and development diagnostics identify the missing key.
3. Interpolation with missing or extra parameters is non-crashing, escaped and announced without raw internals.
4. Plural categories follow `Intl.PluralRules` for representative count values.
5. Locale switching preserves board, draft, undo, filters, cross-filter, comparison, realtime state, scroll and focus where practical.
6. English, Russian, a CJK locale and Arabic RTL are exercised through the real viewer and editor, with screenshots and video.
7. The Arabic instance sets direction only on the scoped root; the host page remains unchanged. Focus order, drawers, icons, numeric values, chart labels and data tables remain usable.
8. CJK and Devanagari rendering, line breaking and clipping are checked with the longest available labels.
9. Display timezone stays independent of UI language and formatting follows the selected locale.
10. The review records functional coverage and does not claim native-speaker or professional translation certification.
