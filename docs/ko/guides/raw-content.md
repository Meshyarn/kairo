# 원문(Raw) 콘텐츠 전달 (write/change)

::: tip Stable (ADR-089)
`write`/`change`에서 원문 소스(ContentSource)가 안정적으로 지원됩니다.
따옴표/이스케이프 깨짐을 피하려면 `ContentSource` 사용을 권장합니다.
:::

Vue/Svelte/Astro 템플릿, JSON, 정규식이 많은 코드처럼 따옴표/이스케이프가 복잡한 텍스트는
JSON 문자열로 운반하는 과정에서 **따옴표/이스케이프 깨짐** 문제가 자주 발생합니다.

ADR-089는 `ContentSource`를 도입하여, 문자열 자체 대신 **file/base64/artifact** 같은 더 안전한 채널로
원문을 전달할 수 있도록 합니다(도구 계약은 계속 discoverable 하게 유지).

아키텍처 결정 및 호환성 정책은 아래 ADR을 참고하세요:

- [ADR-089: Raw content sources for change/write](/adr/ADR-089-raw-content-sources-for-change-write)

## ContentSource

`ContentSource`는 kind를 가진 tagged object 입니다:

```json
{ "kind": "inline", "text": "..." }
```

지원하는 kind:

- `inline` — 기존 문자열 전달과 동일하지만, 명시적으로 표현합니다.
- `base64` — UTF-8 텍스트를 base64로 인코딩.
- `file` — 파일 경로(repo root 상대경로)에서 텍스트를 읽음.
- `artifact` — 저장된 artifact id에서 텍스트를 읽음.

## `write`

복잡한 원문 텍스트는 `contentSource` 사용을 권장합니다.

- `contentSource`가 있으면 `content`보다 우선합니다.
- `contentBase64`는 레거시/임시 경로이며(Deprecated, 경고가 출력됨), `contentSource` 사용을 권장합니다.

예시(file):

```json
{
  "intent": "Vue 템플릿 업데이트",
  "targetPath": "src/App.vue",
  "contentSource": { "kind": "file", "path": ".kairo/tmp/app.vue.txt" }
}
```

## `change` (구조화된 edits)

정확하고 모호하지 않은 변경을 위해 edit 단위로 `targetSource` / `replacementSource`를 사용할 수 있습니다.

```json
{
  "intent": "템플릿 블록 교체",
  "targetFiles": ["src/App.vue"],
  "edits": [
    {
      "filePath": "src/App.vue",
      "targetSource": { "kind": "file", "path": ".kairo/tmp/target.txt" },
      "replacementSource": { "kind": "file", "path": ".kairo/tmp/replacement.txt" }
    }
  ]
}
```

## 마이그레이션 (레거시 필드)

레거시 base64 필드는 여전히 허용되지만 Deprecation 경고가 출력됩니다. `contentSource` 사용을 권장합니다.

- `contentBase64` → `contentSource: { kind: "base64", base64: "..." }`
- `edits[].targetStringBase64` / `edits[].targetBase64` → `edits[].targetSource`
- `edits[].replacementStringBase64` / `edits[].replacementBase64` → `edits[].replacementSource`

Deprecation 안내는 tool contract findings 및 guidance warnings에 기록됩니다.

## 보안/제한사항 (`file` source)

`contentSource.kind="file"` 사용 시:

- 경로는 workspace/repo root 내부로 제한됩니다(멀티 레포: `repoId` / `repoScope` 기준).
- ignore 규칙이 적용됩니다(`.gitignore`, `.mcpignore`, Kairo 내부 ignore).
- 내부 디렉터리는 기본적으로 차단되며, temp 디렉터리만 허용됩니다:
  - `.kairo/tmp` / `.kairo/temp` (또는 `${KAIRO_DIR}/tmp`, `${KAIRO_DIR}/temp`)
- 큰 파일은 거부됩니다. 최대 크기는 `KAIRO_CONTENT_SOURCE_MAX_BYTES`로 제어됩니다(기본: `1048576`).

## 클라이언트 헬퍼 패턴

복잡한 템플릿은 다음 흐름을 권장합니다:

1) 원문 텍스트를 `.kairo/tmp/<name>.txt`에 저장합니다.
2) Plan: `contentSource.kind="file"`로 `write` 또는 `change`를 호출합니다(dry-run / `safety:"plan"`).
3) Apply: 반환된 `draftId`(MCP 모드에서는 `applyToken` 포함)로 apply를 수행합니다. apply 단계에서는 `contentSource`를 다시 보내지 마세요.
4) 임시 파일을 삭제하거나 TTL 정리(`KAIRO_TEMP_FILE_TTL_MS`)에 맡깁니다.

## 멀티레포 + ignore 규칙

- 경로는 선택된 repo root 기준으로 해석됩니다(`repoId` / `repoScope`).
- `file` source는 프로젝트 ignore 규칙(예: `.gitignore`, `.mcpignore`, Kairo 내부 ignore)을 준수해야 합니다.

## 임시 파일 (`.kairo/tmp`)

git 상태/인덱싱/검색에 불필요한 노이즈를 남기지 않도록, 임시 payload는 아래 경로를 권장합니다:

- `.kairo/tmp/` (또는 `KAIRO_DIR/tmp`)
