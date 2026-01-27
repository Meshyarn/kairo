# 스토리지 & prune

Kairo는 기본적으로 대상 프로젝트 루트의 `.kairo/` 아래에 런타임 상태를 저장합니다.

## 핵심 설정

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_DIR` | 데이터 디렉터리. | 기본값 `.kairo` (index/cache/history 포함). |
| `KAIRO_ALLOW_LEGACY_MCP_DIR` | `KAIRO_DIR`에 대해 레거시 `.mcp` 경로를 허용. | 레거시 `.mcp`는 deprecated. 가능하면 `.kairo` 사용. |
| `KAIRO_STORAGE_MODE` | 스토리지 백엔드. | `file`(기본) 또는 `memory`(비영속). |

## 스토리지 유지보수(ADR-059)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_STORAGE_PRUNE_INTERVAL_MS` | 백그라운드 prune 주기(ms). | `0`/미설정이면 백그라운드 prune 비활성화. |
| `KAIRO_STORAGE_PRUNE_ON_START` | 시작 시 prune 1회 실행. | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_FLOW_ARTIFACTS` | prune에 flow artifacts 포함. | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_TEMP_FILES` | prune에 temp files 포함(`.kairo/tmp`, `.kairo/temp`). | `true`로 활성화. |
| `KAIRO_STORAGE_PRUNE_COMPACT` | prune 이후 compact rewrite 수행. | `true`로 활성화. |
| `KAIRO_TASK_EVIDENCE_TTL_MS` | task evidence pack TTL(ms). | 기본 `1800000` (30분). |
| `KAIRO_EVIDENCE_PACK_MAX_COUNT` | evidence pack 최대 개수 상한. | 기본 ~300. |
| `KAIRO_EVIDENCE_PACK_MAX_BYTES` | evidence pack 바이트 상한. | 기본 100MB. |
| `KAIRO_EVIDENCE_PACK_STALE_CHECK_MAX_ITEMS` | evidence pack stale 샘플링 상한. | 기본 24 items. |
| `KAIRO_CHUNK_SUMMARY_MAX_CHUNKS` | chunk summary 최대 chunk 수. | 기본 20k. |
| `KAIRO_CHUNK_SUMMARY_MAX_BYTES` | chunk summary 바이트 상한. | 기본 100MB. |
| `KAIRO_TEMP_FILE_TTL_MS` | temp file TTL(ms). | 기본 `604800000`(7일). `temp_files` prune 시 사용. |
| `KAIRO_TEMP_FILE_MAX_COUNT` | temp file 최대 개수 상한. | 기본 `0`(상한 없음). `temp_files` prune 시 사용. |

## 패치 원장 디스크 가드레일

패치 히스토리(ledger) 저장소의 디스크 여유를 보호하는 가드레일입니다.

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_PATCH_STORAGE_WARN_FREE_PCT` | 패치 원장(ledger) 디스크 여유 경고 임계값(%). | 기본 8. |
| `KAIRO_PATCH_STORAGE_BLOCK_FREE_PCT` | 패치 원장(ledger) 디스크 여유 차단 임계값(%). | 기본 3. |

자세한 내용:

- [설정(전체 환경 변수)](/ko/guides/configuration)
