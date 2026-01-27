# 안전한 쓰기: plan → apply, drift, tokens

Kairo는 에이전트 프레임워크가 “쓰기”를 신뢰 가능하게 만들 수 있도록, 편집을 **2단계 계약**으로 다룹니다.

## 핸드셰이크

MCP 모드(`KAIRO_MODE=mcp`)에서는 보통 apply가 게이트됩니다:

1. **Plan**: draft(`draftId`) + (MCP 모드에서) one-time `applyToken`
2. **Apply**: `draftId + applyToken`로 적용
3. **Verify**: 결과 검증(적용 결과에 포함되거나 별도 호출)

## Drift 인지 안전

**Drift**는 plan 이후, apply 전에 파일이 변경되는 경우입니다(사람, formatter, CI, 다른 에이전트의 편집).

### 타임라인 예시

```
1. Plan 단계
   ├─ Kairo가 "src/auth.ts" 스냅샷(해시: abc123)
   └─ draftId + applyToken 반환 (해시: abc123 인코딩)

2. 시간 경과 (초~시간)
   ├─ 사용자/formatter가 "src/auth.ts" 수동 편집
   ├─ CI가 prettier 실행, 해시 변경 → xyz789
   └─ 파일 내용이 이미 다른 상태

3. Apply 단계
   ├─ 호스트가 applyToken(예상 해시: abc123)으로 apply 호출
   ├─ Kairo가 현재 파일 해시 확인: xyz789
   └─ 불일치! → apply 거절
```

### Drift 검사가 중요한 이유

Drift 검사 없이:
- Kairo가 변경된 내용 위에 **무조건 적용** → 파일 손상
- 병합 충돌이 무음 → 숨겨진 버그
- 여러 에이전트 동시 편집 → 데이터 손실

Drift 검사로:
- Apply가 **명확한 이유와 함께 실패**
- 호스트가 반드시 해결 (재계획 또는 수동 수정)
- 안전한 복구 사다리: 재읽기 → 재인덱싱 → 범위 축소

Kairo는 다음으로 보호합니다:

1. **Snapshot**: plan 시 파일 상태 스냅샷(해시/버전)
2. **Token**: `applyToken`이 예상 상태 인코딩
3. **Block**: 파일이 drift하면 토큰 거절

대표적인 "blocked" 원인:

- apply token 누락/만료/재사용
- 대상 불일치(다른 파일에 draft를 적용하려 함)
- plan 스냅샷 대비 drift 발생
- 정책/가드레일 위반


## 프레임워크 do / don’t

Do:

- `guidance.nextCalls`를 우선으로 그대로 실행
- apply는 serialize(토큰은 1회성)
- `draftId/applyToken`을 호스트 텔레메트리에 기록(토큰은 필요 시 마스킹)

Don’t:

- apply 단계에서 불필요하게 `edits`/targets를 다시 보내기
- write draft apply에서 `targetPath`를 바꾸려 시도하기(불일치는 차단되어야 안전)

정확한 계약은 아래 참고:

- [도구 레퍼런스](/ko/agent/TOOL_REFERENCE)
- [ADR-086](/adr/ADR-086-task-compact-change-write-verify)

