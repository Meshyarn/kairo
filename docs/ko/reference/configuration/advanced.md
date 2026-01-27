# 고급 튜닝

이 페이지는 “첫 성공이 안정적”이 된 뒤 더 깊게 튜닝할 때를 위한 내용입니다.

## 적응형 LOD

Adaptive LOD는 예산/타임박스 제약에서 출력 디테일을 자동으로 downshift 합니다.

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_ADAPTIVE_LOD_ENABLED` | 적응형 프로파일 downshift 활성화. | 기본 `true`; 비활성화하려면 `false`. |
| `KAIRO_ADAPTIVE_LOD_WINDOW` | 슬라이딩 윈도우 크기(호출 수). | 기본 12. |
| `KAIRO_ADAPTIVE_LOD_COOLDOWN_CALLS` | 복구를 허용하기 전 쿨다운 호출 수. | 기본 20. |

## 스케일 티어

스케일 티어는 대형 저장소에서 동작 상한을 둡니다.

| 변수 | 용도 | 비고 |
|---|---|---|
| `KAIRO_SCALE_TIER_S_MAX_FILES` | 스케일 티어 S의 최대 파일 수. | 기본 5000. |
| `KAIRO_SCALE_TIER_M_MAX_FILES` | 스케일 티어 M의 최대 파일 수. | 기본 50000. |

전체 목록:

- [설정(전체 환경 변수)](/ko/guides/configuration)
