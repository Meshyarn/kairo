# 롤아웃 & 실험

이 설정들은 주로 canary/beta와 같은 점진적 롤아웃, 실험을 위한 것입니다. 운영 환경에서 예측 가능한 동작을 원한다면 presets와 기본 정책 파일을 우선 사용하세요.

## 네이티브 엔진 토글(ADR-053-H)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_RUST_CORE_ENABLED` | Rust 코어를 전역 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_CHUNKING_ENABLED` | Rust chunking 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_DIFF_ENABLED` | Rust diffing 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_SYNTAX_ENABLED` | Rust syntax validation 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_VECTOR_ENABLED` | Rust vector math 활성화. | `on/off` (기본: on). |
| `KAIRO_RUST_SYMBOLIC_SOLVER_ENABLED` | Rust symbolic solver capability 활성화. | `on/off` (기본: on; Rust core enabled일 때만). |
| `KAIRO_WASM_CHUNKING_ENABLED` | WASM chunking provider 활성화. | `on/off` (기본: off). |
| `KAIRO_RUST_CHUNKING` | 레거시 Rust chunking 토글. | 역호환; `KAIRO_RUST_CHUNKING_ENABLED` 권장. |
| `KAIRO_TOKENIZER_PATH` | `tokenizer.json`의 절대 경로. | 선택; Kairo가 표준 cache/model 경로에서 자동 탐지합니다. |
| `KAIRO_DOC_CHUNK_PROFILE` | 인덱싱용 기본 토큰 chunk 프로파일. | `fast/balanced/deep` (outlineOptions가 오버라이드하지 않을 때만 사용). |

## 모듈러 롤아웃(ADR-045)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_MODULAR_HANDLERS_ENABLED` | 모듈러 handler registry 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_UNIFIED_EXTRACTION_ENABLED` | unified extraction pipeline 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_PILLAR_DECOMPOSITION_ENABLED` | decomposed pillar modules 토글. | `true/false`가 percent를 오버라이드. |
| `KAIRO_MODULAR_ROLLOUT_PERCENT` | 모듈러 플래그 롤아웃 퍼센트. | `0-100`; rollout user hashing 사용. |
| `KAIRO_ROLLOUT_USER` | 롤아웃 hashing용 기본 user ID. | 호스트가 user ID를 전달하지 않으면 사용. |

## 적응형 플로우 롤아웃(ADR-075)

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ROLLOUT_MODE` | 롤아웃 preset(`legacy|shadow|canary|beta|full`). | 기본 preset 스위치. |
| `KAIRO_ROLLOUT_PHASE` | `KAIRO_ROLLOUT_MODE`의 alias. | 역호환을 위해 유지. |
| `KAIRO_ROLLOUT_CANARY_USERS` | canary allowlist. | comma-separated user IDs. |
| `KAIRO_ROLLOUT_BETA_PERCENT` | beta 롤아웃 퍼센트. | `0-100`. |
| `KAIRO_ROLLOUT_FORCE` | preset 강제 적용. | 명시적 env overrides가 있어도 적용. |
| `KAIRO_ADAPTIVE_FLOW_ENABLED` | Adaptive Flow 플래그 오버라이드. | `on|off|canary|beta|full` (선택 payload). |
| `KAIRO_UCG_ENABLED` | UCG 플래그 오버라이드. | 위와 동일. |
| `KAIRO_TOPOLOGY_SCANNER_ENABLED` | topology scanner 플래그 오버라이드. | 위와 동일. |
| `KAIRO_DUAL_WRITE_VALIDATION` | dual-write validation 토글. | 위와 동일. |
| `KAIRO_TOPOLOGY_SUCCESS_MIN` | topology success rate 알림 임계값. | 기본 `0.95`. |
| `KAIRO_UCG_MEMORY_MAX_MB` | UCG memory estimate 알림 임계값. | 기본 `500`. |
| `KAIRO_L3_PROMOTION_RATIO_MAX` | L3 promotion ratio 알림 임계값. | 기본 `0.5`. |

